import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, type City } from '../src/sim.ts';
import { TrafficClock, TRAFFIC_MODEL_ENABLED, gameMinute, totalDelay } from '../src/traffic/clock.ts';
import { cityDemandInput } from '../src/traffic/snapshot.ts';
import { assignPeriod, averageTripSeconds, BPR_ALPHA, BPR_BETA, type RouteState } from '../src/traffic/routing.ts';
import { linkKey, freeFlowSeconds, type Link, type LinkNetwork } from '../src/traffic/network.ts';
import type { DemandInput } from '../src/traffic/types.ts';
import { periodDemand } from '../src/traffic/demand.ts';

/** Starter city grown 30 days so it has homes, jobs and freight. */
const city = () => { const c = createCity(61025); for (let d = 0; d < 30; d++) step(c); return c; };
const input = (scale: number): DemandInput => {
  const c = city(), base = cityDemandInput(c);
  return { ...base, households: base.households.map(h => ({ ...h, amount: h.amount * scale })), jobs: base.jobs.map(j => ({ ...j, amount: j.amount * scale })) };
};

test('flag is off by default and an off clock does nothing', () => {
  assert.equal(TRAFFIC_MODEL_ENABLED, false);
  const k = new TrafficClock(), c = city();
  k.advance(c, 0); assert.deepEqual(k.advance(c, gameMinute(3, 0)), []);
  assert.equal(k.totals.periods, 0); assert.equal(k.network, null);
});
test('snapshot reads the starter city without mutating it', () => {
  const c = city(), before = JSON.stringify(c), s = cityDemandInput(c);
  assert.equal(JSON.stringify(c), before);
  assert.ok(s.households.length && s.jobs.length);
  const roads = new Set(c.cells.flatMap((x, i) => x.road ? [i] : []));
  for (const src of [...s.households, ...s.jobs]) assert.ok(roads.has(src.cell));
});
test('clock pauses; hours that pass while paused run once on resume', () => {
  const c = city(), k = new TrafficClock({ enabled: true });
  k.advance(c, gameMinute(0, 0));
  k.advance(c, gameMinute(0, 600)); assert.equal(k.totals.periods, 10);
  k.advance(c, gameMinute(0, 900), true); k.advance(c, gameMinute(0, 900), true); assert.equal(k.totals.periods, 10);
  k.advance(c, gameMinute(0, 960)); assert.equal(k.totals.periods, 16);
  k.advance(c, gameMinute(0, 960)); assert.equal(k.totals.periods, 16);
});
test('new city object restarts the clock', () => {
  const k = new TrafficClock({ enabled: true }), a = city(); k.advance(a, 0); k.advance(a, 600);
  const b = city(); k.advance(b, 600); assert.equal(k.totals.periods, 0); k.advance(b, 660); assert.equal(k.totals.periods, 1);
});
test('speed-up gives identical totals', () => {
  const c = city(), slow = new TrafficClock({ enabled: true }), fast = new TrafficClock({ enabled: true });
  slow.advance(c, 0); fast.advance(c, 0);
  for (let m = 1; m <= 2 * 1440; m++) slow.advance(c, m);           // every game minute (1×)
  for (let m = 600; m <= 2 * 1440; m += 600) fast.advance(c, m);    // 10-hour jumps (10×)
  fast.advance(c, 2 * 1440);
  assert.equal(fast.totals.periods, 48);
  assert.deepEqual(fast.totals, slow.totals);
  assert.ok(slow.totals.vehicles > 0);
});
test('denser city gives more delay', () => {
  const delay = (scale: number) => {
    const k = new TrafficClock({ enabled: true, snapshot: () => input(scale) }), c = city();
    k.advance(c, 0); k.advance(c, 1440); return totalDelay(k.totals) / Math.max(1, k.totals.vehicles);
  };
  const d1 = delay(10), d5 = delay(50), d20 = delay(200);
  assert.ok(d5 > d1 && d20 > d5, `${d1} ${d5} ${d20}`);
});
test('road edit rebuilds only nearby links', () => {
  const c = city(), k = new TrafficClock({ enabled: true });
  k.advance(c, 0); k.advance(c, 60);
  const net = k.network!, far = [...net.links.values()][0];
  const edited = c.cells.findIndex((x, i) => x.road && Math.abs(i - far.from) > 48);
  k.roadEdited(c, [edited]);
  assert.equal(net.links.get(linkKey(far.from, far.to)), far); // untouched link object kept
});
test('flag on/off leaves economy and money ledgers identical over N days', () => {
  const run = (on: boolean): City => {
    const c = city(), k = new TrafficClock({ enabled: on }); k.advance(c, 0);
    for (let d = 1; d <= 20; d++) { step(c); k.advance(c, gameMinute(c.tick, 0)); }
    if (on) assert.ok(k.totals.periods > 0);
    return c;
  };
  const off = run(false), on = run(true);
  assert.deepEqual(on.accounts, off.accounts);
  assert.deepEqual(on.ledger, off.ledger);
  assert.equal(JSON.stringify(on), JSON.stringify(off));
});

