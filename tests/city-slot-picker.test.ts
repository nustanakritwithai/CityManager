import test from 'node:test';import assert from 'node:assert/strict';
import {createCitySlotPicker,validateSlotList,type SlotEntry} from '../src/city-slot-picker.ts';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
class Element {
 textContent:string|null=null;type='';disabled=false;children:Element[]=[];listeners:Record<string,()=>void>={};
 setAttribute(_k:string,_v:string){} append(...nodes:Element[]){this.children.push(...nodes);}replaceChildren(...nodes:Element[]){this.children=[...nodes];}
 addEventListener(name:string,callback:()=>void){this.listeners[name]=callback;} click(){if(!this.disabled)this.listeners.click?.();}
}
const buttons=(root:Element,label:string):Element[]=>[...(root.textContent===label?[root]:[]),...root.children.flatMap(x=>buttons(x,label))];
const pause=()=>new Promise(r=>setTimeout(r,0));
const item=(slot:number,deleted=false):SlotEntry=>({cityId:id(slot),slot,revision:1,deleted,metadata:{name:`City ${slot}`,population:20,tick:9}});
test('reject duplicate or malformed server entries',()=>{assert.throws(()=>validateSlotList([item(1),{...item(2),slot:1}]));assert.throws(()=>validateSlotList([{...item(1),revision:0}]));assert.equal(validateSlotList([item(1),item(2,true)]).length,2);});
test('picker shows only retry on failed list, and delete requires confirmation',async()=>{
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>new Element()}});
 const root=new Element();let rows=[item(1),item(2,true)],fail=true,removed=0,confirmation=false;
 const picker=createCitySlotPicker(root as unknown as HTMLElement,{list:async()=>{if(fail)throw Error('offline');return rows;},play:async()=>{},create:async()=>{},importLocal:async()=>{},remove:async()=>{removed++;rows=[];},restore:async()=>{}},()=>confirmation);
 await picker.open();assert.equal(buttons(root,'สร้างเมืองใหม่').length,0);assert.equal(buttons(root,'ลองเชื่อมต่ออีกครั้ง').length,1);
 fail=false;await picker.refresh();assert.equal(buttons(root,'เล่น').length,1);assert.equal(buttons(root,'สร้างเมืองใหม่').length,2);assert.equal(buttons(root,'กู้คืนในช่อง 2').length,1);
 buttons(root,'ลบ')[0].click();await pause();assert.equal(removed,0);
 confirmation=true;buttons(root,'ลบ')[0].click();await pause();assert.equal(removed,1);assert.equal(buttons(root,'สร้างเมืองใหม่').length,3);
});
