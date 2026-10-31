import { AppBase, AppOptions, createGraphicsDevice, DEVICETYPE_WEBGL2, RenderComponentSystem, CameraComponentSystem, LightComponentSystem, Entity, Color, StandardMaterial, BoundingBox, type RenderComponent } from 'playcanvas';
import { CityView } from '../src/renderer.ts';
import { SceneAtmosphere } from '../src/scene-atmosphere.ts';
import { atmosphereAt } from '../src/atmosphere.ts';
import type { CropId } from '../src/goods.ts';
const canvas=document.querySelector('canvas')!; canvas.width=innerWidth;canvas.height=innerHeight;
const options=new AppOptions();options.graphicsDevice=await createGraphicsDevice(canvas,{deviceTypes:[DEVICETYPE_WEBGL2],antialias:true});options.componentSystems=[RenderComponentSystem,CameraComponentSystem,LightComponentSystem];
const app=new AppBase(canvas);app.init(options);
const camera=new Entity('Farm camera');camera.addComponent('camera',{clearColor:new Color(.16,.22,.25),fov:38,nearClip:.1,farClip:100});camera.setPosition(5,9,10);camera.lookAt(0,0,0);app.root.addChild(camera);
const view=new CityView(canvas,app,()=>{},()=>{},()=>{});view.atmosphere=new SceneAtmosphere(app,camera);view.atmosphere.setQuality('medium');
const renderer=view as unknown as {farm(tile:Entity,fertility:number,level:number,crop:CropId,active:boolean):void;fade(tile:Entity):void};
let models:Entity[]=[];
function show(crop:CropId='rice',night=false,active=true,disconnected=false){
 for(const model of models)model.destroy();models=[];
 for(let level=1;level<=6;level++){
  const model=new Entity(`Level ${level}`);model.setPosition(((level-1)%3-1)*2.3,0,level<=3?-1.2:1.2);app.root.addChild(model);
  renderer.farm(model,85,level,crop,active&&!disconnected);if(disconnected)renderer.fade(model);models.push(model);
 }
 view.atmosphere.apply(atmosphereAt(night?22:12));document.querySelector('#case')!.textContent=`${crop} · ${night?'Night':'Day'} · ${disconnected?'disconnected':active?'active':'inactive'}`;
}
function inspect(){return models.map((model,index)=>{
 let bounds:BoundingBox|undefined;const meshes=(model.findComponents('render') as RenderComponent[]).flatMap(r=>r.meshInstances);
 for(const m of meshes){if(bounds)bounds.add(m.aabb);else bounds=m.aabb.clone();}
 const lights=meshes.filter(m=>m.node.name==='Greenhouse grow light'||m.node.name==='Farm yard lamp');
 return {level:index+1,width:bounds!.halfExtents.x*2,depth:bounds!.halfExtents.z*2,glass:meshes.filter(m=>m.node.name==='Greenhouse glass roof').map(m=>({opacity:(m.material as StandardMaterial).opacity,depthWrite:(m.material as StandardMaterial).depthWrite})),lights:lights.map(m=>(m.material as StandardMaterial).emissiveIntensity),rows:meshes.filter(m=>m.node.name.startsWith('Renewable crop row')).map(m=>({name:m.node.name,color:(m.material as StandardMaterial).diffuse.toString(false)}))};
});}
show();app.start();Object.assign(window,{farmReview:{ready:true,show,inspect}});
