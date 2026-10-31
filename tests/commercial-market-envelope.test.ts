import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deserialize,serialize} from '../src/sim.ts';
import {embeddedMarketJournal,MarketClient,marketJournalForTest} from '../src/market-client.ts';
import {requireGuestEntry} from '../src/entry-gate.ts';
import {SAVE_KEY} from '../src/save-storage.ts';
const guest='00000000-0000-4000-8000-000000000003',other='00000000-0000-4000-8000-000000000006';
function fixture(version:24|25){
  const c=deserialize(readFileSync(new URL('./fixtures/retail-v15.json',import.meta.url),'utf8'));
  const journal=marketJournalForTest(null);journal.guestId=guest;journal.seq='4';
  journal.operations.push({opId:'00000000-0000-4000-8000-000000000002',guestId:guest,cityId:journal.cityId,kind:'buy',payload:{listing_id:'test',quantity:1},state:'pending',createdAt:'2026-10-31T00:00:00.000Z'});
  const envelope=JSON.parse(serialize(c,journal));
  if(version===24){envelope.version=24;envelope.rulesVersion='chain-19';delete envelope.commercialBaseVersion;delete envelope.commercialUnifiedStartTick;delete envelope.commercialUnifiedBaseline;}
  return{raw:JSON.stringify(envelope),journal};
}

test('shared extractor validates v24/v25 and preserves pending journal without a write or identity change',()=>{
  for(const version of[24,25]as const){const{raw,journal}=fixture(version);assert.deepEqual(embeddedMarketJournal(raw),journal);}
  assert.equal(embeddedMarketJournal(null),null);
  for(const mutate of[(e:any)=>{e.version=99;},(e:any)=>{e.rulesVersion='invalid';},(e:any)=>{e.market.operations=[{kind:'unknown'}];},(e:any)=>{e.market.guestId=null;},(e:any)=>{e.accounts.treasury++;}]){
    const e=JSON.parse(fixture(25).raw);mutate(e);assert.throws(()=>embeddedMarketJournal(JSON.stringify(e)));
  }
  assert.throws(()=>embeddedMarketJournal('{broken'));
  assert.throws(()=>embeddedMarketJournal(JSON.stringify({version:11})),/recovery/);
});

test('Pages expected guest recognizes both wrappers and rejects standalone guest mismatch before connection',()=>{
  const old=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  try{for(const version of[24,25]as const){const{raw}=fixture(version);let writes=0;
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>k===SAVE_KEY?raw:null,setItem:()=>{writes++;}}});
    const c=deserialize(raw),client=new MarketClient(()=>c);
    const expected=()=>Reflect.get(client,'expectedPagesGuest').call(client);
    assert.equal(expected(),guest);client.guestId=other;assert.throws(expected,/mismatch/);assert.equal(writes,0);
  }}finally{if(old)Object.defineProperty(globalThis,'localStorage',old);else Reflect.deleteProperty(globalThis,'localStorage');}
});

test('entry gate never creates replacement guest for v24/v25 pending identity or corrupt/unknown wrappers',async()=>{
  class Element{children:Element[]=[];parent?:Element;inert=false;disabled=false;handler?:()=>void;textContent='';className='';id='';type='';setAttribute(){}focus(){}append(...nodes:Element[]){for(const n of nodes){n.parent=this;this.children.push(n);}}addEventListener(_n:string,f:()=>void){this.handler=f;}remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}contains(n:Element){return this.children.includes(n);}}
  const names=['document','HTMLElement','localStorage']as const,old=names.map(n=>Object.getOwnPropertyDescriptor(globalThis,n));
  try{for(const mode of['v24','v25','corrupt','unknown','mismatch']as const){let{raw}=fixture(mode==='v24'?24:25);if(mode==='corrupt'||mode==='unknown'){const e=JSON.parse(raw);if(mode==='corrupt')e.market.operations=[{bad:true}];else e.version=99;raw=JSON.stringify(e);}
    const body=new Element(),game=new Element();body.append(game);let calls=0,created=0,started=0,writes=0;
    Object.defineProperty(globalThis,'HTMLElement',{configurable:true,value:Element});Object.defineProperty(globalThis,'document',{configurable:true,value:{body,createElement:()=>new Element()}});
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>k===SAVE_KEY?raw:null,setItem:()=>{writes++;}}});
    const client={enabled:true,usesPagesAuth:false,guestId:null,journal:marketJournalForTest(null),checkSession:async()=>{calls++;return mode==='mismatch'?{guest_id:other}:null;},createGuest:async()=>{created++;throw Error('must not create');},reconcileSession:async()=>{throw Error('must not reconcile foreign identity');}}as unknown as MarketClient;
    await requireGuestEntry(client,()=>{started++;});body.children[1].children[0].children[3].handler!();await new Promise(r=>setTimeout(r,0));
    assert.equal(created,0,mode);assert.equal(started,0,mode);assert.equal(writes,0,mode);assert.equal(game.inert,true,mode);if(mode==='corrupt'||mode==='unknown')assert.equal(calls,0);
  }}finally{names.forEach((n,i)=>old[i]?Object.defineProperty(globalThis,n,old[i]!):Reflect.deleteProperty(globalThis,n));}
});
