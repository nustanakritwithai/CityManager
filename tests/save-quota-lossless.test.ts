import test from 'node:test';import assert from 'node:assert/strict';
import {createCity,step} from '../src/sim.ts';
import {createParkRuntime,serializeParkSession,deserializeParkSession} from '../src/park-runtime.ts';
import {createSaveGuard} from '../src/save-guard.ts';
import {readStoredCity,saveStoredCity,SAVE_KEY,AUTOSAVE_CHECKPOINT_KEY,PRE_AUTOSAVE_BACKUP} from '../src/save-storage.ts';
import {decodeSaveCopy,encodeSaveCopy} from '../src/save-copy-codec.ts';
import {marketJournalForTest,MarketClient,MARKET_SAVE_KEY} from '../src/market-client.ts';
import {exportLocalCitySession} from '../src/local-city-save.ts';
const snap=(c:ReturnType<typeof createCity>)=>serializeParkSession(c,createParkRuntime(c));
const memory=()=>{const data=new Map<string,string>();return{data,getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};};
const market=()=>{const j=marketJournalForTest(null);j.guestId='00000000-0000-4000-8000-000000000003';return j;};
test('new original backup compresses losslessly and old existing raw backup is never changed',()=>{
 const c=createCity(61025,{starter:true});for(let i=0;i<388;i++)step(c);const j=market();c.market=j;const raw=snap(c);assert(raw.length>=64000);const packed=encodeSaveCopy(raw);assert(packed.length<raw.length);assert.equal(decodeSaveCopy(packed),raw);const s=memory();s.setItem(SAVE_KEY,raw);const g=createSaveGuard(s);g.acceptLoaded(raw);g.write(raw,null);assert.equal(s.getItem(SAVE_KEY),raw);assert.equal(s.getItem(PRE_AUTOSAVE_BACKUP),packed);assert.equal(readStoredCity(s,'backup')?.raw,raw);assert.deepEqual(deserializeParkSession(readStoredCity(s,'backup')!.raw).city.market,j);console.log(`388-day v${JSON.parse(raw).version}: raw=${raw.length}, compressed=${packed.length} UTF-16 code units; saving ${raw.length-packed.length}`);
 const original='original old backup bytes';const old=memory();old.setItem(SAVE_KEY,raw);old.setItem(PRE_AUTOSAVE_BACKUP,original);const guard=createSaveGuard(old);guard.acceptLoaded(raw);guard.write(raw,null);assert.equal(old.getItem(PRE_AUTOSAVE_BACKUP),original);
});
test('limited headroom accepts compressed new backup when raw backup cannot fit; rejects zero headroom without touching prior primary or checkpoint',()=>{
 const c=createCity(1,{starter:true});for(let i=0;i<120;i++)step(c);const raw=snap(c),packed=encodeSaveCopy(raw);assert(packed.length<raw.length);const s=memory();s.setItem(SAVE_KEY,raw);s.setItem(AUTOSAVE_CHECKPOINT_KEY,packed);const initial=[...s.data.values()].reduce((n,v)=>n+v.length,0);const limit=initial+packed.length+20;const limited={getItem:s.getItem,setItem:(k:string,v:string)=>{let total=[...s.data].reduce((n,[key,val])=>n+(key===k?0:val.length),0)+v.length;if(total>limit)throw Object.assign(Error('quota'),{name:'QuotaExceededError'});s.setItem(k,v);}};const g=createSaveGuard(limited);g.acceptLoaded(raw);g.write(raw,null);assert.equal(decodeSaveCopy(s.getItem(PRE_AUTOSAVE_BACKUP)),raw);assert(initial+raw.length>limit);
 const zero=memory();zero.setItem(SAVE_KEY,raw);zero.setItem(AUTOSAVE_CHECKPOINT_KEY,packed);const before=[...zero.data];const blocked=createSaveGuard({getItem:zero.getItem,setItem:()=>{throw Object.assign(Error('quota'),{name:'QuotaExceededError'});}});blocked.acceptLoaded(raw);assert.throws(()=>blocked.write(raw,null),/quota/);assert.deepEqual([...zero.data],before);
});
test('export includes locked latest financial journal without any storage writes or city mutation',async()=>{
 const s=memory(),oldDescriptors=['window','navigator','localStorage'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)] as const);let writes=0;
 try{const j=market();const c=createCity(3);c.market=structuredClone(j);const operation={opId:'00000000-0000-4000-8000-000000000004',guestId:j.guestId!,cityId:j.cityId,kind:'buy',payload:{listing_id:'test',quantity:1},state:'pending',createdAt:'2026-10-27T00:00:00.000Z'} as const;j.operations.push(operation);s.setItem(MARKET_SAVE_KEY,JSON.stringify(j));Object.defineProperty(globalThis,'window',{configurable:true,value:{}});Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_n:unknown,_o:unknown,fn:(x:unknown)=>unknown)=>fn({})}}});Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:s.getItem,setItem:(k:string,v:string)=>{writes++;s.setItem(k,v);}}});const client=new MarketClient(()=>c,'/citymanager-api'),before=JSON.stringify(c.market),snapshot=await exportLocalCitySession(c,createParkRuntime(c),client);assert.deepEqual(JSON.parse(snapshot).market,j);assert.equal(JSON.stringify(c.market),before);assert.equal(writes,0);
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}});await assert.rejects(exportLocalCitySession(c,createParkRuntime(c),client),/lock-unavailable/);assert.equal(writes,0);
 }finally{for(const [key,d] of oldDescriptors)if(d)Object.defineProperty(globalThis,key,d);else Reflect.deleteProperty(globalThis,key);}
});

