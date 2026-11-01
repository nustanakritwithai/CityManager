import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createCity,enableEducation,deserialize,serialize,step,isCommercial,commercialGrowthStatus,firmCapacity,firmCredentialCounts,retailDemand,marketToConvert,ownerFinance,type City} from '../src/sim.ts';
import {retailCapacity,staffedRetailCapacity} from '../src/retail-capacity.ts';
import {createParkRuntime,serializeParkSession,deserializeParkSession} from '../src/park-runtime.ts';
import {keepSupplied} from './plants.ts';
import {holdEducationReady} from './education-ready.ts';
const oldRaw=readFileSync(new URL('./fixtures/retail-v15.json',import.meta.url),'utf8');
const fresh=()=>deserialize(oldRaw);
const premise=(c:City,id:number)=>c.buildings.find(b=>b.id===id)!;

test('old commercial migration preserves the approved baseline compaction projection and adds only rule boundaries',()=>{
  const old=JSON.parse(oldRaw),c=fresh();
  assert.equal(c.commercialUnifiedStartTick,old.tick);
  // Snapshot of the approved main64a1763 loader, INCLUDING its bounded history compaction.
  const {commercialUnifiedStartTick,commercialUnifiedBaseline,...priorProjection}=c;
  assert.equal(createHash('sha256').update(JSON.stringify(priorProjection)).digest('hex'),'72f0e5ba0e51c557d9aca8e47f767f550f0f0435724750b097eff306d268bf06');
  for(const key of ['accounts','firms','buildings','households','ownerLabor','employment','goods','crops','rng','nextId'] as const)assert.deepEqual(c[key],old[key]);
  const before=JSON.stringify(c),raw=serialize(c);assert.equal(JSON.parse(raw).version,25);
  assert.equal(JSON.stringify(deserialize(raw)),before);
  const runtime=createParkRuntime(c);assert.deepEqual(deserializeParkSession(serializeParkSession(c,runtime)),{city:c,runtime});
});

test('both legacy origins trade both commodity shelves and share organic levels1–9 without conversion or stock writeoff',()=>{
  const c=fresh();enableEducation(c);
  const originals=c.firms.filter(isCommercial).map(f=>({id:f.id,wallet:f.wallet,owner:f.owner?.householdId,building:f.building,cell:premise(c,f.building).cell,kind:f.commercialKind}));
  const seen=new Map(originals.map(f=>[f.id,new Set([premise(c,f.building).level])]));
  for(let d=0;d<300;d++){
    holdEducationReady(c);keepSupplied(c,20);
    const levels=new Map(originals.map(f=>[f.id,premise(c,f.building).level]));step(c);
    for(const old of originals){
      const f=c.firms.find(f=>f.id===old.id)!;assert.ok(f);const b=premise(c,f.building),prev=levels.get(f.id)!;
      assert.equal(f.wallet,old.wallet);assert.equal(f.owner?.householdId,old.owner);assert.equal(b.cell,old.cell);assert.equal(f.commercialKind,old.kind);
      if(b.level>prev){assert.equal(b.level,prev+1);assert.equal(c.tick%30,0);assert.ok(c.ledger.some(e=>e.tick===c.tick&&e.from===f.wallet&&e.amount===20000&&e.reason==='Profitable firm height investment'));}
      seen.get(f.id)!.add(b.level);
      assert.ok(!c.cropLedger.some(e=>e.tick===c.tick&&e.from===f.wallet&&e.kind==='writeoff'));
      assert.ok(!c.ledger.some(e=>e.tick===c.tick&&e.from===f.wallet&&e.reason==='Market to shop conversion'));
    }
    // One family basket across crop and finished-goods paths, never two food allowances.
    for(const h of c.households){
      const crops=c.cropLedger.filter(e=>e.tick===c.tick&&e.to===h.wallet&&e.kind==='consumption').reduce((n,e)=>n+e.quantity,0);
      const goods=c.goodsLedger.filter(e=>e.tick===c.tick&&e.to===h.wallet&&e.reason==='Household final consumption').reduce((n,e)=>n+e.quantity,0);
      assert.ok(crops+goods<=h.members);
    }
    if(c.tick%30===0)assert.equal(JSON.stringify(deserialize(serialize(c))),JSON.stringify(c));
  }
  for(const old of originals){const f=c.firms.find(f=>f.id===old.id)!;assert.equal(premise(c,f.building).level,9);assert.ok(f.cropInventory>0&&f.inventory>0);assert.equal(commercialGrowthStatus(c,f).nextLevel,null);}
  const oldMarket=originals.find(f=>f.kind==='market')!;assert.deepEqual([...seen.get(oldMarket.id)!],[1,2,3,4,5,6,7,8,9]);
  assert.equal(Object.values(c.accounts).reduce((n,v)=>n+v,0),0);assert.equal(marketToConvert(c),undefined);
});

