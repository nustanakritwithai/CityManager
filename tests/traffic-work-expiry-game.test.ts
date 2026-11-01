import test from 'node:test';
import assert from 'node:assert/strict';
import {createCity,serialize,type City} from '../src/sim.ts';
import {TrafficGame,captureTrafficGameInput,trafficGameSampleFromInput,gameCarIsTaxi,type WorkTripInput,type TrafficGameSample} from '../src/traffic/game.ts';

const sample=(taxiRate=0):TrafficGameSample=>({
  map:{cells:Array.from({length:576},(_,i)=>({road:[25,26,27,28,49,50,51,52].includes(i)}))},
  demand:[{from:25,to:28,rate:2,...(taxiRate?{taxiRate}:{} )},{from:49,to:52,rate:1}],
});
const clock=(day:number,minute:number,ack=0,candidates:WorkTripInput['candidates']=[{citizenId:'h:1:m:0',home:25,work:28}]):WorkTripInput=>({day,minute,ack,candidates});
const mass=(g:TrafficGame)=>{const f=g.frame;assert.ok(Math.abs(f.offered-f.completed-f.dropped-f.cancelled-f.waiting-f.moving)<1e-7);};
const issued=(g:TrafficGame)=>[...(g as any).workIssued.keys()] as number[];

test('capture pairs only employed people to their actual home and firm, without changing city',()=>{
  const city=createCity(1,{starter:false});
  for(const n of [25,26,27,28])city.cells[n].road=true;
  city.buildings=[{id:1,cell:49,zone:'R',level:1,age:0},{id:2,cell:52,zone:'C',level:1,age:0}];
  city.households=[{id:1,home:1,members:2,workforce:1,dependents:1,workerSkills:{general:1,manufacturing:0,retail:0},skillSource:'arrival-profile',profile:'family',origin:'arrival',wallet:'h:1',lastPurchaseTick:-1,needs:0}];
  city.firms=[{id:3,building:2} as City['firms'][number]];
  city.employment=[{householdId:1,firmId:3,skill:'general',workers:1,occupation:'manufacturing',rank:'entry'}];
  const before=serialize(city),capture=captureTrafficGameInput(city,{workClock:{day:4,minute:600,ack:0}});
  assert.deepEqual(capture.work?.candidates,[{citizenId:'h:1:m:0',home:49,work:52}]);
  assert.equal(serialize(city),before);
  city.employment=[];assert.deepEqual(captureTrafficGameInput(city,{workClock:{day:4,minute:600,ack:0}}).work?.candidates,[]);
});

test('17:00 alone does not expire work cars; authorized overdue cancellation preserves other traffic',()=>{
  const g=new TrafficGame(sample());g.setWork(clock(2,1019));
  for(let i=0;i<4;i++)g.step();
  const ids=issued(g);assert.equal(ids.length,1);
  const before=g.frame;assert.ok(before.cars.some(c=>!ids.includes(c.id)));
  g.setWork(clock(2,1019));assert.deepEqual(g.frame.expiredWorkTrips,undefined);
  g.setWork(clock(2,1020));assert.equal(g.frame.expiredWorkTrips,undefined);
  assert.deepEqual(g.frame.cars,before.cars);assert.deepEqual(g.frame.workTrips,[{id:ids[0],day:2}]);
  g.setWork({...clock(2,1020),cancelIds:ids});const after=g.frame;
  assert.deepEqual(after.expiredWorkTrips,[{sequence:1,id:ids[0]}]);assert.ok(after.cars.every(c=>c.id!==ids[0]));
  assert.ok(after.cars.some(c=>before.cars.some(old=>old.id===c.id&&!ids.includes(c.id))));
  assert.equal(after.cancelled-before.cancelled,before.cars.some(c=>c.id===ids[0])?1:0);
  mass(g);assert.deepEqual(g.clone().frame.expiredWorkTrips,after.expiredWorkTrips);
  g.setWork(clock(2,1020,1));assert.equal(g.frame.expiredWorkTrips,undefined);
  for(let i=0;i<6;i++)g.step();assert.deepEqual(issued(g),[]);
});