test('recovery load checks financial journal under lock without any storage write, and rejects mismatch',async()=>{
 const {loadRecoveryCityReadOnly}=await import('../src/local-city-save.ts');
 const s=memory(),d=['window','navigator','localStorage'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)] as const);let writes=0;
 try{
  const j=market();j.operations.push({opId:'00000000-0000-4000-8000-000000000004',guestId:j.guestId!,cityId:j.cityId,kind:'buy',payload:{listing_id:'test',quantity:1},state:'pending',createdAt:'2026-10-27T00:00:00.000Z'});s.setItem(MARKET_SAVE_KEY,JSON.stringify(j));
  Object.defineProperty(globalThis,'window',{configurable:true,value:{}});Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_n:unknown,_o:unknown,fn:(x:unknown)=>unknown)=>fn({})}}});Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:s.getItem,setItem:(k:string,v:string)=>{writes++;s.setItem(k,v);}}});
  const city=createCity(4);city.market=structuredClone(j);const raw=snap(city),client=new MarketClient(()=>city,'/citymanager-api'),guard=createSaveGuard(s);let applied=false;await loadRecoveryCityReadOnly(raw,client,guard,()=>{applied=true;});assert(applied);assert.equal(writes,0);assert.equal(guard.armed,false);
  const different=structuredClone(city);different.market!.operations=[];applied=false;await assert.rejects(loadRecoveryCityReadOnly(snap(different),client,guard,()=>{applied=true;}),/reconciliation-required/);assert.equal(applied,false);assert.equal(writes,0);
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}});await assert.rejects(loadRecoveryCityReadOnly(raw,client,guard,()=>{}),/lock-unavailable/);assert.equal(writes,0);
 }finally{for(const [key,desc] of d)if(desc)Object.defineProperty(globalThis,key,desc);else Reflect.deleteProperty(globalThis,key);}
});

