import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, deserialize, expandValidatedCity, serialize, step, SIZE, type City } from '../src/sim.ts';
import { estimateHouseholdCommutes, prepareCommuteEstimates } from '../src/resident-commute.ts';

/** Small deterministic topology. Job counts are explicitly provided allocations. */
function sample(): City {
  const c = createCity(17,{starter:false});
  for (let x=0;x<=10;x++) c.cells[12*SIZE+x].road=true;
  const home=11*SIZE+1, work=11*SIZE+9;
  c.cells[home]={road:false,zone:'R',building:10}; c.cells[work]={road:false,zone:'C',building:20};
  c.buildings=[{id:10,cell:home,zone:'R',level:1,age:3},{id:20,cell:work,zone:'C',level:1,age:3}];
  const person={id:30,home:10,members:1,workforce:1,dependents:0,workerSkills:{general:1,manufacturing:0,retail:0},skillSource:'arrival-profile' as const,profile:'single-worker' as const,origin:'arrival' as const,wallet:'household:30',lastPurchaseTick:0,needs:0};
  c.households=[person];
  c.firms=[{id:40,building:20,zone:'C',crops:{rice:0,vegetables:0,sugarcane:0},products:{'milled-rice':0,'canned-food':0,sugar:0},wallet:'firm:40',workDays:{},inventory:0,cropInventory:0,cropCost:0,productionTick:0,owner:null,profit:0,lastMonthProfit:0,monthlyRevenue:0,monthlyExpense:0}];
  c.employment=[{householdId:30,firmId:40,occupation:'retail',rank:'entry',skill:'general',workers:1}];
  return c;
}
test('commute estimate follows assigned work and directed road reachability without mutation',()=>{
  const c=sample(), before=structuredClone(c), first=estimateHouseholdCommutes(c);
  assert.equal(first.length,1); assert.equal(first[0].workers,1); assert.equal(first[0].reachableWorkers,1);
  assert.ok(first[0].averageSeconds! >= first[0].freeFlowSeconds!); assert.ok(first[0].freeFlowSeconds! > 0);
  assert.deepEqual(c,before); assert.deepEqual(estimateHouseholdCommutes(c),first);
  c.cells[12*SIZE+5].road=false;
  const blocked=estimateHouseholdCommutes(c)[0]; assert.equal(blocked.unreachableWorkers,1); assert.equal(blocked.averageSeconds,null);
});
test('expanded map is supported without the old parcel-zone protocol',()=>{
  const c=expandValidatedCity(deserialize(serialize(createCity(88))));
  assert.equal(c.cells.length,672); assert.deepEqual(estimateHouseholdCommutes(c),[]);
});
test('real daily simulation and save reload produce the same estimates over multiple days',()=>{
  const a=createCity(31337), b=deserialize(serialize(a));
  let observed=false;
  for(let day=0;day<90;day++){
    step(a); step(b);
    const x=estimateHouseholdCommutes(a), y=estimateHouseholdCommutes(b);
    assert.deepEqual(x,y); observed ||= x.length>0;
    if(day===44) { const saved=deserialize(serialize(b)); Object.assign(b,saved); }
  }
  assert.ok(observed,'the real simulation produced assigned commuters');
});

test('a valid 2000-person city can experience estimated peak congestion', async()=>{
  const { population2000Fixture }=await import('./population-capacity-fixture.ts');
  const { happinessTargets }=await import('../src/resident-happiness.ts');
  const c=population2000Fixture();
  // Put the same 64 permitted firms beyond a shared road spine. No workers,
  // accounts, road links or jobs are fabricated, and both saves validate.
  const firms=c.firms.map(f=>c.buildings.find(b=>b.id===f.building)!);
  for(const b of firms)c.cells[b.cell]={road:false,zone:null,building:null};
  const cells=[16,19,22].flatMap(row=>Array.from({length:23},(_,x)=>row*SIZE+x+1));
  firms.forEach((b,i)=>{b.cell=cells[i];c.cells[b.cell]={road:false,zone:'I',building:b.id};});
  assert.doesNotThrow(()=>deserialize(serialize(c)));step(c);assert.doesNotThrow(()=>deserialize(serialize(c)));
  const rows=estimateHouseholdCommutes(c), crowded=rows.find(r=>r.averageSeconds!==null && r.freeFlowSeconds!==null && r.averageSeconds-r.freeFlowSeconds>=10 && r.averageSeconds>=r.freeFlowSeconds*1.02)!;
  assert.ok(crowded,'valid assigned workers congest the modeled shared spine');
  const baseline=happinessTargets(c).get(crowded.householdId)!;
  const quiet=structuredClone(c);quiet.employment=quiet.employment.filter(row=>row.householdId===crowded.householdId);
  assert.doesNotThrow(()=>deserialize(serialize(quiet)));
  const after=happinessTargets(quiet).get(crowded.householdId)!;
  assert.ok(baseline.target<after.target);assert.equal(crowded.unreachableWorkers,0);
});

test('hypothetical move matches a full recomputation without mutating the live city',()=>{
  const c=sample(), cell=11*SIZE+5;
  c.cells[cell]={road:false,zone:'R',building:11};c.buildings.push({id:11,cell,zone:'R',level:1,age:3});
  const second={...structuredClone(c.households[0]),id:31,wallet:'household:31'};c.households.push(second);
  c.employment.push({...c.employment[0],householdId:31});
  const before=structuredClone(c), candidate=prepareCommuteEstimates(c).atHome(30,cell);
  const copy=structuredClone(c);copy.households.find(h=>h.id===30)!.home=11;
  assert.deepEqual(candidate,estimateHouseholdCommutes(copy).find(row=>row.householdId===30));
  assert.deepEqual(c,before);
});

test('updating the commute snapshot after accepted moves matches fresh calculations',()=>{
  const c=sample(), cells=[11*SIZE+5,11*SIZE+6];
  for(const [index,cell] of cells.entries()){const id=11+index;c.cells[cell]={road:false,zone:'R',building:id};c.buildings.push({id,cell,zone:'R',level:1,age:3});}
  c.households.push({...structuredClone(c.households[0]),id:31,wallet:'household:31'});
  c.employment.push({...c.employment[0],householdId:31});
  const snapshot=prepareCommuteEstimates(c), copy=structuredClone(c);
  for(const [id,home,cell] of [[30,11,cells[0]],[31,12,cells[1]]] as const){
    assert.deepEqual(snapshot.atHome(id,cell),prepareCommuteEstimates(copy).atHome(id,cell));
    copy.households.find(h=>h.id===id)!.home=home;snapshot.moved(id,cell);
    assert.deepEqual(snapshot.all,estimateHouseholdCommutes(copy));
  }
});
