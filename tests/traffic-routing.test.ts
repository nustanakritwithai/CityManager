import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNetwork } from '../src/traffic/network.ts';
import { assignPeriod, shortestPath, linkTimes, averageTripSeconds, REROUTE_SHARE, type RouteState } from '../src/traffic/routing.ts';
import { configureRoadPath, type RoadMap } from '../src/road-topology.ts';

const S = 24, at = (x: number, y: number) => y * S + x;
const blank = (): RoadMap => ({ cells: Array.from({ length: S * S }, () => ({ road: false })) });
function draw(c: RoadMap, path: number[]) {
  const fresh = new Set(path.filter(i => !c.cells[i].road));
  for (const i of path) c.cells[i].road = true;
  configureRoadPath(c, path, fresh, false);
}
const row = (y: number, x0: number, x1: number) => Array.from({ length: x1 - x0 + 1 }, (_, i) => at(x0 + i, y));
const col = (x: number, y0: number, y1: number) => Array.from({ length: y1 - y0 + 1 }, (_, i) => at(x, y0 + i));
/** Short route along y=0 from (0,0) to (6,0); long detour down to y=3 and back. */
function twoRoutes() {
  const c = blank(); draw(c, row(0, 0, 6)); draw(c, col(0, 0, 3)); draw(c, row(3, 0, 6)); draw(c, col(6, 0, 3));
  return c;
}
const run = (net: ReturnType<typeof buildNetwork>, od: { from: number; to: number; vehicles: number }[], n: number) => {
  let s: RouteState = new Map(), a = assignPeriod(net, od, s); const out = [a];
  for (let i = 1; i < n; i++) { a = assignPeriod(net, od, a.state); out.push(a); }
  return out;
};
const shareVia = (s: RouteState, key: string, cell: number) => (s.get(key) ?? []).filter(p => p.path.includes(cell)).reduce((t, p) => t + p.share, 0);

test('shortest-time path chosen at free flow', () => {
  const net = buildNetwork(twoRoutes());
  assert.deepEqual(shortestPath(net, linkTimes(net, new Map()), at(0, 0), at(6, 0)), row(0, 0, 6));
});
test('congestion shifts share gradually to the detour', () => {
  const net = buildNetwork(twoRoutes()), od = [{ from: at(0, 0), to: at(6, 0), vehicles: 3000 }], key = `${at(0, 0)}:${at(6, 0)}`;
  const r = run(net, od, 20), detour = at(3, 3);
  assert.ok(shareVia(r[0].state, key, detour) <= REROUTE_SHARE + 1e-9);
  const series = r.map(a => shareVia(a.state, key, detour));
  for (let i = 1; i < series.length; i++) assert.ok(series[i] - series[i - 1] <= REROUTE_SHARE + 1e-9);
  assert.ok(series.at(-1)! > .3, String(series.at(-1)));
});
test('adding a parallel route cuts congested travel time', () => {
  const c = blank(); draw(c, row(0, 0, 10));
  const od = [{ from: at(0, 0), to: at(10, 0), vehicles: 1200 }];
  const before = averageTripSeconds(run(buildNetwork(c), od, 1)[0]);
  draw(c, col(0, 0, 2)); draw(c, row(2, 0, 10)); draw(c, col(10, 0, 2));
  const after = averageTripSeconds(run(buildNetwork(c), od, 40).at(-1)!);
  // Doubled capacity → BPR delay term falls ~16×; expect a large cut despite the detour.
  assert.ok(after < before * .7, `${before} -> ${after}`);
});
test('unreachable OD counted as unserved without crashing', () => {
  const c = blank(); draw(c, row(0, 0, 3)); draw(c, row(5, 0, 3));
  const a = assignPeriod(buildNetwork(c), [{ from: at(0, 0), to: at(3, 5), vehicles: 7 }, { from: at(0, 0), to: at(3, 0), vehicles: 2 }]);
  assert.equal(a.unserved, 7); assert.equal(a.served, 2);
});
test('deterministic', () => {
  const net = buildNetwork(twoRoutes()), od = [{ from: at(0, 0), to: at(6, 0), vehicles: 2500 }, { from: at(6, 3), to: at(0, 0), vehicles: 400 }];
  assert.deepEqual(run(net, od, 10).at(-1), run(buildNetwork(twoRoutes()), od, 10).at(-1));
});
