/**
 * In-memory demand history for the R/C/I/F sparklines: one sample per simulated day, last 30
 * days, kept per City object (a load or new city starts empty). Never enters a save.
 */
import type { City } from './sim.ts';

export type DemandZone = 'R' | 'C' | 'I' | 'F';
export type DemandSample = { tick: number } & Record<DemandZone, number>;
export const DEMAND_HISTORY_DAYS = 30;
const histories = new WeakMap<City, DemandSample[]>();

export function recordDemand(city: City, demand: Record<DemandZone, number>): DemandSample[] {
  const history = histories.get(city) ?? [];
  const last = history.at(-1), sample = { tick: city.tick, R: demand.R, C: demand.C, I: demand.I, F: demand.F };
  if (last?.tick === city.tick) history[history.length - 1] = sample;
  else { history.push(sample); if (history.length > DEMAND_HISTORY_DAYS) history.splice(0, history.length - DEMAND_HISTORY_DAYS); }
  histories.set(city, history); return history;
}

/** A tiny polyline (viewBox 0 0 60 16) of one zone's demand; null until two days are known. */
export function demandSparkline(history: readonly DemandSample[], zone: DemandZone): string | null {
  if (history.length < 2) return null;
  const values = history.map(h => h[zone]), max = Math.max(1, ...values), min = Math.min(0, ...values);
  const x = (i: number) => (i / (values.length - 1) * 58 + 1).toFixed(1), y = (v: number) => (15 - (v - min) / (max - min || 1) * 14).toFixed(1);
  return `<svg class="demand-spark" viewBox="0 0 60 16" aria-hidden="true"><polyline points="${values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
