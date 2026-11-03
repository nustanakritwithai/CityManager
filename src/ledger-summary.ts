import { MONTH } from './sim.ts';

/** Presentation only: folds one wallet's journal rows into "what came in, what went out" for the panel. */
export type DigestRow = { tick: number; from: string; to: string; value: number; label: string };
export type DigestGroup = { key: string; label: string; direction: 'in' | 'out'; total: number; entries: number };
export type LedgerDigest = { fromTick: number; toTick: number; totalIn: number; totalOut: number; entries: number; groups: DigestGroup[] };

/** Entries listed one by one before the player asks for the full list. */
export const RECENT_ENTRIES = 3;
/** Kinds shown by name; smaller ones fold into one "other" row so the summary stays short. */
export const DIGEST_GROUPS = 4;

/** "ซื้อขายพืชผล · รายการ #2286" and "Crop export #2288" become one kind each. */
export function groupLabel(label: string): string {
  const base = label.replace(/\s*(?:·\s*)?(?:รายการ\s*)?#\d+\s*$/u, '').replace(/^รายการอื่น:\s*/u, '').trim();
  return base || label;
}

/** Inclusive last `days` days ending today; rows are any order, values are non-negative. */
export function ledgerDigest(rows: readonly DigestRow[], wallet: string, tick: number, days = MONTH): LedgerDigest {
  const fromTick = Math.max(0, tick - days + 1), byKey = new Map<string, DigestGroup>();
  let totalIn = 0, totalOut = 0, entries = 0;
  for (const row of rows) {
    if (row.tick < fromTick || row.tick > tick || (row.from !== wallet && row.to !== wallet)) continue;
    if (row.from === wallet && row.to === wallet) continue; // moving within one wallet changes nothing for it
    const direction = row.to === wallet ? 'in' : 'out', label = groupLabel(row.label), key = `${direction}:${label}`;
    const group = byKey.get(key) ?? { key, label, direction, total: 0, entries: 0 };
    group.total += row.value; group.entries++; byKey.set(key, group); entries++;
    if (direction === 'in') totalIn += row.value; else totalOut += row.value;
  }
  const sorted = [...byKey.values()].sort((a, b) => b.total - a.total || b.entries - a.entries || a.key.localeCompare(b.key));
  const groups = sorted.slice(0, DIGEST_GROUPS);
  for (const direction of ['in', 'out'] as const) {
    const rest = sorted.slice(DIGEST_GROUPS).filter(group => group.direction === direction);
    if (rest.length) groups.push({ key: `${direction}:other`, label: 'อื่น ๆ', direction, total: rest.reduce((n, g) => n + g.total, 0), entries: rest.reduce((n, g) => n + g.entries, 0) });
  }
  return { fromTick, toTick: tick, totalIn, totalOut, entries, groups };
}
