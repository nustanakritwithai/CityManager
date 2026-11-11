import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampus, buildPark, createCity, departureDay, departureForecast, deserialize, householdWorkerCount, serialize, step, rebalanceHousing, SIZE, type City } from '../src/sim.ts';
import { HAPPINESS_DEPARTURE_DAYS, happinessTarget, happinessTargets } from '../src/resident-happiness.ts';
import { scheduleCityTaxes } from '../src/city-tax-policy.ts';
import { peopleOf } from '../src/education.ts';

import { keepSupplied } from './plants.ts';

const advance=(c:City,n:number)=>{for(let i=0;i<n;i++)step(c);};
const oneWay=(c:City)=>{c.roadTopology={version:1,blocked:[],oneWay:Object.fromEntries(c.cells.flatMap((v,i)=>v.road?[[i,1]]:[]))};};
test('severe route loss causes slow, capped decline; restoring routes lets remaining households recover',()=>{
 const c=createCity(61025); advance(c,120); const initial=c.households.length;
 assert.ok(initial>4); assert.equal(c.migration.departures??0,0);
 oneWay(c); const before=c.households.length; advance(c,29);
 assert.ok(c.households.length>=before,'no immediate unhappy departures');
 advance(c,61); assert.ok((c.migration.departures??0)>0); assert.ok(c.households.length<initial,'not immediately backfilled');
 const retained=c.households.map(h=>h.id), old=new Map(c.happiness!.rows.map(r=>[r.householdId,r.score]));
 c.roadTopology={version:1,blocked:[],oneWay:{}}; advance(c,30);
 assert.ok(retained.some(id=>c.happiness!.rows.find(row=>row.householdId===id && row.score>(old.get(id)??100))),'restored roads allow recovery');
 assert.doesNotThrow(()=>deserialize(serialize(c)));
});
test('a persistent severe city can decline to its protected floor, with deterministic save replay',()=>{
 const a=createCity(61025); advance(a,120); oneWay(a); const b=deserialize(serialize(a));
 for(let i=0;i<150;i++){step(a);step(b);if(i===74){const x=deserialize(serialize(b));Object.assign(b,x);}}
 assert.equal(a.households.length,2); assert.deepEqual(b,a); assert.deepEqual(deserialize(serialize(a)),a);
});
test('wellbeing starts only when old saves advance and rejects corrupt or mismatched records',()=>{
 const c=createCity(12), old=serialize(c); assert.equal(JSON.parse(old).version,27); assert.equal(deserialize(old).happiness,undefined);
 step(c); const raw=serialize(c); assert.equal(JSON.parse(raw).version,28); assert.deepEqual(deserialize(raw),c);
 for(const mutate of [(x:any)=>x.happiness.day++, (x:any)=>x.happiness.rows.push({householdId:999,score:50,distressDays:0}), (x:any)=>x.happiness.version=2]) {const x=JSON.parse(raw);mutate(x);assert.throws(()=>deserialize(JSON.stringify(x)));}
});

test('new rates move wage earners and business owners gradually from the effective day, including after reload', () => {
  const neutral = createCity(42);
  advance(neutral, 89);
  const higher = deserialize(serialize(neutral)), lower = deserialize(serialize(neutral));
  const owner = neutral.firms.find(firm => firm.owner)!.owner!.householdId;
  const employee = neutral.employment.find(job => job.householdId !== owner)!.householdId;
  const score = (city: City, id: number) => city.happiness!.rows.find(row => row.householdId === id)!.score;
  scheduleCityTaxes(higher, { wage: 30, profit: 40 });
  scheduleCityTaxes(lower, { wage: 0, profit: 0 });
  assert.deepEqual(happinessTargets(higher), happinessTargets(neutral));
  assert.deepEqual(happinessTargets(lower), happinessTargets(neutral));
  step(neutral); step(higher); step(lower);
  assert.deepEqual(higher.happiness, neutral.happiness);
  assert.deepEqual(lower.happiness, neutral.happiness);
  const reloaded = deserialize(serialize(higher));
  assert.deepEqual(reloaded.happiness, higher.happiness);

  step(neutral); step(higher); step(lower); step(reloaded);
  assert.equal(serialize(reloaded), serialize(higher));
  const high = happinessTargets(higher), low = happinessTargets(lower), baseline = happinessTargets(neutral);
  for (const id of [owner, employee]) {
    assert.equal(high.get(id)!.target, baseline.get(id)!.target - 20);
    assert.equal(low.get(id)!.target, baseline.get(id)!.target + (id === owner ? 20 : 10));
    assert.equal(score(higher, id), score(neutral, id) - 1);
    assert.equal(score(lower, id), score(neutral, id) + 2);
  }
  assert.equal(high.get(owner)!.wageTaxPoints, 0, 'an unpaid owner post is not a wage job');
  assert.equal(high.get(employee)!.profitTaxPoints, 0);
  const arrival = neutral.households.find(h => !neutral.employment.some(job => job.householdId === h.id) && h.id !== owner)!;
  assert.equal(high.get(arrival.id)!.target, baseline.get(arrival.id)!.target);
});