test('export refuses stale empty market client after another tab changes persisted journal',async()=>{
 const s=memory(),d=['window','navigator','localStorage'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)] as const);
 try{const j=market();s.setItem(MARKET_SAVE_KEY,JSON.stringify(j));Object.defineProperty(globalThis,'window',{configurable:true,value:{}});Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_n:unknown,_o:unknown,fn:(x:unknown)=>unknown)=>fn({})}}});Object.defineProperty(globalThis,'localStorage',{configurable:true,value:s});
 const c=createCity(5);c.market=structuredClone(j);const client=new MarketClient(()=>c,'/citymanager-api');j.operations.push({opId:'00000000-0000-4000-8000-000000000004',guestId:j.guestId!,cityId:j.cityId,kind:'buy',payload:{listing_id:'test',quantity:1},state:'pending',createdAt:'2026-10-27T00:00:00.000Z'});s.setItem(MARKET_SAVE_KEY,JSON.stringify(j));await assert.rejects(exportLocalCitySession(c,createParkRuntime(c),client),/market-state-changed-reload/);
 }finally{for(const [key,desc] of d)if(desc)Object.defineProperty(globalThis,key,desc);else Reflect.deleteProperty(globalThis,key);}
});

test('v25 business-capacity save round trips losslessly without reducing ledger or market fields',async()=>{
 const {businessFixture}=await import('./business-capacity-fixture.ts');const c=businessFixture(65),j=market();c.market=j;const raw=snap(c),copy=encodeSaveCopy(raw);assert.equal(JSON.parse(raw).version,25);assert.equal(JSON.parse(raw).commercialBaseVersion,23);assert.equal(decodeSaveCopy(copy),raw);assert.deepEqual(deserializeParkSession(decodeSaveCopy(copy)!).city.market,j);assert.deepEqual(JSON.parse(decodeSaveCopy(copy)!).ledger,JSON.parse(raw).ledger);
});

test('nonzero sequence or unknown market fields are not pristine',async()=>{
 const {isPristineMarketJournal}=await import('../src/market-client.ts');const j=marketJournalForTest(null);assert.equal(isPristineMarketJournal(j),true);j.seq='1';assert.equal(isPristineMarketJournal(j),false);j.seq='0';(j as any).unknownFinancialField=123;assert.equal(isPristineMarketJournal(j),false);
});

test('recovery mode blocks market mutation but permits locked export without network or storage writes',async()=>{
 const s=memory(),d=['window','navigator','localStorage','fetch'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)] as const);let writes=0,network=0;
 try{const j=market();s.setItem(MARKET_SAVE_KEY,JSON.stringify(j));Object.defineProperty(globalThis,'window',{configurable:true,value:{}});Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_n:unknown,_o:unknown,fn:(x:unknown)=>unknown)=>fn({})}}});Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:s.getItem,setItem:(k:string,v:string)=>{writes++;s.setItem(k,v);}}});Object.defineProperty(globalThis,'fetch',{configurable:true,value:()=>{network++;throw Error('network forbidden');}});
 const c=createCity(6);c.market=structuredClone(j);const client=new MarketClient(()=>c,'/citymanager-api');client.setRecoveryReadOnly(true);await assert.rejects(client.buy('00000000-0000-4000-8000-000000000008',1),/market-disabled-in-recovery/);await assert.rejects(client.list('crop:rice',1,1),/market-disabled-in-recovery/);assert.deepEqual(JSON.parse(await exportLocalCitySession(c,createParkRuntime(c),client)).market,j);assert.equal(network,0);assert.equal(writes,0);client.setRecoveryReadOnly(false);await client.reconcileSession({guest_id:j.guestId!,seq:'0'});assert.equal(writes,1,'market writer resumes only after recovery restriction is lifted');assert.equal(network,0);
 }finally{for(const [key,desc] of d)if(desc)Object.defineProperty(globalThis,key,desc);else Reflect.deleteProperty(globalThis,key);}
});

test('a Guest-only journal cannot be attached to an unrelated no-market city',async()=>{
 const s=memory(),d=['window','navigator','localStorage'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)] as const);
 try{const j=market();s.setItem(MARKET_SAVE_KEY,JSON.stringify(j));Object.defineProperty(globalThis,'window',{configurable:true,value:{}});Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_n:unknown,_o:unknown,fn:(x:unknown)=>unknown)=>fn({})}}});Object.defineProperty(globalThis,'localStorage',{configurable:true,value:s});const c=createCity(7);delete c.market;const client=new MarketClient(()=>c,'/citymanager-api');await assert.rejects(exportLocalCitySession(c,createParkRuntime(c),client),/saved-city-recovery-required/);assert.equal(c.market,undefined);
 }finally{for(const [key,desc] of d)if(desc)Object.defineProperty(globalThis,key,desc);else Reflect.deleteProperty(globalThis,key);}
});

