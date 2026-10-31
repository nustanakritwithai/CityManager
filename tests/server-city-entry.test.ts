import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {legacySaveOwner} from '../src/city-save-auth.ts';
const owner='00000000-0000-4000-8000-000000000001';
test('legacy auth identity is read-only and preserved independently of market enablement',()=>{
 assert.equal(legacySaveOwner({getItem:()=>JSON.stringify({guestId:owner})}),owner);
 assert.equal(legacySaveOwner({getItem:()=>null}),null);
 assert.equal(legacySaveOwner({getItem:key=>key==='citymanager.save.v7'?JSON.stringify({market:{guestId:owner}}):null}),null);
 assert.throws(()=>legacySaveOwner({getItem:()=>'{'}));
 assert.throws(()=>legacySaveOwner({getItem:()=>JSON.stringify({guestId:'wrong'})}));
});
test('production entry and save integration has no browser city writer or offline escape',()=>{
 const main=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
 for(const forbidden of ['autoWipeOnce','restoreStartupCity','saveLocalCitySession','saveRecoveryCopy','saveActiveLocalSave','saveStoredCity','saveGuard','rememberResumeChoice','deleteOldSaves'])assert.ok(!main.includes(forbidden),forbidden);
 assert.match(main,/await serverSave.save\(raw/);
 assert.match(main,/await serverSave.retry\(\)/);
 assert.match(main,/market-disabled-server-save-required/);
 const gate=readFileSync(new URL('../src/server-city-entry.ts',import.meta.url),'utf8');
 assert.ok(!gate.includes('เล่นออฟไลน์'));
 assert.ok(gate.indexOf('await client.load()')<gate.indexOf('await client.create('));
 assert.ok(!gate.includes('client.archive('));
 assert.ok(!gate.includes('inventoryLegacyCities'));
 assert.ok(!readFileSync(new URL('../src/city-save-auth.ts',import.meta.url),'utf8').includes('citymanager.save.'));
 assert.ok(!readFileSync(new URL('../src/city-save-auth.ts',import.meta.url),'utf8').includes('/v1/auth/guest'));
});
test('cookie save auth preserves CSRF and server conflict status without enabling trading',async()=>{
 const {createCitySaveAuth}=await import('../src/city-save-auth.ts');
 const originalFetch=globalThis.fetch;
 Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'https://example.test'}});
 Object.defineProperty(globalThis,'document',{configurable:true,value:{cookie:'other=x; cm_csrf=expected-csrf'}});
 const calls:{url:string;init?:RequestInit}[]=[];
 globalThis.fetch=async(input,init)=>{calls.push({url:String(input),init});return new Response(JSON.stringify({guest_id:owner}),{status:200});};
 try{
  assert.throws(()=>createCitySaveAuth('https://unapproved.example/citymanager-api'),/save-endpoint-not-allowed/);
  const auth=createCitySaveAuth('/citymanager-api');assert.equal(await auth.connect(),owner);
  await auth.request('/v1/city-save',{method:'POST',body:'{}'});
  assert.equal(calls[1].url,'/citymanager-api/v1/city-save');assert.equal(calls[1].init?.credentials,'include');
  assert.equal(new Headers(calls[1].init?.headers).get('x-csrf-token'),'expected-csrf');
  globalThis.fetch=async()=>new Response(JSON.stringify({error:{code:'revision-conflict'}}),{status:409});
  await assert.rejects(auth.request('/v1/city-save',{method:'POST'}),(error:any)=>error.status===409&&error.message==='revision-conflict');
  const requests:string[]=[];globalThis.fetch=async input=>{requests.push(String(input));return new Response('{}',{status:401});};
  await assert.rejects(createCitySaveAuth().connect(),(error:any)=>error.status===401);
  assert.deepEqual(requests,['/citymanager-api/v1/me']);
  globalThis.fetch=async()=>new Response(JSON.stringify({guest_id:'00000000-0000-4000-8000-000000000002'}),{status:200});
  await assert.rejects(auth.connect(owner),/save-owner-mismatch/);
 }finally{globalThis.fetch=originalFetch;delete (globalThis as any).location;delete (globalThis as any).document;}
});
test('expired Pages token reconnects only the same existing Guest and stays memory-only',async()=>{
 const {createCitySaveAuth}=await import('../src/city-save-auth.ts');
 const {pagesSession,PAGES_ORIGIN}=await import('../src/pages-auth.ts');
 const originalFetch=globalThis.fetch;const methods={bearer:pagesSession.bearer,connect:pagesSession.connect,activate:pagesSession.activate,prepare:pagesSession.prepare,clear:pagesSession.clear};
 Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:PAGES_ORIGIN}});
 Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('browser storage prohibited');}});
 let token:string|null=null;const expectedGuests:(string|null)[]=[];
 pagesSession.clear=()=>{token=null;};pagesSession.bearer=()=>token;pagesSession.connect=async expected=>{expectedGuests.push(expected);token='memory-token';return owner;};pagesSession.activate=guest=>assert.equal(guest,owner);pagesSession.prepare=async()=>{};
 globalThis.fetch=async(_input,init)=>{assert.equal(init?.credentials,'omit');assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer memory-token');return new Response(JSON.stringify({guest_id:owner}),{status:200});};
 try{const auth=createCitySaveAuth();assert.equal(await auth.connect(),owner);assert.deepEqual(expectedGuests,[null]);token=null;assert.equal(await auth.connect(),owner);assert.deepEqual(expectedGuests,[null,owner]);const successFetch=globalThis.fetch;globalThis.fetch=async()=>new Response('{}',{status:401});await assert.rejects(auth.request('/v1/city-save'),(error:any)=>error.status===401);assert.equal(token,null);globalThis.fetch=successFetch;await auth.connect();assert.deepEqual(expectedGuests,[null,owner,owner]);}
 finally{Object.assign(pagesSession,methods);globalThis.fetch=originalFetch;delete (globalThis as any).location;delete (globalThis as any).localStorage;}
});
