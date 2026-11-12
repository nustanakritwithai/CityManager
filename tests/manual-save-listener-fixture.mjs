// Executes the actual production Save listener/queue, not a parallel implementation.
// Only DOM registration, gesture authentication and HTTP delivery are synthetic.
// No sockets, browser, persistent files or real account/save endpoints are used.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createCity } from '../src/sim.ts';
import { createParkRuntime, serializeParkSession } from '../src/park-runtime.ts';
import { citySaveMetadata } from '../src/server-city-entry.ts';
import { ServerCitySaveClient } from '../src/server-city-save.ts';
import { persistServerCity, describeServerAcknowledgement, shouldWarnBeforeUnload } from '../src/server-save-lifecycle.ts';
import { createSaveAttemptQueue, createSaveFeedback } from '../src/save-feedback.ts';
import { createAutosave, installAutosave, describeAutosave } from '../src/autosave.ts';
import { createTrafficServerFixture } from './traffic-server-entry-fixture.mjs';
import { PANEL_OWNER } from './panel-server-entry-fixture.mjs';
import { assertPanelSaveChain } from './panel-ui-server.mjs';

export const manualSuccess='บันทึกเมืองบนเซิร์ฟเวอร์แล้ว · ตลาดยังปิดอยู่';
export const turn=()=>new Promise(resolve=>setImmediate(resolve));
export function deferred(){let release;const promise=new Promise(resolve=>release=resolve);return{promise,release};}
export async function manualSaveFixture(source=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8')){
 // Windows checkouts may use CRLF. Normalize only line endings before slicing
 // and matching; the production listener and guard expressions stay unchanged.
 source=source.replaceAll('\r\n','\n');
 const start=source.indexOf('  const enqueueSave=createSaveAttemptQueue();'),end=source.indexOf('  const campusAction =',start);
 assert.ok(start>=0&&end>start,'Actual production save block must be found');
 const declaration=source.match(/  let cityGeneration=0,[^\n]+;/)?.[0];assert.ok(declaration);
 const canOpen=source.match(/    canOpen:(\(\)=>[^\n]+),\n/)?.[1];assert.ok(canOpen);
 const listeners=new Map(),windowListeners=new Map(),notices=[],feedback=[],calls=[];
 const city=createCity(61025),runtime=createParkRuntime(city),url='http://127.0.0.1:4181/CityManager/';
 const fixture=createTrafficServerFixture(url);await fixture.seed(serializeParkSession(city,runtime));
 let beforeRequest=null,afterResponse=null,authenticate=()=>Promise.resolve(PANEL_OWNER),authCalls=0,confirmResult=false,confirms=0;
 const client=new ServerCitySaveClient(async(path,init)=>{
  const method=init?.method??'GET',call={method,init:structuredClone(init)};calls.push(call);
  await beforeRequest?.(call);
  let response,status;
  await fixture.intercept({requestId:randomUUID(),request:{url:new URL('/citymanager-api'+path,url).href,method,headers:init?.headers??{},postData:init?.body}},async(_method,payload)=>{status=payload.responseCode;response=JSON.parse(Buffer.from(payload.body,'base64').toString());});
  if(status!==200)throw Object.assign(Error(response.error),{status});
  await afterResponse?.(call);return response;
 },PANEL_OWNER);
 await client.load();
 const window={addEventListener(type,fn){const list=windowListeners.get(type)??[];list.push(fn);windowListeners.set(type,list);},setInterval(){return 1;},confirm(){confirms++;return confirmResult;}};
 const scope={city,parkRuntime:runtime,paused:true,serverSave:client,serverEntry:{slot:null,auth:{connect(){authCalls++;return authenticate();}}},saveSuccessLabel:'',saveFeedback:createSaveFeedback(state=>feedback.push(state)),createSaveAttemptQueue,persistServerCity,describeServerAcknowledgement,shouldWarnBeforeUnload,serializeParkSession,citySaveMetadata,createAutosave,installAutosave,describeAutosave,document:{hidden:false,addEventListener(){}},window,sound(){},status:text=>notices.push(text),$:selector=>{assert.equal(selector,'#save');return{addEventListener:(type,fn)=>listeners.set(type,fn)};}};
 // TypeScript removes annotations only. The Save callback, trackedSave, queue,
 // autosave wiring, busy flags, unload and management guards come from main.ts.
 const accessors=`return {autosave,trackedSave,canOpen:${canOpen},get busy(){return saveBusy;},get manualPending(){return typeof manualSavePending==='undefined'?false:manualSavePending;},set managing(value){managingSave=value;},replaceGeneration(){cityGeneration++;},set resolving(value){resolvingConflict=value;}};`;
 const compiled=ts.transpileModule(declaration+'\n'+source.slice(start,end)+'\n'+accessors,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const actual=new Function('scope','with(scope){'+compiled+'}')(scope);
 return {fixture,client,scope,actual,notices,feedback,calls,click:()=>listeners.get('click')(),
  get raw(){return serializeParkSession(scope.city,scope.parkRuntime,scope.city.market);},
  edit(){scope.city.lastEvent+=' synthetic edit';},
  replace(){scope.city=createCity(61026);scope.parkRuntime=createParkRuntime(scope.city);actual.replaceGeneration();actual.autosave.adoptLoaded();},
  warn(){let warned=false;windowListeners.get('beforeunload').at(-1)({preventDefault(){warned=true;}});return warned;},
  get authCalls(){return authCalls;},get confirms(){return confirms;},set confirm(value){confirmResult=value;},
  set authenticate(fn){authenticate=fn;},set beforeRequest(fn){beforeRequest=fn;},set afterResponse(fn){afterResponse=fn;},
  holdNextPost({lose=false,reject=false}={}){
   const started=deferred(),gate=deferred();let held=false;
   const hook=async call=>{if(call.method!=='POST'||held)return;held=true;started.release();await gate.promise;if(lose||reject)throw Object.assign(Error(lose?'synthetic-lost-ack':'synthetic-conflict'),reject?{status:409}:{});};
   if(reject)beforeRequest=hook;else afterResponse=hook;
   return{started:started.promise,release:gate.release};
  }
 };
}

// Durable original reproduction: supply an unmodified pre-fix main.ts snapshot.
// node --experimental-strip-types tests/manual-save-listener-fixture.mjs --reproduce-baseline /tmp/main-before-fix.ts
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 assert.equal(process.argv[2],'--reproduce-baseline');assert.ok(process.argv[3]);
 const h=await manualSaveFixture(readFileSync(process.argv[3],'utf8')),gate=h.holdNextPost();h.edit();
 const saving=h.actual.autosave.run();await gate.started;
 const before=h.fixture.active,cursor=h.fixture.writes.length;
 assert.equal(h.actual.busy,true);await h.click();gate.release();await saving;
 assert.equal(h.notices.includes(manualSuccess),false);assert.equal(h.scope.saveSuccessLabel,'บันทึกบนเซิร์ฟเวอร์แล้ว');
 assert.throws(()=>assertPanelSaveChain(before,h.fixture.active,h.fixture.writes.slice(cursor),h.raw,h.fixture.writes.slice(0,cursor)),/Native Save produces a newly acknowledged revision/);
 const reproduction={baselineRevision:before.revision,finalRevision:h.fixture.active.revision,newEvents:h.fixture.writes.length-cursor,savedBadge:true,manualCompletion:false};
 await h.click();assert.equal(h.fixture.active.revision,before.revision+1);assert.ok(h.notices.includes(manualSuccess));
 console.log(JSON.stringify({syntheticOnly:true,productionListener:true,reproduction,idleControl:{revision:h.fixture.active.revision,newEvents:h.fixture.writes.length-cursor,manualCompletion:true}},null,2));
}
