import {Entity,Mesh,MeshInstance,StandardMaterial,Color,Vec3,VertexBuffer,VertexFormat,BUFFER_DYNAMIC,type AppBase} from 'playcanvas';
import {vehicleMeshData,type VehiclePart} from './vehicle-geometry.ts';
import {signalSymbol,writeSignalMatrix,type SignalHead} from './traffic/signal-display.ts';
type Batch={entity:Entity;instance:MeshInstance;mesh:Mesh;material:StandardMaterial;buffer:VertexBuffer|null;matrices:Float32Array;capacity:number};
/** Three shared instanced batches: supported heads, red bars, green arrows. No point lights. */
export class SceneTrafficSignals {
 readonly root=new Entity('Accepted worker traffic signals');private batches:Batch[]=[];private destroyed=false;private count=0;private heads:readonly SignalHead[]=[];
 private readonly app:AppBase;
 constructor(app:AppBase){this.app=app;
  app.root.addChild(this.root);
  const part=(x:number,y:number,z:number,sx:number,sy:number,sz:number):VehiclePart=>({role:'dark',x,y,z,sx,sy,sz});
  const housing=vehicleMeshData([part(0,.36,0,.035,.72,.035),part(0,.73,0,.22,.04,.25)],'#222c35');
  this.batches.push(this.make('Signal posts and heads',housing,'#18252f',false));
  this.batches.push(this.make('Red stop bars',signalSymbol('red'),'#ff625c',true));
  this.batches.push(this.make('Green approach arrows',signalSymbol('green'),'#55ffad',true));
  app.once('destroy',this.destroy,this);
 }
 private make(name:string,data:{positions:number[];indices:number[]},color:string,emissive:boolean):Batch{
  const mesh=new Mesh(this.app.graphicsDevice);mesh.setPositions(data.positions);mesh.setNormals(Array.from({length:data.positions.length},(_,i)=>i%3===1?1:0));mesh.setIndices(data.indices);mesh.update();
  const material=new StandardMaterial();material.diffuse=new Color().fromString(color);if(emissive)material.emissive=new Color().fromString(color);material.useLighting=false;material.update();
  const entity=new Entity(name);this.root.addChild(entity);const instance=new MeshInstance(mesh,material,entity);instance.castShadow=false;instance.receiveShadow=false;instance.cull=false;
  entity.addComponent('render',{meshInstances:[instance],castShadows:false,receiveShadows:false});entity.enabled=false;
  return {entity,instance,mesh,material,buffer:null,matrices:new Float32Array(0),capacity:0};
 }
 sync(heads:readonly SignalHead[]):void{
  if(this.destroyed)return;if(heads.length>2304)throw Error('Signal display bound exceeded');this.count=heads.length;this.heads=heads.map(h=>({...h}));
  const groups=[heads,heads.filter(h=>h.state==='red'),heads.filter(h=>h.state==='green')];
  groups.forEach((group,i)=>{const b=this.batches[i];b.entity.enabled=group.length>0;if(!group.length)return;
   if(group.length>b.capacity){b.instance.setInstancing(null);b.buffer?.destroy();b.capacity=2**Math.ceil(Math.log2(Math.max(16,group.length)));b.matrices=new Float32Array(b.capacity*16);b.buffer=new VertexBuffer(this.app.graphicsDevice,VertexFormat.getDefaultInstancingFormat(this.app.graphicsDevice),b.capacity,{usage:BUFFER_DYNAMIC,data:b.matrices});b.instance.setInstancing(b.buffer,false);}
   group.forEach((h,n)=>writeSignalMatrix(b.matrices,n*16,h));b.buffer!.setData(b.matrices);b.instance.instancingCount=group.length;
  });this.app.renderNextFrame=true;
 }
 setEnabled(value:boolean):void{if(!this.destroyed){this.root.enabled=value;this.app.renderNextFrame=true;}}
 private screenAnchors(){
  if(this.destroyed||!this.root.enabled)return [];const camera=(this.app.root.findByName('City camera') as Entity|null)?.camera;if(!camera)return [];
  const canvas=this.app.graphicsDevice.canvas as HTMLCanvasElement;if(typeof canvas.getBoundingClientRect!=='function')return [];const rect=canvas.getBoundingClientRect();
  return this.heads.map(h=>{const center=camera.worldToScreen(new Vec3(h.x,.755,h.z)),forward=camera.worldToScreen(new Vec3(h.x+h.headingX*.1,.755,h.z+h.headingZ*.1));return {node:h.node,approach:h.approach,state:h.state,allRed:h.allRed,x:center.x+rect.left,y:center.y+rect.top,forwardX:forward.x+rect.left,forwardY:forward.y+rect.top,depth:center.z};});
 }
 get diagnostics(){const result={heads:this.count,batches:this.destroyed||!this.root.enabled?0:this.batches.filter(b=>b.entity.enabled).length,materials:this.destroyed?0:3};return Object.defineProperty(result,'screenAnchors',{enumerable:false,get:()=>this.screenAnchors()});}
 destroy():void{if(this.destroyed)return;this.destroyed=true;this.app.off('destroy',this.destroy,this);for(const b of this.batches){b.instance.setInstancing(null);b.buffer?.destroy();}this.root.destroy();for(const b of this.batches){b.material.destroy();}this.count=0;this.heads=[];}
}
