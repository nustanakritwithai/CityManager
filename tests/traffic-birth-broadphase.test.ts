import test from 'node:test';
import assert from 'node:assert/strict';
import {presentationUnionIntersectsBox, presentationUnionsIntersect, type PresentationAdmissionBox as Box} from '../src/traffic/presentation.ts';
import {TRAFFIC_SPACING} from '../src/traffic/spacing.ts';

// Independent original narrow-phase predicate, including the production gap/EPS.
const old=(a:Box,b:Box)=>a.minX-TRAFFIC_SPACING.standstillGap<b.maxX-1e-7&&b.minX-TRAFFIC_SPACING.standstillGap<a.maxX-1e-7&&a.minZ-TRAFFIC_SPACING.standstillGap<b.maxZ-1e-7&&b.minZ-TRAFFIC_SPACING.standstillGap<a.maxZ-1e-7;
const union=(v:Box[]):Box=>({minX:Math.min(...v.map(b=>b.minX)),maxX:Math.max(...v.map(b=>b.maxX)),minZ:Math.min(...v.map(b=>b.minZ)),maxZ:Math.max(...v.map(b=>b.maxZ))});
const box=(x:number,z:number,w=.4,h=.3):Box=>({minX:x,maxX:x+w,minZ:z,maxZ:z+h});
test('birth broad phase equals old child checks at gaps, false positives and multiple boxes',()=>{
 const scenarios:Box[][]=[
  [box(0,0)], // Legacy single-box plan.
  [box(-3,0),box(3,0)], // Union contains empty space between two corners.
  [box(0,0),box(.7,.8),box(1.5,-.4)], // Multi-segment turn.
 ];
 const targets:Box[]=[box(0,0),box(0,.8),box(0,5),box(2,0),box(3,0)];
 const edge=.4+TRAFFIC_SPACING.standstillGap-1e-7;
 for(const d of [-1e-8,0,1e-8])targets.push(box(edge+d,0));
 let seed=0x84f11;const rng=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
 for(let i=0;i<1000;i++)targets.push(box(rng()*10-5,rng()*8-4,rng()+.01,rng()+.01));
 let falsePositive=false;
 for(const children of scenarios){const outer=union(children);
  for(const target of targets){const expected=children.some(a=>old(a,target));
   assert.equal(presentationUnionIntersectsBox(outer,children,target),expected);
   if(old(outer,target)&&!expected)falsePositive=true;
  }
  // Corner-vs-corner and bus reservation collections run the same original
  // nested narrow phase even when their enclosing bounds overlap empty space.
  for(const other of scenarios){assert.equal(presentationUnionsIntersect(outer,children,union(other),other),children.some(a=>other.some(b=>old(a,b))));}
 }
 assert.ok(falsePositive,'fixture must exercise broad-phase hit with no child collision');
});
