import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createCity,step,serialize,deserialize,employmentForHousehold,householdWorkerCount,firmWorkerCount,firmCapacity,summary,bulldoze,buildRoad,GATEWAY,WAGES,MONTH,type City} from '../src/sim.ts';
import {deserializeV2} from '../src/legacy-v2.ts';
const raw65=readFileSync(new URL('./fixtures/legacy-v2-day65.json',import.meta.url),'utf8');
const raw180=readFileSync(new URL('./fixtures/legacy-v2-day180.json',import.meta.url),'utf8');
const rawV3=(day:number)=>readFileSync(new URL(`./fixtures/legacy-v3-day${day}.json`,import.meta.url),'utf8');
const advance=(c:City,n:number)=>{for(let i=0;i<n;i++){step(c);deserialize(serialize(c));}return c;};
const byFirm=(c:City,h:number)=>new Map(employmentForHousehold(c,h).map(e=>[e.firmId,e]));

test('actual published v2 import preserves every economic and temporal field, jobs and earned claims',()=>{
 assert.equal(createHash('sha256').update(raw65).digest('hex'),'7062ffb3c6628b1a62ae7d9c548e497ab87e70d3b57bb715d34e0a9194eba3a5');
 assert.equal(createHash('sha256').update(raw180).digest('hex'),'0c33c983c1e71063496f4a95b935c22647b972c0084d2ce98449b7e7b8c13475');
 for(const raw of [raw65,raw180]){
  const old=deserializeV2(raw),c=deserialize(raw);
  assert.equal(c.version,9);assert.equal(c.rulesVersion,'chain-4');
  for(const key of ['seed','rng','tick','nextId','migration','accounts','ledger','goodsLedger','goods','cells','lastEvent'] as const)assert.deepEqual(c[key],old[key]);
  assert.deepEqual(c.buildings,old.buildings.map(b=>({...b,level:b.zone==='C'?b.level+1:b.level})));
  for(const b of c.buildings.filter(b=>b.zone==='C')) assert.equal(firmCapacity(b),old.buildings.find(previous=>previous.id===b.id)!.level,'Commercial level renumbering preserves the actual old worker capacity');
  assert.deepEqual(c.firms.map(({cropInventory,cropCost,productionTick,owner,commercialKind,crops:_crops,products:_products,recipe:_recipe,...preserved})=>{assert.equal(commercialKind,preserved.zone==='C'?'retail':undefined);assert.equal(cropInventory,0);assert.equal(cropCost,0);assert.equal(productionTick,old.tick);assert.equal(owner,null);return preserved;}),old.firms);
  assert.equal(c.agricultureStartTick,old.tick);assert.deepEqual(c.cropLedger,[]);assert.deepEqual(c.crops,{harvested:0,processed:0,consumed:0,writtenOff:0});assert.deepEqual(c.ownerLabor,[]);
  for(const h of c.households){const previous=old.households.find(p=>p.id===h.id)!;const {workerSkills,skillSource,...preserved}=h;assert.deepEqual(preserved,previous);assert.deepEqual(workerSkills,{general:h.workforce,manufacturing:0,retail:0});assert.equal(skillSource,'legacy-assumed');}
  assert.deepEqual(c.employment.map(({skill,...e})=>{assert.equal(skill,'general');return e;}),old.employment);
  assert.equal(serialize(deserialize(raw)),serialize(c));assert.equal(serialize(deserialize(serialize(c))),serialize(c));
 }
});

test('published v3 retail opening still splits workers after migration while new input shortage stops free factory output',()=>{
 const previous=JSON.parse(rawV3(96)),oldNext=JSON.parse(rawV3(97));
 for(const c of [deserialize(rawV3(96)),deserialize(rawV3(96))]){
  const family=c.households.find(h=>h.id===4)!;assert.equal(family.members,3);assert.equal(family.workforce,2);assert.equal(family.dependents,1);
  const before=employmentForHousehold(c,family.id);assert.equal(new Set(before.map(e=>e.firmId)).size,1);assert.equal(before.reduce((n,e)=>n+e.workers,0),2);
  const claims=c.firms.map(f=>({id:f.id,days:f.workDays[family.wallet]??0}));const grants=c.ledger.filter(e=>e.reason==='New household arrival savings'&&e.to===family.wallet).length;
  step(c);assert.equal(c.tick,97);assert.equal(householdWorkerCount(c,family.id),2);
  const jobs=employmentForHousehold(c,family.id);assert.equal(new Set(jobs.map(e=>e.firmId)).size,2);assert.deepEqual(jobs.map(e=>e.occupation).sort(),['manufacturing','retail']);
  assert.ok(jobs.every(e=>e.workers===1));assert.equal(family.members,3);assert.equal(c.ledger.filter(e=>e.reason==='New household arrival savings'&&e.to===family.wallet).length,grants);
  for(const f of c.firms)assert.equal(f.workDays[family.wallet]??0,(claims.find(old=>old.id===f.id)?.days??0)+(byFirm(c,family.id).get(f.id)?.workers??0));
  assert.deepEqual(c.employment,oldNext.employment);assert.deepEqual(c.firms.map(f=>f.workDays),oldNext.firms.map((f:any)=>f.workDays));
  assert.equal(c.goods.produced,previous.goods.produced);assert.equal(c.goods.exported,previous.goods.exported);assert.deepEqual(c.cropLedger,[]);
  const shop=c.firms.find(f=>f.zone==='C')!,factory=c.firms.find(f=>f.zone==='I')!;
  assert.equal(factory.cropInventory,0);assert.equal(factory.inventory,0);assert.equal(c.accounts[factory.wallet],previous.accounts[factory.wallet]);
  const imports=c.ledger.filter(e=>e.tick===97&&e.reason==='Outside goods import');assert.deepEqual(imports,[{tick:97,from:shop.wallet,to:'outside',amount:3600,reason:'Outside goods import'}]);
  const purchases=c.ledger.filter(e=>e.tick===97&&e.from.startsWith('household:')&&e.reason.includes('purchase'));
  assert.deepEqual(purchases.map(e=>[e.from,e.to,e.amount]),previous.households.map((h:any)=>[h.wallet,shop.wallet,800]));
  assert.equal(c.accounts[shop.wallet],previous.accounts[shop.wallet]-3600+3200);assert.equal(shop.inventory,4);
  assert.equal(c.goods.imported,previous.goods.imported+8);assert.equal(c.goods.consumed,previous.goods.consumed+4);
  assert.deepEqual(c.goodsLedger.filter(e=>e.tick===97).map(e=>[e.from,e.to,e.quantity,e.reason]),[['outside',shop.wallet,8,'Imported shop stock'],...previous.households.map((h:any)=>[shop.wallet,h.wallet,1,'Household final consumption'])]);
  assert.doesNotThrow(()=>deserialize(serialize(c)));
 }
});

