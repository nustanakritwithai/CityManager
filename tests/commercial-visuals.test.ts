import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {commercialPresentation,commercialVisualPlan} from '../src/commercial-visuals.ts';
test('nine commercial levels have distinct bounded market, building and mall silhouettes',()=>{
 let previousHeight=0;const shapes=new Set<string>();
 for(let level=1;level<=9;level++){
  const plan=commercialVisualPlan(level);
  assert.equal(plan.tier,level<=3?'market':level<=6?'building':'mall');
  assert.ok(plan.parts.length<=32,'bounded geometry per parcel');
  assert.ok(plan.height>=previousHeight,'no shrinking tier transition');previousHeight=plan.height;
  for(const p of plan.parts){assert.ok([p.x,p.y,p.z,p.width,p.height,p.depth].every(Number.isFinite));assert.ok(p.width>0&&p.height>0&&p.depth>0);assert.ok(Math.abs(p.x)+p.width/2<=.851);assert.ok(Math.abs(p.z)+p.depth/2<=.851);assert.ok(p.y-p.height/2>=0);}
  shapes.add(JSON.stringify(plan.parts));
  assert.equal(plan.parts.some(p=>p.name==='Central mall atrium'),level>=7);
  assert.equal(plan.parts.some(p=>p.name==='Broad market canopy'),level<=3);
  assert.equal(plan.parts.some(p=>p.name==='Commercial building body'),level>=4&&level<=6);
 }
 assert.equal(shapes.size,9);
});
test('one commercial level system has presentation-only tier labels',()=>{
 for(let level=1;level<=9;level++){
  const p=commercialPresentation(level);assert.match(p.label,new RegExp(`ระดับ ${level}/9`));
  assert.equal(p.title,level<=3?'ตลาด':level<=6?'อาคารพาณิชย์':'Big Mall');
  assert.doesNotMatch(p.label,/พืชผล|สำเร็จรูป/);
 }
 for(const level of [0,10,1.5,NaN])assert.throws(()=>commercialVisualPlan(level),RangeError);
});
test('renderer and panels use real tiers, shared materials and powered occupied windows',()=>{
 const renderer=readFileSync(new URL('../src/renderer.ts',import.meta.url),'utf8'),panels=readFileSync(new URL('../src/context-panels.ts',import.meta.url),'utf8');
 assert.match(renderer,/if \(b.zone === 'C'\) \{ this.commercial/);
 assert.match(renderer,/lit && reach && services.ok\(commercial.building\)/);
 assert.match(renderer,/part.window && lit \? this.windowLit : part.color/);
 assert.doesNotMatch(renderer,/Math.max\(1, b.level - 1\)/);
 assert.match(panels,/labels\[data.kind\] = commercialPresentation\(selectedBuilding.level/);
 assert.match(panels,/cardTrade\(data, 'crops'\), cardTrade\(data, 'goods'\)/);
 assert.doesNotMatch(panels,/marketConversionStatus|retailGrowthStatus|isMarket|isRetail/);
});
test('commercial bodies and rooftop fittings touch their supports',()=>{
 const bottom=(p:any)=>p.y-p.height/2,top=(p:any)=>p.y+p.height/2;
 for(let level=1;level<=9;level++){
  const parts=commercialVisualPlan(level).parts,get=(name:string)=>parts.find(p=>p.name===name)!;
  if(level<=3){assert.ok(top(get('Canopy post'))>=bottom(get('Broad market canopy')));assert.ok(bottom(get('Sales counter'))<=top(get('Paved commercial forecourt'))+1e-9);}
  else if(level<=6){assert.ok(bottom(get('Commercial building body'))<=top(get('Paved commercial forecourt'))+1e-9);assert.ok(bottom(get('Flat commercial roof'))<=top(get('Commercial building body'))+1e-9);assert.ok(bottom(get('Rooftop service room'))<=top(get('Flat commercial roof'))+1e-9);}
  else if(level>=8)assert.ok(bottom(get('Terrace planter'))<=top(get('Wing roof terrace'))+1e-9);
 }
});
