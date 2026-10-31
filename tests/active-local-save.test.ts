import test from 'node:test';
import assert from 'node:assert/strict';
import {saveActiveLocalSave,readActiveLocalSave,activeLocalRevision,requireExplicitActiveChoice,canRetryActiveLocalSave} from '../src/active-local-save.ts';
import {createCity,step} from '../src/sim.ts';
import {createParkRuntime,serializeParkSession} from '../src/park-runtime.ts';

// A deterministic transaction fake, not a replacement for the real Edge acceptance.
// Snapshots and commits are isolated; delayed events intentionally model an IDB
// implementation which does not acknowledge abort after a timeout.
function fakeIdb(options:{stallWrite?:boolean;noAbortEvent?:boolean;abortThrowsComplete?:boolean;failWrites?:boolean;corruptAfterNextCommit?:boolean;schema?:Partial<{keyPath:unknown;autoIncrement:boolean;indexNames:string[]}>}={}) {
 const stores=new Map<string,Map<unknown,unknown>>([['branches',new Map()],['active-city',new Map()]]);
 const names=Object.assign(['branches','active-city'],{contains(x:string){return this.includes(x);}});
 let puts=0,closed=0,corruptReads=false;const delayed:Array<()=>void>=[];
 const db:any={version:2,objectStoreNames:names,close(){closed++;},transaction(_names:unknown,mode:string){
  const draft=new Map([...stores].map(([n,m])=>[n,new Map([...m].map(([k,v])=>[k,structuredClone(v)]))]));
  if(mode==='readonly'&&corruptReads&&options.corruptAfterNextCommit){const first=draft.get('branches')?.values().next().value as any;if(first)first.current.copy='corrupt readback';}
  let pending=0,aborted=false,completeScheduled=false;
  const finish=()=>{if(pending||aborted||completeScheduled)return;completeScheduled=true;setImmediate(()=>{if(pending||aborted){completeScheduled=false;return;}if(mode==='readwrite'){stores.clear();for(const [n,m] of draft)stores.set(n,m);if(options.corruptAfterNextCommit)corruptReads=true;}t.oncomplete?.();});};
  const dispatch=(fn:()=>void)=>{if(options.stallWrite&&mode==='readwrite')delayed.push(fn);else setImmediate(fn);};
  const t:any={objectStoreNames:names,error:null,abort(){if(options.abortThrowsComplete){setImmediate(()=>t.oncomplete?.());throw Error('abort failed');}if(options.noAbortEvent)return;aborted=true;setImmediate(()=>t.onabort?.());},objectStore(name:string){const data=draft.get(name)!;return {keyPath:null,autoIncrement:false,indexNames:[],...options.schema,
   openCursor(){pending++;const request:any={};const entries=[...data];let index=0;const next=()=>dispatch(()=>{if(aborted)return;const entry=entries[index++];request.result=entry?{key:entry[0],value:structuredClone(entry[1]),continue:next}:null;request.onsuccess?.();if(!entry){pending--;finish();}});next();return request;},
   count(){pending++;const request:any={};dispatch(()=>{if(aborted)return;request.result=data.size;request.onsuccess?.();pending--;finish();});return request;},
   put(value:unknown,key:unknown){if(options.failWrites){t.error=new DOMException('quota','QuotaExceededError');t.abort();throw t.error;}if(aborted)throw new DOMException('aborted','TransactionInactiveError');puts++;data.set(key,structuredClone(value));return {};},
  };}};return t;
 }};
 const factory:any={open(){const request:any={};setImmediate(()=>{request.result=db;request.onsuccess?.();});return request;}};
 return {factory,stores,get puts(){return puts;},get closed(){return closed;},release(){while(delayed.length)delayed.shift()!();},delayed};
}
const fence={primary:'untouched primary',checkpoint:'untouched checkpoint',inventory:'all known slots'};
const make=()=>{const city=createCity(73);return {city,raw:()=>serializeParkSession(city,createParkRuntime(city))};};

