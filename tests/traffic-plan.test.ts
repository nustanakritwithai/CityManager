import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, buildRoad, zoneCell, step, serialize, connectedRoads, GATEWAY, SIZE, type City } from '../src/sim.ts';
import { trafficPlan, roadRoute, accessCell, visualHash, keyHash, commuteGoal, leaderAhead, deliveryWeek, MAX_CARS, MAX_TRUCKS, MAX_WALKERS, type Mover } from '../src/traffic-plan.ts';

function grownCity(days: number): City {
  const c = createCity(61025), S = SIZE;
  buildRoad(c, GATEWAY, 12 * S + 20);
  for (const col of [5, 10, 15]) buildRoad(c, 6 * S + col, 18 * S + col);
  buildRoad(c, 6 * S + 5, 6 * S + 15); buildRoad(c, 18 * S + 5, 18 * S + 20);
  for (let r = 7; r <= 17; r++) for (const col of [4, 6, 9, 11, 14, 16]) if (r !== 12) zoneCell(c, r * S + col, r < 12 ? 'R' : col > 12 ? 'I' : 'R');
  for (const col of [6, 7, 8, 9, 11, 12, 13]) { zoneCell(c, 11 * S + col, 'C'); zoneCell(c, 13 * S + col, col % 2 ? 'C' : 'F'); }
  for (let col = 16; col <= 20; col++) { zoneCell(c, 11 * S + col, 'F'); zoneCell(c, 13 * S + col, 'F'); }
  for (let t = 0; t < days; t++) step(c);
  return c;
}

test('route finding stays on connected road cells and is deterministic', () => {
  const c = grownCity(0), roads = connectedRoads(c);
  const route = roadRoute(roads, GATEWAY, 12 * SIZE + 20);
  assert.equal(route[0], GATEWAY); assert.equal(route.at(-1), 12 * SIZE + 20);
  assert.ok(route.every(cell => roads.has(cell)));
  for (let i = 1; i < route.length; i++) assert.equal(Math.abs(route[i] - route[i - 1]) === 1 || Math.abs(route[i] - route[i - 1]) === SIZE, true, 'each step is a neighbour');
  assert.deepEqual(roadRoute(roads, GATEWAY, 12 * SIZE + 20), route);
  assert.deepEqual(roadRoute(roads, GATEWAY, 0), [], 'unreachable parcel has no route');
  assert.equal(accessCell(roads, 11 * SIZE + 7), 12 * SIZE + 7);
});

test('an empty or disconnected city shows no traffic', () => {
  const empty = trafficPlan(createCity(61025));
  assert.deepEqual([empty.cars.length, empty.trucks.length, empty.walkers.length, empty.smoke.length], [0, 0, 0, 0]);
  const c = createCity(61025); buildRoad(c, 3 * SIZE + 3, 3 * SIZE + 9); // not touching the gateway
  assert.equal(trafficPlan(c).cars.length, 0);
});

test('cars, walkers, trucks and smoke follow real data and stay within caps', () => {
  const c = grownCity(480), plan = trafficPlan(c), roads = connectedRoads(c);
  const employed = c.employment.reduce((n, e) => n + e.workers, 0) + c.ownerLabor.length;
  assert.ok(employed > 0 && plan.cars.length > 0, 'working households drive');
  assert.ok(plan.cars.length <= Math.min(MAX_CARS, c.employment.length + c.ownerLabor.length));
  assert.ok(plan.walkers.length > 0 && plan.walkers.length <= MAX_WALKERS);
  assert.ok(plan.trucks.length <= MAX_TRUCKS);
  for (const v of [...plan.cars, ...plan.trucks]) assert.ok(v.route.length > 1 && v.route.every(cell => roads.has(cell)), `${v.key} on connected roads`);
  for (const w of plan.walkers) assert.ok(w.route.every(cell => roads.has(cell)));
  for (const cell of plan.smoke) assert.equal(c.buildings.find(b => b.cell === cell)?.zone, 'I');
  assert.equal(new Set(plan.cars.map(v => v.key)).size, plan.cars.length, 'keys are unique');
});

const TRUCKED = ['Wholesale stock delivery', 'Imported shop stock', 'Exported goods'];
const deliveredIn = (c: City, [since, until]: [number, number]) => c.goodsLedger.some(e => e.tick >= since && e.tick < until && TRUCKED.includes(e.reason)) || c.cropLedger.some(e => e.tick >= since && e.tick < until && e.kind === 'trade');