test('same level and business facts produce same growth/capacity independent of legacy origin',()=>{
  const c=fresh(),f=c.firms.find(f=>f.commercialKind==='market')!;premise(c,f.building).age=30;
  const status=commercialGrowthStatus(c,f),demand=retailDemand(c),before=JSON.stringify(c);
  assert.deepEqual(status.reasons,[]);assert.equal(JSON.stringify(c),before);
  const clone=structuredClone(c),other=clone.firms.find(a=>a.id===f.id)!;other.commercialKind='retail';
  assert.deepEqual(commercialGrowthStatus(clone,other),status);assert.equal(retailDemand(clone),demand);
  assert.equal(firmCapacity(premise(clone,other.building),other),firmCapacity(premise(c,f.building),f));
  const check=(mutate:(x:City)=>void,re:RegExp)=>{const x=structuredClone(c);mutate(x);assert.match(commercialGrowthStatus(x,x.firms.find(a=>a.id===f.id)!).reasons.join(' '),re);};
  check(x=>{x.accounts[f.wallet]=39999;},/400/);check(x=>{x.firms.find(a=>a.id===f.id)!.lastMonthProfit=0;},/กำไร/);
  check(x=>{x.ownerLabor=x.ownerLabor.filter(a=>a.firmId!==f.id);x.employment=x.employment.filter(a=>a.firmId!==f.id);},/ทำงาน/);
  check(x=>{x.cells.forEach(cell=>{cell.road=false;});},/ถนน/);
  const educated=structuredClone(c);premise(educated,f.building).level=6;enableEducation(educated);holdEducationReady(educated);
  assert.equal(firmCredentialCounts(educated,f.id).higher,1);
  assert.equal(commercialGrowthStatus(educated,educated.firms.find(a=>a.id===f.id)!).reasons.some(r=>/วุฒิ/.test(r)),false);
});

test('v25 alone admits new commercial levels and the boundary cannot be hidden in a legacy envelope',()=>{
  for(const kind of ['market','retail'] as const){const c=fresh(),f=c.firms.find(f=>f.commercialKind===kind)!;premise(c,f.building).level=9;
    const raw=serialize(c),envelope=JSON.parse(raw);assert.equal(premise(deserialize(raw),f.building).level,9);
    const {commercialBaseVersion,commercialUnifiedStartTick,commercialUnifiedBaseline,...old}=envelope;old.version=commercialBaseVersion;old.rulesVersion=old.version===24?'chain-19':'chain-14';
    assert.throws(()=>deserialize(JSON.stringify(old)),/corrupt|version/);
    envelope.commercialBaseVersion=19;assert.throws(()=>deserialize(JSON.stringify(envelope)),/history/);
    premise(c,f.building).level=10;assert.throws(()=>deserialize(serialize(c)),/corrupt/);
  }
  const e=JSON.parse(serialize(fresh()));e.commercialUnifiedStartTick=e.tick+1;assert.throws(()=>deserialize(JSON.stringify(e)),/boundary/);
});

test('one capacity table startsL1 and preserves existing shelves; all roles share actual staffed limits',()=>{
  assert.deepEqual([1,2,3,4,5,6,7,8,9].map(l=>retailCapacity(l).stock),[24,24,32,40,48,72,96,120,144]);
  assert.equal(staffedRetailCapacity(9,1).stock,24);assert.equal(staffedRetailCapacity(9,0).stock,0);assert.equal(staffedRetailCapacity(9,8).stock,144);
});

test('online receipt destinations share independent crop/goods capacities across both historical tags without network changes',async()=>{
  const {MarketClient}=await import('../src/market-client.ts');const c=fresh(),client=new MarketClient(()=>c);
  const crops=client.receiptDestinations({receipt_id:'crop-test',item_code:'crop:rice',quantity:1});
  const goods=client.receiptDestinations({receipt_id:'goods-test',item_code:'product:milled-rice',quantity:1});
  for(const f of c.firms.filter(isCommercial)){
    assert.ok(crops.some(d=>d.firmId===f.id));assert.ok(goods.some(d=>d.firmId===f.id));
    assert.equal(crops.find(d=>d.firmId===f.id)!.available,48-f.cropInventory);
    assert.equal(goods.find(d=>d.firmId===f.id)!.available,1024-f.inventory);
  }
});

test('owner proposals use combined current finance for all owned commercial levels, with same-tick save safety',async()=>{
  const {captureOwnerSnapshot,proposeOwnerDecision,executeOwnerProposal}=await import('../src/owner-decision.ts');
  for(const kind of ['market','retail'] as const){
    const c=fresh(),f=c.firms.find(f=>f.commercialKind===kind&&f.owner)!;premise(c,f.building).level=4;
    const snap=captureOwnerSnapshot(c,f.id);assert.ok(snap);
    const finance=ownerFinance(c,f.id)!;assert.equal(snap.facts.withdrawAvailable,finance.withdrawAvailable);
    const proposal=proposeOwnerDecision(snap);executeOwnerProposal(c,proposal);
    assert.equal(JSON.stringify(deserialize(serialize(c))),JSON.stringify(c));
  }
});

test('single commercial demand and finished-goods goals ignore historical kind',async()=>{
  const {summary}=await import('../src/sim.ts');const{cityGoals}=await import('../src/city-goals.ts');
  const c=fresh(),before=cityGoals(c);assert.equal(summary(c).demand.C,retailDemand(c));
  for(const f of c.firms.filter(isCommercial))f.commercialKind='market';
  assert.deepEqual(cityGoals(c),before);
});