test('active local transaction saves and restores exact session; twenty rotations retain baseline, previous and marker CAS',async()=>{
 const db=fakeIdb(),fixture=make();let paused=false;
 let saved=await saveActiveLocalSave({raw:fixture.raw(),token:null,expectedMarker:null,fence,assertCurrent(){},factory:db.factory,marketClient:{setRecoveryReadOnly(v){paused=v;}}});
 const baseline=saved.snapshot.raw,first=saved;let previous=baseline;
 assert.equal(paused,true);assert.equal((await readActiveLocalSave(fence,db.factory))?.snapshot.raw,baseline);
 for(let i=0;i<20;i++){previous=fixture.raw();step(fixture.city);saved=await saveActiveLocalSave({raw:fixture.raw(),token:{branchId:saved.snapshot.branchId,revision:saved.snapshot.revision},expectedMarker:saved.marker.revision,fence,assertCurrent(){},factory:db.factory});}
 assert.equal((await readActiveLocalSave(fence,db.factory))?.snapshot.raw,fixture.raw());
 const branch:any=db.stores.get('branches')!.get(saved.snapshot.branchId);assert.equal(branch.baseline.copy,baseline);assert.equal(branch.previous.copy,previous);
 const before=JSON.stringify([...db.stores].map(([k,v])=>[k,[...v]]));
 await assert.rejects(saveActiveLocalSave({raw:baseline,token:{branchId:first.snapshot.branchId,revision:first.snapshot.revision},expectedMarker:first.marker.revision,fence,assertCurrent(){},factory:db.factory}),/conflict/);
 assert.equal(JSON.stringify([...db.stores].map(([k,v])=>[k,[...v]])),before);
 await assert.rejects(readActiveLocalSave({...fence,inventory:'changed backup'},db.factory),/choice-changed/);
 assert.equal(await activeLocalRevision(db.factory),saved.marker.revision);
});

test('unknown metadata keys and non-string branch keys fail closed without writes',async()=>{
 for(const [store,key,value,pattern] of [['active-city','future-key',{future:true},/metadata-unknown/],['active-city','active',undefined,/metadata-unknown/],['branches',123,{},/unknown-key/]] as const){
  const db=fakeIdb();db.stores.get(store)!.set(key,value);
  await assert.rejects(saveActiveLocalSave({raw:make().raw(),token:null,expectedMarker:null,fence,assertCurrent(){},factory:db.factory}),pattern);assert.equal(db.puts,0);assert.equal(db.stores.get(store)!.has(key),true);
 }
});

test('same-name unknown schema is rejected without mutation',async()=>{
 for(const schema of [{keyPath:'id'},{autoIncrement:true},{indexNames:['future-index']}]){const db=fakeIdb({schema});await assert.rejects(readActiveLocalSave(fence,db.factory),/schema-unknown/);assert.equal(db.puts,0);}
});

test('valid-shaped but corrupt active metadata is never overwritten',async()=>{
 for(const field of ['rawHash','inventoryHash','branchRevision'] as const){const db=fakeIdb(),fixture=make();const saved=await saveActiveLocalSave({raw:fixture.raw(),token:null,expectedMarker:null,fence,assertCurrent(){},factory:db.factory});const marker:any=db.stores.get('active-city')!.get('active');marker[field]='corrupt';const puts=db.puts;
  await assert.rejects(saveActiveLocalSave({raw:fixture.raw(),token:{branchId:saved.snapshot.branchId,revision:saved.snapshot.revision},expectedMarker:saved.marker.revision,fence,assertCurrent(){},factory:db.factory}),/metadata-uncertain/);assert.equal(db.puts,puts);assert.equal((db.stores.get('active-city')!.get('active') as any)[field],'corrupt');
 }
});

test('transaction timeout rejects with no events and late cursor callbacks cannot put after rejection',async()=>{
 const db=fakeIdb({stallWrite:true,noAbortEvent:true});let paused=false;
 await assert.rejects(saveActiveLocalSave({raw:make().raw(),token:null,expectedMarker:null,fence,assertCurrent(){},factory:db.factory,marketClient:{setRecoveryReadOnly(){paused=true;}}}),/transaction-timeout-uncertain/);
 assert(db.delayed.length>0,'write transaction is holding cursor callbacks');assert.equal(db.puts,0);assert.equal(paused,false);
 db.release();await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
 assert.equal(db.puts,0,'no late put after timeout released the caller');assert.equal(db.stores.get('branches')!.size,0);assert.equal(db.stores.get('active-city')!.size,0);
});