test('trucks follow real delivery routes of the last full week and keep their keys within the week', () => {
  const c = grownCity(480); let withTrucks = 0, withDeliveries = 0, previous: string[] = [], kept = 0, compared = 0;
  for (let day = 0; day < 40; day++) {
    step(c);
    const delivered = deliveredIn(c, deliveryWeek(c.tick)), plan = trafficPlan(c), keys = plan.trucks.map(t => t.key);
    if (plan.trucks.length) { withTrucks++; assert.ok(delivered, 'a truck implies a delivery this week'); }
    if (delivered) withDeliveries++;
    assert.ok(keys.every(k => !k.includes(String(c.tick))), 'truck keys carry the route, not the day');
    assert.equal(new Set(keys).size, keys.length); assert.ok(plan.trucks.length <= MAX_TRUCKS);
    assert.ok(plan.trucks.every(t => t.colour >= 0 && t.colour < 6), 'cargo is one of the three crops or three products');
    if (previous.length && deliveryWeek(c.tick)[0] === deliveryWeek(c.tick - 1)[0]) assert.deepEqual(keys, previous, 'the fleet only changes when a new week starts');
    if (previous.length) { compared += previous.length; kept += previous.filter(k => keys.includes(k)).length; }
    previous = keys;
  }
  assert.ok(withDeliveries === 0 || withTrucks > 0, 'real deliveries produce trucks');
  assert.ok(kept / compared > .8, `a route keeps its truck from one day to the next (${kept}/${compared})`);
  assert.deepEqual(deliveryWeek(20), [7, 14]); assert.deepEqual(deliveryWeek(21), [14, 21]);
  const quiet = grownCity(0); assert.equal(trafficPlan(quiet).trucks.length, 0, 'no deliveries, no trucks');
});

test('commuters follow the visual day: to work in the morning rush, home in the evening rush, parked between', () => {
  const cars = Array.from({ length: 200 }, (_, i) => [keyHash(`car:${i}:depart`), keyHash(`car:${i}:errand`)] as const);
  const share = (hour: number, goal: string) => cars.filter(([d, e]) => commuteGoal(hour, d, e) === goal).length / cars.length;
  assert.equal(share(5, 'work'), 0, 'before the rush everyone is home'); assert.equal(share(13, 'home'), 0, 'nobody is home at noon');
  assert.ok(share(8, 'work') > .3 && share(8, 'work') < .7, 'the morning rush spreads departures');
  assert.ok(share(13, 'cruise') > .15 && share(13, 'cruise') < .35, 'a quarter run errands through the day');
  assert.ok(share(18, 'home') > .3 && share(18, 'home') < .7 && share(20, 'home') > .9, 'the evening rush brings them home');
  assert.ok(share(2, 'cruise') < .12, 'a few drive at night');
  for (const [d, e] of cars) assert.equal(commuteGoal(26, d, e), commuteGoal(2, d, e), 'hours wrap');
});

test('vehicles on one route get their own start, and same-lane vehicles queue instead of overlapping', () => {
  const seeds = ['car:12:5', 'car:13:5', 'car:14:5', 'car:21:5'].map(keyHash);
  assert.equal(new Set(seeds).size, seeds.length, 'keys of the same length still differ');
  const car = (x: number, z: number, hx: number, hz: number, rank = .5): Mover => ({ x, z, hx, hz, length: .6, width: .3, rank });
  const lane = [car(0, 0, 1, 0), car(1, 0, 1, 0), car(1, .72, -1, 0), car(.5, .7, 0, 1)];
  assert.deepEqual(leaderAhead(lane, 0).leader, 1, 'the car ahead in the same lane');
  assert.ok(Math.abs(leaderAhead(lane, 0).gap - .4) < 1e-9, 'gap is bumper to bumper');
  assert.equal(leaderAhead(lane, 1).leader, -1, 'nothing ahead of the front car; the oncoming lane does not count');
  const stacked = [car(0, 0, 1, 0, .2), car(0, 0, 1, 0, .7)];
  assert.equal(leaderAhead(stacked, 1).leader, 0, 'on the same spot the higher rank waits');
  assert.equal(leaderAhead(stacked, 0).leader, -1, 'and the lower rank drives on');
  assert.equal(leaderAhead([car(0, 0, 1, 0), car(.8, .1, 0, 1)], 0).leader, 1, 'a car crossing the lane ahead counts');
  const crossing = leaderAhead([car(0, 0, 1, 0), car(.7, .45, 0, -1)], 0);
  assert.equal(crossing.leader, 1, 'a car about to cross is seen before the bodies touch');
  assert.ok(Math.abs(crossing.gap - .25) < 1e-9, 'its width counts along this lane, not its length');
});

test('planning never changes the city or its save', () => {
  const c = grownCity(300), before = serialize(c);
  for (let i = 0; i < 5; i++) trafficPlan(c);
  assert.equal(serialize(c), before);
  assert.ok(visualHash(1, 2) >= 0 && visualHash(1, 2) < 1 && visualHash(1, 2) === visualHash(1, 2));
});
