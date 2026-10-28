import test from 'node:test';
import { createCity as oldCity, step as oldStep, serialize as oldSerialize } from '../src/legacy-v6.ts';
import assert from 'node:assert/strict';
import { GATEWAY, SIZE, access, buildPlant, buildRoad, bulldoze, createCity, deserialize, explainCell, plantAt, serialize, step, summary, utilities, zoneCell, type City } from '../src/sim.ts';
import { HOUSEHOLD_BILL, OUTSIDE_PRICE, OUTSIDE_SUPPLY, PLANTS, TARIFF, buildingNeed } from '../src/utilities.ts';
import { previewPlacement } from '../src/placement-preview.ts';
import { cityGoals } from '../src/city-goals.ts';
import { keepSupplied } from './plants.ts';

const site = (c: City, skip = 0) => c.cells.map((cell, i) => !cell.road && !cell.zone && cell.building === null && !plantAt(c, i) && access(c, i) ? i : -1).filter(i => i >= 0)[skip];
const run = (c: City, days: number) => { for (let d = 0; d < days; d++) step(c); };

test('the gateway contract caps growth until the city builds plants; plants lift it', { timeout: 120_000 }, () => {
  const capped = createCity(61025); run(capped, 720);
  const svc = utilities(capped);
  assert.deepEqual(svc.capacity, OUTSIDE_SUPPLY, 'a new city has only the gateway contract');
  assert.ok(svc.used.power <= OUTSIDE_SUPPLY.power && svc.used.water <= OUTSIDE_SUPPLY.water);
  assert.equal(cityGoals(capped).won, false, 'without plants the sample city cannot win');
  const supplied = createCity(61025); let won = 0;
  for (let d = 1; d <= 720; d++) { step(supplied); keepSupplied(supplied); if (!won && cityGoals(supplied).won) won = d; }
  assert.ok(supplied.plants.length >= 2 && won > 0, `with plants the city wins (day ${won})`);
  assert.ok(summary(supplied).population > summary(capped).population);
  assert.deepEqual(deserialize(serialize(supplied)), supplied);
});

test('a plant needs an empty connected parcel and the treasury, and journals its cost', () => {
  const c = createCity(61025), cell = site(c), before = c.accounts.treasury;
  assert.equal(previewPlacement(c, 'power', null, cell)?.ok, true);
  assert.equal(buildPlant(c, GATEWAY, 'power').ok, false, 'not on a road');
  assert.equal(buildPlant(c, 0, 'water').ok, false, 'not off the network');
  assert.equal(previewPlacement(c, 'water', null, 0)?.ok, false);
  const r = buildPlant(c, cell, 'power'); assert.equal(r.ok, true, r.message);
  assert.equal(c.accounts.treasury, before - PLANTS.power.cost);
  assert.equal(c.ledger.at(-1)!.reason, `Build power plant #${c.plants[0].id}`);
  assert.equal(buildPlant(c, cell, 'water').ok, false, 'one plant per parcel');
  assert.equal(zoneCell(c, cell, 'R').ok, false, 'a plant parcel cannot be zoned');
  assert.equal(buildRoad(c, cell, cell).ok, false, 'or paved');
  assert.deepEqual(utilities(c).capacity, { power: OUTSIDE_SUPPLY.power + PLANTS.power.capacity, water: OUTSIDE_SUPPLY.water });
  assert.deepEqual(deserialize(serialize(c)), c);
  const poor = createCity(61025); poor.accounts.treasury = PLANTS.water.cost - 1;
  assert.equal(buildPlant(poor, site(poor), 'water').ok, false, 'no credit'); assert.equal(poor.plants.length, 0);
  assert.equal(bulldoze(c, cell).ok, true); assert.equal(c.plants.length, 0); assert.deepEqual(utilities(c).capacity, OUTSIDE_SUPPLY);
  assert.deepEqual(deserialize(serialize(c)), c);
});

