import test from 'node:test';
import assert from 'node:assert/strict';
import {presentationCarSweep} from '../src/traffic/presentation.ts';
import {TRAFFIC_SPACING} from '../src/traffic/spacing.ts';
import type {CitizenVehiclePose} from '../src/citizen-vehicle-poses.ts';

/** Frozen pre-optimization exact geometry, including its angle wrap and critical points. */
function reference(from: CitizenVehiclePose,to: CitizenVehiclePose) {
 const start=Math.atan2(from.headingZ,from.headingX);let end=Math.atan2(to.headingZ,to.headingX);while(end-start>Math.PI)end-=2*Math.PI;while(end-start< -Math.PI)end+=2*Math.PI;
 const lo=Math.min(start,end),hi=Math.max(start,end),length=TRAFFIC_SPACING.lengths.sedan,width=.3;
 const support=(x:number,z:number)=>{const values=[lo,hi],critical=Math.atan2(z,x);for(let k=-2;k<=2;k++)for(const a of [critical,-critical,Math.PI-critical,Math.PI+critical]){const angle=a+k*2*Math.PI;if(angle>=lo&&angle<=hi)values.push(angle);}return Math.max(...values.map(a=>(x*Math.abs(Math.cos(a))+z*Math.abs(Math.sin(a)))/2));};
 const hx=support(length,width),hz=support(width,length);
 return {minX:Math.min(from.x,to.x)-hx,maxX:Math.max(from.x,to.x)+hx,minZ:Math.min(from.z,to.z)-hz,maxZ:Math.max(from.z,to.z)+hz};
}
test('straight and changing-heading sweeps exactly preserve the original collision bounds',()=>{
 for(let i=0;i<4096;i++){
  const angle=(i-2048)*Math.PI/701, from={vehicleId:'car',x:i/1000,z:-i/700,headingX:Math.cos(angle),headingZ:Math.sin(angle),paint:0,speed:0};
  for(const delta of [0,2e-12,Math.PI/2,-Math.PI/2]){
   const to={...from,x:from.x+.001,z:from.z-.001,headingX:Math.cos(angle+delta),headingZ:Math.sin(angle+delta)};
   assert.deepEqual(presentationCarSweep(from,to),reference(from,to),`angle ${angle}, delta ${delta}`);
  }
 }
});