test('outstanding trip blocks duplicate on a later day until confirmed terminal retirement',()=>{
  const g=new TrafficGame(sample());g.setWork(clock(1,600));for(let i=0;i<8;i++)g.step();
  const [old]=issued(g);assert.ok(old);assert.ok(!g.frame.cars.some(c=>c.id===old));
  g.setWork(clock(1,1020));g.setWork(clock(1,600));for(let i=0;i<8;i++)g.step();
  assert.deepEqual(issued(g),[old]); // backward clock cannot restore eligibility
  g.setWork(clock(2,600));for(let i=0;i<8;i++)g.step();
  assert.deepEqual(issued(g),[old]); // still visible/pending in presentation until host confirms retirement
  g.setWork({...clock(2,600),retiredIds:[old]});assert.deepEqual(issued(g),[]);
  for(let i=0;i<8;i++)g.step();
  assert.equal(issued(g).length,1);mass(g);
});

test('a morning work car keeps moving at 17:00 unless cancellation is explicitly requested',()=>{
  const g=new TrafficGame(sample());g.setWork(clock(1,7*60));g.step();
  const ids=issued(g);assert.equal(ids.length,1);
  g.setWork(clock(1,17*60));assert.equal(g.frame.expiredWorkTrips,undefined);assert.deepEqual(issued(g),ids);
  g.setWork({...clock(1,17*60),cancelIds:ids});assert.ok(g.frame.expiredWorkTrips?.some(e=>e.id===ids[0]));mass(g);
});

test('a skipped work window claims one bounded cohort without advancing while paused',()=>{
  const g=new TrafficGame(sample());const work=clock(2,0,0);
  work.crossedWorkDay=1;g.setWork(work);const paused=g.step(true);
  assert.equal(paused.step,0);assert.equal(paused.workTrips,undefined);
  const first=g.step();assert.equal(first.workTrips?.length,1);assert.equal(first.workTrips?.[0].day,1);
  for(let i=0;i<5;i++){g.setWork(work);g.step();}
  assert.equal(g.frame.workTrips?.length,1,'replayed observation cannot issue the same day twice');mass(g);
});

test('a real job outside the two representative OD endpoints is not falsely labeled',()=>{
  const c=createCity(1,{starter:false});for(const i of [25,26,27,28,29,30])c.cells[i].road=true;
  c.buildings=[{id:1,cell:49,zone:'R',level:1,age:0},{id:2,cell:50,zone:'C',level:2,age:0},{id:3,cell:51,zone:'C',level:2,age:0},{id:4,cell:54,zone:'C',level:2,age:0}];
  c.firms=[{id:3,building:4} as City['firms'][number]];
  c.households=[{id:4,home:1,members:16,workforce:1,dependents:15,workerSkills:{general:1,manufacturing:0,retail:0},skillSource:'arrival-profile',profile:'family',origin:'arrival',wallet:'h:4',lastPurchaseTick:-1,needs:0}];
  c.employment=[{householdId:4,firmId:3,skill:'general',workers:1,occupation:'manufacturing',rank:'entry'}];
  const input=captureTrafficGameInput(c,{workClock:{day:1,minute:600,ack:0}});
  assert.deepEqual(input.work?.candidates,[{citizenId:'h:4:m:0',home:49,work:54}]);
  const sample=trafficGameSampleFromInput(input),game=new TrafficGame(sample);game.setWork(input.work);
  for(let i=0;i<30;i++)game.step();assert.ok(game.frame.offered>0);assert.equal(game.frame.workTrips,undefined);
});

test('completed model car is still reported at deadline for a delayed presenter',()=>{
  const g=new TrafficGame(sample());g.setWork(clock(0,600));g.step();const id=issued(g)[0];assert.ok(id);
  for(let i=0;i<60;i++)g.step();const before=g.frame;assert.ok(!before.cars.some(c=>c.id===id));
  g.setWork(clock(1,100));assert.equal(g.frame.expiredWorkTrips,undefined);
  g.setWork({...clock(1,100),cancelIds:[id]});const after=g.frame;
  assert.ok(after.expiredWorkTrips?.some(e=>e.id===id));assert.equal(after.completed,before.completed);
  assert.equal(after.cancelled,before.cancelled);mass(g);
});

