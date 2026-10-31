import test from 'node:test';
import assert from 'node:assert/strict';
import {vehicleParts,vehicleMeshData,vehicleVariant,vehiclePartColor,type VehicleKind} from '../src/vehicle-geometry.ts';
import {registerVehicleGlow,updateVehicleGlow,vehicleGlowCount} from '../src/vehicle-lighting.ts';
import {writeVehicleMatrix} from '../src/citizen-vehicle-poses.ts';

test('vehicle silhouettes preserve road footprints and +Z headlights',()=>{
 for(const kind of ['sedan','suv','taxi','truck'] as VehicleKind[]){
  const parts=vehicleParts(kind),width=kind==='truck'?.36:.28,length=kind==='truck'?.74:.42;
  for(const p of parts){assert.ok(Math.abs(p.x)+p.sx/2<=width/2+1e-9);assert.ok(Math.abs(p.z)+p.sz/2<=length/2+1e-9);assert.ok(p.y-p.sy/2>=0);}
  assert.equal(parts.filter(p=>p.role==='headlight').length,2);assert.equal(parts.filter(p=>p.role==='taillight').length,2);
  assert.ok(parts.filter(p=>p.role==='headlight').every(p=>p.z>0));assert.ok(parts.filter(p=>p.role==='taillight').every(p=>p.z<0));
  assert.ok(parts.some(p=>p.role==='dark'));assert.ok(parts.some(p=>p.role==='glass'));
 }
 const top=(kind:VehicleKind)=>Math.max(...vehicleParts(kind).map(p=>p.y+p.sy/2));
 assert.ok(top('suv')>top('sedan'));assert.ok(vehicleParts('taxi').some(p=>p.role==='sign'));
 assert.ok(vehicleParts('truck').some(p=>p.role==='cargo'));
});
test('baked geometry has finite arrays, complete normals/colors and bounded triangles',()=>{
 for(const kind of ['sedan','suv','taxi','truck'] as VehicleKind[]){
  const parts=vehicleParts(kind),data=vehicleMeshData(parts,'#d9534f','#5fae4e');
  const faces=parts.reduce((n,p)=>n+(p.role==='headlight'||p.role==='taillight'?1:6),0);
  assert.equal(data.positions.length,faces*4*3);assert.equal(data.normals.length,data.positions.length);
  assert.equal(data.colors.length,faces*4*4);assert.equal(data.indices.length,faces*6);
  assert.ok(data.positions.every(Number.isFinite));assert.ok(data.indices.every(i=>i>=0&&i<data.positions.length/3));
  assert.ok(data.indices.length/3<=120);assert.equal(vehiclePartColor('cargo','#ffffff','#5fae4e'),'#5fae4e');
 }
});
test('variant selection is stable, order independent, renderer-only and includes both shapes',()=>{
 const ids=Array.from({length:128},(_,i)=>`game:${i}`),before=ids.map(vehicleVariant);
 assert.deepEqual([...ids].reverse().map(vehicleVariant).reverse(),before);
 assert.deepEqual(new Set(before),new Set(['sedan','suv']));
 const matrix=new Float32Array(16);writeVehicleMatrix(matrix,0,{vehicleId:'unchanged',x:2,z:4,headingX:1,headingZ:0,paint:0});
 assert.equal(matrix[8],1);assert.equal(matrix[10],0);assert.equal(matrix[12],2);assert.equal(matrix[14],4);
});
test('night glow follows latest app state and unregisters on repeated renderer lifecycles',()=>{
 const app={},other={};updateVehicleGlow(app,1);
 for(let i=0;i<10;i++){
  let updates=0;const material={emissiveIntensity:0,update(){updates++;}},remove=registerVehicleGlow(app,material);
  assert.equal(material.emissiveIntensity,2.2);assert.equal(vehicleGlowCount(app),1);assert.equal(vehicleGlowCount(other),0);
  updateVehicleGlow(app,0);assert.equal(material.emissiveIntensity,0);
  updateVehicleGlow(app,.5);assert.equal(material.emissiveIntensity,1.1);
  remove();remove();assert.equal(vehicleGlowCount(app),0);const n=updates;
  updateVehicleGlow(app,1);assert.equal(updates,n,'disposed materials are never updated');
 }
});

test('explicit geometry budget: richer bodies, bounded batches and no hidden lamp faces',()=>{
 // Baseline was 24 triangles/car and six color batches. New silhouette batches are 2x6 + one lamp layer.
 assert.equal(vehicleMeshData(vehicleParts('sedan'),'#ffffff').indices.length/3,56);
 assert.equal(vehicleMeshData(vehicleParts('suv'),'#ffffff').indices.length/3,56);
 assert.equal(vehicleMeshData(vehicleParts('taxi'),'#ffffff').indices.length/3,68);
 assert.equal(vehicleMeshData(vehicleParts('truck'),'#ffffff').indices.length/3,80);
 for(const kind of ['sedan','suv','taxi'] as VehicleKind[]){
  const parts=vehicleParts(kind),body=parts.find(p=>p.role==='paint')!;
  for(const lamp of parts.filter(p=>p.role==='headlight'||p.role==='taillight'))assert.ok(Math.abs(lamp.z)+lamp.sz/2>body.sz/2,'lamp face is proud of chassis, not coplanar');
 }
});
