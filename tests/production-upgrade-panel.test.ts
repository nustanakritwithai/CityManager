import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, productionUpgradeStatus, type Firm } from '../src/sim.ts';
import { factoryCropCapacity } from '../src/factory-levels.ts';
import { farmStockCapacity } from '../src/agriculture.ts';
import { registerHooks } from 'node:module';
registerHooks({ load(url, context, nextLoad) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : nextLoad(url, context); } });
const { renderProductionProgression } = await import('../src/context-panels.ts');
class Element {
  children: Element[] = []; dataset: Record<string,string> = {}; textContent = ''; className='';
  classList={add: (..._names: string[])=>undefined};
  append(...nodes: Element[]) { this.children.push(...nodes); }
}
const text = (e: Element): string => [e.textContent, ...e.children.map(text)].join('\n');
function fixture() { const c=createCity(61025); for(let i=0;i<60;i++)step(c); return c; }

test('production preview follows every supported level, exposes real capacities, and never changes state', () => {
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>new Element()}});
  try {
    const c=fixture();
    for(const zone of ['I','F'] as const) {
      const f=c.firms.find(f=>f.zone===zone)!; assert.ok(f);
      const b=c.buildings.find(b=>b.id===f.building)!; const max=zone==='I'?9:6;
      for(let level=1;level<=max;level++) {
        b.level=level; const before=JSON.stringify(c); const s=productionUpgradeStatus(c,f);
        const rendered=text(renderProductionProgression(c,f) as unknown as Element);
        assert.equal(s.maximum,max); assert.equal(s.nextLevel,level===max?null:level+1);
        assert.ok(rendered.includes(`ระดับ ${level}/${max}`));
        assert.ok(rendered.includes(`คลังวัตถุดิบ ${zone==='I'?factoryCropCapacity(level):farmStockCapacity(level)} ล็อต`));
        assert.ok(rendered.includes(level===max?'ถึงระดับสูงสุดแล้ว':`ระดับถัดไป ${level+1}`));
        if(level<max) { assert.ok(rendered.includes('จากเงินกิจการ')); assert.ok(rendered.includes('สำรองเมือง')); }
        assert.equal(JSON.stringify(c),before);
      }
    }
  } finally { if(descriptor)Object.defineProperty(globalThis,'document',descriptor); else Reflect.deleteProperty(globalThis,'document'); }
});
test('farm and factory previews report unmet real funding, age, profit and worker gates',()=>{
  const c=fixture();
  for(const zone of ['I','F'] as const) {
    const f=c.firms.find(f=>f.zone===zone)!; const b=c.buildings.find(b=>b.id===f.building)!;
    b.level=3;b.age=2;c.accounts[f.wallet]=0;f.lastMonthProfit=0;
    c.employment=c.employment.filter(e=>e.firmId!==f.id); c.ownerLabor=c.ownerLabor.filter(e=>e.firmId!==f.id);
    const s=productionUpgradeStatus(c,f);
    assert.equal(s.cost,20000);assert.ok(s.requiredSpendable>=40000);
    for(const word of ['อายุอาคาร','กำไร','คนทำงาน','เงินกิจการ','พ้นสำรอง'])assert.ok(s.reasons.some(r=>r.includes(word)),word);
  }
});
