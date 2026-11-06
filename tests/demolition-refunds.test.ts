import test from 'node:test';
import assert from 'node:assert/strict';
import { access, buildCampus, buildPark, buildPlant, buildRoad, bulldoze, createCity, demolitionQuote, deserialize, GATEWAY, plantAt, serialize, step, upgradeCampus, upgradePlant, type City } from '../src/sim.ts';
import { auditMoney, compactCityHistory } from '../src/city-history.ts';
import { EDUCATION_COST } from '../src/education.ts';
import { PARK } from '../src/parks.ts';
import { PLANTS, PLANT_LEVELS } from '../src/utilities.ts';

const fresh = () => createCity(61025, {starter:false});
const balanced = (c: City) => assert.equal(Object.values(c.accounts).reduce((a,b)=>a+b,0),0);
const roundTrip = (c: City) => assert.deepEqual(deserialize(serialize(c)),c);
const fund = (c: City, amount: number) => {c.accounts.outside-=amount;c.accounts.treasury+=amount;c.ledger.push({tick:c.tick,from:'outside',to:'treasury',amount,reason:'Synthetic refund test funding'});};
const assertRefund = (c: City, cell: number, paid: number) => {
 const before=structuredClone(c.accounts), quote=demolitionQuote(c,cell);
 assert.equal(quote.paid,paid); assert.equal(quote.refund,Math.floor(paid*.8));assert.equal(quote.fee,0);assert.equal(quote.net,quote.refund);
 const outcome=bulldoze(c,cell);assert.equal(outcome.ok,true,outcome.message);
 assert.equal(c.accounts.treasury,before.treasury+quote.refund);balanced(c);roundTrip(c);
 const refunded=structuredClone(c.accounts),entries=c.ledger.length;
 assert.equal(bulldoze(c,cell).ok,true);assert.deepEqual(c.accounts,refunded);assert.equal(c.ledger.length,entries,'repeat cannot pay twice');
 roundTrip(c);
};

