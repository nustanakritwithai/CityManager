import test from 'node:test';
import assert from 'node:assert/strict';
import {TrafficPresentation} from '../src/traffic/presentation.ts';
import type {CitizenVehiclePose} from '../src/citizen-vehicle-poses.ts';

// Frozen pre-index corner bookkeeping from 1551f44. It intentionally scans
// the whole reservation map per owner, independently of the optimized index.
function preIndex(corners:Map<string,any>, plansByOwner:Map<string,any[]>, sequence:number){
 for(const [id,allPlans] of plansByOwner){
  const plans=allPlans.filter(p=>p.key!=='legacy'||![...corners.values()].some(r=>r.owner===id&&r.plan!=='legacy'));
  const desired=new Set(plans.map(p=>p.key));
  for(const [key,r] of corners)if(r.owner===id&&!r.entered&&!desired.has(r.plan))corners.delete(key);
  for(const plan of plans){
   const key=`${id}@${plan.key}`;
   if(!corners.has(key)&&[...corners.values()].filter(r=>r.owner===id).length>=2)break;
   if(!corners.has(key))corners.set(key,{owner:id,plan:plan.key,visit:plan.visit,exit:plan.exit,gate:plan.gate,box:plan.box,boxes:plan.boxes,order:++sequence,entered:false,active:false});
  }
 }
 return sequence;
}

test('indexed corner bookkeeping matches pre-index multi-owner pruning and legacy reinsertion', () => {
 const pose=(id:string,x:number,node:number):CitizenVehiclePose=>({vehicleId:id,x,z:-.24,headingX:1,headingZ:0,paint:0,speed:0,upcomingTurn:{x:node+.71,z:-.24,headingX:1,headingZ:0,nodeX:node,nodeZ:0,entryX:node,entryZ:-.24,incomingHeadingX:1,incomingHeadingZ:0,visit:1}});
 const legacy:CitizenVehiclePose={...pose('l',18,20),upcomingTurn:{x:20.71,z:-.24,headingX:0,headingZ:1}};
 const p=new TrafficPresentation();p.update([pose('a',-2,0),pose('b',8,10),legacy]);p.frame(0,false);
 const corners=(p as any).corners as Map<string,any>;
 const original=[...corners.values()];
 const plans=new Map(original.map(r=>[r.owner,[{key:r.plan,visit:r.visit,exit:r.exit,gate:r.gate,box:r.box,boxes:r.boxes}]]));
 // Seed transient pre-prune states: a has stale nonlegacy and legacy plans;
 // l's legacy plan is suppressed for one frame by a stale nonlegacy plan.
 const a=[...corners.values()].find(r=>r.owner==='a');a.plan='stale';a.active=false;a.entered=false;
 corners.set('a@legacy',{...a,plan:'legacy',order:a.order+100});
 const l=[...corners.values()].find(r=>r.owner==='l');
 corners.set('l@stale',{...l,plan:'stale',order:l.order+100,active:false,entered:false});
 const expected=new Map([...corners].map(([key,r])=>[key,{...r}]));
 let sequence=(p as any).reservationSequence as number;
 const check=()=>{
  sequence=preIndex(expected,plans,sequence);p.frame(0,false);
  // acquireCorners runs after bookkeeping and can change active; compare all
  // other reservation fields, global order and sequence without masking them.
  const normalize=(m:Map<string,any>)=>[...m].map(([key,{active,...r}])=>[key,r]);
  assert.deepEqual(normalize(corners),normalize(expected));
  assert.equal((p as any).reservationSequence,sequence);
  return [...corners.keys()];
 };
 assert.deepEqual(check(),['b@1:10,0/1,0/1,0','a@1:0,0/1,0/1,0']);
 assert.deepEqual(check(),['b@1:10,0/1,0/1,0','a@1:0,0/1,0/1,0','l@legacy']);
});
