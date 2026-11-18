/**
 * Treasury forecast, read-only: where the treasury is heading if the last 30 days repeat. The one-off founding
 * grant is left out, so a young city is judged on what it earns and spends, not on its starting money.
 */
import { MONTH, type City } from './sim.ts';

export const ONE_OFF_TREASURY_REASONS: readonly string[] = ['Initial municipal grant'];
export type TreasuryForecast = {
  balance: number; spendable: number;
  /** Days the trend is drawn from: 30, or fewer in a city younger than that. */
  windowDays: number;
  income: number; spending: number; net: number;
  /** Net per day over the window, rounded to the satang. */
  daily: number;
  /** Balance after another 30 days at this pace. */
  nextMonth: number;
  /** Days until the balance runs out at this pace; null when it is not falling. */
  runwayDays: number | null;
  /** Days until the next month-end settlement (rent, taxes, upkeep). */
  settlementIn: number;
  /** Known month-end upkeep for parks and city services at current funding. */
  upkeep: number;
};

export function treasuryForecast(city: Pick<City, 'ledger' | 'tick' | 'accounts'>, spendable: number, upkeep: number, days = MONTH): TreasuryForecast {
  const fromTick = Math.max(0, city.tick - days + 1), windowDays = city.tick - fromTick + 1;
  let income = 0, spending = 0;
  for (let i = city.ledger.length - 1; i >= 0; i--) {
    const e = city.ledger[i];
    if (e.tick < fromTick) break;
    if (e.tick > city.tick || e.from === e.to || ONE_OFF_TREASURY_REASONS.includes(e.reason)) continue;
    if (e.to === 'treasury') income += e.amount;
    if (e.from === 'treasury') spending += e.amount;
  }
  const balance = city.accounts.treasury ?? 0, net = income - spending, daily = Math.round(net / windowDays);
  const nextMonth = balance + Math.round(net / windowDays * MONTH);
  const runwayDays = daily < 0 ? Math.max(0, Math.floor(balance / -daily)) : null;
  const settlementIn = MONTH - (city.tick % MONTH); // month-end bills post on days that are a multiple of MONTH
  return { balance, spendable, windowDays, income, spending, net, daily, nextMonth, runwayDays, settlementIn, upkeep };
}
