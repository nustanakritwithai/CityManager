import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoad, createCity, deserialize, GATEWAY, isCommercial, MONTH, serialize, SIZE, step } from '../src/sim.ts';
import { cityGoals } from '../src/city-goals.ts';
import { GOAL_SERVED_ROADS, GOAL_SERVED_ROADS_PER_AXIS, mainGoalNetwork } from '../src/main-goal-network.ts';
import { expandedGoalCity } from './main-goals-fixture.ts';
import { keepSupplied } from './plants.ts';

test('a straight road, disconnected road, and unserved branch do not satisfy the network objective', () => {
  const c = createCity(61025);
  const initial = mainGoalNetwork(c);
  assert.ok(initial.roads < 30); assert.equal(initial.vertical, 0);
  assert.equal(buildRoad(c, 2 * SIZE + 1, 2 * SIZE + 20).ok, true);
  assert.deepEqual(mainGoalNetwork(c), initial, 'disconnected roads do not count');
  assert.equal(buildRoad(c, GATEWAY + 10, GATEWAY + 17).ok, true);
  assert.equal(buildRoad(c, 12 * SIZE + 15, 4 * SIZE + 15).ok, true);
  assert.equal(mainGoalNetwork(c).vertical, 0, 'a dangling, unserved branch does not count');
});

test('branched and loop networks both support a real attainable revised victory', {timeout: 120_000}, t => {
  for (const layout of ['branches', 'loop'] as const) {
    const c = expandedGoalCity(61025, layout); let win = 0;
    for (let d = 1; d <= 900 && !win; d++) { step(c); keepSupplied(c); if (cityGoals(c).won) win = d; }
    const n = mainGoalNetwork(c);
    assert.ok(n.served >= GOAL_SERVED_ROADS && n.horizontal >= GOAL_SERVED_ROADS_PER_AXIS && n.vertical >= GOAL_SERVED_ROADS_PER_AXIS, `${layout}: ${JSON.stringify(n)}`);
    assert.ok(n.horizontal + n.vertical === n.served, 'junctions count toward at most one axis');
    assert.ok(win > 0, `${layout} reaches victory`);
    assert.ok(c.ledger.some(e => e.reason === 'Monthly municipal services' && e.amount > 0), 'victory includes actual resident service costs');
    t.diagnostic(`${layout} wins day ${win}`);
    const raw = serialize(c); assert.deepEqual(cityGoals(deserialize(raw)), cityGoals(c)); assert.equal(serialize(c), raw);
    const noWholesale = deserialize(raw); noWholesale.goodsLedger = noWholesale.goodsLedger.filter(e => e.reason !== 'Wholesale stock delivery' || e.tick <= noWholesale.tick - MONTH);
    assert.equal(cityGoals(noWholesale).won, false, 'recent wholesale is required');
    const imported = deserialize(raw); imported.goodsLedger.push({tick: imported.tick, from: 'outside', to: 'firm:1', quantity: 1, reason: 'Imported shop stock'});
    assert.equal(cityGoals(imported).won, false, 'a recent import blocks victory');
  }
});

test('legacy goals remain reversible and do not fabricate an achievement; marker validates', {timeout: 120_000}, () => {
  const c = createCity(61025); delete c.goalRulesVersion;
  for (let d = 0; d < 450 && !cityGoals(c).won; d++) { step(c); keepSupplied(c); }
  assert.ok(cityGoals(c).won); const saved = serialize(c); const old = deserialize(saved);
  assert.equal(old.goalRulesVersion, undefined); assert.equal(cityGoals(old).won, true);
  assert.equal(cityGoals({...old, goalRulesVersion: 2}).won, false, 'new rules apply only to opted-in cities');
  assert.throws(() => deserialize(JSON.stringify({...JSON.parse(saved), goalRulesVersion: 1})), /goal rules/);
  assert.throws(() => serialize({...c, goalRulesVersion: 1} as never), /goal rules/);
});

test('revised stage three reports wholesale and household purchases separately', () => {
  const c = createCity(61025); for (let day = 0; day < 120; day++) step(c);
  const shop = c.firms.find(isCommercial); assert.ok(shop);
  c.goodsLedger = [];
  const checks = () => cityGoals(c).stages[2].checks;
  assert.deepEqual(checks().map(check => check.done), [false, false]);
  c.goodsLedger.push({tick:c.tick, from:'firm:1', to:shop.wallet, quantity:1, reason:'Wholesale stock delivery'});
  assert.deepEqual(checks().map(check => check.done), [true, false]);
  c.goodsLedger.push({tick:c.tick, from:shop.wallet, to:'household:1', quantity:1, reason:'Household final consumption'});
  assert.deepEqual(checks().map(check => check.done), [true, true]);
});


test('empty buildings and a long connected spur do not create served frontage', {timeout: 120_000}, () => {
  const c = createCity(61025);
  for (let day = 0; day < 300; day++) { step(c); keepSupplied(c); }
  const before = mainGoalNetwork(c);
  assert.ok(before.served > 0 && before.served < GOAL_SERVED_ROADS);
  assert.equal(buildRoad(c, GATEWAY + 10, GATEWAY + 20).ok, true);
  assert.equal(buildRoad(c, GATEWAY + 20, 23 * SIZE + 20).ok, true);
  const after = mainGoalNetwork(c);
  assert.ok(after.roads > before.roads + 15, 'the long spur is connected');
  assert.equal(after.served, before.served, 'unserved roads add no qualifying frontage');
  assert.ok(after.served < GOAL_SERVED_ROADS);
  const empty = structuredClone(c); empty.households = []; empty.employment = []; empty.ownerLabor = [];
  assert.ok(empty.buildings.length > 0, 'physical buildings remain in place');
  assert.equal(mainGoalNetwork(empty).served, 0, 'vacant homes and unstaffed firms do not count');
});

test('one served intersection is assigned to only one axis', () => {
  const c = createCity(61025, {starter:false});
  assert.ok(buildRoad(c, GATEWAY, GATEWAY + 5).ok);
  assert.ok(buildRoad(c, 10 * SIZE + 5, 14 * SIZE + 5).ok);
  c.buildings.push({id: 999, cell: 12 * SIZE + 6, zone: 'R', level: 1, age: 0});
  c.households.push({home: 999} as typeof c.households[number]);
  const n = mainGoalNetwork(c);
  assert.equal(n.served, 1); assert.equal(n.horizontal + n.vertical, 1);
  assert.ok(n.horizontal < GOAL_SERVED_ROADS_PER_AXIS && n.vertical < GOAL_SERVED_ROADS_PER_AXIS);
  c.utilities.outside = {power: 0, water: 0};
  assert.equal(mainGoalNetwork(c).served, 0, 'an occupied home without utilities does not count');
  c.utilities.outside = {power: 12, water: 0};
  assert.equal(mainGoalNetwork(c).served, 0, 'both utilities are required');
  c.utilities.outside = {power: 12, water: 12};
  assert.equal(mainGoalNetwork(c).served, 1, 'frontage returns when utilities return');
});
