/**
 * Decorative city life: which cars, trucks, walkers and smoke plumes to show.
 * Read-only over City; no sim RNG, no mutation, nothing enters a save. Quantities follow
 * real data (employment, population, today's goods/crop journals, producing factories).
 */
import { GATEWAY, SIZE, connectedRoads, economicSignals, firmWorkerCount, type City } from './sim.ts';

export const MAX_CARS = 40, MAX_TRUCKS = 12, MAX_WALKERS = 60;
export type Vehicle = { key: string; kind: 'car' | 'truck'; route: number[]; colour: number };
export type Walker = { key: string; route: number[]; colour: number };
export type TrafficPlan = { cars: Vehicle[]; trucks: Vehicle[]; walkers: Walker[]; smoke: number[]; signature: string };

const neighbours = (i: number) => [i % SIZE ? i - 1 : -1, i % SIZE < SIZE - 1 ? i + 1 : -1, i >= SIZE ? i - SIZE : -1, i < SIZE * (SIZE - 1) ? i + SIZE : -1].filter(n => n >= 0);

/** Visual-only hash; never the simulation RNG. */
export function visualHash(a: number, b = 0): number {
  let n = Math.imul((a ^ 0x9e3779b1) >>> 0, 0x85ebca6b) ^ Math.imul((b + 0x7f4a7c15) >>> 0, 0xc2b2ae35);
  n = Math.imul(n ^ (n >>> 15), 0x27d4eb2d);
  return ((n ^ (n >>> 13)) >>> 0) / 4294967296;
}

/** Nearest connected road cell beside a parcel (stable: lowest index wins ties). */
export function accessCell(roads: ReadonlySet<number>, cell: number): number | null {
  if (roads.has(cell)) return cell;
  const options = neighbours(cell).filter(n => roads.has(n)).sort((a, b) => a - b);
  return options.length ? options[0] : null;
}

/** Shortest path over connected road cells, deterministic neighbour order. */
export function roadRoute(roads: ReadonlySet<number>, from: number, to: number): number[] {
  if (!roads.has(from) || !roads.has(to)) return [];
  if (from === to) return [from];
  const previous = new Map<number, number>([[from, -1]]), queue = [from];
  for (let q = 0; q < queue.length; q++) {
    const here = queue[q];
    for (const next of neighbours(here)) {
      if (!roads.has(next) || previous.has(next)) continue;
      previous.set(next, here);
      if (next === to) {
        const path = [to]; for (let at = here; at !== -1; at = previous.get(at)!) path.push(at);
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return [];
}

function walletCell(city: City, roads: ReadonlySet<number>, wallet: string): number | null {
  if (wallet === 'outside') return roads.has(GATEWAY) ? GATEWAY : null;
  const firm = city.firms.find(f => f.wallet === wallet);
  const building = firm && city.buildings.find(b => b.id === firm.building);
  return building ? accessCell(roads, building.cell) : null;
}

export function trafficPlan(city: City): TrafficPlan {
  const roads = connectedRoads(city), cars: Vehicle[] = [], trucks: Vehicle[] = [], walkers: Walker[] = [], smoke: number[] = [];
  const buildingCell = (id: number) => city.buildings.find(b => b.id === id)?.cell ?? null;
  if (roads.size > 1 && city.utilities.power && city.utilities.water) {
    // Commuters: one car per real employment allocation (household home → firm), plus self-employed owners.
    const jobs = [...city.employment.map(e => ({ h: e.householdId, f: e.firmId })), ...city.ownerLabor.map(e => ({ h: e.householdId, f: e.firmId }))];
    for (const job of jobs.sort((a, b) => a.f - b.f || a.h - b.h)) {
      if (cars.length >= MAX_CARS) break;
      const home = city.households.find(h => h.id === job.h)?.home, firm = city.firms.find(f => f.id === job.f);
      const homeCell = home == null ? null : buildingCell(home), workCell = firm ? buildingCell(firm.building) : null;
      const from = homeCell == null ? null : accessCell(roads, homeCell), to = workCell == null ? null : accessCell(roads, workCell);
      if (from == null || to == null || from === to) continue;
      const route = roadRoute(roads, from, to);
      if (route.length > 1) cars.push({ key: `car:${job.h}:${job.f}`, kind: 'car', route, colour: Math.floor(visualHash(job.h, job.f) * 6) });
    }
    // Trucks: today's real deliveries (goods wholesale/import/export and crop trades).
    const deliveries: { key: string; from: string; to: string }[] = [];
    for (const e of city.goodsLedger) if (e.tick === city.tick && ['Wholesale stock delivery', 'Imported shop stock', 'Exported goods'].includes(e.reason)) deliveries.push({ key: `${e.reason}:${e.from}>${e.to}`, from: e.from, to: e.to });
    for (const e of city.cropLedger) if (e.tick === city.tick && e.kind === 'trade') deliveries.push({ key: `crop:${e.from}>${e.to}`, from: e.from, to: e.to });
    for (const d of deliveries) {
      if (trucks.length >= MAX_TRUCKS) break;
      const from = walletCell(city, roads, d.from), to = walletCell(city, roads, d.to);
      if (from == null || to == null || from === to) continue;
      const route = roadRoute(roads, from, to);
      if (route.length > 1) trucks.push({ key: `truck:${city.tick}:${d.key}`, kind: 'truck', route, colour: 0 });
    }
    // Walkers: residents of connected homes stroll a short stretch of their street.
    const people = new Map<number, number>();
    for (const h of city.households) if (h.home != null) people.set(h.home, (people.get(h.home) ?? 0) + h.members);
    for (const [home, count] of [...people].sort((a, b) => a[0] - b[0])) {
      const cell = buildingCell(home), start = cell == null ? null : accessCell(roads, cell);
      if (start == null) continue;
      const out = neighbours(start).filter(n => roads.has(n)).sort((a, b) => a - b);
      for (let k = 0; k < Math.min(2, Math.ceil(count / 3)) && walkers.length < MAX_WALKERS; k++) {
        const far = out.length ? out[Math.floor(visualHash(home, k) * out.length)] : start;
        walkers.push({ key: `walk:${home}:${k}`, route: far === start ? [start] : [start, far], colour: Math.floor(visualHash(home, k + 9) * 6) });
      }
    }
    // Smoke: factories that really produce today.
    for (const s of economicSignals(city)) {
      const firm = city.firms.find(f => f.id === s.firmId);
      if (firm?.zone !== 'I' || s.reasonId !== 'agriculture.recipe-ready' || firmWorkerCount(city, firm.id) < 1) continue;
      const cell = buildingCell(firm.building); if (cell != null && roads.has(accessCell(roads, cell) ?? -1)) smoke.push(cell);
    }
  }
  const signature = [city.tick, cars.map(c => c.key).join(','), trucks.map(t => t.key).join(','), walkers.length, smoke.join(',')].join('|');
  return { cars, trucks, walkers, smoke, signature };
}
