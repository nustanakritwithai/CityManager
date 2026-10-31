import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requireServerCityEntry} from '../src/server-city-entry.ts';
import {createCity} from '../src/sim.ts';
import {createParkRuntime,serializeParkSession} from '../src/park-runtime.ts';
const owner='00000000-0000-4000-8000-000000000001';
class Element {
 children:Element[]=[];inert=false;removed=false;hidden=false;disabled=false;value='';textContent='';className='';onclick:(()=>Promise<void>)|null=null;
 append(...nodes:Element[]){this.children.push(...nodes);}setAttribute(){}replaceChildren(){this.children=[];}remove(){this.removed=true;}
}
function fixture(options:{activeRaw?:string|null;conflict?:boolean;deleted?:boolean}={}){
 const body=new Element(),game=new Element();body.append(game);
 Object.defineProperty(globalThis,'HTMLElement',{configurable:true,value:Element});
 Object.defineProperty(globalThis,'document',{configurable:true,value:{body,createElement:()=>new Element()}});
 Object.defineProperty(globalThis,'window',{configurable:true,value:{confirm:()=>{throw Error('unexpected local candidate choice');}}});
 const city=createCity(61025),raw=serializeParkSession(city,createParkRuntime(city));
 const calls:string[]=[],reads:string[]=[];let activeRaw=options.activeRaw===undefined?raw:options.activeRaw;
 let deletedHead:any=options.deleted?{deleted:true,owner,cityId:'22222222-2222-4222-8222-222222222222',revision:5,archiveHash:'a'.repeat(64)}:null;
 const client:any={pending:false,conflict:options.conflict??false,
 load:async()=>{calls.push('load');return deletedHead??(activeRaw===null?null:{raw:activeRaw});},
 archive:async()=>{throw Error('browser-only save must not be archived');},
 create:async(value:string)=>{calls.push('create');activeRaw=value;deletedHead=null;return {raw:value};},
 retry:async()=>{calls.push('retry');client.pending=false;activeRaw=raw;return {raw};},
 discardConflictedAttempt:()=>{calls.push('discard');client.conflict=false;client.pending=false;}};
 const auth:any={connect:async()=>owner,prepare:async()=>{},request:async()=>{}};
 const storage:any={get length(){throw Error('obsolete city inventory forbidden');},key:()=>{throw Error('obsolete city inventory forbidden');},getItem:(key:string)=>{reads.push(key);if(key!=='citymanager.market.v10')throw Error('obsolete city bytes forbidden');return null;}};
 const promise=requireServerCityEntry(()=>{throw Error('browser fallback forbidden');},undefined,{auth,storage,createClient:()=>client});
 const overlay=body.children[1],card=overlay.children[0],button=card.children[2],status=card.children[3];
 return {promise,overlay,game,button,status,calls,reads,raw,client,setActive:(value:string)=>{activeRaw=value;deletedHead=null;}};
}
async function ready(){await Promise.resolve();await Promise.resolve();}
function cleanup(){for(const key of ['HTMLElement','document','window'])delete (globalThis as any)[key];}
test('semantic invalid server city keeps game inert and permits retry',async()=>{const f=fixture({activeRaw:'{}'});try{await ready();await f.button.onclick!();assert.equal(f.overlay.removed,false);assert.equal(f.game.inert,true);assert.match(f.status.textContent,/ยังเข้าเมืองไม่ได้/);f.setActive(f.raw);await f.button.onclick!();assert.equal((await f.promise).raw,f.raw);assert.equal(f.game.inert,false);}finally{cleanup();}});
test('server city opens without reading, archiving or being blocked by obsolete local city data',async()=>{const f=fixture();try{await ready();await f.button.onclick!();const result=await f.promise;assert.equal(result.raw,f.raw);assert.deepEqual(result.migrationIssues,[]);assert.deepEqual(f.calls,['load']);assert.deepEqual(f.reads,['citymanager.market.v10']);}finally{cleanup();}});
test('missing server head never imports browser city and requires a second explicit fresh creation click',async()=>{const f=fixture({activeRaw:null});try{await ready();await f.button.onclick!();assert.equal(f.overlay.removed,false);assert.deepEqual(f.calls,['load']);assert.equal(f.button.textContent,'เริ่มเมืองใหม่');await f.button.onclick!();const result=await f.promise;assert.equal(JSON.parse(result.raw).market.guestId,owner);assert.deepEqual(f.calls,['load','load','create','load']);}finally{cleanup();}});
test('server load failure does not create or use a browser fallback',async()=>{const f=fixture({activeRaw:null});try{await ready();f.client.load=async()=>{throw Error('unavailable');};await f.button.onclick!();assert.equal(f.overlay.removed,false);assert.ok(!f.calls.includes('create'));assert.match(f.status.textContent,/unavailable/);}finally{cleanup();}});
test('rejected create intent resolves only by reading authoritative server state',async()=>{const f=fixture({conflict:true});try{await ready();await f.button.onclick!();assert.equal((await f.promise).raw,f.raw);assert.deepEqual(f.calls,['discard','load']);}finally{cleanup();}});
test('uncertain create retries original intent then reads the authoritative head before entry',async()=>{const f=fixture({activeRaw:null});try{await ready();f.client.pending=true;await f.button.onclick!();assert.equal((await f.promise).raw,f.raw);assert.deepEqual(f.calls,['retry','load']);}finally{cleanup();}});
test('deleted head never reactivates legacy city and requires explicit new identity',async()=>{const f=fixture({deleted:true});try{await ready();await f.button.onclick!();assert.equal(f.overlay.removed,false);assert.ok(!f.calls.includes('create'));assert.equal(f.button.textContent,'เริ่มเมืองใหม่');await f.button.onclick!();const result=await f.promise;const city=JSON.parse(result.raw);assert.equal(city.market.guestId,owner);assert.notEqual(city.market.cityId,'22222222-2222-4222-8222-222222222222');assert.deepEqual(city.market.operations,[]);assert.equal(f.calls.filter(c=>c==='create').length,1);}finally{cleanup();}});