test('real market writer stays paused after verified active save and readonly restart; buy/claim/ACK never send',async()=>{
 const {MarketClient,marketJournalForTest,MARKET_SAVE_KEY}=await import('../src/market-client.ts');
 const {withLocalCitySnapshot,loadRecoveryCityReadOnly}=await import('../src/local-city-save.ts');const {createSaveGuard}=await import('../src/save-guard.ts');
 const keys=['window','navigator','document','localStorage','fetch'] as const,previous=keys.map(k=>Object.getOwnPropertyDescriptor(globalThis,k));const data=new Map<string,string>();let held=false,network=0;
 const local={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};
 try{
  Object.defineProperty(globalThis,'window',{configurable:true,value:{}});Object.defineProperty(globalThis,'document',{configurable:true,value:{cookie:'cm_csrf=test'}});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_name:unknown,_options:unknown,fn:(lock:unknown)=>Promise<unknown>)=>{if(held)return fn(null);held=true;try{return await fn({});}finally{held=false;}}}}});
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:local});Object.defineProperty(globalThis,'fetch',{configurable:true,value:async()=>{network++;throw Error('network forbidden');}});
  const journal=marketJournalForTest(null),receipt='00000000-0000-4000-8000-000000000004';journal.guestId='00000000-0000-4000-8000-000000000003';journal.receipts[receipt]={claimId:'00000000-0000-4000-8000-000000000005',state:'applied',firmId:2,itemId:'crop:rice',quantity:1};data.set(MARKET_SAVE_KEY,JSON.stringify(journal));const journalBefore=data.get(MARKET_SAVE_KEY);
  let city=createCity(27);city.market=structuredClone(journal);const runtime=createParkRuntime(city),client=new MarketClient(()=>city,'http://127.0.0.1:4317'),db=fakeIdb();
  const saved=await withLocalCitySnapshot(city,runtime,client,raw=>saveActiveLocalSave({raw,token:null,expectedMarker:null,fence,assertCurrent(){assert.equal(held,true);},factory:db.factory,marketClient:client}));
  const forbidden=async(c:InstanceType<typeof MarketClient>)=>{for(const work of [()=>c.buy('00000000-0000-4000-8000-000000000008',1),()=>c.claim(receipt),()=>c.ack(receipt)])await assert.rejects(work(),/market-disabled-in-recovery/);assert.equal(network,0);assert.equal(data.get(MARKET_SAVE_KEY),journalBefore);};
  await forbidden(client);const restarted=new MarketClient(()=>city,'http://127.0.0.1:4317'),guard=createSaveGuard(local);const reopened=await readActiveLocalSave(fence,db.factory);assert.equal(reopened?.snapshot.raw,saved.snapshot.raw);await loadRecoveryCityReadOnly(reopened!.snapshot.raw,restarted,guard,restored=>{city=restored.city;});assert.equal(guard.armed,false);await forbidden(restarted);
  restarted.setRecoveryReadOnly(false);await assert.rejects(loadRecoveryCityReadOnly('{invalid',restarted,guard,()=>{}));assert.equal(guard.armed,false);await forbidden(restarted);
  restarted.setRecoveryReadOnly(false);const mismatch=JSON.parse(reopened!.snapshot.raw);mismatch.market.seq='1';await assert.rejects(loadRecoveryCityReadOnly(JSON.stringify(mismatch),restarted,guard,()=>{}),/reconciliation-required/);await forbidden(restarted);
 }finally{keys.forEach((key,i)=>previous[i]?Object.defineProperty(globalThis,key,previous[i]!):Reflect.deleteProperty(globalThis,key));}
});

test('failed schema transaction whose abort throws and later completes rejects instead of hanging',async()=>{
 const db=fakeIdb({abortThrowsComplete:true,schema:{keyPath:'unexpected'}});
 await assert.rejects(readActiveLocalSave(fence,db.factory),/schema-unknown/);assert.equal(db.puts,0);
});

test('all-write quota abort retains exact prior active transaction and never accepts market',async()=>{
 const config={failWrites:false},db=fakeIdb(config),fixture=make();const saved=await saveActiveLocalSave({raw:fixture.raw(),token:null,expectedMarker:null,fence,assertCurrent(){},factory:db.factory});const before=JSON.stringify([...db.stores].map(([k,v])=>[k,[...v]]));step(fixture.city);config.failWrites=true;let accepted=false;
 await assert.rejects(saveActiveLocalSave({raw:fixture.raw(),token:{branchId:saved.snapshot.branchId,revision:saved.snapshot.revision},expectedMarker:saved.marker.revision,fence,assertCurrent(){},factory:db.factory,marketClient:{setRecoveryReadOnly(){accepted=true;}}}),/quota/);
 assert.equal(accepted,false);assert.equal(JSON.stringify([...db.stores].map(([k,v])=>[k,[...v]])),before);assert.equal((await readActiveLocalSave(fence,db.factory))?.snapshot.raw,saved.snapshot.raw);
});

