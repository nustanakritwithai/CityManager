import test from 'node:test';
import assert from 'node:assert/strict';
import { access, buildPark, buildPlant, buildRoad, bulldoze, createCity, deserialize, GATEWAY, plantAt, plantUpgradeStatus, serialize, SIZE, step, treasurySpendable, upgradePlant, utilities, type City } from '../src/sim.ts';
import { plantLevel, plantSpec, PLANTS, PLANT_LEVELS, plantUpgradeReason, type UtilityKind } from '../src/utilities.ts';
import { auditMoney, compactCityHistory } from '../src/city-history.ts';
import { createParkRuntime, deserializeParkSession, serializeParkSession } from '../src/park-runtime.ts';
const site = (c: City) => c.cells.findIndex((x, i) => !x.road && x.building === null && !plantAt(c, i) && access(c, i));
const make = (kind: UtilityKind = 'power') => { const c = createCity(61025); assert.ok(buildPlant(c, site(c), kind).ok); return c; };

for (const kind of ['power', 'water'] as const) test(`${kind}: successive upgrades increase real capacity, charge once and preserve saves`, () => {
  const c = make(kind), p = c.plants[0], original = serialize(c), before = c.accounts.treasury, ids = c.nextId;
  assert.equal(p.level, undefined); assert.equal(serialize(deserialize(original)), original);
  for (const level of [1, 2] as const) {
    const quote = plantUpgradeStatus(c, p.id)!; assert.equal(quote.level, level);
    assert.deepEqual(quote.reasons, []); assert.ok(upgradePlant(c, p.id, level).ok);
    assert.equal(plantLevel(p), level + 1); assert.equal(utilities(c).plants[kind], PLANT_LEVELS[kind][level].capacity);
    const after = serialize(c); assert.equal(upgradePlant(c, p.id, level).ok, false); assert.equal(serialize(c), after, 'stale repeated command does not charge next level');
    assert.deepEqual(deserialize(after), c);
  }
  assert.equal(c.accounts.treasury, before - PLANT_LEVELS[kind][1].upgradeCost - PLANT_LEVELS[kind][2].upgradeCost);
  assert.equal(c.nextId, ids); assert.equal(c.plants.length, 1);
  const beforeMax = serialize(c); assert.equal(upgradePlant(c, p.id, 3).ok, false); assert.equal(serialize(c), beforeMax);
  const runtime = createParkRuntime(c), saved = serializeParkSession(c, runtime); assert.deepEqual(deserializeParkSession(saved).city, c);
  assert.equal(deserialize(original).plants[0].level, undefined, 'original remains a four-field L1 plant');
});
test('insufficient spendable treasury, missing plant and disconnected frontage refuse without mutation', () => {
  const c = make(), p = c.plants[0]; c.accounts.treasury = 299_999;
  const before = JSON.stringify(c); assert.equal(upgradePlant(c, p.id, 1).ok, false); assert.equal(JSON.stringify(c), before);
  assert.equal(upgradePlant(c, -1, 1).ok, false); assert.equal(JSON.stringify(c), before);
  c.accounts.treasury = 500_000;
  for (const cell of c.cells) cell.road = false;
  const disconnected = JSON.stringify(c); assert.equal(upgradePlant(c, p.id, 1).ok, false); assert.equal(JSON.stringify(c), disconnected);
  assert.equal(utilities(c).plants.power, 0);
});
test('monthly upkeep uses upgraded levels; disconnect removes capacity and demolition removes full capacity', () => {
  const c = make(), p = c.plants[0]; assert.ok(upgradePlant(c, p.id, 1).ok);
  while (c.tick < 30) step(c);
  assert.equal(auditMoney(c).find(e => e.reason === `Monthly power plant upkeep #${p.id}`)?.amount, 18_000);
  assert.equal(utilities(c).plants.power, 80);
  assert.ok(bulldoze(c, p.cell).ok); assert.equal(utilities(c).plants.power, 0);
  assert.match(c.lastEvent, /loses 80 power/); assert.deepEqual(deserialize(serialize(c)), c);
});
test('strict saves reject missing, duplicated, reordered, wrong-price and invented upgrade evidence', () => {
  const c = make(), p = c.plants[0]; upgradePlant(c, p.id, 1); upgradePlant(c, p.id, 2);
  const good = JSON.parse(serialize(c));
  const mutations = [
    (x: any) => { delete x.plants[0].level; },
    (x: any) => { x.plants[0].level = 1; },
    (x: any) => { x.plants[0].level = 4; },
    (x: any) => { x.plants[0].unknown = true; },
    (x: any) => { x.ledger.splice(x.ledger.findIndex((e: any) => e.reason.includes('to level 2')), 1); },
    (x: any) => { const i = x.ledger.findIndex((e: any) => e.reason.includes('to level 2')); [x.ledger[i], x.ledger[i+1]] = [x.ledger[i+1], x.ledger[i]]; },
    (x: any) => { x.ledger.find((e: any) => e.reason.includes('to level 2')).amount--; },
    (x: any) => { x.ledger.push({...x.ledger.at(-1)}); },
    (x: any) => { x.ledger.find((e: any) => e.reason.includes('to level 2')).reason = plantUpgradeReason('water', p.id, 2); },
  ];
  for (const mutate of mutations) { const x = structuredClone(good); mutate(x); assert.throws(() => deserialize(JSON.stringify(x)), /corrupt/i); }
  assert.doesNotThrow(() => deserialize(JSON.stringify(good)));
});
test('32 fully upgraded plants retain receipts through repeated checkpoints and demolition', () => {
  const c = createCity(123, { starter: false });
  c.accounts.outside -= 100_000_000; c.accounts.treasury += 100_000_000;
  c.ledger.push({tick:c.tick, from:'outside', to:'treasury', amount:100_000_000, reason:'Synthetic test funding'});
  assert.ok(buildRoad(c, GATEWAY, GATEWAY + SIZE - 1).ok);
  for(let i=0; i<32; i++) { assert.ok(buildPlant(c, site(c), i%2 ? 'water':'power').ok); const p=c.plants.at(-1)!; assert.ok(upgradePlant(c,p.id,1).ok); assert.ok(upgradePlant(c,p.id,2).ok); }
  c.tick = 120; assert.ok(compactCityHistory(c));
  assert.equal(c.history!.structuralProofs.filter(e=>e.reason.startsWith('Upgrade ')).length,64);
  assert.deepEqual(deserialize(serialize(c)),c);
  c.tick = 180; compactCityHistory(c); assert.deepEqual(deserialize(serialize(c)),c);
  assert.ok(bulldoze(c,c.plants[0].cell).ok); c.tick=240;compactCityHistory(c); assert.deepEqual(deserialize(serialize(c)),c);
});
test('level one prices stay unchanged and upgrades improve cost/capacity without raising tariffs',()=>{
  for(const kind of ['power','water'] as const) {
    assert.equal(PLANT_LEVELS[kind][0].capacity,PLANTS[kind].capacity);
    assert.equal(PLANT_LEVELS[kind][0].upkeep,PLANTS[kind].upkeep);
    for(const level of [1,2]) { const previous=PLANT_LEVELS[kind][level-1],next=PLANT_LEVELS[kind][level];
      assert.equal(next.upgradeCost/(next.capacity-previous.capacity),PLANTS[kind].cost/40*.6);
      assert.ok(next.upkeep/next.capacity < previous.upkeep/previous.capacity);
    }
  }
});