test('only matching private vehicles claim work; taxi and unrelated destinations never expire',()=>{
  const g=new TrafficGame(sample(2));g.setWork(clock(0,600));for(let i=0;i<8;i++)g.step();
  const before=g.frame;assert.ok(before.cars.some(gameCarIsTaxi));assert.deepEqual(issued(g),[]);
  g.setWork(clock(0,1020));const after=g.frame;
  assert.equal(after.expiredWorkTrips,undefined);
  assert.deepEqual(after.cars.map(c=>c.id),before.cars.map(c=>c.id));mass(g);
  const other=new TrafficGame(sample());other.setWork(clock(0,600,0,[{citizenId:'x',home:25,work:52}]));
  for(let i=0;i<4;i++)other.step();assert.deepEqual(issued(other),[]);
});

test('ack is validated and an expired token survives detached candidates until acknowledged',()=>{
  const g=new TrafficGame(sample());g.setWork(clock(0,1019));g.step();const id=issued(g)[0];assert.ok(id);
  const candidate=g.clone();candidate.setWork({...clock(0,1020),cancelIds:[id]});assert.equal(candidate.frame.expiredWorkTrips?.[0].id,id);
  assert.equal(g.frame.expiredWorkTrips,undefined);
  const committed=candidate.clone();assert.equal(committed.frame.expiredWorkTrips?.[0].id,id);
  committed.setWork({...clock(0,1020),cancelIds:[id]});assert.deepEqual(committed.frame.expiredWorkTrips,[{sequence:1,id}]);
  assert.throws(()=>committed.setWork(clock(0,1020,2)),/Invalid traffic work/);
  committed.setWork({...clock(0,1020,1),cancelIds:[id]});assert.equal(committed.frame.expiredWorkTrips,undefined);
});

test('early, stale and unknown cancellations cannot remove work or generic cars',()=>{
  const g=new TrafficGame(sample());g.setWork(clock(0,1019));g.step();const id=issued(g)[0];
  const before=g.frame;
  g.setWork({...clock(0,1019),cancelIds:[id,999999]});assert.equal(g.frame.expiredWorkTrips,undefined);
  assert.deepEqual(g.frame.cars,before.cars);
  g.setWork(clock(0,1020));g.setWork({...clock(0,1019),cancelIds:[id]});
  assert.deepEqual(g.frame.cars,before.cars);assert.equal(g.frame.expiredWorkTrips,undefined);
  assert.throws(()=>g.setWork({...clock(0,1020),cancelIds:[id,id]}),/Invalid traffic work trip identities/);
  assert.throws(()=>g.setWork({...clock(0,1020),cancelIds:[id],retiredIds:[id]}),/Invalid traffic work trip identities/);
  assert.throws(()=>g.setWork({...clock(0,1020),retiredIds:[0]}),/Invalid traffic work trip identities/);
  mass(g);
});

test('retirement confirmation never removes a car still active in worker state',()=>{
  const g=new TrafficGame(sample());g.setWork(clock(0,600));g.step();const id=issued(g)[0];
  assert.ok(g.frame.cars.some(c=>c.id===id));g.setWork({...clock(0,600),retiredIds:[id]});
  assert.deepEqual(g.frame.workTrips,[{id,day:0}]);assert.ok(g.frame.cars.some(c=>c.id===id));
  for(let i=0;i<20;i++)g.step();assert.ok(!g.frame.cars.some(c=>c.id===id));
  g.setWork({...clock(0,600),retiredIds:[id]});assert.equal(g.frame.workTrips,undefined);
  assert.equal(g.frame.expiredWorkTrips,undefined);mass(g);
});

test('expiration within a junction releases its request and lets its follower proceed',()=>{
  const roads=[25,26,27,28,2,50];
  const g=new TrafficGame({map:{cells:Array.from({length:576},(_,i)=>({road:roads.includes(i)}))},demand:[{from:25,to:28,rate:4}]});
  g.setWork(clock(0,1019));const initial=g.step(),work=issued(g)[0];
  const car=initial.cars.find(c=>c.id===work)!;assert.equal(car.to,26);assert.ok(car.progress!>.7);
  assert.ok((g as any).junctionRequests.has(work));
  const follower=initial.cars.find(c=>c.id!==work)!;assert.ok(follower);
  g.setWork({...clock(0,1020),cancelIds:[work]});assert.ok(!(g as any).junctionRequests.has(work));
  const released=g.frame;assert.ok(released.expiredWorkTrips?.some(e=>e.id===work));
  for(let i=0;i<2;i++)g.step();
  const next=g.frame.cars.find(c=>c.id===follower.id);
  assert.ok(!next||next.from!==follower.from||next.progress!>follower.progress!);mass(g);
});