test('altered readback after commit rejects uncertain outcome, retains old and committed data, and does not accept market',async()=>{
 const config={corruptAfterNextCommit:false},db=fakeIdb(config),fixture=make();const saved=await saveActiveLocalSave({raw:fixture.raw(),token:null,expectedMarker:null,fence,assertCurrent(){},factory:db.factory});step(fixture.city);const current=fixture.raw();config.corruptAfterNextCommit=true;let accepted=false;
 await assert.rejects(saveActiveLocalSave({raw:current,token:{branchId:saved.snapshot.branchId,revision:saved.snapshot.revision},expectedMarker:saved.marker.revision,fence,assertCurrent(){},factory:db.factory,marketClient:{setRecoveryReadOnly(){accepted=true;}}}),/readback-uncertain/);assert.equal(accepted,false);
 config.corruptAfterNextCommit=false;const actual=await readActiveLocalSave(fence,db.factory);assert.equal(actual?.snapshot.raw,current);const branch:any=db.stores.get('branches')!.get(saved.snapshot.branchId);assert.equal(branch.previous.copy,saved.snapshot.raw);assert.equal(branch.baseline.copy,saved.snapshot.raw);
});


test('explicit different choice disables old active preselection atomically without changing any branch',async()=>{
 const db=fakeIdb(),fixture=make(),active=await saveActiveLocalSave({raw:fixture.raw(),token:null,expectedMarker:null,fence,assertCurrent(){},factory:db.factory});const before=JSON.stringify([...db.stores.get('branches')!]);await requireExplicitActiveChoice(active,fence,()=>{},db.factory);const after=await readActiveLocalSave(fence,db.factory);assert.equal(after?.marker.requireChoice,true);assert.notEqual(after?.marker.revision,active.marker.revision);assert.equal(after?.snapshot.raw,active.snapshot.raw);assert.equal(JSON.stringify([...db.stores.get('branches')!]),before);await assert.rejects(requireExplicitActiveChoice(active,fence,()=>{},db.factory),/conflict/);
});


test('fresh suppression nonce invalidates an earlier active fence and delayed preference never overwrites suppression',async()=>{
 const {suppressRememberedChoice,rememberResumeChoice,RESUME_CHOICE_KEY}=await import('../src/save-choice.ts');const map=new Map<string,string>(),storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);}};const first=suppressRememberedChoice(storage),db=fakeIdb(),fixture=make(),oldFence={...fence,inventory:JSON.stringify([[RESUME_CHOICE_KEY,first]])};await saveActiveLocalSave({raw:fixture.raw(),token:null,expectedMarker:null,fence:oldFence,assertCurrent(){},factory:db.factory});const second=suppressRememberedChoice(storage);assert.notEqual(first,second);await assert.rejects(readActiveLocalSave({...oldFence,inventory:JSON.stringify([[RESUME_CHOICE_KEY,second]])},db.factory),/choice-changed/);
 map.delete(RESUME_CHOICE_KEY);const choice={id:'stored:current',label:'primary',raw:fixture.raw()};const pending=rememberResumeChoice(storage,choice,[choice]);const suppressed=suppressRememberedChoice(storage);await pending;assert.equal(storage.getItem(RESUME_CHOICE_KEY),suppressed);
 await assert.rejects(async()=>suppressRememberedChoice({getItem:()=>null,setItem(){throw new DOMException('full','QuotaExceededError')}}),/full/);
});


