import test from 'node:test';
import assert from 'node:assert/strict';
import {createContext,runInContext} from 'node:vm';
import {reachTouch,withStoredLoadCompletion} from './touch-reach.mjs';
function page(){
 const observers=new Set<any>();let text='โหลดวันที่ 0 แล้ว';
 const status={get textContent(){return text;}};
 const control={closest(){return null;},getBoundingClientRect(){return {width:100};}};
 const window:any={};const context=createContext({window,document:{querySelector(selector:string){return selector==='#status'?status:control;}},MutationObserver:class {callback:()=>void;constructor(callback:()=>void){this.callback=callback;}observe(){observers.add(this);}disconnect(){observers.delete(this);}}});
 return {window,observers,evaluate:async(expression:string)=>runInContext(expression,context),setStatus(value:string){text=value;for(const o of [...observers])o.callback();}};
}
test('shared native Load executes once and awaits fresh asynchronous terminal status for all stored actions',async()=>{
 for(const selector of ['#load','#load-legacy','#load-v2','#load-v3','#load-v4','#load-v5','#load-v6','#load-backup','#load-autosave-copy','#load-save-conflict']){
  const p=page();let clicked=0,applied=false;
  const button=async(s:string)=>{if(await reachTouch(p.evaluate,button,s))return;clicked++;setTimeout(()=>{applied=true;p.setStatus('โหลดวันที่ 65 แล้ว');},5);};
  await button(selector);assert.equal(clicked,1);assert.equal(applied,true);assert.equal(p.observers.size,0);assert.equal(p.window.__storedLoadObserver,undefined);
 }
});
test('expected rejection completes synchronization without pretending the city loaded',async()=>{
 const p=page();let rejected=false;
 await withStoredLoadCompletion(p.evaluate,async()=>{setTimeout(()=>{rejected=true;p.setStatus('โหลดไม่สำเร็จ: sidecar clock mismatch');},5);});
 assert.equal(rejected,true);assert.equal(p.observers.size,0);
});
test('stale success and unknown transient text cannot complete a new load',async()=>{
 for(const change of [false,true]){const p=page();await assert.rejects(withStoredLoadCompletion(p.evaluate,async()=>{if(change)p.setStatus('กำลังอ่านข้อมูล');},10),/did not reach a terminal result/);assert.equal(p.observers.size,0);}
});
test('native click error removes observer and reentrancy guard so the next real Load works',async()=>{
 const p=page();let fail=true,clicked=0;
 const button=async(s:string)=>{if(await reachTouch(p.evaluate,button,s))return;clicked++;if(fail)throw Error('native click failed');p.setStatus('โหลดวันที่ 2 แล้ว');};
 await assert.rejects(button('#load'),/native click failed/);assert.equal(p.observers.size,0);fail=false;await button('#load');assert.equal(clicked,2);assert.equal(p.observers.size,0);
});
