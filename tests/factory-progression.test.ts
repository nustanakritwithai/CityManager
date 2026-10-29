import test from 'node:test';
import assert from 'node:assert/strict';
import { factoryCropCapacity, factoryLevel } from '../src/factory-levels.ts';
import { proposeCropPurchase, proposeRecipe } from '../src/agriculture.ts';
import { createCity, deserialize, serialize, step } from '../src/sim.ts';
import { holdEducationReady } from './education-ready.ts';

test('factory capacity retains old tiers and adds two days of input storage per funded job', () => {
  assert.deepEqual(Array.from({length:9}, (_, i) => factoryCropCapacity(i + 1)), [24,24,24,28,32,36,40,44,48]);
  assert.throws(() => factoryCropCapacity(10));
});

test('published factory levels one to three retain their paid jobs and utility needs', () => {
  assert.deepEqual([1, 2, 3].map(level => {
    const { jobs, crops, power, water } = factoryLevel(level);
    return { jobs, crops, power, water };
  }), [
    { jobs: 4, crops: 24, power: 3, water: 2 },
    { jobs: 5, crops: 24, power: 4, water: 3 },
    { jobs: 6, crops: 24, power: 5, water: 4 },
  ]);
});

test('expanded factory buys real input and processes once per worker with no extra multiplier', () => {
  const seller = {wallet:'firm:1', zone:'F' as const, cash:0, reservedCash:0, cropInventory:48, cropCost:0};
  const buyer = {wallet:'firm:2', zone:'I' as const, cash:20000, reservedCash:2000, cropInventory:0, cropCost:0, cropCapacity:48};
  const p = proposeCropPurchase(seller, buyer, {quantity:48});
  assert.equal(p.ok,true); assert.equal(p.cash,16800); assert.equal(p.nextSeller.cropInventory,0); assert.equal(p.nextBuyer.cropInventory,48);
  const r = proposeRecipe({...p.nextBuyer, inventory:0, productionTick:0}, {tick:1, workers:12, operational:true, cropCapacity:48});
  assert.deepEqual([r.quantity,r.outputQuantity,r.batches,r.next.cropInventory], [24,96,12,24]);
  assert.equal(proposeRecipe({...p.nextBuyer, inventory:0, productionTick:0}, {tick:1, workers:0, operational:true, cropCapacity:48}).outputQuantity,0);
  assert.equal(proposeRecipe({...p.nextBuyer, inventory:0, productionTick:0}, {tick:1, workers:12, operational:false, cropCapacity:48}).outputQuantity,0);
});

test('new level save roundtrip preserves firm identity and old envelope still rejects a new level', () => {
  const city = createCity(61025); for (let day=0; day<90; day++) step(city);
  const f = city.firms.find(f=>f.zone==='I')!; assert.ok(f);
  const b = city.buildings.find(b=>b.id===f.building)!; b.level=9;
  const before = structuredClone(f); const saved = JSON.parse(serialize(city));
  const loaded = deserialize(JSON.stringify(saved));
  assert.deepEqual(loaded.firms.find(x=>x.id===f.id),before);
  assert.equal(loaded.buildings.find(x=>x.id===b.id)?.level,9);
  saved.version=15; saved.rulesVersion='chain-10'; delete saved.factoryProgressionStartTick; delete saved.farmLevelStartTick;
  assert.throws(()=>deserialize(JSON.stringify(saved)));
});

test('first upgraded save backs up exact old bytes before overwriting', async () => {
  const { SAVE_KEY, FACTORY_PROGRESS_BACKUP_KEY, saveStoredCity } = await import('../src/save-storage.ts');
  const data = new Map<string,string>();
  const storage = {getItem:(k:string)=>data.get(k) ?? null, setItem:(k:string,v:string)=>{data.set(k,v)}};
  const old = JSON.stringify({version:15, rulesVersion:'chain-10', parks:[]});
  const next = JSON.stringify({version:17, rulesVersion:'chain-12', parks:[]});
  storage.setItem(SAVE_KEY,old); saveStoredCity(storage,next,null);
  assert.equal(storage.getItem(FACTORY_PROGRESS_BACKUP_KEY),old); assert.equal(storage.getItem(SAVE_KEY),next);
});

