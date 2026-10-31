import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installTrafficSaveTrace} from './traffic-save-trace.mjs';
test('traffic diagnostics preserve timer/storage behavior and retain failed write evidence',()=>{
 class Memory { values=new Map<string,string>();fail=false;getItem(key:string){return this.values.get(key)??null;}setItem(key:string,value:string){if(this.fail)throw Error('quota');this.values.set(key,value);}removeItem(key:string){this.values.delete(key);}clear(){this.values.clear();} }
 const localStorage=new Memory(),sessionStorage=new Memory(),timers:any[]=[],handlers:Record<string,()=>void>={};
 const window:any={setInterval:(fn:any,delay:number,...args:any[])=>{timers.push({fn,delay,args});return timers.length;},addEventListener:(type:string,fn:()=>void)=>handlers[type]=fn};
 const context={window,localStorage,sessionStorage,Storage:Memory,performance:{now:()=>12},document:{visibilityState:'visible',addEventListener:window.addEventListener},Date,Error};
 vm.runInNewContext(`(${installTrafficSaveTrace.toString()})();`,context);
 let called=0;assert.equal(window.setInterval((value:number)=>{called+=value;},60000,3),1);assert.equal(timers[0].delay,60000);timers[0].fn(...timers[0].args);assert.equal(called,3);
 const other=()=>{};window.setInterval(other,1500);assert.equal(timers[1].fn,other);
 localStorage.setItem('citymanager.save.v7','first');localStorage.fail=true;assert.throws(()=>localStorage.setItem('citymanager.save.v7','second'),/quota/);localStorage.fail=false;
 sessionStorage.setItem('citymanager.save.v7','not-local');handlers.pagehide();
 const trace=window.__trafficSaveTrace;assert.equal(trace.length,5);assert.equal(trace[0].type,'autosave-interval-registered');assert.equal(trace[1].type,'autosave-interval-fired');assert.equal(trace[2].before,null);assert.equal(trace[2].after,'first');assert.equal(trace[2].ok,true);assert.equal(trace[3].ok,false);assert.equal(trace[3].after,'first');assert.equal(trace[4].type,'pagehide');assert.equal(trace[2].pageAgeMs,12);assert.ok(trace[2].stack);
});
test('controlled fixture holds exactly one native autosave callback and leaves unrelated timers/lifecycle active',()=>{
 class Memory {getItem(){return null;}setItem(){}removeItem(){}clear(){}}
 const timers:any[]=[],handlers:Record<string,()=>void>={};
 const window:any={setInterval:(fn:any,delay:number,...args:any[])=>{timers.push({fn,delay,args});return timers.length;},addEventListener:(type:string,fn:()=>void)=>handlers[type]=fn};
 vm.runInNewContext(`(${installTrafficSaveTrace.toString()})(true);`,{window,localStorage:new Memory(),Storage:Memory,performance:{now:()=>0},document:{visibilityState:'visible',addEventListener:window.addEventListener},Date,Error});
 let calls=0;window.setInterval((v:number)=>{calls+=v;},60000,2);
 const unrelated=()=>{};window.setInterval(unrelated,500);assert.equal(timers.length,1);assert.equal(timers[0].fn,unrelated);assert.equal(calls,0);
 assert.equal(window.__trafficAutosaveSchedule.registrations,1);handlers.pagehide();assert.equal(window.__trafficSaveTrace.at(-1).type,'pagehide');
 window.__trafficInvokeAutosave();assert.equal(calls,2);assert.equal(window.__trafficAutosaveSchedule.invocations,1);
 assert.throws(()=>window.__trafficInvokeAutosave(),/exactly one/);assert.throws(()=>window.setInterval(()=>{},60000),/Ambiguous/);
});
