import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createCity,step,serialize,deserialize,employmentForHousehold,householdWorkerCount,firmWorkerCount,summary,bulldoze,buildRoad,GATEWAY,WAGES,MONTH,type City} from '../src/sim.ts';
import {deserializeV2} from '../src/legacy-v2.ts';
const raw65=readFileSync(new URL('./fixtures/legacy-v2-day65.json',import.meta.url),'utf8');
const raw180=readFileSync(new URL('./fixtures/legacy-v2-day180.json',import.meta.url),'utf8');
const advance=(c:City,n:number)=>{for(let i=0;i<n;i++){step(c);deserialize(serialize(c));}return c;};
const byFirm=(c:City,h:number)=>new Map(employmentForHousehold(c,h).map(e=>[e.firmId,e]));

test('actual published v2 import preserves every economic and temporal field, jobs and earned claims',()=>{
 assert.equal(createHash('sha256').update(raw65).digest('hex'),'7062ffb3c6628b1a62ae7d9c548e497ab87e70d3b57bb715d34e0a9194eba3a5');
 assert.equal(createHash('sha256').update(raw180).digest('hex'),'0c33c983c1e71063496f4a95b935c22647b972c0084d2ce98449b7e7b8c13475');
 for(const raw of [raw65,raw180]){
  const old=deserializeV2(raw),c=deserialize(raw);
  assert.equal(c.version,3);assert.equal(c.rulesVersion,'worker-1');
  for(const key of ['seed','rng','tick','nextId','migration','accounts','ledger','goodsLedger','goods','buildings','cells','firms','lastEvent'] as const)assert.deepEqual(c[key],old[key]);
  for(const h of c.households){const previous=old.households.find(p=>p.id===h.id)!;const {workerSkills,skillSource,...preserved}=h;assert.deepEqual(preserved,previous);assert.deepEqual(workerSkills,{general:h.workforce,manufacturing:0,retail:0});assert.equal(skillSource,'legacy-assumed');}
  assert.deepEqual(c.employment.map(({skill,...e})=>{assert.equal(skill,'general');return e;}),old.employment);
  assert.equal(serialize(deserialize(raw)),serialize(c));assert.equal(serialize(deserialize(serialize(c))),serialize(c));
 }
});

test('real retail opening automatically splits eligible workers in fresh and imported cities without hiring dependents',()=>{
 for(const c of [advance(createCity(61025),96),advance(deserialize(raw65),31)]){
  const family=c.households.find(h=>h.id===4)!;assert.equal(family.members,3);assert.equal(family.workforce,2);assert.equal(family.dependents,1);
  const before=employmentForHousehold(c,family.id);assert.equal(new Set(before.map(e=>e.firmId)).size,1);assert.equal(before.reduce((n,e)=>n+e.workers,0),2);
  const claims=c.firms.map(f=>({id:f.id,days:f.workDays[family.wallet]??0}));const grants=c.ledger.filter(e=>e.reason==='New household arrival savings'&&e.to===family.wallet).length;
  step(c);assert.equal(c.tick,97);assert.equal(householdWorkerCount(c,family.id),2);
  const jobs=employmentForHousehold(c,family.id);assert.equal(new Set(jobs.map(e=>e.firmId)).size,2);assert.deepEqual(jobs.map(e=>e.occupation).sort(),['manufacturing','retail']);
  assert.ok(jobs.every(e=>e.workers===1));assert.equal(family.members,3);assert.equal(c.ledger.filter(e=>e.reason==='New household arrival savings'&&e.to===family.wallet).length,grants);
  for(const f of c.firms)assert.equal(f.workDays[family.wallet]??0,(claims.find(old=>old.id===f.id)?.days??0)+(byFirm(c,family.id).get(f.id)?.workers??0));
  assert.doesNotThrow(()=>deserialize(serialize(c)));
 }
});

test('new family capability counts are disjoint and allow its general worker and specialist different roles',()=>{
 const c=advance(createCity(61025),97),h=c.households.find(h=>h.id===4)!;
 assert.equal(h.skillSource,'arrival-profile');assert.deepEqual(h.workerSkills,{general:1,manufacturing:1,retail:0});
 assert.deepEqual(employmentForHousehold(c,h.id).map(e=>[e.occupation,e.skill,e.workers]).sort(),[['manufacturing','manufacturing',1],['retail','general',1]].sort());
 for(const h of c.households){assert.equal(Object.values(h.workerSkills).reduce((a,b)=>a+b,0),h.workforce);for(const skill of ['general','manufacturing','retail'] as const)assert.ok(employmentForHousehold(c,h.id).filter(e=>e.skill===skill).reduce((n,e)=>n+e.workers,0)<=h.workerSkills[skill]);}
 assert.equal(summary(c).population,summary(c).workforce+summary(c).dependents);
});