test('automatic monthly reviews upgrade same-cell factories through level nine using paid capital', async () => {
  const { selectFactoryRecipe, firmWorkerCount } = await import('../src/sim.ts');
  const source = createCity(61025); for (let day=0; day<89; day++) step(source);
  for (let level=3; level<=8; level++) {
    const city = structuredClone(source), f = city.firms.find(f=>f.zone==='I')!, b = city.buildings.find(b=>b.id===f.building)!;
    b.level=level; city.utilities.outside = {power:1000, water:1000};
    const choice = f.recipe!;
    assert.equal(selectFactoryRecipe(city,f.id,choice).ok,true);
    const identity = {building:b.id,cell:b.cell,firm:f.id,wallet:f.wallet,owner:structuredClone(f.owner),recipe:f.recipe,mode:f.recipeMode};
    const beforeLedger = city.ledger.length; assert.ok(firmWorkerCount(city,f.id)>0);
    holdEducationReady(city);
    step(city);
    assert.equal(b.level,level+1, `level ${level} upgrades`);
    assert.deepEqual({building:b.id,cell:b.cell,firm:f.id,wallet:f.wallet,owner:f.owner,recipe:f.recipe,mode:f.recipeMode},identity);
    assert.equal(city.ledger.slice(beforeLedger).filter(e=>e.from===f.wallet && e.to==='construction' && e.amount===20000 && e.reason==='Profitable firm height investment').length,1);
    assert.equal(Object.values(city.accounts).reduce((a,n)=>a+n,0),0);
    assert.deepEqual(deserialize(serialize(city)),city);
  }
});

test('expanded factory processes actual allocated workers and replays history after demolition', async () => {
  const { bulldoze, firmWorkerCount } = await import('../src/sim.ts');
  const { RECIPE } = await import('../src/goods.ts');
  const city = createCity(61025); for (let day=0; day<89; day++) step(city);
  const f = city.firms.find(f=>f.zone==='I')!, b = city.buildings.find(b=>b.id===f.building)!;
  b.level=9; city.utilities.outside={power:1000,water:1000};
  // Move already allocated workers: no worker or skill is invented.
  for (const e of city.employment) { e.firmId=f.id; e.occupation='manufacturing'; }
  const crop=RECIPE[f.recipe!].crop, qty=48-f.cropInventory;
  city.cropLedger.push({id:city.cropLedger.length+1,tick:city.tick,kind:'market-receipt',from:'market-server',to:f.wallet,quantity:qty,fromValue:0,toValue:0,cash:0,workers:0,batches:0,outputQuantity:0,reason:`Market receipt #${city.cropLedger.length+1}`,crop});
  f.cropInventory+=qty; f.crops[crop]+=qty;
  assert.deepEqual(deserialize(serialize(city)),city);
  step(city); const event=city.cropLedger.findLast(e=>e.kind==='process'&&e.from===f.wallet)!;
  assert.ok(event && event.workers>6 && event.workers===firmWorkerCount(city,f.id));
  assert.equal(event.quantity,2*event.batches); assert.equal(event.outputQuantity,8*event.batches); assert.equal(event.batches,event.workers);
  assert.deepEqual(deserialize(serialize(city)),city);
  const bad=JSON.parse(serialize(city)); bad.cropLedger.findLast((e:any)=>e.kind==='process'&&e.from===f.wallet).workers=13;
  assert.throws(()=>deserialize(JSON.stringify(bad)));
  assert.equal(bulldoze(city,b.cell).ok,true);
  assert.equal(city.firms.some(x=>x.id===f.id),false);
  assert.deepEqual(deserialize(serialize(city)),city);
  const badBoundary=JSON.parse(serialize(city)); badBoundary.factoryProgressionStartTick=89;
  assert.throws(()=>deserialize(JSON.stringify(badBoundary)), 'known factory receipt cannot exceed the old 24-lot limit before migration');
});

