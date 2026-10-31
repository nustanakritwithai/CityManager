/** Read-only migration inventory. Browser originals are never edited or removed. */
import { decodeSaveCopy } from './save-copy-codec.ts';
import { deserializeParkSession } from './park-runtime.ts';
import { listRecoveryCopies, type RecoveryListing } from './recovery-idb.ts';
import { validateRecoveryMarketJournal } from './market-client.ts';

export type MigrationCandidate = { raw: string; sources: string[]; tick: number };
type Reader = Pick<Storage, 'length' | 'key' | 'getItem'>;
const CITY_KEY = /^citymanager\.(save\.|backup\.|checkpoint\.)/;
const POINTER_KEYS = new Set(['citymanager.backup.latest', 'citymanager.backup.save-conflict.latest']);

export async function inventoryLegacyCities(
  storage?: Reader,
  listRecovery: () => Promise<RecoveryListing[]> = listRecoveryCopies,
): Promise<{ candidates: MigrationCandidate[]; issues: string[] }> {
  const unique = new Map<string, MigrationCandidate>();
  const issues: string[] = [];
  const add = (raw: string, source: string) => {
    try {
      const { city } = deserializeParkSession(raw);
      const parsed = JSON.parse(raw);
      if (Object.hasOwn(parsed, 'market')) validateRecoveryMarketJournal(parsed.market);
      const found = unique.get(raw);
      if (found) { if (!found.sources.includes(source)) found.sources.push(source); }
      else unique.set(raw, { raw, sources: [source], tick: city.tick });
    } catch { issues.push(`${source}: unreadable-city`); }
  };
  try {
    const reader = storage ?? globalThis.localStorage;
    if (!reader) throw Error('storage-unavailable');
    // Snapshot keys first; an individual unreadable slot must not hide other slots.
    const keys = new Set<string>();
    const length = reader.length;
    for (let i = 0; i < length; i++) {
      try { const key = reader.key(i); if (key && CITY_KEY.test(key)) keys.add(key); }
      catch { issues.push(`localStorage:index:${i}: unavailable`); }
    }
    for (const key of [...keys].sort()) {
      const source = `localStorage:${key}`;
      try {
        const encoded = reader.getItem(key);
        if (encoded === null) { issues.push(`${source}: changed-during-read`); continue; }
        // These keys are references, not save bodies. Check that referenced bytes
        // remain available; enumeration independently imports every retained slot.
        if (POINTER_KEYS.has(key) && CITY_KEY.test(encoded)) {
          if (!keys.has(encoded)) issues.push(`${source}: missing-reference`);
          continue;
        }
        if (key === 'citymanager.backup.save-conflict.index') {
          const references: unknown = JSON.parse(encoded);
          if (!Array.isArray(references) || !references.every(k => typeof k === 'string' && /^citymanager\.backup\.save-conflict\.[0-9]+$/.test(k))) throw Error('invalid-index');
          if (references.some(k => !keys.has(k))) issues.push(`${source}: missing-reference`);
          continue;
        }
        const raw = decodeSaveCopy(encoded);
        if (raw === null) throw Error('empty-copy');
        add(raw, source);
      } catch { issues.push(`${source}: unreadable`); }
    }
  } catch { issues.push('localStorage: unavailable'); }
  try {
    for (const item of await listRecovery()) {
      const source = `indexedDB:${item.branchId}:${item.slot}${item.snapshot ? `:${item.snapshot.revision}` : ''}`;
      if (!item.snapshot) { issues.push(`${source}: unreadable-city`); continue; }
      add(item.snapshot.raw, source);
    }
  } catch { issues.push('indexedDB: unavailable'); }
  // Deliberately no selection or freshness sorting: a high tick is not authority.
  return { candidates: [...unique.values()], issues: [...new Set(issues)] };
}