test('two employers pay exact earned worker-days into the same shared household wallet',()=>{
 const c=advance(createCity(61025),119),h=c.households.find(h=>h.id===4)!;
 const expected=new Map(c.firms.map(f=>[f.wallet,((f.workDays[h.wallet]??0)+employmentForHousehold(c,h.id).filter(e=>e.firmId===f.id).reduce((n,e)=>n+e.workers,0))*WAGES[f.zone]/MONTH]));
 const cash=c.accounts[h.wallet];step(c);
 const payments=c.ledger.filter(e=>e.tick===120&&e.reason==='Monthly wages'&&e.to===h.wallet);
 assert.equal(payments.length,2);for(const e of payments)assert.equal(e.amount,expected.get(e.from));
 const inflows=c.ledger.filter(e=>e.tick===120&&e.to===h.wallet).reduce((n,e)=>n+e.amount,0),outflows=c.ledger.filter(e=>e.tick===120&&e.from===h.wallet).reduce((n,e)=>n+e.amount,0);
 assert.equal(c.accounts[h.wallet],cash+inflows-outflows);assert.ok(c.firms.every(f=>!Object.hasOwn(f.workDays,h.wallet)));assert.doesNotThrow(()=>deserialize(serialize(c)));
});

test('losing one reachable employer leaves incompatible specialists unemployed and retains earned wages until reconnection',()=>{
 const c=advance(createCity(61025),97),h=c.households.find(h=>h.id===4)!,factory=c.firms.find(f=>f.zone==='I')!,shop=c.firms.find(f=>f.zone==='C')!;
 const claims=factory.workDays[h.wallet],members=h.members,skills={...h.workerSkills};
 // Cut beyond this family's home frontage and the shop, before its factory.
 assert.equal(bulldoze(c,GATEWAY+9).ok,true);step(c);
 assert.equal(firmWorkerCount(c,factory.id),0);assert.equal(factory.workDays[h.wallet],claims);assert.equal(householdWorkerCount(c,h.id),1);
 assert.deepEqual(employmentForHousehold(c,h.id).map(e=>[e.firmId,e.skill]),[[shop.id,'general']]);assert.equal(h.members,members);assert.deepEqual(h.workerSkills,skills);
 assert.equal(buildRoad(c,GATEWAY+9,GATEWAY+9).ok,true);step(c);assert.equal(householdWorkerCount(c,h.id),2);assert.equal(factory.workDays[h.wallet],claims+1);assert.doesNotThrow(()=>deserialize(serialize(c)));
});

test('closing an establishment settles its old claims without erasing a family or the other employer',()=>{
 const c=advance(createCity(61025),98),h=c.households.find(h=>h.id===4)!,factory=c.firms.find(f=>f.zone==='I')!,shop=c.firms.find(f=>f.zone==='C')!;
 const due=factory.workDays[h.wallet]*WAGES.I/MONTH,otherClaims=shop.workDays[h.wallet],count=c.households.length,composition=JSON.stringify(h);
 assert.equal(bulldoze(c,c.buildings.find(b=>b.id===factory.building)!.cell).ok,true);
 assert.equal(c.households.length,count);assert.equal(JSON.stringify(h),composition);assert.equal(householdWorkerCount(c,h.id),1);assert.equal(shop.workDays[h.wallet],otherClaims);
 assert.equal(c.ledger.filter(e=>e.tick===98&&e.from===factory.wallet&&e.to===h.wallet&&e.reason==='Monthly wages').at(-1)?.amount,due);assert.doesNotThrow(()=>deserialize(serialize(c)));
});

test('v3 rejects duplicated capability counts, incompatible assignments and unverified legacy skill claims',()=>{
 const c=advance(createCity(61025),98),raw=serialize(c);
 for(const mutate of [
  (x:any)=>x.households[0].workerSkills.general++,
  (x:any)=>x.households[0].workerSkills.manufacturing=-1,
  (x:any)=>delete x.households[0].workerSkills.retail,
  (x:any)=>x.households[0].skillSource='education-record',
  (x:any)=>x.employment.find((e:any)=>e.occupation==='manufacturing').skill='retail',
  (x:any)=>x.employment.push({...x.employment[0]}),
  (x:any)=>x.employment[0].workers=3,
 ]){const bad=JSON.parse(raw);mutate(bad);assert.throws(()=>deserialize(JSON.stringify(bad)));}
 const old=JSON.parse(raw180);old.accounts.treasury++;assert.throws(()=>deserialize(JSON.stringify(old)));assert.equal(serialize(c),raw);
});
