/** Baked low-poly silhouettes in GPU instance batches. No per-car Entities or lights. */
import {Entity,Mesh,MeshInstance,StandardMaterial,Color,VertexBuffer,VertexFormat,BUFFER_DYNAMIC,type AppBase} from 'playcanvas';
import {writeVehicleMatrix,type CitizenVehiclePose} from './citizen-vehicle-poses.ts';
import {vehicleParts,vehicleMeshData,vehicleVariant,type VehicleKind} from './vehicle-geometry.ts';
import {registerVehicleGlow} from './vehicle-lighting.ts';
const PAINT=['#d9534f','#e8a53a','#4a90d9','#58b368','#e6e6e0','#8e5ea2'];
type Batch={entity:Entity;instance:MeshInstance;buffer:VertexBuffer|null;matrices:Float32Array;capacity:number};
export class SceneCitizenVehicles {
 readonly root=new Entity('Representative fleet vehicles');
 private readonly batches:Batch[]=[];
 private readonly materials:StandardMaterial[]=[];
 private readonly unregister:()=>void;
 private readonly kinds:VehicleKind[];
 private visibleCount=0;
 private destroyed=false;
 constructor(private readonly app:AppBase,private readonly palette:readonly string[]=PAINT,options:{taxi?:boolean}={}) {
  this.kinds=options.taxi?['taxi']:['sedan','suv'];
  app.root.addChild(this.root);
  const body=new StandardMaterial();body.diffuse=new Color(1,1,1);body.diffuseVertexColor=true;body.gloss=.22;body.update();
  const lamps=new StandardMaterial();lamps.diffuse=new Color(1,1,1);lamps.diffuseVertexColor=true;lamps.emissive=new Color(1,1,1);lamps.emissiveVertexColor=true;lamps.update();
  this.materials.push(body,lamps);this.unregister=registerVehicleGlow(app,lamps);
  for(const kind of this.kinds)for(const paint of palette)this.batches.push(this.makeBatch(kind,paint,body,false));
  // Identical lamp positions for every car silhouette: one batch for the entire fleet.
  this.batches.push(this.makeBatch('sedan','#ffffff',lamps,true));
  app.once('destroy',this.destroy,this);
 }
 private makeBatch(kind:VehicleKind,paint:string,material:StandardMaterial,lights:boolean):Batch {
  const parts=vehicleParts(kind).filter(p=>(p.role==='headlight'||p.role==='taillight')===lights);
  const data=vehicleMeshData(parts,paint),mesh=new Mesh(this.app.graphicsDevice);
  mesh.setPositions(data.positions);mesh.setNormals(data.normals);mesh.setColors32(data.colors);mesh.setIndices(data.indices);mesh.update();
  const entity=new Entity(lights?'Instanced vehicle lamps':`Instanced ${kind} ${paint}`);this.root.addChild(entity);
  const instance=new MeshInstance(mesh,material,entity);instance.castShadow=false;instance.receiveShadow=false;instance.cull=false;
  entity.addComponent('render',{meshInstances:[instance],castShadows:false,receiveShadows:false});entity.enabled=false;
  return {entity,instance,buffer:null,matrices:new Float32Array(0),capacity:0};
 }
 sync(poses:readonly CitizenVehiclePose[]):void {
  if(this.destroyed)return;
  const groups:CitizenVehiclePose[][]=this.batches.map(()=>[]);
  for(const pose of poses){
   if(!Number.isInteger(pose.paint)||pose.paint<0||pose.paint>=this.palette.length)throw new Error('Unknown vehicle paint');
   const variant=this.kinds.length===1?0:vehicleVariant(pose.vehicleId)==='suv'?1:0;
   groups[variant*this.palette.length+pose.paint].push(pose);groups[groups.length-1].push(pose);
  }
  this.visibleCount=poses.length;
  groups.forEach((group,i)=>{
   const batch=this.batches[i];batch.entity.enabled=group.length>0;if(!group.length)return;
   if(group.length>batch.capacity){
    batch.instance.setInstancing(null);batch.buffer?.destroy();
    batch.capacity=2**Math.ceil(Math.log2(Math.max(16,group.length)));batch.matrices=new Float32Array(batch.capacity*16);
    batch.buffer=new VertexBuffer(this.app.graphicsDevice,VertexFormat.getDefaultInstancingFormat(this.app.graphicsDevice),batch.capacity,{usage:BUFFER_DYNAMIC,data:batch.matrices});batch.instance.setInstancing(batch.buffer,false);
   }
   group.forEach((pose,n)=>writeVehicleMatrix(batch.matrices,n*16,pose));batch.buffer!.setData(batch.matrices);batch.instance.instancingCount=group.length;
  });
  this.app.renderNextFrame=true;
 }
 setEnabled(enabled:boolean):void {if(this.destroyed)return;this.root.enabled=enabled;this.app.renderNextFrame=true;}
 get diagnostics(){return {cars:this.visibleCount,drawBatches:this.destroyed||!this.root.enabled?0:this.batches.filter(b=>b.entity.enabled).length,
  trianglesPerCar:(this.kinds.length===1?5:4)*12+8,capacity:this.batches.reduce((n,b)=>n+b.capacity,0),
  meshes:this.destroyed?0:this.batches.length,materials:this.destroyed?0:this.materials.length,buffers:this.batches.filter(b=>b.buffer).length};}
 destroy():void {
  if(this.destroyed)return;this.destroyed=true;this.app.off('destroy',this.destroy,this);this.unregister();
  for(const b of this.batches){b.instance.setInstancing(null);b.buffer?.destroy();b.buffer=null;b.capacity=0;b.matrices=new Float32Array(0);}
  this.root.destroy();for(const material of this.materials)material.destroy();this.visibleCount=0;
 }
}
