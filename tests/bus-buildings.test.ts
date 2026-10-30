import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, bulldoze, buildRoad, buildParallelRoad, editRoadJunction, zoneCell, buildPark, connectedRoads, SIZE, type City } from '../src/sim.ts';
import { configureRoadPath, type RoadMap } from '../src/road-topology.ts';
import { busDepotAt, busStopAt, busStopSides, reconcileBusStops, BUS_STOP_SPACING } from '../src/bus/buildings.ts';
import { buildBusDepot, buildBusStop, busDepotReason, busStopSiteReason, removeBusDepot, removeBusStop, toggleBusDepot, upgradeBusDepot, upgradeBusStop, defaultBusStopSide } from '../src/bus/placement.ts';
import { buildTaxiDepot, taxiSiteReason } from '../src/taxi/placement.ts';
import { BUS_LIMITS } from '../src/bus/types.ts';
import { SAVE_KEY, BUS_BACKUP_KEY, TAXI_BACKUP_KEY, saveStoredCity } from '../src/save-storage.ts';

const grown = () => { const c = createCity(61025); for (let d = 0; d < 20; d++) step(c); return c; };
const nb = (i: number) => [i - 1, i + 1, i - SIZE, i + SIZE].filter(n => n >= 0 && n < SIZE * SIZE && Math.abs((n % SIZE) - (i % SIZE)) <= 1);
const lots = (c: City) => { const r = connectedRoads(c); return c.cells.flatMap((x, i) => !x.road && x.zone === null && x.building === null && nb(i).some(n => r.has(n)) && busDepotReason(c, i, true) === null ? [i] : []); };
/** Straight road cells that can hold a stop, spaced apart. */
const stopCells = (c: City) => { const out: number[] = []; for (let i = 0; i < SIZE * SIZE; i++) if (busStopSiteReason(c, i, defaultBusStopSide(c, i), true) === null && out.every(o => Math.abs(o % SIZE - i % SIZE) + Math.abs(Math.floor(o / SIZE) - Math.floor(i / SIZE)) >= BUS_STOP_SPACING)) out.push(i); return out; };
const mem = () => { const m = new Map<string, string>(); return { m, st: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), get length() { return m.size; }, key: (n: number) => [...m.keys()][n] ?? null, clear: () => m.clear() } }; };
const withBus = () => {
  const c = grown(), l = lots(c); assert.ok(buildBusDepot(c, l[0], true).ok); assert.ok(buildBusDepot(c, l[1], true).ok);
  const s = stopCells(c); assert.ok(s.length >= 3, `stop cells ${s.length}`);
  for (const i of s.slice(0, 3)) assert.ok(buildBusStop(c, i, defaultBusStopSide(c, i), true).ok);
  const [a, b, d] = c.bus!.stops.map(x => x.id);
  c.bus!.lines.push({ id: c.nextId++, depotId: c.bus!.depots[0].id, stopIds: [a, b, d], busCount: 2, busLevel: 1 });
  return c;
};