test('park and campus jobs qualify for wage tax effects, study alone is exempt, and targets are bounded', () => {
  const city = createCity(42);
  scheduleCityTaxes(city, { wage: 11, profit: 21 });
  advance(city, 91);
  const owner = city.firms.find(firm => firm.owner)!.owner!.householdId;
  const [parkWorker, teacher, student] = city.households.filter(h => h.id !== owner);
  assert.ok(buildPark(city, 0).ok);
  const park = city.parks[0];
  const schoolSite = city.cells.findIndex((cell, index) => !cell.road && cell.zone === null
    && [index - 1, index + 1, index - SIZE, index + SIZE].some(adjacent => city.cells[adjacent]?.road));
  assert.ok(buildCampus(city, schoolSite, 'school').ok);
  const campus = city.education!.campuses[0];
  // Isolate the household roles used by the happiness projection.
  city.employment = [];
  park.staffing = { workDays: {}, allocations: [{ householdId: parkWorker.id, parkId: park.id, skill: 'general', workers: 1 }] };
  city.education!.people = [
    { ...peopleOf(city.education!, teacher.id), campusId: campus.id, teacher: 1 },
    { ...peopleOf(city.education!, student.id), campusId: campus.id, school: 1 },
    { ...peopleOf(city.education!, owner), campusId: campus.id, teacher: 1 },
  ];
  const targets = happinessTargets(city);
  assert.equal(targets.get(parkWorker.id)!.wageTaxPoints, -1);
  assert.equal(targets.get(teacher.id)!.wageTaxPoints, -1);
  assert.equal(targets.get(student.id)!.wageTaxPoints, 0);
  assert.equal(targets.get(owner)!.wageTaxPoints, -1);
  assert.equal(targets.get(owner)!.profitTaxPoints, -1);
  assert.equal(happinessTarget({ parkNearby: true, schoolNearby: true, points: 20 }, undefined, 30), 100);
  const inaccessible = { householdId: owner, workers: 1, reachableWorkers: 0, unreachableWorkers: 1, averageSeconds: null, freeFlowSeconds: null };
  assert.equal(happinessTarget({ parkNearby: false, schoolNearby: false, points: 0 }, inaccessible, -40), 0);
});
test('a single household can move to an empty home near a park without later oscillation',()=>{
 const c=createCity(17,{starter:false}); for(let x=0;x<=10;x++)c.cells[12*SIZE+x].road=true;
 const source=11*SIZE+1, dest=11*SIZE+9;
 c.cells[source]={road:false,zone:'R',building:10};c.cells[dest]={road:false,zone:'R',building:11};
 c.buildings=[{id:10,cell:source,zone:'R',level:1,housingType:'cottage',age:7},{id:11,cell:dest,zone:'R',level:1,housingType:'cottage',age:7}];
 c.households=[{id:30,home:10,members:1,workforce:1,dependents:0,workerSkills:{general:1,manufacturing:0,retail:0},skillSource:'arrival-profile',profile:'single-worker',origin:'arrival',wallet:'household:30',lastPurchaseTick:0,needs:0}];
 c.parks=[{id:40,cell:10*SIZE+9,tick:0,level:1}];c.tick=7;
 assert.equal(happinessTargets(c).get(30)!.parkNearby,false);assert.equal(rebalanceHousing(c),1);assert.equal(c.households[0].home,11);
 for(let n=0;n<52;n++){c.tick+=7;assert.equal(rebalanceHousing(c),0);assert.equal(c.households[0].home,11);}
});