/** Two disjoint equal-length 2-link routes 0→1→3 (cap c) and 0→2→3 (cap k·c); no junction penalty. */
function corridor(k: number): LinkNetwork {
  const links = new Map<string, Link>(), mk = (a: number, b: number, cap: number) => links.set(linkKey(a, b), { from: a, to: b, length: 100, freeFlowKmh: 40, lanes: 1, capacityPerHour: cap });
  mk(0, 1, 600); mk(1, 3, 600);
  if (k > 0) { mk(0, 2, 600 * k); mk(2, 3, 600 * k); }
  const out = new Map<number, Link[]>();
  for (const l of [...links.values()].sort((a, b) => a.from - b.from || a.to - b.to)) out.set(l.from, [...(out.get(l.from) ?? []), l]);
  return { links, out };
}
test('calibrated: parallel capacity cuts delay ~ (1+k)^-β (BPR equilibrium)', () => {
  const V = 1500, od = [{ from: 0, to: 3, vehicles: V }], ff = 2 * freeFlowSeconds(corridor(0).links.get(linkKey(0, 1))!);
  const delayAt = (k: number) => {
    const net = corridor(k); let s: RouteState = new Map(), a = assignPeriod(net, od, s, 0);
    for (let i = 1; i < 400; i++) a = assignPeriod(net, od, a.state, i);
    return averageTripSeconds(a) - ff;
  };
  const d0 = delayAt(0);
  assert.ok(Math.abs(d0 - ff * BPR_ALPHA * (V / 600) ** BPR_BETA) < 1e-6);
  for (const k of [1, 3]) {
    const ratio = delayAt(k) / d0, expected = (1 + k) ** -BPR_BETA;
    assert.ok(Math.abs(ratio / expected - 1) < .25, `k=${k} ratio=${ratio} expected=${expected}`);
  }
});
test('shrinking step lets shares settle', () => {
  const net = corridor(1), od = [{ from: 0, to: 3, vehicles: 1500 }];
  let a = assignPeriod(net, od, new Map(), 0); const shares: number[] = [];
  for (let i = 1; i < 300; i++) { a = assignPeriod(net, od, a.state, i); shares.push(a.state.get('0:3')!.find(p => p.path.includes(2))?.share ?? 0); }
  const tail = shares.slice(-50), swing = Math.max(...tail) - Math.min(...tail);
  assert.ok(swing < .02, String(swing));
  assert.ok(Math.abs(shares.at(-1)! - .5) < .05);
});

/** Real hourly profiles with overnight zero demand and two alternative road corridors. */
const intermittentInput: DemandInput = { households: [{ cell: 25, amount: 45000 }], jobs: [{ cell: 28, amount: 45000 }], schoolSeats: [], parks: [], freight: [], entrance: 25 };
const quietInput: DemandInput = { households: [], jobs: [], schoolSeats: [], parks: [], freight: [], entrance: 25 };
const routeCity = () => ({ cells: Array.from({ length: 576 }, (_, i) => ({ road: [25, 26, 27, 28, 49, 50, 51, 52].includes(i) })) } as City);

test('100 daily peaks retain learning through empty nights and age each OD only when active', () => {
  const c = routeCity(), k = new TrafficClock({ enabled: true, snapshot: () => intermittentInput });
  k.advance(c, 0);
  let state: RouteState = new Map(), carry = {}, active = new Map<string, number>(), peaks = 0;
  for (let hour = 0; hour < 100 * 24; hour++) {
    const r = periodDemand(intermittentInput, hour, carry); carry = r.carry;
    const actual = k.advance(c, (hour + 1) * 60)[0];
    if (!r.od.length) { assert.deepEqual(actual.state, state); continue; }
    const expected = assignPeriod(k.network!, r.od, state, active);
    assert.deepEqual(actual, expected, `hour ${hour}`);
    state = expected.state;
    for (const key of new Set(r.od.map(d => `${d.from}:${d.to}`))) active.set(key, (active.get(key) ?? 0) + 1);
    if (hour % 24 === 8) peaks++;
  }
  assert.equal(peaks, 100); assert.ok(k.totals.vehicles > 100000);
  assert.ok(state.get('25:28')!.length > 1);
});

test('new OD after 100 quiet days gets a fresh settling step', () => {
  const c = routeCity(); let demand = quietInput;
  const k = new TrafficClock({ enabled: true, snapshot: () => demand }); k.advance(c, 0);
  for (let day = 1; day <= 100; day++) k.advance(c, day * 1440);
  demand = intermittentInput;
  for (let h = 0; h < 24; h++) {
    const actual = k.advance(c, 100 * 1440 + (h + 1) * 60)[0];
    const r = periodDemand(demand, h);
    if (!r.od.length) continue;
    assert.deepEqual(actual, assignPeriod(k.network!, r.od));
    assert.ok(actual.state.size > 0); return;
  }
  assert.fail('fixture must produce a nonempty OD');
});
