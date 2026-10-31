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
function fixture(options:{activeRaw?:string|null;issues?:string[];conflict?:boolean;deleted?:boolean}={}){
 const body=new Element(),game=new Element();body.append(game);
 Object.defineProperty(globalThis,'HTMLElement',{configurable:true,value:Element});
 Object.defineProperty(globalThis,'document',{configurable:true,value:{body,createElement:()=>new Element()}});
 Object.defineProperty(globalThis,'window',{configurable:true,value:{confirm:()=>true}});
 const city=createCity(61025),raw=serializeParkSession(city,createParkRuntime(city));
 const archives:string[]=[],calls:string[]=[];let activeRaw=options.activeRaw===undefined?raw:options.activeRaw;
 const client:any={pending:false,conflict:options.conflict??false,
 load:async()=>{calls.push('load');return options.deleted?{deleted:true,owner,cityId:'22222222-2222-4222-8222-222222222222',revision:5,archiveHash:'a'.repeat(64)}:activeRaw===null?null:{raw:activeRaw};},
 archive:async(input:any)=>{archives.push(input.raw);calls.push('archive');},
 create:async(value:string)=>{calls.push('create');return {raw:value};},
 retry:async()=>{calls.push('retry');return {raw};},
 discardConflictedAttempt:()=>{calls.push('discard');client.conflict=false;client.pending=false;}};
 const auth:any={connect:async()=>owner,prepare:async()=>{},request:async()=>{}};
 const storage:any={length:0,key:()=>null,getItem:()=>null};
 let inventory:any={candidates:[{raw,sources:['legacy:primary'],tick:0}],issues:options.issues??[]};
 const promise=requireServerCityEntry(()=>raw,undefined,{auth,storage,createClient:()=>client,inventory:async()=>inventory});
 const overlay=body.children[1],card=overlay.children[0],button=card.children[3],status=card.children[4];
 return {promise,overlay,game,button,status,calls,archives,raw,client,setActive:(value:string)=>{activeRaw=value;},setInventory:(value:any)=>{inventory=value;}};
}
async function ready(){await Promise.resolve();await Promise.resolve();await Promise.resolve();}
function cleanup(){for(const key of ['HTMLElement','document','window'])delete (globalThis as any)[key];}
test('semantic invalid server city keeps game inert and permits retry',async()=>{const f=fixture({activeRaw:'{}'});try{await ready();await f.button.onclick!();assert.equal(f.overlay.removed,false);assert.equal(f.game.inert,true);assert.match(f.status.textContent,/ยังเข้าเมืองไม่ได้/);f.setActive(f.raw);await f.button.onclick!();assert.equal((await f.promise).raw,f.raw);assert.equal(f.game.inert,false);}finally{cleanup();}});
test('existing server city opens with visible incomplete migration evidence, never creates fallback',async()=>{const f=fixture({issues:['idb-unavailable']});try{await ready();await f.button.onclick!();const result=await f.promise;assert.deepEqual(result.migrationIssues,['idb-unavailable']);assert.deepEqual(f.archives,[f.raw]);assert.ok(!f.calls.includes('create'));}finally{cleanup();}});
test('incomplete inventory without authoritative server city blocks fresh creation',async()=>{const f=fixture({activeRaw:null,issues:['idb-unavailable']});try{await ready();await f.button.onclick!();assert.equal(f.overlay.removed,false);assert.ok(!f.calls.includes('create'));assert.match(f.status.textContent,/ยังตรวจเซฟเดิมไม่ครบ/);}finally{cleanup();}});
test('multiple old cities require explicit choice rather than selecting highest tick',async()=>{const f=fixture({activeRaw:null});try{await ready();f.setInventory({candidates:[{raw:f.raw,sources:['a'],tick:0},{raw:f.raw+' ',sources:['b'],tick:999}],issues:[]});await f.button.onclick!();assert.equal(f.overlay.removed,false);assert.ok(!f.calls.includes('create'));const select=f.overlay.children[0].children[2];assert.equal(select.hidden,false);select.value=f.raw;await f.button.onclick!();assert.equal((await f.promise).raw,f.raw);}finally{cleanup();}});
test('cancelled create-conflict resolution leaves pending state untouched',async()=>{const f=fixture({conflict:true});try{await ready();(globalThis as any).window.confirm=()=>false;await f.button.onclick!();assert.equal(f.overlay.removed,false);assert.deepEqual(f.calls,[]);assert.equal(f.client.conflict,true);}finally{cleanup();}});

test('deleted server head never reactivates retained legacy city and requires explicit fresh start',async()=>{
 const f=fixture({deleted:true});try{await ready();await f.button.onclick!();assert.equal(f.overlay.removed,false);assert.ok(!f.calls.includes('create'));assert.equal(f.button.textContent,'เริ่มเมืองใหม่');
 await f.button.onclick!();const result=await f.promise;assert.notEqual(result.raw,f.raw);const city=JSON.parse(result.raw);assert.equal(city.market.guestId,owner);assert.notEqual(city.market.cityId,'22222222-2222-4222-8222-222222222222');assert.deepEqual(city.market.operations,[]);assert.equal(f.calls.filter(c=>c==='create').length,1);
 }finally{cleanup();}
});