test('a nearby park cannot lure an employee into a home with an unreachable commute',()=>{
 const c=createCity(17,{starter:false});for(let x=0;x<=10;x++)c.cells[12*SIZE+x].road=true;
 const source=11*SIZE+1,dest=11*SIZE+9,work=13*SIZE+1;
 c.cells[source]={road:false,zone:'R',building:10};c.cells[dest]={road:false,zone:'R',building:11};c.cells[work]={road:false,zone:'C',building:12};
 c.buildings=[{id:10,cell:source,zone:'R',level:1,housingType:'cottage',age:7},{id:11,cell:dest,zone:'R',level:1,housingType:'cottage',age:7},{id:12,cell:work,zone:'C',level:1,age:7}];
 c.households=[{id:30,home:10,members:1,workforce:1,dependents:0,workerSkills:{general:1,manufacturing:0,retail:0},skillSource:'arrival-profile',profile:'single-worker',origin:'arrival',wallet:'household:30',lastPurchaseTick:0,needs:0}];
 c.firms=[{id:50,building:12,zone:'C',crops:{rice:0,vegetables:0,sugarcane:0},products:{'milled-rice':0,'canned-food':0,sugar:0},wallet:'firm:50',workDays:{},inventory:0,cropInventory:0,cropCost:0,productionTick:0,owner:null,profit:0,lastMonthProfit:0,monthlyRevenue:0,monthlyExpense:0}];
 c.employment=[{householdId:30,firmId:50,occupation:'retail',rank:'entry',skill:'general',workers:1}];
 c.parks=[{id:40,cell:10*SIZE+9,tick:0,level:1}];c.tick=7;oneWay(c);
 assert.equal(happinessTargets(c).get(30)!.unreachableWorkers,0);
 const hypothetical=structuredClone(c);hypothetical.households[0].home=11;
 assert.equal(happinessTargets(hypothetical).get(30)!.unreachableWorkers,1);
 assert.ok(happinessTargets(hypothetical).get(30)!.target<happinessTargets(c).get(30)!.target);
 assert.equal(rebalanceHousing(c),0);assert.equal(c.households[0].home,10);
});

test('save validation rejects a distress streak longer than elapsed city time',()=>{
 const city=createCity(61025);advance(city,12);assert.ok(city.households.length>0);assert.ok(city.tick<30);
 const raw=JSON.parse(serialize(city));raw.happiness.rows[0].score=0;raw.happiness.rows[0].distressDays=city.tick+1;
 assert.throws(()=>deserialize(JSON.stringify(raw)),/Invalid happiness row/);
});

test('a working household with sustained low happiness gets a conditional month-end forecast', () => {
  const city = createCity(61025);
  for (let day = 0; day < 179; day++) { step(city); keepSupplied(city); }
  const household = city.households.find(h => h.origin === 'arrival'
    && householdWorkerCount(city, h.id) > 0 && !city.firms.some(f => f.owner?.householdId === h.id));
  assert.ok(household);
  const row = city.happiness!.rows.find(h => h.householdId === household.id)!;
  row.score = 0;
  row.distressDays = HAPPINESS_DEPARTURE_DAYS - 2;
  assert.equal(departureDay(city, household.id), 210, 'missing the first settlement moves eligibility to the next one');

  row.distressDays++;
  const restored = deserialize(serialize(city));
  assert.equal(departureDay(restored, household.id), 180);
  assert.deepEqual(departureForecast(restored, household.id), { day: 180, reason: 'happiness' });
  step(restored);
  assert.equal(restored.households.some(h => h.id === household.id), false);
});