test('higher factory receipt space counts crop lots separately from finished goods', async () => {
  const { MarketClient } = await import('../src/market-client.ts');
  const { RECIPE } = await import('../src/goods.ts');
  const city=createCity(61025); for(let day=0;day<30;day++)step(city);
  const f=city.firms.find(f=>f.zone==='I')!, b=city.buildings.find(b=>b.id===f.building)!;
  f.crops={rice:0,vegetables:0,sugarcane:0}; f.cropInventory=0; f.cropCost=0;
  f.products[RECIPE[f.recipe!].product]=100; f.inventory=100;
  const client=new MarketClient(()=>city), receipt={receipt_id:'00000000-0000-4000-8000-000000000004',item_code:`crop:${RECIPE[f.recipe!].crop}`,quantity:28};
  b.level=3; assert.equal(client.receiptDestinations(receipt).some(x=>x.firmId===f.id),false);
  b.level=4; assert.equal(client.receiptDestinations(receipt).find(x=>x.firmId===f.id)?.available,28);
  assert.equal(client.receiptDestinations({...receipt,quantity:29}).some(x=>x.firmId===f.id),false);
});

test('new upgrades retain working capital while old level-two economics stay unchanged', async () => {
  const source=createCity(61025); for(let day=0;day<89;day++)step(source);
  for(const [level,expected] of [[2,3],[3,3]] as const) {
    const city=structuredClone(source), f=city.firms.find(f=>f.zone==='I')!, b=city.buildings.find(b=>b.id===f.building)!;
    b.level=level; city.utilities.outside={power:1000,water:1000};
    const amount=city.accounts[f.wallet]-350000; assert.ok(amount>0);
    city.accounts[f.wallet]-=amount; city.accounts.outside+=amount;
    city.ledger.push({tick:city.tick,from:f.wallet,to:'outside',amount,reason:'Test reserve adjustment'});
    step(city); assert.equal(b.level,expected);
    const investments=city.ledger.filter(e=>e.tick===city.tick && e.from===f.wallet && e.reason==='Profitable firm height investment');
    assert.equal(investments.length,level===2?1:0); assert.equal(Object.values(city.accounts).reduce((a,n)=>a+n,0),0);
    assert.deepEqual(deserialize(serialize(city)),city);
  }
});

test('legacy v15 migration preserves records and applies old worker limits before the boundary', () => {
  const source=createCity(61025); for(let day=0;day<89;day++)step(source);
  const old=JSON.parse(serialize(source)); delete old.education; old.version=15; old.rulesVersion='chain-10'; delete old.factoryProgressionStartTick; delete old.farmLevelStartTick;
  const raw=JSON.stringify(old), loaded=deserialize(raw);
  assert.equal(loaded.factoryProgressionStartTick,old.tick);
  assert.deepEqual(loaded.cropLedger,old.cropLedger); assert.deepEqual(loaded.goodsLedger,old.goodsLedger); assert.deepEqual(loaded.accounts,old.accounts);
  const bad=JSON.parse(raw); bad.cropLedger.find((e:any)=>e.kind==='process').workers=7;
  assert.throws(()=>deserialize(JSON.stringify(bad)));
  const carried=JSON.parse(serialize(loaded)); carried.cropLedger.find((e:any)=>e.kind==='process').workers=7;
  assert.throws(()=>deserialize(JSON.stringify(carried)));
  assert.equal(JSON.stringify(old),raw);
});

test('factory upgrade requires network capacity and does not fabricate workers', async () => {
  const { utilities, firmWorkerCount }=await import('../src/sim.ts');
  const source=createCity(61025); for(let day=0;day<89;day++)step(source);
  const city=structuredClone(source), f=city.firms.find(f=>f.zone==='I')!, b=city.buildings.find(b=>b.id===f.building)!;
  b.level=3; const used=utilities(city).used; city.utilities.outside={...used};
  step(city); assert.equal(b.level,3); assert.ok(firmWorkerCount(city,f.id)<=6);
  for (const h of city.households) {
    const employees=city.employment.filter(e=>e.householdId===h.id).reduce((n,e)=>n+e.workers,0), owners=city.ownerLabor.filter(e=>e.householdId===h.id).length;
    assert.ok(employees+owners<=h.workforce);
  }
});
