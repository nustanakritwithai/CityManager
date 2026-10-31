import {BoundingBox, StandardMaterial, type Entity, type RenderComponent} from 'playcanvas';
import {CityView} from '../src/renderer.ts';
import {createCity, SIZE, GATEWAY, access, connectedRoads, type Firm} from '../src/sim.ts';
import {emptyCrops,emptyProducts} from '../src/goods.ts';
import {atmosphereAt} from '../src/atmosphere.ts';
import {utilityService} from '../src/utilities.ts';
import {commercialVisualPlan} from '../src/commercial-visuals.ts';
// Synthetic visual input only. Never serialized, simulated, uploaded or installed as a playable city.
const city=createCity(61031,{starter:false});
city.cells.forEach(cell=>{cell.road=false;cell.zone=null;cell.building=null;});
const road=(x:number,z:number)=>{city.cells[z*SIZE+x].road=true;};
for(let x=0;x<=16;x++)road(x,12);
for(let z=7;z<=17;z++)road(5,z);
for(const z of [8,11,14,17])for(let x=5;x<=16;x++)road(x,z);
city.cells[GATEWAY].road=true;
const roads=city.cells.map(cell=>cell.road);
for(let level=1;level<=9;level++){
 const cell=(7+Math.floor((level-1)/3)*3)*SIZE+8+(level-1)%3*3;
 city.cells[cell].zone='C';city.cells[cell].building=level;
 city.buildings.push({id:level,cell,zone:'C',level,age:100});
 city.firms.push({id:level,building:level,zone:'C',commercialKind:'market',crops:emptyCrops(),products:emptyProducts(),wallet:`firm:${level}`,workDays:{},inventory:0,cropInventory:0,cropCost:0,productionTick:0,owner:null,profit:0,lastMonthProfit:0,monthlyRevenue:0,monthlyExpense:0} satisfies Firm);
}
for(const [n,zone] of (['R','I','F'] as const).entries()){
 const id=20+n,cell=16*SIZE+8+n*3;city.cells[cell].zone=zone;city.cells[cell].building=id;
 city.buildings.push({id,cell,zone,level:zone==='I'?4:1,age:100});
}
let contextLost=false;
const canvas=document.querySelector('canvas')!;canvas.addEventListener('webglcontextlost',()=>{contextLost=true;});
const view=await CityView.create(canvas,()=>{},()=>{},()=>{});
view.cameraBlocked=true;view.setQuality('medium');view.target.set(-1,0,-1);view.yaw=0;view.radius=28;view.updateCamera();
// Continuous rendering is confined to this renderer fixture; production still owns its frame scheduling.
view.app.autoRender=true;
let state={night:false,occupied:true,powered:true,disconnected:false,legacyTag:'market' as 'market'|'retail'};
function show(night=false,occupied=true,powered=true,disconnected=false,legacyTag:'market'|'retail'='market'){
 state={night,occupied,powered,disconnected,legacyTag};
 city.cells.forEach((cell,i)=>{cell.road=roads[i]&&!disconnected;});
 city.utilities.outside={power:powered?1000:0,water:1000};
 city.ownerLabor=occupied?city.firms.map(f=>({householdId:f.id,firmId:f.id,skill:'retail' as const,workers:1 as const})):[];
 city.firms.forEach(f=>{f.commercialKind=legacyTag;});
 view.render(city,null,[]);view.setAtmosphere(atmosphereAt(night?22:12));
 document.querySelector('#case')!.textContent=`C1–9 · ${night?'Night':'Day'} · ${!occupied?'Empty':disconnected?'Disconnected':!powered?'Unpowered':'Occupied / powered'} · historical ${legacyTag} tag`;
}
function inspect(){const service=utilityService(city,connectedRoads(city));return city.buildings.filter(b=>b.zone==='C').map(b=>{
 const parcel=view.tiles.get(b.cell)!.entity,plan=commercialVisualPlan(b.level),model=parcel.findByName(`Commercial ${plan.tier}`) as Entity | null;
 if(!model)throw Error(`Production route missing C${b.level}`);
 const renders=model.findComponents('render') as RenderComponent[];let bounds:BoundingBox|undefined;
 for(const render of renders)for(const instance of render.meshInstances){if(bounds)bounds.add(instance.aabb);else bounds=instance.aabb.clone();}
 const windows=renders.filter(r=>plan.parts.find(p=>p.name===r.entity.name)?.window).map(r=>(()=>{const m=r.meshInstances[0].material as StandardMaterial;return m.emissiveIntensity*Math.max(m.emissive.r,m.emissive.g,m.emissive.b);})());
 return {level:b.level,tier:plan.tier,name:model.name,parts:renders.map(r=>r.entity.name),width:bounds!.halfExtents.x*2,depth:bounds!.halfExtents.z*2,height:bounds!.halfExtents.y*2,windows,connected:access(city,b.cell),powered:service.ok(b.id)};
});}
function inspectControls(){return city.buildings.filter(b=>b.zone!=='C').map(b=>({zone:b.zone,commercial:['market','building','mall'].some(t=>!!view.tiles.get(b.cell)!.entity.findByName(`Commercial ${t}`)),renders:view.tiles.get(b.cell)!.entity.findComponents('render').length}));}
show();Object.assign(window,{commercialReview:{get ready(){return !!view.assets&&view.assets.status.failed.length===0;},get status(){return view.assets?.status;},health:()=>({contextLost:contextLost||!!canvas.getContext('webgl2')?.isContextLost(),width:canvas.width,height:canvas.height}),show,inspect,inspectControls,get state(){return state;},diagnostics:()=>view.agricultureDiagnostics()}});