test('IDB-unavailable continuation inventory distinguishes preferences, journal and uncertain city keys',async()=>{
 const {hasOnlyKnownNonCityKeys}=await import('../src/local-city-save.ts');const store=(keys:string[])=>({length:keys.length,key:(i:number)=>keys[i]??null});
 assert.equal(hasOnlyKnownNonCityKeys(store([]),false),true);assert.equal(hasOnlyKnownNonCityKeys(store(['citymanager.visual.v1','citymanager.traffic']),false),true);
 assert.equal(hasOnlyKnownNonCityKeys(store(['citymanager.market.v10']),false),false);assert.equal(hasOnlyKnownNonCityKeys(store(['citymanager.market.v10']),true),true);
 for(const k of ['citymanager.save.v7','citymanager.backup.v5','citymanager.checkpoint.latest','citymanager.unknown'])assert.equal(hasOnlyKnownNonCityKeys(store([k]),true),false);
 assert.equal(hasOnlyKnownNonCityKeys({get length(){throw Error('denied');},key:()=>null},true),false);
});

test('recovery market validation rejects malformed, unknown, or unowned financial records',async()=>{
 const {validateRecoveryMarketJournal}=await import('../src/market-client.ts');const j=market();validateRecoveryMarketJournal(j);
 const malformed=structuredClone(j) as any;malformed.operations=[{bad:true}];assert.throws(()=>validateRecoveryMarketJournal(malformed));
 const extra=structuredClone(j) as any;extra.futureFinancialState={amount:1};assert.throws(()=>validateRecoveryMarketJournal(extra),/unknown/);
 const missing=structuredClone(j) as any;missing.guestId=null;missing.operations=[{opId:'00000000-0000-4000-8000-000000000004',guestId:j.guestId,cityId:j.cityId,kind:'buy',payload:{},state:'pending',createdAt:'2026-10-27T00:00:00.000Z'}];assert.throws(()=>validateRecoveryMarketJournal(missing),/identity-missing/);
});

test('overlapping failed and successful save attempts settle in order',async()=>{
 const {createSaveAttemptQueue}=await import('../src/save-feedback.ts');const enqueue=createSaveAttemptQueue(),events:string[]=[];let release!:()=>void;
 const gate=new Promise<void>(r=>{release=r;});const first=enqueue(async()=>{events.push('first-start');await gate;events.push('first-fail');throw Error('quota');});
 const second=enqueue(async()=>{events.push('second-start');events.push('second-success');return 1;});await Promise.resolve();assert.deepEqual(events,['first-start']);release();await assert.rejects(first,/quota/);assert.equal(await second,1);assert.deepEqual(events,['first-start','first-fail','second-start','second-success']);
});


test('legacy storage utility validates v25 history checkpoints before writes and preserves exact bytes on success or quota failure',()=>{
 const c=createCity(91,{starter:false});for(let i=0;i<65;i++)step(c);
 const raw=snap(c);assert.equal(JSON.parse(raw).version,25);assert.equal(JSON.parse(raw).commercialBaseVersion,24);
 const s=memory();saveStoredCity(s,raw,null);assert.equal(s.getItem(SAVE_KEY),raw);
 const before=[...s.data];let writes=0;
 for(const mutate of [
  (v:any)=>{v.history.moneyCount=-1;},
  (v:any)=>{v.historyBaseVersion=999;},
  (v:any)=>{v.rulesVersion='chain-18';},
 ]){const invalid=JSON.parse(raw);mutate(invalid);assert.throws(()=>saveStoredCity({...s,setItem:()=>{writes++;}},JSON.stringify(invalid),null));}
 assert.equal(writes,0);assert.deepEqual([...s.data],before);
 assert.throws(()=>saveStoredCity({...s,setItem:()=>{throw Error('quota');}},raw,null),/quota/);
 assert.deepEqual([...s.data],before);
});
