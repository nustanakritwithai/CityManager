export const MONTH = 30;
export const DEFAULT_TAX_RATES = { wage: 10, profit: 20 } as const;
export const MAX_TAX_RATES = { wage: 30, profit: 40 } as const;

export type TaxRates = { wage: number; profit: number };
export type TaxChange = TaxRates & { fromDay: number };
type TaxCity = { tick: number; taxPolicy?: TaxChange[] };

export const nextTaxDay = (tick: number) => Math.ceil(tick / MONTH) * MONTH + 1;
const validRate = (rate: unknown, max: number): rate is number =>
  typeof rate === 'number' && Number.isInteger(rate) && rate >= 0 && rate <= max;
const sameRates = (a: TaxRates, b: TaxRates) => a.wage === b.wage && a.profit === b.profit;

export function taxRatesAt(policy: readonly TaxChange[] | undefined, tick: number): TaxRates {
  if (policy) {
    for (let i = policy.length - 1; i >= 0; i--) {
      if (policy[i].fromDay <= tick) return policy[i];
    }
  }
  return DEFAULT_TAX_RATES;
}

export function scheduleCityTaxes(city: TaxCity, rates: TaxRates): void {
  const fromDay = nextTaxDay(city.tick);
  if (!Number.isSafeInteger(fromDay) || !validRate(rates.wage, MAX_TAX_RATES.wage) || !validRate(rates.profit, MAX_TAX_RATES.profit)) {
    throw new Error('Invalid city tax rates or effective day.');
  }
  const active = taxRatesAt(city.taxPolicy, city.tick);
  const policy = city.taxPolicy?.filter(change => change.fromDay < fromDay) ?? [];
  if (!sameRates(active, rates)) policy.push({ fromDay, wage: rates.wage, profit: rates.profit });
  if (policy.length) city.taxPolicy = policy;
  else delete city.taxPolicy;
}

export function validateTaxPolicy(policy: unknown, tick: unknown): asserts policy is TaxChange[] {
  const fail = (): never => { throw new Error('Invalid city tax policy.'); };
  if (!Array.isArray(policy) || !policy.length || typeof tick !== 'number' || !Number.isSafeInteger(tick) || tick < 0) return fail();
  let lastDay = 0;
  let previous: TaxRates = DEFAULT_TAX_RATES;
  for (const change of policy) {
    if (!change || typeof change !== 'object' || Array.isArray(change) || Object.keys(change).sort().join(',') !== 'fromDay,profit,wage'
      || !Number.isSafeInteger(change.fromDay) || change.fromDay <= lastDay || (change.fromDay - 1) % MONTH !== 0 || change.fromDay > nextTaxDay(tick)
      || !validRate(change.wage, MAX_TAX_RATES.wage) || !validRate(change.profit, MAX_TAX_RATES.profit) || sameRates(change, previous)) fail();
    lastDay = change.fromDay;
    previous = change;
  }
}

/** Ledger amounts are integer satang. A positive base is rounded down once. */
export function taxAmount(base: bigint, rate: number): bigint {
  return base > 0n && rate > 0 ? base * BigInt(rate) / 100n : 0n;
}

export const taxSatang = (base: number, rate: number): number => Number(taxAmount(BigInt(base), rate));
