/** Instanced, low-detail vehicles. Six paint batches, no per-car entities, no cap.
 * This adapter owns rendering buffers only; changing quality cannot delete trips.
 */
import {Entity,Mesh,MeshInstance,StandardMaterial,Color,VertexBuffer,VertexFormat,BUFFER_DYNAMIC,type AppBase} from 'playcanvas';
import {writeVehicleMatrix,type CitizenVehiclePose} from './citizen-vehicle-poses.ts';
const PAINT=['#d9534f','#e8a53a','#4a90d9','#58b368','#e6e6e0','#8e5ea2'];
type Batch={entity:Entity;instance:MeshInstance;material:StandardMaterial;buffer:VertexBuffer|null;matrices:Float32Array;capacity:number};
export class SceneCitizenVehicles {
 readonly root=new Entity('Real citizen vehicles');
 private readonly mesh:Mesh;
 private readonly batches:Batch[]=[];
 private visibleCount=0;
 constructor(private readonly app:AppBase) {
   this.mesh=new Mesh(app.graphicsDevice);
   const positions:number[]=[],normals:number[]=[],colors:number[]=[],indices:number[]=[];
   const box=(sx:number,sy:number,sz:number,y:number,shade:number)=>{
     const faces=[{n:[1,0,0],v:[[1,-1,-1],[1,1,-1],[1,1,1],[1,-1,1]]},
       {n:[-1,0,0],v:[[-1,-1,1],[-1,1,1],[-1,1,-1],[-1,-1,-1]]},
       {n:[0,1,0],v:[[-1,1,-1],[-1,1,1],[1,1,1],[1,1,-1]]},
       {n:[0,-1,0],v:[[-1,-1,1],[-1,-1,-1],[1,-1,-1],[1,-1,1]]},
       {n:[0,0,1],v:[[1,-1,1],[1,1,1],[-1,1,1],[-1,-1,1]]},
       {n:[0,0,-1],v:[[-1,-1,-1],[-1,1,-1],[1,1,-1],[1,-1,-1]]}];
     for(const face of faces){const base=positions.length/3;for(const p of face.v){positions.push(p[0]*sx/2,p[1]*sy/2+y,p[2]*sz/2);normals.push(...face.n);colors.push(shade,shade,shade,255);}indices.push(base,base+1,base+2,base,base+2,base+3);}
   };
   box(.5,.22,.94,.11,255);box(.4,.2,.46,.3,100);
   this.mesh.setPositions(positions);this.mesh.setNormals(normals);this.mesh.setColors32(colors);this.mesh.setIndices(indices);this.mesh.update();
   app.root.addChild(this.root);
   for(const color of PAINT){
     const material=new StandardMaterial();material.diffuse=new Color().fromString(color);material.diffuseVertexColor=true;material.update();
     const entity=new Entity('Instanced traffic paint');this.root.addChild(entity);
     const instance=new MeshInstance(this.mesh,material,entity);instance.castShadow=false;instance.receiveShadow=false;instance.cull=false;
     entity.addComponent('render',{meshInstances:[instance],castShadows:false,receiveShadows:false});entity.enabled=false;
     this.batches.push({entity,instance,material,buffer:null,matrices:new Float32Array(0),capacity:0});
   }
 }
 sync(poses:readonly CitizenVehiclePose[]):void {
   const groups:CitizenVehiclePose[][]=PAINT.map(()=>[]);
   for(const pose of poses){if(!groups[pose.paint])throw new Error('Unknown vehicle paint');groups[pose.paint].push(pose);}
   this.visibleCount=poses.length;
   groups.forEach((group,i)=>{
     const batch=this.batches[i];batch.entity.enabled=group.length>0;if(!group.length)return;
     if(group.length>batch.capacity){
       batch.instance.setInstancing(null);batch.buffer?.destroy();
       batch.capacity=2**Math.ceil(Math.log2(Math.max(16,group.length)));batch.matrices=new Float32Array(batch.capacity*16);
       batch.buffer=new VertexBuffer(this.app.graphicsDevice,VertexFormat.getDefaultInstancingFormat(this.app.graphicsDevice),batch.capacity,{usage:BUFFER_DYNAMIC,data:batch.matrices});
       batch.instance.setInstancing(batch.buffer,false);
     }
     group.forEach((pose,n)=>writeVehicleMatrix(batch.matrices,n*16,pose));batch.buffer!.setData(batch.matrices);batch.instance.instancingCount=group.length;
   });
   this.app.renderNextFrame=true;
 }
 setEnabled(enabled:boolean):void {this.root.enabled=enabled;this.app.renderNextFrame=true;}
 get diagnostics(){return {cars:this.visibleCount,drawBatches:this.batches.filter(b=>b.entity.enabled).length,trianglesPerCar:24,capacity:this.batches.reduce((n,b)=>n+b.capacity,0)};}
 destroy():void {for(const b of this.batches){b.instance.setInstancing(null);b.buffer?.destroy();}this.root.destroy();for(const b of this.batches)b.material.destroy();this.visibleCount=0;}
}
