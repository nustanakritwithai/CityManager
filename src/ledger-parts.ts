/**
 * Daily household summaries, kept by a big town (tile-scale.ts). A town of thousands of households would otherwise write a
 * money entry and a goods entry for every household's shopping every day, and keep a month or two of them: megabytes of
 * save and seconds of checking at the month's end. Instead one entry stands for a day's payments between many households
 * and one other account: its `from` (or `to`) is HOUSEHOLDS, and `parts` lists, in the order they paid, each household's
 * id and amount (or quantity), which add up to the entry's total. Every reader that follows wallets sees the same
 * payments, the legs, as one entry each would give.
 */
export const HOUSEHOLDS = 'households';
export const householdWallet = (id: number) => `household:${id}`;

type Parted = { from: string; to: string; parts?: readonly number[] };
type MoneyLike = Parted & { amount: number };
type GoodsLike = Parted & { quantity: number };
export type Leg = { from: string; to: string; value: number };

/** The value an entry moves: a money entry's amount or a goods entry's quantity. */
const valueOf = (e: MoneyLike | GoodsLike) => 'amount' in e ? e.amount : e.quantity;

/** Whether an entry is a summary of many households' payments. */
export const isSummary = (e: Parted): boolean => e.parts !== undefined;

/** Each payment an entry stands for, in order: the entry itself, or one leg for each household of a summary. */
export function legs(e: MoneyLike | GoodsLike): Leg[] {
  const parts = e.parts;
  if (!parts) return [{ from: e.from, to: e.to, value: valueOf(e) }];
  const out: Leg[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const wallet = householdWallet(parts[i]);
    out.push(e.from === HOUSEHOLDS ? { from: wallet, to: e.to, value: parts[i + 1] } : { from: e.from, to: wallet, value: parts[i + 1] });
  }
  return out;
}

/** Calls `fn` for each payment an entry stands for, without building the list. */
export function forEachLeg(e: MoneyLike | GoodsLike, fn: (from: string, to: string, value: number) => void): void {
  const parts = e.parts;
  if (!parts) { fn(e.from, e.to, valueOf(e)); return; }
  const fromHouseholds = e.from === HOUSEHOLDS;
  for (let i = 0; i < parts.length; i += 2) {
    const wallet = householdWallet(parts[i]);
    if (fromHouseholds) fn(wallet, e.to, parts[i + 1]); else fn(e.from, wallet, parts[i + 1]);
  }
}

/** The household ids a summary names, in order; none for an ordinary entry. */
export function summaryHouseholds(e: Parted): number[] {
  const parts = e.parts, ids: number[] = [];
  if (parts) for (let i = 0; i < parts.length; i += 2) ids.push(parts[i]);
  return ids;
}

/**
 * A summary's own shape: exactly one side is HOUSEHOLDS, the other a real account; the parts are pairs of a household id
 * (each household once) and a positive whole amount, adding up to the total. An ordinary entry never names HOUSEHOLDS.
 */
export function validSummary(e: MoneyLike | GoodsLike): boolean {
  const parts = e.parts as unknown;
  if (parts === undefined) return e.from !== HOUSEHOLDS && e.to !== HOUSEHOLDS;
  if (!Array.isArray(parts) || parts.length < 2 || parts.length % 2 !== 0) return false;
  if ((e.from === HOUSEHOLDS) === (e.to === HOUSEHOLDS)) return false;
  const seen = new Set<number>();
  let sum = 0;
  for (let i = 0; i < parts.length; i += 2) {
    const id = parts[i], value = parts[i + 1];
    if (!Number.isSafeInteger(id) || id < 1 || seen.has(id) || !Number.isSafeInteger(value) || value < 1) return false;
    seen.add(id); sum += value;
    if (!Number.isSafeInteger(sum)) return false;
  }
  return sum === valueOf(e);
}

/** One summary being collected: its other account, direction, reason (and product), parts and total. */
export type SummaryLine = { other: string; fromHouseholds: boolean; reason: string; product?: string; parts: number[]; total: number };
/**
 * Collects one day's household payments into summaries while the day is worked out: one per account, direction, reason
 * and product. `add` records a leg; `lines` gives the summaries in the order their first leg came. A household that pays
 * into the same summary twice in a day has its amounts added together.
 */
export class SummaryBook {
  private byKey = new Map<string, SummaryLine & { at: Map<number, number> }>();
  add(householdId: number, other: string, fromHouseholds: boolean, reason: string, value: number, product?: string): void {
    if (!(value > 0)) return;
    const key = `${fromHouseholds ? '<' : '>'}${other}|${reason}|${product ?? ''}`;
    let line = this.byKey.get(key);
    if (!line) { line = { other, fromHouseholds, reason, ...(product === undefined ? {} : { product }), parts: [], total: 0, at: new Map() }; this.byKey.set(key, line); }
    const index = line.at.get(householdId);
    if (index === undefined) { line.at.set(householdId, line.parts.length); line.parts.push(householdId, value); }
    else line.parts[index + 1] += value;
    line.total += value;
  }
  lines(): SummaryLine[] { return [...this.byKey.values()].map(({ at: _, ...line }) => line); }
  get size(): number { return this.byKey.size; }
}

/** The reason one household's own entry would carry, for a summary's reason. */
const ownReason: Readonly<Record<string, (id: number) => string>> = {
  'Household purchases': id => `Household #${id} purchase`,
  'Household other spending': id => `Household #${id} other spending`,
};
/** The entries a summary stands for, one a household, as a town without summaries would have written them. */
export function expandEntry<E extends (MoneyLike | GoodsLike) & { reason: string }>(e: E): E[] {
  const parts = e.parts;
  if (!parts) return [e];
  const own = ownReason[e.reason], fromHouseholds = e.from === HOUSEHOLDS, key = 'amount' in e ? 'amount' : 'quantity', out: E[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const wallet = householdWallet(parts[i]), { parts: _, ...rest } = e as E & { parts?: readonly number[] };
    out.push({ ...rest, from: fromHouseholds ? wallet : e.from, to: fromHouseholds ? e.to : wallet, [key]: parts[i + 1], reason: own ? own(parts[i]) : e.reason } as unknown as E);
  }
  return out;
}
/** A ledger as rows of one household each, kept up to date as entries are added. The same array while it has no summary. */
const expanded = new WeakMap<object, { done: number; last: unknown; rows: unknown[] | null }>();
export function ledgerRows<E extends (MoneyLike | GoodsLike) & { reason: string }>(ledger: E[]): E[] {
  let view = expanded.get(ledger);
  // A ledger only grows between compactions, which replace it; anything else starts over.
  if (!view || view.done > ledger.length || view.done > 0 && ledger[view.done - 1] !== view.last) { view = { done: 0, last: undefined, rows: null }; expanded.set(ledger, view); }
  for (let i = view.done; i < ledger.length; i++) {
    const e = ledger[i];
    if (e.parts && !view.rows) view.rows = ledger.slice(0, i);
    if (view.rows) (view.rows as E[]).push(...expandEntry(e));
  }
  view.done = ledger.length; view.last = ledger[ledger.length - 1];
  return (view.rows as E[] | null) ?? ledger;
}