for(const kind of ['power','water'] as const) test(`${kind}: 80% of actual construction plus both upgrades, no demolition fee`,()=>{
 const c=fresh();fund(c,2_000_000);assert.ok(buildPlant(c,GATEWAY+1,kind).ok);const p=c.plants[0];
 for(const level of [1,2] as const)assert.ok(upgradePlant(c,p.id,level).ok);
 const paid=PLANTS[kind].cost+PLANT_LEVELS[kind][1].upgradeCost+PLANT_LEVELS[kind][2].upgradeCost;
 assertRefund(c,p.cell,paid);assert.match(c.lastEvent,/./);
});
test('park refund uses actual paid capital, never upkeep or maintenance',()=>{
 const c=fresh();buildPark(c,0);for(let i=0;i<31;i++)step(c);
 assertRefund(c,0,PARK.cost);
});
for(const kind of ['school','university'] as const) test(`${kind}: refunds exact construction and eligible upgrade receipts`,()=>{
 const c=fresh();fund(c,2_000_000);assert.ok(buildCampus(c,GATEWAY+1,kind).ok);const campus=c.education!.campuses[0];
 let paid=EDUCATION_COST[kind].build;
 if(kind==='school'){assert.ok(upgradeCampus(c,campus.id).ok);paid+=EDUCATION_COST.school.upgrade;}
 assertRefund(c,campus.cell,paid);
});
test('municipal quote is read-only and no treasury cash is needed to receive a refund',()=>{
 const c=fresh();buildPark(c,0);const amount=c.accounts.treasury;c.accounts.treasury=0;c.accounts.outside+=amount;c.ledger.push({tick:c.tick,from:'treasury',to:'outside',amount,reason:'Synthetic withdrawal'});
 const before=serialize(c);for(let i=0;i<3;i++)demolitionQuote(c,0);assert.equal(serialize(c),before);
 assertRefund(c,0,PARK.cost);
});
test('new roads record only newly paid cells; repeat placement and rebuild cannot duplicate refunds',()=>{
 const c=fresh();assert.ok(buildRoad(c,GATEWAY,GATEWAY+3).ok);const cash=c.accounts.treasury;
 assert.ok(buildRoad(c,GATEWAY,GATEWAY+3).ok);assert.equal(c.accounts.treasury,cash);
 for(const cell of [GATEWAY+1,GATEWAY+2,GATEWAY+3])assert.equal(demolitionQuote(c,cell).paid,5000);
 assertRefund(c,GATEWAY+2,5000);
 assert.ok(buildRoad(c,GATEWAY+2,GATEWAY+2).ok);assertRefund(c,GATEWAY+2,5000);
 roundTrip(c);
});
test('historical roads without parcel receipts receive no invented refund; gateway is protected',()=>{
 const c=fresh();buildRoad(c,GATEWAY,GATEWAY+1);
 for(const entry of c.ledger)if(entry.to==='roadworks')entry.reason='Build 1 road cells';
 const loaded=deserialize(serialize(c));const quote=demolitionQuote(loaded,GATEWAY+1);
 assert.equal(quote.paid,0);assert.equal(quote.refund,0);assert.equal(quote.unknown,true);
 const before=structuredClone(loaded.accounts);assert.ok(bulldoze(loaded,GATEWAY+1).ok);assert.deepEqual(loaded.accounts,before);roundTrip(loaded);
 const gateway=serialize(loaded);assert.equal(bulldoze(loaded,GATEWAY).ok,false);assert.equal(serialize(loaded),gateway);
});
test('plant, upgraded school and road receipts survive repeated compaction then demolition',()=>{
 const c=fresh();fund(c,2_000_000);buildRoad(c,GATEWAY,GATEWAY+4);buildPlant(c,GATEWAY+1-24,'water');upgradePlant(c,c.plants[0].id,1);
 assert.ok(buildCampus(c,GATEWAY+2-24,'school').ok);assert.ok(upgradeCampus(c,c.education!.campuses[0].id).ok);buildPark(c,0);
 for(const tick of [120,180]){c.tick=tick;compactCityHistory(c);roundTrip(c);}
 assertRefund(c,c.plants[0].cell,PLANTS.water.cost+PLANT_LEVELS.water[1].upgradeCost);
 assertRefund(c,c.education!.campuses[0].cell,EDUCATION_COST.school.build+EDUCATION_COST.school.upgrade);
 assertRefund(c,0,PARK.cost);assertRefund(c,GATEWAY+4,5000);
 c.tick=240;compactCityHistory(c);roundTrip(c);
});
test('old compacted campus history is not repriced or credited during load',()=>{
 const c=fresh();buildCampus(c,GATEWAY+1,'school');upgradeCampus(c,c.education!.campuses[0].id);c.tick=120;compactCityHistory(c);
 c.history!.structuralProofs=c.history!.structuralProofs.filter(e=>!/^Build school |^Upgrade school /.test(e.reason));
 const before=structuredClone(c.accounts),loaded=deserialize(serialize(c));assert.deepEqual(loaded.accounts,before);
 const quote=demolitionQuote(loaded,GATEWAY+1);assert.equal(quote.paid,0);assert.equal(quote.refund,0);assert.equal(quote.unknown,true);
 assert.ok(bulldoze(loaded,GATEWAY+1).ok);assert.deepEqual(loaded.accounts,before);roundTrip(loaded);
});
test('refund mutations cannot pass simply by balancing accounts',()=>{
 const c=fresh();buildPark(c,0);bulldoze(c,0);const good=JSON.parse(serialize(c));
 const mutate=[
  (x:any)=>{const e=x.ledger.find((e:any)=>e.reason.startsWith('Demolition refund'));e.amount++;x.accounts[e.from]--;x.accounts[e.to]++;},
  (x:any)=>{const e=x.ledger.find((e:any)=>e.reason.startsWith('Demolition refund'));x.ledger.push({...e});x.accounts[e.from]-=e.amount;x.accounts[e.to]+=e.amount;},
  (x:any)=>{const e=x.ledger.find((e:any)=>e.reason.startsWith('Demolition refund'));e.reason=e.reason.replace(/#\d+$/,'#999999');},
 ];
 for(const change of mutate){const x=structuredClone(good);change(x);assert.throws(()=>deserialize(JSON.stringify(x)),/corrupt|refund/i);}
});
test('private buildings have no municipal capital refund and retain existing closure accounting',()=>{
 const c=createCity(61025);for(let i=0;i<30;i++)step(c);const home=c.buildings.find(b=>b.zone==='R');assert.ok(home);
 const q=demolitionQuote(c,home.cell);assert.equal(q.paid,0);assert.equal(q.refund,0);assert.equal(q.fee,2000);assert.equal(q.unknown,false);
 const before=c.accounts.treasury;assert.ok(bulldoze(c,home.cell).ok);assert.equal(c.accounts.treasury,before-2000);balanced(c);roundTrip(c);
});

test('refund chronology rejects backdated payments before purchase or a retained upgrade, without compacting away evidence',()=>{
 const reject = (c:City, tick:number) => {
  const refund=c.ledger.find(e=>e.reason.startsWith('Demolition refund'))!;
  assert.ok(refund);refund.tick=tick;balanced(c);
  assert.throws(()=>deserialize(serialize(c)),/corrupt|refund|checkpoint/i);
  c.tick=240;const before=serialize(c);
  assert.throws(()=>compactCityHistory(c),/refund/i);
  assert.equal(serialize(c),before,'failed compaction must preserve all invalid evidence and balances');
 };
 const plant=fresh();plant.tick=10;assert.ok(buildPlant(plant,GATEWAY+1,'water').ok);
 plant.tick=20;assert.ok(bulldoze(plant,GATEWAY+1).ok);reject(plant,0);
 const upgraded=fresh();upgraded.tick=10;buildCampus(upgraded,GATEWAY+1,'school');
 upgraded.tick=20;upgradeCampus(upgraded,upgraded.education!.campuses[0].id);
 upgraded.tick=30;bulldoze(upgraded,GATEWAY+1);reject(upgraded,15);
 // Legacy compaction can omit the original campus build. The later upgrade is
 // still attributable, and its refund may not precede that remaining payment.
 const partial=fresh();partial.tick=10;buildCampus(partial,GATEWAY+1,'school');
 partial.tick=150;compactCityHistory(partial);
 partial.history!.structuralProofs=partial.history!.structuralProofs.filter(e=>!e.reason.startsWith('Build school '));
 partial.tick=160;upgradeCampus(partial,partial.education!.campuses[0].id);
 partial.tick=170;assert.ok(bulldoze(partial,GATEWAY+1).ok);
 assert.equal(partial.ledger.find(e=>e.reason.startsWith('Demolition refund'))!.amount,EDUCATION_COST.school.upgrade*.8);
 reject(partial,155);
});

test('road compaction uses the same chronological replay as quotes for reordered retained entries',()=>{
 const c=fresh();c.tick=90;compactCityHistory(c);
 c.tick=100;assert.ok(buildRoad(c,GATEWAY,GATEWAY+1).ok);
 c.tick=110;assert.ok(bulldoze(c,GATEWAY+1).ok);
 c.tick=120;assert.ok(buildRoad(c,GATEWAY,GATEWAY+1).ok);
 const index=c.ledger.findIndex(e=>e.reason===`Demolition refund road cell @${GATEWAY+1}`);
 const [refund]=c.ledger.splice(index,1);c.ledger.push(refund);
 const loaded=deserialize(serialize(c));
 assert.equal(demolitionQuote(loaded,GATEWAY+1).paid,5000);
 loaded.tick=180;compactCityHistory(loaded);
 assert.equal(demolitionQuote(loaded,GATEWAY+1).paid,5000,'the rebuilt road must keep its latest paid receipt');
 assert.equal(loaded.history!.structuralProofs.filter(e=>e.reason===`Build road cell @${GATEWAY+1}`).length,1);
 roundTrip(loaded);assertRefund(loaded,GATEWAY+1,5000);
});