test('supply follows roads: the farthest buildings go dark first and their work stops', { timeout: 120_000 }, () => {
  const c = createCity(61025); run(c, 120); keepSupplied(c, 40); run(c, 240);
  const svc = utilities(c);
  assert.ok(c.buildings.every(b => !access(c, b.cell) || svc.ok(b.id)), 'a supplied network serves everyone');
  // Remove the plants: the gateway contract cannot cover the city any more.
  for (const p of [...c.plants]) assert.equal(bulldoze(c, p.cell).ok, true);
  const short = utilities(c), dark = c.buildings.filter(b => short.distance.has(b.id) && !short.ok(b.id));
  assert.ok(dark.length > 0, 'some buildings lose service');
  const lit = c.buildings.filter(b => short.distance.has(b.id) && short.ok(b.id));
  const order = [...short.distance.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  assert.ok(short.ok(order[0][0]), 'the building nearest a source keeps its service');
  assert.ok(Math.max(...dark.map(b => short.distance.get(b.id)!)) >= Math.min(...lit.map(b => short.distance.get(b.id)!)), 'the cut falls on the far side');
  assert.match(explainCell(c, dark[0].cell).join(' '), /No (power|water)/);
  run(c, 2);
  for (const b of dark) for (const f of c.firms.filter(f => f.building === b.id && f.zone !== 'C')) assert.equal(c.employment.some(e => e.firmId === f.id), false, `firm #${f.id} without service has no workers`);
  assert.deepEqual(deserialize(serialize(c)), c);
});

test('monthly bills: users pay the city, the city pays outside units and plant upkeep', () => {
  const c = createCity(61025); run(c, 59); const cell = site(c);
  assert.equal(buildPlant(c, cell, 'water').ok, true); run(c, 1); assert.equal(c.tick % 30, 0);
  const month = c.ledger.filter(e => e.tick === c.tick), svc = utilities(c);
  const household = month.filter(e => e.reason === 'Monthly household water and power bill');
  assert.ok(household.length > 0 && household.every(e => e.to === 'treasury' && e.amount === HOUSEHOLD_BILL));
  const firms = month.filter(e => e.reason === 'Monthly water and power bill');
  for (const e of firms) {
    // Month-end growth runs after the bills, so a firm that grew today was billed at its old level.
    const f = c.firms.find(f => f.wallet === e.from)!, b = c.buildings.find(b => b.id === f.building)!;
    const grew = month.some(m => m.from === f.wallet && m.reason === 'Profitable firm height investment'), n = buildingNeed(b.zone, b.level - (grew ? 1 : 0));
    assert.equal(e.amount, n.power * TARIFF.power + n.water * TARIFF.water);
  }
  const bought = month.find(e => e.reason === 'Outside power supply')!.amount;
  assert.ok(bought > 0 && bought % OUTSIDE_PRICE.power === 0 && bought <= OUTSIDE_SUPPLY.power * OUTSIDE_PRICE.power, 'the gateway delivered the power, unit by unit');
  assert.ok(svc.plants.water >= svc.used.water);
  assert.equal(month.find(e => e.reason === 'Outside water supply'), undefined, 'the pump covers all the water; no outside purchase');
  assert.equal(month.find(e => e.reason === `Monthly water pump upkeep #${c.plants[0].id}`)!.amount, PLANTS.water.upkeep);
});

test('a 2.0 (v8) save loads with a contract that covers what it already drew, and never shrinks', () => {
  const old = oldCity(61025); for (let day = 0; day < 400; day++) oldStep(old);
  const raw = JSON.parse(serialize(deserialize(oldSerialize(old)))); delete raw.foodDemandStartTick; delete raw.plants; raw.utilities = { power: true, water: true }; raw.version = 8; raw.rulesVersion = 'chain-3';
  const loaded = deserialize(JSON.stringify(raw)), drawn = utilities(loaded);
  assert.equal(loaded.version, 9); assert.deepEqual(loaded.plants, []);
  assert.ok(loaded.utilities.outside.power >= OUTSIDE_SUPPLY.power && loaded.utilities.outside.water >= OUTSIDE_SUPPLY.water);
  assert.ok(loaded.buildings.every(b => !drawn.distance.has(b.id) || drawn.ok(b.id)), 'everything that ran before still runs');
  assert.deepEqual(deserialize(serialize(loaded)), loaded);
});

test('saves reject plants and contracts that do not add up', () => {
  const c = createCity(61025); run(c, 30); assert.equal(buildPlant(c, site(c), 'power').ok, true);
  const raw = JSON.parse(serialize(c));
  for (const mutate of [
    (x: any) => { x.plants[0].kind = 'water'; },
    (x: any) => { x.plants[0].cell = GATEWAY; },
    (x: any) => { x.plants.push({ ...x.plants[0], id: x.nextId - 1 + 100 }); },
    (x: any) => { x.utilities.outside.power = 1; },
    (x: any) => { delete x.plants; },
    (x: any) => { x.utilities = { power: true, water: true }; },
    (x: any) => { x.ledger = x.ledger.filter((e: any) => !/^Build power plant/.test(e.reason)); },
  ]) { const bad = structuredClone(raw); mutate(bad); assert.throws(() => deserialize(JSON.stringify(bad)), /corrupt/); }
  assert.ok(SIZE > 0);
});
