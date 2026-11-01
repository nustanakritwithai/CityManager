import test from 'node:test';import assert from 'node:assert/strict';import {registerHooks} from 'node:module';
import {createCity} from '../src/sim.ts';import {createParkRuntime} from '../src/park-runtime.ts';
// Exercise real rail management commands against the real runtime. WebGL and the already
// separately tested shared popup positioning are adapters, not simulated passengers.
registerHooks({load(url,context,next){
 if(url.endsWith('/rail/scene.ts'))return {format:'module',source:'export class SceneRail {diagnostics={invalidations:0};syncNetwork(){}invalidateInfrastructure(){this.diagnostics.invalidations++}destroy(){}}',shortCircuit:true};
 if(url.endsWith('/tool-menu.ts'))return {format:'module',source:'export function installToolMenu(anchor,menu){document.body.append(menu);let open=false;return {open(){open=true},close(){open=false},isOpen(){return open}}}',shortCircuit:true};
 if(url.endsWith('.css'))return {format:'module',source:'',shortCircuit:true};return next(url,context);
}});
const railModule=await import('../src/rail/management.ts'),{installRailManagement}=railModule;
class Element extends EventTarget {
 id='';textContent='';className='';type='';title='';hidden=false;disabled=false;open=false;children:Element[]=[];dataset:Record<string,string>={};onclick:(()=>void)|null=null;
 classList={add(){},remove(){},toggle(){}};setAttribute(){}append(...nodes:Element[]){this.children.push(...nodes);}replaceChildren(...nodes:Element[]){this.children=nodes;}focus(){}showModal(){this.open=true;}close(){this.open=false;}remove(){}
 click(){if(this.disabled)return;this.dispatchEvent(new Event('pointerdown'));this.onclick?.();this.dispatchEvent(new Event('click'));}
}
const find=(root:Element,predicate:(e:Element)=>boolean):Element|undefined=>predicate(root)?root:root.children.map(e=>find(e,predicate)).find(Boolean);
test('explicit stations, atomic track confirmation, service, cancellation and stale-city guard',()=>{
 const oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document'),oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
 const body=new Element(),dock=new Element(),canvas=new Element(),doc=new EventTarget();body.append(dock,canvas);
 Object.assign(doc,{body,createElement:()=>new Element(),querySelector:(s:string)=>s==='.tool-buttons'?dock:s==='#city-canvas'?canvas:null});
 Object.defineProperty(globalThis,'document',{configurable:true,value:doc});Object.defineProperty(globalThis,'window',{configurable:true,value:new EventTarget()});
 let city=createCity(61031,{starter:false}),runtime=createParkRuntime(city),changes=0;const messages:string[]=[];
 const view={cameraBlocked:false,abortGesture(){}} as any;
 const ui=installRailManagement({view,city:()=>city,runtime:()=>runtime,selectTool(){},changed(){changes++},status:m=>messages.push(m),enabled:true});
 const action=(key:string)=>{const button=find(body,e=>e.dataset.railAction===key);assert.ok(button,key);button.click();};
 const click=(id:string)=>{const button=find(body,e=>e.id===id);assert.ok(button,id);button.click();};
 try{
  action('station');ui.activate(288);click('rail-confirm-accept');assert.equal(runtime.rail,undefined,'Occupied road cannot become a station');assert.match(messages.at(-1)!,/ไม่มีถนนหรืออาคาร/);
  action('station');assert.equal(ui.activate(289),true);click('rail-confirm-cancel');assert.equal(runtime.rail,undefined);assert.equal(changes,0);
  action('station');ui.activate(289);click('rail-confirm-accept');assert.equal(runtime.rail!.snapshot.stations.length,1);
  action('station');ui.activate(292);click('rail-confirm-accept');assert.equal(runtime.rail!.snapshot.stations.length,2);
  action('manage');click('rail-configure-service');click('rail-confirm-accept');assert.equal(runtime.rail!.snapshot.service,null);assert.match(messages.at(-1)!,/เชื่อมราง/);
  action('add-track');ui.activate(289);ui.activate(292);click('rail-confirm-cancel');assert.equal(runtime.rail!.snapshot.graph.links.length,0);
  action('add-track');ui.activate(289);ui.activate(292);click('rail-confirm-accept');assert.equal(runtime.rail!.snapshot.graph.links.length,6);
  action('manage');click('rail-configure-service');click('rail-confirm-accept');assert.ok(runtime.rail!.snapshot.service);assert.equal(ui.isReserved(290),true);click('rail-model-accepting');assert.equal(runtime.rail!.snapshot.model!.accepting,false);assert.equal(runtime.rail!.snapshot.service!.snapshot.enabled,true,'Drain toggle does not pause the train or discard its queue');click('rail-model-accepting');assert.equal(runtime.rail!.snapshot.model!.accepting,true);
  const saved=JSON.stringify(runtime.rail!.snapshot);action('remove-track');ui.activate(289);ui.activate(290);
  city=createCity(61032,{starter:false});runtime=createParkRuntime(city);click('rail-confirm-accept');assert.equal(runtime.rail,undefined);assert.match(messages.at(-1)!,/สถานะเมืองเปลี่ยน/);assert.ok(saved.length>0);ui.sync();assert.equal((ui.diagnostics() as any).invalidations,1,'New city/runtime invalidates renderer even when infrastructure revisions collide');
 }finally{ui.destroy();if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else Reflect.deleteProperty(globalThis,'document');if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else Reflect.deleteProperty(globalThis,'window');}
});
test('player-facing rail positions, straight track preview and the place-panel card',()=>{
 const {cellLabel,straight}=railModule;
 assert.equal(cellLabel(315),'(4,14)','Column,row like the place panel, never the internal cell index');
 assert.deepEqual(straight(315,339),[315,339]);assert.deepEqual(straight(339,336),[339,338,337,336]);assert.deepEqual(straight(315,340),[315,340],'Diagonal picks keep only the two ends');
 const oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document'),oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
 const body=new Element(),dock=new Element(),canvas=new Element(),doc=new EventTarget();body.append(dock,canvas);
 Object.assign(doc,{body,createElement:()=>new Element(),querySelector:(s:string)=>s==='.tool-buttons'?dock:s==='#city-canvas'?canvas:null});
 Object.defineProperty(globalThis,'document',{configurable:true,value:doc});Object.defineProperty(globalThis,'window',{configurable:true,value:new EventTarget()});
 const city=createCity(61031,{starter:false}),runtime=createParkRuntime(city);let repaints=0;
 const ui=installRailManagement({view:{cameraBlocked:false,abortGesture(){}} as any,city:()=>city,runtime:()=>runtime,selectTool(){},changed(){},status(){},repaint(){repaints++},enabled:true});
 const action=(key:string)=>{const button=find(body,e=>e.dataset.railAction===key);assert.ok(button,key);button.click();};
 const click=(id:string)=>{const button=find(body,e=>e.id===id);assert.ok(button,id);button.click();};
 try{
  assert.equal(ui.preview(289),null,'No rail frames while the select tool is active');
  action('station');assert.deepEqual(ui.preview(289),{cells:[289],invalid:[]});assert.deepEqual(ui.preview(288)!.invalid,[288],'A road cell is framed as blocked');
  ui.activate(289);assert.deepEqual(ui.preview(null)!.cells,[289],'The open confirmation keeps its cell framed');assert.equal(repaints,1);
  click('rail-confirm-accept');assert.equal(ui.placeCard(289)!.title,'สถานีรถไฟ 1');assert.equal(ui.placeCard(300),null);
  action('station');ui.activate(292);click('rail-confirm-accept');
  action('add-track');ui.activate(289);assert.deepEqual(ui.preview(292)!.cells,[289,290,291,292],'Second tap previews the straight run');ui.activate(292);click('rail-confirm-accept');
  assert.equal(ui.placeCard(290)!.title,'รางรถไฟ');
 }finally{ui.destroy();if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else Reflect.deleteProperty(globalThis,'document');if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else Reflect.deleteProperty(globalThis,'window');}
});
