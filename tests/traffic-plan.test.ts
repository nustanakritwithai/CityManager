import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, buildRoad, zoneCell, step, serialize, connectedRoads, GATEWAY, SIZE, type City } from '../src/sim.ts';
import { trafficPlan, roadRoute, accessCell, visualHash, MAX_CARS, MAX_TRUCKS, MAX_WALKERS } from '../src/traffic-plan.ts';

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

test('trucks only appear on days with real deliveries', () => {
  const c = grownCity(480); let withTrucks = 0, withDeliveries = 0;
  for (let day = 0; day < 40; day++) {
    step(c);
    const delivered = c.goodsLedger.some(e => e.tick === c.tick && ['Wholesale stock delivery', 'Imported shop stock', 'Exported goods'].includes(e.reason)) || c.cropLedger.some(e => e.tick === c.tick && e.kind === 'trade');
    const plan = trafficPlan(c);
    if (plan.trucks.length) { withTrucks++; assert.ok(delivered, 'a truck implies a delivery today'); }
    if (delivered) withDeliveries++;
  }
  assert.ok(withDeliveries === 0 || withTrucks > 0, 'real deliveries produce trucks');
});

test('planning never changes the city or its save', () => {
  const c = grownCity(300), before = serialize(c);
  for (let i = 0; i < 5; i++) trafficPlan(c);
  assert.equal(serialize(c), before);
  assert.ok(visualHash(1, 2) >= 0 && visualHash(1, 2) < 1 && visualHash(1, 2) === visualHash(1, 2));
});