test('confirmed active-IDB quota abort permits retry only after exact durable-state verification',async()=>{
 const options={failWrites:false},db=fakeIdb(options),fixture=make();
 const saved=await saveActiveLocalSave({raw:fixture.raw(),token:null,expectedMarker:null,fence,assertCurrent(){},factory:db.factory});
 const token={branchId:saved.snapshot.branchId,revision:saved.snapshot.revision},before=JSON.stringify([...db.stores].map(([k,v])=>[k,[...v]]));
 step(fixture.city);options.failWrites=true;let failure:unknown;
 try{await saveActiveLocalSave({raw:fixture.raw(),token,expectedMarker:saved.marker.revision,fence,assertCurrent(){},factory:db.factory});}catch(error){failure=error;}
 assert.equal((failure as Error).name,'QuotaExceededError');assert.equal(JSON.stringify([...db.stores].map(([k,v])=>[k,[...v]])),before);
 assert.equal(await canRetryActiveLocalSave(failure,saved,fence,db.factory),true);
 assert.equal(await canRetryActiveLocalSave(Error('active-local-transaction-timeout-uncertain'),saved,fence,db.factory),false);
 assert.equal(await canRetryActiveLocalSave(failure,{...saved,marker:{...saved.marker,revision:'stale'}},fence,db.factory),false);
 assert.equal(await canRetryActiveLocalSave(failure,saved,{...fence,inventory:'changed'},db.factory),false);
 options.failWrites=false;const retried=await saveActiveLocalSave({raw:fixture.raw(),token,expectedMarker:saved.marker.revision,fence,assertCurrent(){},factory:db.factory});assert.equal(retried.snapshot.raw,fixture.raw());
 assert.equal(await canRetryActiveLocalSave(failure,saved,fence,db.factory),false,'successful commit can never be mistaken for unchanged state');
});


test('legacy emergency writer cannot invalidate active A; confirmed rebind saves B and retains A',async()=>{
 const {saveRecoveryCopy}=await import('../src/recovery-idb.ts');
 const db=fakeIdb(),a=make(),saved=await saveActiveLocalSave({raw:a.raw(),token:null,expectedMarker:null,fence,assertCurrent(){},factory:db.factory});
 const before=JSON.stringify([...db.stores].map(([k,v])=>[k,[...v]]));const b=createCity(123),rawB=serializeParkSession(b,createParkRuntime(b));
 await assert.rejects(saveRecoveryCopy(rawB,null,db.factory),{name:'ActiveLocalConfirmationRequired'});
 assert.equal(JSON.stringify([...db.stores].map(([k,v])=>[k,[...v]])),before,'marker and every branch unchanged');
 const switched=await saveActiveLocalSave({raw:rawB,token:null,expectedMarker:saved.marker.revision,fence,assertCurrent(){},allowRebind:true,factory:db.factory});
 assert.equal((await readActiveLocalSave(fence,db.factory))?.snapshot.raw,rawB);
 assert.notEqual(switched.snapshot.branchId,saved.snapshot.branchId);
 assert.equal((db.stores.get('branches')!.get(saved.snapshot.branchId) as any).current.copy,a.raw());
});


test('opaque marker v2 fences preserve already-compressed checkpoint bytes without representation collisions',async()=>{
 const {encodeSaveCopy}=await import('../src/save-copy-codec.ts');const raw=JSON.stringify({payload:'x'.repeat(100000)}),encoded=encodeSaveCopy(raw);
 assert.notEqual(encoded,raw);assert.equal(encodeSaveCopy(encoded),encoded,'already-compressed short input is not encoded twice');
 for(const checkpoint of [encoded,raw,'cm-copy-lz1:not-a-valid-copy','"quoted legacy bytes"']){
  const db=fakeIdb(),fixture=make(),opaque={primary:encoded,checkpoint,inventory:JSON.stringify([['checkpoint',checkpoint]])};
  const saved=await saveActiveLocalSave({raw:fixture.raw(),token:null,expectedMarker:null,fence:opaque,assertCurrent(){},factory:db.factory});
  assert.equal(saved.marker.version,2);assert.equal((await readActiveLocalSave(opaque,db.factory))?.snapshot.raw,fixture.raw(),'restart accepts exact opaque bytes');
  await assert.rejects(readActiveLocalSave({...opaque,checkpoint:checkpoint===encoded?raw:encoded},db.factory),/choice-changed/,'decoded/encoded lookalike never matches original byte fence');
  await assert.rejects(readActiveLocalSave({...opaque,primary:raw},db.factory),/choice-changed/);
 }
});

test('ambiguous pre-release v1 marker is retained and rejected rather than guessed or rewritten',async()=>{
 const db=fakeIdb(),fixture=make();await saveActiveLocalSave({raw:fixture.raw(),token:null,expectedMarker:null,fence,assertCurrent(){},factory:db.factory});
 (db.stores.get('active-city')!.get('active') as any).version=1;const before=JSON.stringify([...db.stores].map(([k,v])=>[k,[...v]]));
 await assert.rejects(readActiveLocalSave(fence,db.factory),/metadata-invalid/);assert.equal(JSON.stringify([...db.stores].map(([k,v])=>[k,[...v]])),before);
});
