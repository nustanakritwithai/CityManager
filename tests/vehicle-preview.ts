import { AppBase, AppOptions, createGraphicsDevice, DEVICETYPE_WEBGL2, RenderComponentSystem, CameraComponentSystem, LightComponentSystem, Entity, Color, StandardMaterial, PROJECTION_ORTHOGRAPHIC } from 'playcanvas';
import { BaselineCitizenVehicles } from './vehicle-baseline.ts';
import { SceneCitizenVehicles } from '../src/scene-citizen-vehicles.ts';
import { SceneAtmosphere } from '../src/scene-atmosphere.ts';
import { atmosphereAt } from '../src/atmosphere.ts';
import { addVehicleDetail, vehicleDetailDiagnostics } from '../src/scene-traffic.ts';
import { vehicleVariant } from '../src/vehicle-geometry.ts';
import { vehicleGlowCount } from '../src/vehicle-lighting.ts';
import type { CitizenVehiclePose } from '../src/citizen-vehicle-poses.ts';
const canvas=document.querySelector('canvas')!;canvas.width=innerWidth;canvas.height=innerHeight;
const options=new AppOptions();options.graphicsDevice=await createGraphicsDevice(canvas,{deviceTypes:[DEVICETYPE_WEBGL2],antialias:true});
options.componentSystems=[RenderComponentSystem,CameraComponentSystem,LightComponentSystem];
const app=new AppBase(canvas);app.init(options);
const camera=new Entity('Vehicle review camera');camera.addComponent('camera',{clearColor:new Color(.1,.17,.23),projection:PROJECTION_ORTHOGRAPHIC,orthoHeight:1.75,nearClip:.1,farClip:100});camera.setPosition(0,3.2,5);camera.lookAt(0,.2,0);app.root.addChild(camera);
const atmosphere=new SceneAtmosphere(app,camera);atmosphere.setQuality('medium');atmosphere.follow(8);
const materials=new Map<string,StandardMaterial>();
function material(color:string){let m=materials.get(color);if(!m){m=new StandardMaterial();m.diffuse=new Color().fromString(color);m.update();materials.set(color,m);}return m;}
const box=(parent:Entity,x:number,y:number,z:number,sx:number,sy:number,sz:number,color:string|StandardMaterial,castShadows=false)=>{const e=new Entity('Vehicle review primitive');e.addComponent('render',{type:'box',material:typeof color==='string'?material(color):color,castShadows,receiveShadows:false});e.setLocalPosition(x,y,z);e.setLocalScale(sx,sy,sz);parent.addChild(e);return e;};
box(app.root,0,.03,0,6,.05,2,'#36434b');for(const x of [-1.2,0,1.2])box(app.root,x,.061,0,.015,.01,1.5,'#b1b9b4');
const fleet=new SceneCitizenVehicles(app),taxi=new SceneCitizenVehicles(app,['#f2c94c'],{taxi:true});
let truck:Entity;
function makeTruck(){truck=new Entity('Actual decorative cargo truck');truck.setPosition(1.8,.14,0);app.root.addChild(truck);addVehicleDetail(truck,{app},'truck','#d97a4b','#65ae59');}
makeTruck();
const idFor=(kind:'sedan'|'suv',n=0)=>{let id=`review:${kind}:${n}`;while(vehicleVariant(id)!==kind)id+='x';return id;};
const pose=(id:string,x:number,paint=0,z=0):CitizenVehiclePose=>({vehicleId:id,x,z,paint,headingX:0,headingZ:1});
function show(night=false,rear=false){camera.setPosition(0,3.2,rear?-5:5);camera.lookAt(0,.2,0);fleet.setEnabled(true);taxi.setEnabled(true);fleet.sync([pose(idFor('sedan'),-1.8,2),pose(idFor('suv'),-.6,0)]);taxi.sync([pose('taxi:review',.6)]);atmosphere.apply(atmosphereAt(night?21.5:12.5));document.querySelector('#case')!.textContent=`Sedan · SUV · Taxi · Cargo truck — ${night?'Night':'Day'}${rear?' · rear lamps':''}`;}
const renders=(root:Entity)=>root.findComponents('render') as any[];
const instances=(root:Entity)=>renders(root).flatMap(r=>r.meshInstances);
const buffers=()=>[...instances(fleet.root),...instances(taxi.root)].map(m=>m.instancingData?.vertexBuffer).filter(Boolean);
const vehicleDraws=()=>fleet.diagnostics.drawBatches+taxi.diagnostics.drawBatches+renders(truck).length;
const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
function inspect(){const lamps=[...instances(fleet.root),...instances(taxi.root)].filter(m=>m.node.name==='Instanced vehicle lamps').map(m=>m.material.emissiveIntensity);return {fleet:fleet.diagnostics,taxi:taxi.diagnostics,truckDraws:renders(truck).length,vehicleDraws:vehicleDraws(),frameDrawCalls:(app as any).stats?.drawCalls?.total??null,lamps:[...lamps,...instances(truck).filter(m=>m.node.name==='Vehicle detail lamps').map(m=>m.material.emissiveIntensity)],realLights:[fleet.root,taxi.root,truck].reduce((n,r)=>n+r.findComponents('light').length,0),baseline:{fleetDrawBudget:6,trianglesPerCar:24},kindMapping:[vehicleVariant(idFor('sedan')),vehicleVariant(idFor('suv'))]};}
async function sampleFrames(){const intervals:number[]=[],draws:number[]=[];await frame();let last=performance.now();for(let i=0;i<20;i++){await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));const now=performance.now();intervals.push(now-last);last=now;draws.push(app.stats.drawCalls.total);}const sorted=[...intervals].sort((a,b)=>a-b);return {samples:intervals.length,meanFrameMs:intervals.reduce((a,b)=>a+b,0)/intervals.length,p95FrameMs:sorted[Math.floor(sorted.length*.95)],drawCalls:draws.at(-1),drawCallsRange:[Math.min(...draws),Math.max(...draws)]};}
async function lifecycle(){
 const poses:CitizenVehiclePose[]=[];for(const kind of ['sedan','suv'] as const)for(let paint=0;paint<6;paint++)poses.push(pose(idFor(kind,paint),paint*.08,paint));while(poses.length<64)poses.push(pose(`bounded:${poses.length}`,poses.length*.01,poses.length%6));
 const baseline=new BaselineCitizenVehicles(app);fleet.setEnabled(false);taxi.setEnabled(false);truck.enabled=false;baseline.sync(poses);const baselineMeasured=await sampleFrames();baseline.setEnabled(false);fleet.setEnabled(true);fleet.sync(poses);const candidateMeasured=await sampleFrames();baseline.destroy();taxi.setEnabled(true);truck.enabled=true;
 fleet.sync(poses);taxi.sync(Array.from({length:16},(_,i)=>pose(`taxi:${i}`,i*.01)));await frame();
 const before=inspect(),original=buffers(),capacity=fleet.diagnostics.capacity+taxi.diagnostics.capacity;
 for(let n=0;n<12;n++){fleet.sync(poses);taxi.sync(Array.from({length:16},(_,i)=>pose(`taxi:${i}`,i*.01)));}
 await frame();const repeatedFrameDrawCalls=app.stats.drawCalls.total;
 const repeated=buffers(),buffersReused=original.length===repeated.length&&original.every((b,i)=>b===repeated[i]);
 fleet.sync(poses.slice(0,12));taxi.sync([pose('taxi:small',0)]);const capacityStable=capacity===fleet.diagnostics.capacity+taxi.diagnostics.capacity;
 fleet.setEnabled(false);taxi.setEnabled(false);const disabledDraws=fleet.diagnostics.drawBatches+taxi.diagnostics.drawBatches;
 fleet.setEnabled(true);taxi.setEnabled(true);fleet.sync([]);taxi.sync([]);const emptyDraws=fleet.diagnostics.drawBatches+taxi.diagnostics.drawBatches;
 const truckMeshes=instances(truck).map(m=>m.mesh);const oldTruck=truck;oldTruck.destroy();const cacheAfterClear=vehicleDetailDiagnostics(app);makeTruck();const cacheAfterRebuild=vehicleDetailDiagnostics(app);show(true);await frame();
 const rebuilt=fleet.diagnostics.cars===2&&taxi.diagnostics.cars===1&&renders(truck).length===2&&instances(truck).every((m,i)=>m.mesh===truckMeshes[i]&&!!m.mesh.vertexBuffer);
 const restored=inspect();fleet.destroy();taxi.destroy();truck.destroy();await frame();
 const cacheBeforeAppDestroy=vehicleDetailDiagnostics(app);const cachedBeforeAppDestroy=vehicleGlowCount(app);app.destroy();const cacheAfterAppDestroy=vehicleDetailDiagnostics(app);
 const disposed=truckMeshes.every(m=>!m.vertexBuffer)&&cachedBeforeAppDestroy===1&&fleet.diagnostics.buffers===0&&taxi.diagnostics.buffers===0&&fleet.diagnostics.meshes===0&&taxi.diagnostics.meshes===0&&!fleet.root.parent&&!taxi.root.parent&&!truck.parent&&vehicleGlowCount(app)===0;
 return {cacheAfterClear,cacheAfterRebuild,cacheBeforeAppDestroy,cacheAfterAppDestroy,comparison:{samePoses:64,baseline:baselineMeasured,candidate:candidateMeasured,baselineVehicleDraws:6,candidateVehicleDraws:13,note:"Short CI sample, not a stable FPS benchmark"},before,restored,repeatedFrameDrawCalls,disabledDraws,emptyDraws,buffersReused,capacityStable,rebuilt,disposed,maxVehicleDraws:before.vehicleDraws,maxBufferCount:original.length,capacity};
}
show();app.start();Object.assign(window,{vehicleReview:{ready:true,show,inspect,lifecycle}});