test('new family capability counts are disjoint and allow its general worker and specialist different roles',()=>{
 const c=deserialize(rawV3(97)),h=c.households.find(h=>h.id===4)!;step(c);
 assert.equal(h.skillSource,'arrival-profile');assert.deepEqual(h.workerSkills,{general:1,manufacturing:1,retail:0});
 assert.deepEqual(employmentForHousehold(c,h.id).map(e=>[e.occupation,e.skill,e.workers]).sort(),[['manufacturing','manufacturing',1],['retail','general',1]].sort());
 for(const h of c.households){assert.equal(Object.values(h.workerSkills).reduce((a,b)=>a+b,0),h.workforce);for(const skill of ['general','manufacturing','retail'] as const)assert.ok(employmentForHousehold(c,h.id).filter(e=>e.skill===skill).reduce((n,e)=>n+e.workers,0)<=h.workerSkills[skill]);}
 assert.equal(summary(c).population,summary(c).workforce+summary(c).dependents);
});

test('two employers pay exact earned worker-days into the same shared household wallet',()=>{
 const c=deserialize(rawV3(119)),h=c.households.find(h=>h.id===4)!;
 const expected=new Map(c.firms.map(f=>[f.wallet,((f.workDays[h.wallet]??0)+employmentForHousehold(c,h.id).filter(e=>e.firmId===f.id).reduce((n,e)=>n+e.workers,0))*WAGES[f.zone]/MONTH]));
 const cash=c.accounts[h.wallet];step(c);
 const payments=c.ledger.filter(e=>e.tick===120&&e.reason==='Monthly wages'&&e.to===h.wallet);
 assert.equal(payments.length,2);for(const e of payments)assert.equal(e.amount,expected.get(e.from));
 const inflows=c.ledger.filter(e=>e.tick===120&&e.to===h.wallet).reduce((n,e)=>n+e.amount,0),outflows=c.ledger.filter(e=>e.tick===120&&e.from===h.wallet).reduce((n,e)=>n+e.amount,0);
 assert.equal(c.accounts[h.wallet],cash+inflows-outflows);assert.ok(c.firms.every(f=>!Object.hasOwn(f.workDays,h.wallet)));assert.doesNotThrow(()=>deserialize(serialize(c)));
});

test('losing one reachable employer leaves incompatible specialists unemployed and retains earned wages until reconnection',()=>{
 const c=deserialize(rawV3(97)),h=c.households.find(h=>h.id===4)!,factory=c.firms.find(f=>f.zone==='I')!,shop=c.firms.find(f=>f.zone==='C')!;
 const claims=factory.workDays[h.wallet],members=h.members,skills={...h.workerSkills};
 // Cut beyond this family's home frontage and the shop, before its factory.
 assert.equal(bulldoze(c,GATEWAY+9).ok,true);step(c);
 assert.equal(firmWorkerCount(c,factory.id),0);assert.equal(factory.workDays[h.wallet],claims);assert.equal(householdWorkerCount(c,h.id),1);
 assert.deepEqual(employmentForHousehold(c,h.id).map(e=>[e.firmId,e.skill]),[[shop.id,'general']]);assert.equal(h.members,members);assert.deepEqual(h.workerSkills,skills);
 assert.equal(buildRoad(c,GATEWAY+9,GATEWAY+9).ok,true);step(c);assert.equal(householdWorkerCount(c,h.id),2);assert.equal(factory.workDays[h.wallet],claims+1);assert.doesNotThrow(()=>deserialize(serialize(c)));
});

test('closing an establishment settles its old claims without erasing a family or the other employer',()=>{
 const c=deserialize(rawV3(97));step(c);const h=c.households.find(h=>h.id===4)!,factory=c.firms.find(f=>f.zone==='I')!,shop=c.firms.find(f=>f.zone==='C')!;
 const due=factory.workDays[h.wallet]*WAGES.I/MONTH,otherClaims=shop.workDays[h.wallet],count=c.households.length,composition=JSON.stringify(h);
 assert.equal(bulldoze(c,c.buildings.find(b=>b.id===factory.building)!.cell).ok,true);
 assert.equal(c.households.length,count);assert.equal(JSON.stringify(h),composition);assert.equal(householdWorkerCount(c,h.id),1);assert.equal(shop.workDays[h.wallet],otherClaims);
 assert.equal(c.ledger.filter(e=>e.tick===98&&e.from===factory.wallet&&e.to===h.wallet&&e.reason==='Monthly wages').at(-1)?.amount,due);assert.doesNotThrow(()=>deserialize(serialize(c)));
});

test('v6 rejects duplicated capability counts, incompatible assignments and unverified legacy skill claims',()=>{
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
