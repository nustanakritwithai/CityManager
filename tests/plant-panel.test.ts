import test from 'node:test';
import assert from 'node:assert/strict';
import { access, buildPlant, createCity, serialize, upgradePlant } from '../src/sim.ts';
import { installPlantPanel } from '../src/plant-panel.ts';
class Element {
 children: Element[]=[]; textContent=''; hidden=false; disabled=false; id=''; type=''; title=''; attrs: Record<string,string>={}; listeners:Record<string,(e:any)=>void>={};
 append(...items:Element[]){this.children.push(...items);} setAttribute(k:string,v:string){this.attrs[k]=v;}
 addEventListener(k:string,f:(e:any)=>void){this.listeners[k]=f;}
}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
test('plant panel quotes real price and upkeep, guards repeated input, follows selection and hides safely', async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>new Element()}});
 try {
  const c=createCity(61025), cell=c.cells.findIndex((x,i)=>!x.road&&x.building===null&&access(c,i));buildPlant(c,cell,'water');const p=c.plants[0],host=new Element();let calls=0;
  const panel=installPlantPanel(host as unknown as HTMLElement,(city,id,level)=>{calls++;const result=upgradePlant(city,id,level);panel.update(city,p);panel.showResult(result);});
  const button=host.children.find(e=>e.id==='upgrade-plant')!,quote=host.children.find(e=>e.id==='plant-upgrade-quote')!;
  const original=serialize(c);panel.update(c,p);assert.equal(serialize(c),original);assert.equal(host.hidden,false);
  assert.match(button.textContent,/ระดับ 2.*1,800/);assert.match(quote.textContent,/40 → 80.*60.*90/);
  assert.match(button.attrs['aria-describedby'],/plant-upgrade-quote plant-upgrade-reserve plant-feedback/);
  button.listeners.click({detail:0});button.listeners.click({detail:0});button.listeners.click({detail:2});assert.equal(calls,1);assert.equal(p.level,2);
  let prevented=false;button.listeners.keydown({repeat:true,key:'Enter',preventDefault(){prevented=true;}});assert.equal(prevented,true);
  await sleep(630);assert.equal(button.disabled,false);button.listeners.click({detail:1});assert.equal(p.level,3);assert.equal(calls,2);
  await sleep(630);assert.equal(button.disabled,true);assert.equal(button.textContent,'ถึงระดับสูงสุดแล้ว');
  panel.update(c,undefined);assert.equal(host.hidden,true);button.listeners.click({detail:0});assert.equal(calls,2);
  const other=createCity(9);panel.update(other,undefined);assert.equal(host.children.at(-1)!.textContent,'');
 } finally {if(descriptor)Object.defineProperty(globalThis,'document',descriptor);else Reflect.deleteProperty(globalThis,'document');}
});
test('poor and disconnected plant quotes expose disabled reason without mutation',()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'document');Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>new Element()}});
 try {
  const c=createCity(61025),cell=c.cells.findIndex((x,i)=>!x.road&&x.building===null&&access(c,i));buildPlant(c,cell,'power');const host=new Element(),panel=installPlantPanel(host as unknown as HTMLElement,()=>assert.fail());
  c.accounts.treasury=0;const before=JSON.stringify(c);panel.update(c,c.plants[0]);assert.equal(JSON.stringify(c),before);
  const button=host.children.find(e=>e.id==='upgrade-plant')!;assert.equal(button.disabled,true);assert.match(button.title,/เงินคลัง/);
  c.accounts.treasury=500000;for(const x of c.cells)x.road=false;panel.update(c,c.plants[0]);assert.equal(button.disabled,true);assert.match(button.title,/ถนน/);
 } finally {if(descriptor)Object.defineProperty(globalThis,'document',descriptor);else Reflect.deleteProperty(globalThis,'document');}
});