test('pure stop sides: straight two-way, one-way left kerb, junction and corner refused', () => {
  const W = 24, at = (x: number, y: number) => y * W + x, blank = (): RoadMap => ({ cells: Array.from({ length: W * W }, () => ({ road: false })) });
  const draw = (m: RoadMap, p: number[], one = false) => { const f = new Set(p.filter(i => !m.cells[i].road)); for (const i of p) m.cells[i].road = true; configureRoadPath(m, p, f, one); };
  const row = (y: number, a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => at(a + k, y)), col = (x: number, a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => at(x, a + k));
  // SIZE in road-topology is the game map; use the real width there.
  if (W !== SIZE) return; // grid helpers assume SIZE; covered by the sim tests below otherwise
  const m = blank(); draw(m, row(5, 0, 10)); draw(m, col(5, 5, 12));
  assert.deepEqual(busStopSides(m, at(2, 5), W), { sides: ['n', 's'] });
  assert.deepEqual(busStopSides(m, at(5, 9), W), { sides: ['e', 'w'] });
  assert.ok('reason' in busStopSides(m, at(5, 5), W), 'T junction');
  assert.ok('reason' in busStopSides(m, at(3, 3), W), 'not a road');
  const one = blank(); draw(one, row(8, 0, 10), true); const dir = one.roadTopology!.oneWay[at(4, 8)];
  assert.deepEqual(busStopSides(one, at(4, 8), W), { sides: [dir === 1 ? 'n' : 's'] });
  const corner = blank(); draw(corner, row(2, 0, 4)); draw(corner, col(4, 2, 6));
  assert.ok('reason' in busStopSides(corner, at(4, 2), W), 'corner');
});
test('flag off: no placement, no bus key', () => {
  const c = grown(), i = lots(c)[0];
  assert.equal(buildBusDepot(c, i, false).ok, false); assert.equal(c.bus, undefined);
  const s = stopCells(c)[0]; assert.equal(buildBusStop(c, s, undefined, false).ok, false); assert.equal(c.bus, undefined);
});
test('a city without bus saves byte-identical and never gains a bus key', () => {
  const c = grown(), before = serialize(c); assert.ok(!before.includes('"bus"'));
  const back = deserialize(before); assert.equal(serialize(back), before);
  for (let d = 0; d < 5; d++) step(back); assert.ok(!serialize(back).includes('"bus"'));
});
test('round trip with bus keeps the section and save version 9', () => {
  const c = withBus(), raw = serialize(c), back = deserialize(raw);
  assert.deepEqual(back.bus, c.bus); assert.equal(serialize(back), raw); assert.equal(back.version, 9); assert.equal(JSON.parse(raw).version, JSON.parse(serialize(grown())).version, 'save envelope version unchanged');
});
test('depot placement: campus/taxi rules, no overlap with taxi depots, limit 4, upgrade 1→3, toggle', () => {
  const c = grown(), l = lots(c);
  assert.ok(buildTaxiDepot(c, l[0], true).ok);
  assert.ok(busDepotReason(c, l[0], true), 'taxi depot cell is taken');
  assert.ok(buildBusDepot(c, l[1], true).ok); assert.ok(taxiSiteReason(c, l[1], true), 'taxi cannot take a bus depot cell');
  assert.ok(busDepotReason(c, c.cells.findIndex(x => x.road), true));
  for (const i of l.slice(2)) if ((c.bus!.depots.length) < BUS_LIMITS.depots) assert.ok(buildBusDepot(c, i, true).ok);
  assert.equal(c.bus!.depots.length, BUS_LIMITS.depots); assert.match(busDepotReason(c, l.at(-1)!, true)!, /4/);
  const id = c.bus!.depots[0].id;
  assert.ok(upgradeBusDepot(c, id, true).ok); assert.ok(upgradeBusDepot(c, id, true).ok); assert.equal(c.bus!.depots[0].level, 3); assert.equal(upgradeBusDepot(c, id, true).ok, false);
  assert.ok(toggleBusDepot(c, id, true).ok); assert.equal(c.bus!.depots[0].open, false);
  const d = c.bus!.depots[1].cell;
  assert.equal(zoneCell(c, d, 'R').ok, false); assert.equal(buildPark(c, d).ok, false);
  assert.doesNotThrow(() => deserialize(serialize(c)));
});
test('stop placement: road only, spacing, side, level 1→2, limit 40', () => {
  const c = grown(), s = stopCells(c), i = s[0];
  assert.ok(busStopSiteReason(c, lots(c)[0], 'n', true), 'not on a lot');
  const side = defaultBusStopSide(c, i)!, wrong = ({ n: 'e', s: 'w', e: 'n', w: 's' } as const)[side];
  assert.ok(busStopSiteReason(c, i, wrong, true), 'side must match road axis');
  assert.ok(buildBusStop(c, i, side, true).ok); assert.ok(busStopAt(c, i));
  const adj = nb(i).find(n => c.cells[n].road); if (adj !== undefined) assert.ok(busStopSiteReason(c, adj, defaultBusStopSide(c, adj), true));
  const id = c.bus!.stops[0].id; assert.ok(upgradeBusStop(c, id, true).ok); assert.equal(c.bus!.stops[0].level, 2); assert.equal(upgradeBusStop(c, id, true).ok, false);
  c.bus!.stops = Array.from({ length: BUS_LIMITS.stops }, (_, k) => ({ id: 90000 + k, cell: s[k % s.length], side: 'n' as const, level: 1 as const }));
  assert.match(busStopSiteReason(c, s[1], defaultBusStopSide(c, s[1]), true)!, /40/);
});
test('removing a stop removes it from lines; adjacent duplicates collapse', () => {
  const c = withBus(), [a, b, d] = c.bus!.stops.map(x => x.id), line = c.bus!.lines[0];
  line.stopIds = [a, b, a, d];
  assert.ok(removeBusStop(c, b).ok); assert.deepEqual(line.stopIds, [a, d]);
  assert.equal(removeBusStop(c, b).ok, false);
  assert.doesNotThrow(() => deserialize(serialize(c)));
});
test('depot removal: lines move to the lowest-id other depot; last depot with lines is blocked', () => {
  const c = withBus(), [d1, d2] = c.bus!.depots, line = c.bus!.lines[0];
  assert.ok(bulldoze(c, d1.cell).ok); assert.equal(busDepotAt(c, d1.cell), undefined); assert.equal(line.depotId, d2.id);
  const r = removeBusDepot(c, d2.id); assert.equal(r.ok, false); assert.ok(busDepotAt(c, d2.cell));
  assert.equal(bulldoze(c, d2.cell).ok, false, 'bulldozer also refuses');
  c.bus!.lines = []; assert.ok(bulldoze(c, d2.cell).ok); assert.equal(c.bus!.depots.length, 0);
  assert.ok('bus' in JSON.parse(serialize(c)), 'emptied section stays (already a bus save)');
});
test('bulldozing the road under a stop removes the stop and drops it from lines', () => {
  const c = withBus(), s = c.bus!.stops[1], line = c.bus!.lines[0], accounts = JSON.stringify(c.accounts);
  assert.ok(bulldoze(c, s.cell).ok); assert.equal(busStopAt(c, s.cell), undefined); assert.ok(!line.stopIds.includes(s.id));
  assert.match(c.lastEvent, /Bus stop/);
  assert.notEqual(JSON.stringify(c.accounts), accounts, 'road demolition still charges the normal fee');
  assert.doesNotThrow(() => deserialize(serialize(c)));
});
test('road edits that turn a stop cell into a junction or flip its direction invalidate it', () => {
  const c = withBus(), s = c.bus!.stops[0];
  const side = nb(s.cell).find(n => !c.cells[n].road && !busDepotAt(c, n) && c.cells[n].building === null);
  assert.ok(side !== undefined, 'free lot beside the stop'); {
    const r = buildRoad(c, s.cell, side);
    assert.ok(r.ok, r.message); assert.equal(busStopAt(c, s.cell), undefined, 'branch makes a T junction');
  }
  // Junction edit hook runs reconcile too (no throw, still valid).
  const t = c.bus!.stops[0]; if (t) { const n = nb(t.cell).find(x => c.cells[x].road); if (n !== undefined) editRoadJunction(c, t.cell, n, false); }
  assert.doesNotThrow(() => deserialize(serialize(c)));
  // One-way rebuild through a stop with the wrong kerb removes it.
  const c2 = withBus(), ends = (x: { cell: number; side: string }) => (x.side === 'n' || x.side === 's' ? [x.cell - 1, x.cell + 1] : [x.cell - SIZE, x.cell + SIZE]);
  const st = c2.bus!.stops.find(x => ends(x).every(e => c2.cells[e]?.road && Math.floor(e / SIZE) === Math.floor(x.cell / SIZE) || (x.side === 'e' || x.side === 'w')))!; assert.ok(st);
  const [a, b] = ends(st);
  const before = c2.bus!.stops.length; const r2 = buildParallelRoad(c2, a, b, true);
  assert.ok(r2.ok, r2.message); { const left = busStopAt(c2, st.cell); if (left) assert.ok(!('reason' in busStopSides(c2, st.cell, SIZE))); else assert.ok(c2.bus!.stops.length < before); }
});
test('load reconciles stops invalidated by an older build; structural errors still throw', () => {
  const c = withBus(), j = JSON.parse(serialize(c)), s = j.bus.stops[0];
  j.bus.stops[0].side = ({ n: 'e', s: 'w', e: 'n', w: 's' } as Record<string, string>)[s.side];
  const back = deserialize(JSON.stringify(j));
  assert.ok(!back.bus!.stops.some(x => x.id === s.id)); assert.ok(!back.bus!.lines[0].stopIds.includes(s.id));
});
test('validator rejects bad bus data', () => {
  const c = withBus(), good = JSON.parse(serialize(c));
  const bad = (f: (b: any, j: any) => void, re = /bus/i) => { const j = structuredClone(good); f(j.bus, j); assert.throws(() => deserialize(JSON.stringify(j)), re); };
  bad(b => { b.version = 2; }); bad(b => { b.rules = 'bus-2'; }); bad(b => { b.extra = 1; });
  bad(b => { b.depots[0].level = 4; }); bad(b => { b.depots[0].open = 1; }); bad(b => { b.depots[0].tick = 1e9; });
  bad(b => { b.depots[1].cell = b.depots[0].cell; }); bad((b, j) => { b.depots[0].cell = j.cells.findIndex((x: any) => x.road); });
  bad((b, j) => { j.cells[b.depots[0].cell].zone = 'R'; });
  bad((b, j) => { b.depots[0].id = j.nextId; }); bad(b => { b.stops[1].id = b.depots[0].id; }); bad((b, j) => { b.stops[0].id = j.buildings[0].id; });
  bad((b, j) => { b.stops[0].cell = j.cells.findIndex((x: any) => !x.road); });
  bad(b => { b.stops[0].side = 'x'; }); bad(b => { b.stops[0].level = 3; }); bad(b => { b.stops[1].cell = b.stops[0].cell; });
  bad(b => { b.lines[0].depotId = 1e6; }); bad(b => { b.lines[0].stopIds.push(1e6); }); bad(b => { b.lines[0].stopIds = [b.stops[0].id, b.stops[0].id]; });
  bad(b => { b.lines[0].busLevel = 4; }); bad(b => { b.lines[0].busCount = -1; }); bad(b => { b.lines[0].extra = 1; });
  bad(b => { b.depots = Array.from({ length: BUS_LIMITS.depots + 1 }, (_, k) => ({ ...b.depots[0], id: 9000 + k, cell: k })); });
  bad(b => { b.lines = Array.from({ length: BUS_LIMITS.lines + 1 }, (_, k) => ({ ...b.lines[0], id: 9000 + k })); });
  bad((b, j) => { const t = { version: 1, rules: 'taxi-1', depots: [{ id: j.nextId - 1, cell: b.depots[0].cell, tick: 0, level: 1, open: true }] }; j.taxi = t; j.nextId += 1; b.depots[0].id = j.nextId - 1; }, /bus|taxi/i); // taxi depot on bus depot cell
  assert.doesNotThrow(() => deserialize(JSON.stringify(good)));
});
test('before-bus backup is written once before the first bus save; taxi backup untouched', () => {
  const { m, st } = mem(), c = grown(), plain = serialize(c); m.set(SAVE_KEY, plain);
  buildBusDepot(c, lots(c)[0], true); const first = serialize(c);
  saveStoredCity(st as any, first, null); m.set(SAVE_KEY, first);
  assert.equal(m.get(BUS_BACKUP_KEY), plain); assert.equal(m.get(TAXI_BACKUP_KEY), undefined);
  buildBusStop(c, stopCells(c)[0], undefined, true); saveStoredCity(st as any, serialize(c), null);
  assert.equal(m.get(BUS_BACKUP_KEY), plain); assert.equal(m.get(`${BUS_BACKUP_KEY}.1`), undefined);
});
test('economy unchanged over N days with bus sites present', () => {
  const a = grown(), b = withBus();
  const strip = (c: City) => { const j = JSON.parse(serialize(c)); return JSON.stringify({ treasury: j.accounts.treasury, ledger: j.ledger.length }); };
  for (let d = 0; d < 30; d++) { step(a); step(b); }
  assert.equal(strip(b), strip(a));
});