test('upgrade cannot spend wages reserved for municipal workers',()=>{
 const c=make();const p=c.plants[0];const parkCell=c.cells.findIndex((x,i)=>!x.road&&!x.zone&&x.building===null&&!plantAt(c,i));assert.ok(buildPark(c,parkCell).ok);
 c.parks[0].staffing={allocations:[],workDays:{'household:synthetic':1}};
 c.accounts.treasury=300_000;assert.equal(treasurySpendable(c),298_600);
 const before=JSON.stringify(c);assert.equal(upgradePlant(c,p.id,1).ok,false);assert.equal(JSON.stringify(c),before);
});
test('upgraded disconnected plant keeps its level and upkeep, then recovers full capacity on reconnect',()=>{
 const c=make('water'),p=c.plants[0];upgradePlant(c,p.id,1);
 const roads=c.cells.map(x=>x.road);for(const x of c.cells)x.road=false;
 assert.equal(utilities(c).plants.water,0);for(let i=0;i<30;i++)step(c);
 assert.equal(auditMoney(c).find(e=>e.reason===`Monthly water pump upkeep #${p.id}`)?.amount,9_000);
 c.cells.forEach((x,i)=>{x.road=roads[i];});assert.equal(utilities(c).plants.water,80);assert.equal(p.level,2);
});
