import test from 'node:test';
import assert from 'node:assert/strict';
import { configureRoadPath } from '../src/road-topology.ts';
import { createBus } from '../src/bus/buildings.ts';
import { createBusLine, type BusHost } from '../src/bus/lines.ts';
import { BusGameBridge } from '../src/bus/game-bridge.ts';
import { BUS_PCU } from '../src/bus/types.ts';
import { TrafficGame, type TrafficGameSample } from '../src/traffic/game.ts';
import { createTrafficGameWorkerEngine } from '../src/traffic/game-worker-engine.ts';
import { linkKey } from '../src/traffic/network.ts';
import { SIZE } from '../src/sim.ts';

const W = SIZE, at = (x: number, y: number) => y * W + x;
const row = (y: number, a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => at(a + k, y));
const col = (x: number, a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => at(x, a + k));
function host(): BusHost {
  const c: BusHost = { cells: Array.from({ length: W * W }, () => ({ road: false })), nextId: 100 };
  const draw = (p: number[]) => { const f = new Set(p.filter(i => !c.cells[i].road)); for (const i of p) c.cells[i].road = true; configureRoadPath(c, p, f, false); };
  draw(row(2, 0, 20)); draw(row(10, 0, 20)); draw(col(0, 2, 10)); draw(col(20, 2, 10));
  c.bus = createBus();
  c.bus.depots.push({ id: 1, cell: at(5, 1), level: 1, open: true, tick: 0 });
  c.bus.stops.push({ id: 10, cell: at(4, 2), side: 'n', level: 1 }, { id: 11, cell: at(14, 2), side: 'n', level: 1 }, { id: 12, cell: at(20, 6), side: 'e', level: 1 });
  assert.ok(createBusLine(c, { depotId: 1, stopIds: [10, 11, 12], busCount: 3, busLevel: 1 }).ok);
  return c;
}
const sample = (c: BusHost, rate = 2): TrafficGameSample => ({ map: { cells: c.cells.map(x => ({ road: x.road })), ...((c as { roadTopology?: unknown }).roadTopology ? { roadTopology: structuredClone((c as never as { roadTopology: never }).roadTopology) } : {}) }, demand: [{ from: at(3, 2), to: at(20, 5), rate }, { from: at(0, 5), to: at(10, 10), rate: 1 }] });
const run = (g: TrafficGame, n: number) => { let f = g.frame; for (let i = 0; i < n; i++) f = g.step(); return f; };
const ok = (b: BusGameBridge) => { const l = b.ledger(); for (const k of ['splitError', 'engineError', 'releaseError'] as const) assert.ok(Math.abs(l[k]) < 1e-6, `${k} ${JSON.stringify(l)}`); };

test('flag off: no bus input → game frames identical and carry no bus field', () => {
  const c = host(), a = new TrafficGame(sample(c)), b = new TrafficGame(sample(c)); b.setBus(undefined);
  for (let i = 0; i < 40; i++) assert.deepEqual(b.step(), a.step());
  assert.equal('bus' in a.frame, false);
  const e1 = createTrafficGameWorkerEngine(), e2 = createTrafficGameWorkerEngine();
  const input = { map: sample(c).map, homes: [{ cell: at(3, 3), amount: 4 }], destinations: [{ cell: at(19, 6), amount: 3 }] };
  const m = (seq: number, commitPrevious: boolean) => ({ kind: 'compute' as const, epoch: 'e', seq, sample: input, advance: true, paused: false, commitPrevious });
  for (let s = 1; s < 10; s++) assert.deepEqual(e1(m(s, s > 1)), e2(m(s, s > 1)));
});
test('flag on: bus share leaves road demand, game conserves offered = road + bus', () => {
  const c = host(), br = new BusGameBridge(c, 6 * 60), g = new TrafficGame(sample(c)), base = new TrafficGame(sample(c));
  g.setBus(br.input()); const f = run(g, 30), f0 = run(base, 30);
  assert.ok(f.bus && f.bus.diverted > 0, 'some demand rides the bus');
  assert.ok(Math.abs(f.offered + f.bus!.diverted - f0.offered) < 1e-9, `${f.offered}+${f.bus!.diverted} vs ${f0.offered}`);
  assert.ok(f.bus!.totals.every(t => t.lineId === 102 || t.lineId > 0));
});
test('bridge: diverted demand becomes whole riders, buses run, released riders return to cars; conserved', () => {
  const c = host(), br = new BusGameBridge(c, 22 * 60 + 40), g = new TrafficGame(sample(c, 4));
  for (let s = 0; s < 30; s++) { g.setBus(br.input()); const f = g.step(); br.onFrame(f.bus, 22 * 60 + 40 + s); br.tick(22 * 60 + 40 + s); ok(br); }
  assert.ok(br.totals.submitted > 0); assert.ok(br.engine.snapshot().length > 0);
  br.tick(23 * 60 + 30); ok(br); // service end → waiting riders released
  assert.ok(br.totals.returned > 0 && br.pendingReturn > 0);
  const before = g.frame.offered; g.setBus(br.input()); const after = g.frame;
  assert.ok(after.offered > before, 'released riders re-enter as car demand'); br.onFrame(after.bus, 23 * 60 + 31);
  assert.ok(Math.abs(br.pendingReturn) < 1e-9); ok(br);
  g.setBus(br.input()); assert.equal(g.frame.offered, after.offered, 'cumulative returns are injected once (idempotent)');
  assert.ok(br.engine.pendingEvents > 0, 'bridge never drains events (renderer is the only caller)');
});
test('bus load: 2 PCU per moving bus, replaced each tick, and it raises congestion in the game', () => {
  const c = host(), br = new BusGameBridge(c, 6 * 60);
  let saw = false;
  for (let m = 6 * 60; m < 7 * 60; m++) { br.tick(m); const load = br.input().load, expect = Object.fromEntries(br.engine.roadLoad(br.engine.now));
    assert.deepEqual(load, expect, 'replace, not add'); if (Object.keys(load).length) { saw = true; assert.ok(Object.values(load).every(v => v % BUS_PCU === 0)); } }
  assert.ok(saw, 'buses moved on links');
  const busy = (load: Record<string, number>) => { const g = new TrafficGame(sample(c, 4)); g.setBus({ stops: [], lines: [], load, returns: {} }); return run(g, 40); };
  const keys = Object.fromEntries(row(2, 3, 19).map((x, i, a) => i + 1 < a.length ? [linkKey(x, a[i + 1]), 2 * BUS_PCU] : null).filter(Boolean) as [string, number][]);
  const free = busy({}), loaded = busy(keys);
  assert.ok(loaded.completed < free.completed || loaded.blocked > free.blocked, `${loaded.completed}/${free.completed}`);
});
