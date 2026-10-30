import test from 'node:test';
import assert from 'node:assert/strict';
import {createContext,runInContext} from 'node:vm';
import {cdpCommandError,isNavigationContextLoss,navigateDocument,waitForNewDocument,documentIdentityScript} from './active-local-save-navigation.mjs';
const url='http://127.0.0.1:4191/CityManager/';
function clock(){let time=0;return {now:()=>time,sleep:async()=>{time+=100;}};}
function lost(){return cdpCommandError({code:-32000,message:'Inspected target navigated or closed'},'Runtime.evaluate','expected reload command 7');}
test('readiness rejects old document even when URL and application are ready, then requires load completion',async()=>{
 const context:any=createContext({window:{__saveHarnessDocument:'old',cityManager:{}},location:{href:url},document:{readyState:'complete'}});
 let polls=0;
 await waitForNewDocument({previous:'old',url,ready:'!!window.cityManager',...clock(),evaluate:async(expression:string)=>{
  polls++;if(polls===2){context.window.__saveHarnessDocument='new';context.document.readyState='loading';}
  if(polls===3){context.document.readyState='complete';context.location.href='about:blank';}
  if(polls===4)context.location.href=url;
  return runInContext(expression,context);
 }});assert.equal(polls,4);
});
test('document token is generated for every new document without depending on application state',()=>{
 const c:any=createContext({window:{},crypto:{randomUUID:()=> 'identity'}});runInContext(documentIdentityScript,c);assert.equal(c.window.__saveHarnessDocument,'identity');
});
test('only expected navigation read polling retries context loss, bounded by original timeout',async()=>{
 let polls=0;await waitForNewDocument({previous:'old',url,...clock(),evaluate:async()=>{if(++polls===1)throw lost();return true;}});assert.equal(polls,2);
 polls=0;await assert.rejects(waitForNewDocument({previous:'old',url,timeout:300,...clock(),evaluate:async()=>{polls++;throw lost();}}),/new-document readiness timeout/);assert.equal(polls,3);
});
test('unknown CDP errors and application exceptions are not retried',async()=>{
 for(const error of [cdpCommandError({code:-32000,message:'unexpected backend error'},'Runtime.evaluate','read'),new Error('application assertion'),cdpCommandError({code:-1,message:'Inspected target navigated or closed'},'Runtime.evaluate','read')]){
  let polls=0;await assert.rejects(waitForNewDocument({previous:'old',url,...clock(),evaluate:async()=>{polls++;throw error;}}),e=>e===error);assert.equal(polls,1);
 }
});
test('navigate and literal reload execute once and gate subsequent fixture mutations on new document',async()=>{
 for(const reload of [false,true]){const calls:any[]=[];let polls=0,mutation=0;
  await navigateDocument({send:async(method:string,params:any)=>{calls.push({method,params});return {};},evaluate:async(expression:string)=>{if(expression==='window.__saveHarnessDocument')return 'old';if(++polls===1)throw lost();return polls>=3;},url,reload,...clock()});mutation++;
  assert.deepEqual(calls,[{method:reload?'Page.reload':'Page.navigate',params:reload?{}:{url}}]);assert.equal(polls,3);assert.equal(mutation,1);
 }
});
test('navigation command or pre-navigation identity errors are surfaced once, never replayed',async()=>{
 for(const before of [true,false]){let commands=0,reads=0;
  await assert.rejects(navigateDocument({send:async()=>{commands++;throw lost();},evaluate:async()=>{reads++;if(before)throw lost();return 'old';},url,...clock()}),/Inspected target/);
  assert.equal(commands,before?0:1);assert.equal(reads,1);
 }
});
test('CDP errors retain method stage and raw protocol code without fixture content',()=>{
 const e=lost();assert.equal(e.code,-32000);assert.equal(e.method,'Runtime.evaluate');assert.equal(e.stage,'expected reload command 7');assert.match(e.message,/Runtime.evaluate.*expected reload command 7/);assert.equal(isNavigationContextLoss(e),true);
});
test('failed navigation never enters readiness or permits subsequent fixture action',async()=>{
 let reads=0,mutation=0;await assert.rejects((async()=>{await navigateDocument({send:async()=>({errorText:'net::ERR_CONNECTION_REFUSED'}),evaluate:async()=>{reads++;return 'old';},url,...clock()});mutation++;})(),/navigation failed/);assert.equal(reads,1);assert.equal(mutation,0);
});
