import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {createCity,step,commercialGrowthStatus} from '../src/sim.ts';
registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'',shortCircuit:true}:next(url,context);}});
const {renderCommercialProgression,renderAgriculture}=await import('../src/context-panels.ts');
class Element {
 children:Element[]=[];dataset:Record<string,string>={};className='';textContent='';classList={add(..._names:string[]){}};style={setProperty(_name:string,_value:string){}};
 setAttribute(_name:string,_value:string){}
 append(...children:Element[]){this.children.push(...children);}
}
const text=(node:Element):string=>[node.textContent,...node.children.map(text)].join(' ');
const find=(node:Element,key:string):Element|undefined=>node.dataset.contextMetric===key?node:node.children.map(n=>find(n,key)).find(Boolean);
test('one commercial panel shows both stock types and identical growth across historical tags',()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'document');Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>new Element()}});
 try{
  const city=createCity(61025);for(let day=0;day<60;day++)step(city);
  const firm=city.firms.find(f=>f.zone==='C')!;assert.ok(firm);const building=city.buildings.find(b=>b.id===firm.building)!;
  for(const level of [1,3,4,6,7,9]){
   building.level=level;let prior:string|undefined;
   for(const historical of ['market','retail'] as const){
    firm.commercialKind=historical;const before=JSON.stringify(city),status=commercialGrowthStatus(city,firm);
    const panel=renderCommercialProgression(city,firm) as unknown as Element,body=text(panel);
    assert.match(body,new RegExp(`ระดับ ${level}/9`));assert.match(body,/ขายพืชผลและสินค้าสำเร็จรูปในกิจการเดียว/);assert.match(body,/ไม่ตัดสินค้าเดิมทิ้ง/);
    assert.match(body,level<=3?/ตลาด/:level<=6?/อาคารพาณิชย์/:/Big Mall/);
    if(level===9)assert.match(body,/ถึงระดับสูงสุดแล้ว/);else for(const reason of status.reasons)assert.ok(body.includes(reason),reason);
    if(prior!==undefined)assert.equal(body,prior,'historical tag is not a separate current business');prior=body;
    const stock=renderAgriculture(city,building,{...firm,owner:undefined},status.workers)[0] as unknown as Element;
    assert.equal(find(stock,'crop-stock')?.dataset.value,String(firm.cropInventory));
    assert.equal(find(stock,'crop-stock')?.dataset.capacity,'48');
    assert.equal(JSON.stringify(city),before);
   }
  }
 }finally{if(descriptor)Object.defineProperty(globalThis,'document',descriptor);else Reflect.deleteProperty(globalThis,'document');}
});
