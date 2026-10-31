import { AppBase, AppOptions, createGraphicsDevice, DEVICETYPE_WEBGL2, RenderComponentSystem, CameraComponentSystem, LightComponentSystem, ContainerHandler, TextureHandler, Entity, Color, StandardMaterial } from 'playcanvas';
import { CityAssets } from '../src/asset-models.ts';
import { FactoryVisuals, factoryBounds, factoryChimneyTip } from '../src/factory-visuals.ts';
import { SceneAtmosphere } from '../src/scene-atmosphere.ts';
import { atmosphereAt } from '../src/atmosphere.ts';
const canvas=document.querySelector('canvas')!; canvas.width=innerWidth;canvas.height=innerHeight;
const options=new AppOptions(); options.graphicsDevice=await createGraphicsDevice(canvas,{deviceTypes:[DEVICETYPE_WEBGL2],antialias:true});
options.componentSystems=[RenderComponentSystem,CameraComponentSystem,LightComponentSystem];options.resourceHandlers=[ContainerHandler,TextureHandler];
const app=new AppBase(canvas);app.init(options);
const camera=new Entity('Review camera');camera.addComponent('camera',{clearColor:new Color(.1,.17,.23),fov:35,nearClip:.1,farClip:100});camera.setPosition(4.8,5.0,7);camera.lookAt(0,.7,0);app.root.addChild(camera);
const atmosphere=new SceneAtmosphere(app,camera);atmosphere.setQuality('medium');atmosphere.follow(14);
const assets=await CityAssets.load(app);assets.glowRegistrar=(m,s,b)=>atmosphere.registerGlow(m,s,b);
const factories=new FactoryVisuals(app,(m,s,b)=>atmosphere.registerGlow(m,s,b));
const floor=new Entity('Review yard'),floorMat=new StandardMaterial();floorMat.diffuse=new Color(.27,.32,.31);floorMat.update();floor.addComponent('render',{type:'box',material:floorMat});floor.setLocalScale(7,.08,4);floor.setLocalPosition(0,-.05,0);app.root.addChild(floor);
let models:Entity[]=[];
function show(level:number,night=false,working=true,powered=true,low=false,fallback=false) {
  for(const model of models)model.destroy();models=[];
  for(let variant=0;variant<2;variant++) {
    // Cells 0 and 3 select factory-e/f under the admitted deterministic hash.
    const model=factories.build(fallback?null:assets,level,variant * 3,working,powered,low);
    model.setLocalPosition((variant-.5)*2.6,0,0);app.root.addChild(model);models.push(model);
  }
  atmosphere.apply(atmosphereAt(night?21.5:12.5));document.querySelector('#case')!.textContent=`Factory L${level} · ${night?'Night':'Day'} · ${working?'Working':'Inactive'}${!powered?' · disconnected/unpowered':''}${low?' · low quality':''}${fallback?' · asset fallback':''}`;
}
function inspect() {return models.map(model=>{
  const b=factoryBounds(model),children=model.children as Entity[],smoke=children.filter(e=>e.name==='Factory chimney smoke');
  const stacks=children.filter(e=>/^Factory chimney \d/.test(e.name));
  const solids=children.filter(e=>/Factory (main hall|input tank|chimney \d|loading annex)/.test(e.name));
  const intersections:string[]=[];for(let a=0;a<solids.length;a++)for(let c=a+1;c<solids.length;c++)if(factoryBounds(solids[a]).intersects(factoryBounds(solids[c])))intersections.push(`${solids[a].name}/${solids[c].name}`);
  const lamps=children.filter(e=>e.name==='Factory warm yard light'||e.name==='Factory red warning');
  return {width:b.halfExtents.x*2,depth:b.halfExtents.z*2,height:b.halfExtents.y*2,tanks:children.filter(e=>e.name.startsWith('Factory input tank')).length,chimneys:stacks.length,annex:!!model.findByName('Factory loading annex'),smoke:smoke.length,intersections,lights:lamps.length,intensities:lamps.map(e=>(e.render!.meshInstances[0].material as StandardMaterial).emissiveIntensity),tips:stacks.map(factoryChimneyTip),puffs:smoke.map(e=>({x:e.getPosition().x,y:e.getPosition().y,z:e.getPosition().z})),realLights:model.findComponents('light').length};
});}
function cleanup(){for(const model of models)model.destroy();models=[];return factories.smokeCount;}
show(4);app.start();Object.assign(window,{factoryReview:{ready:assets.status.failed.length===0,status:assets.status,show,inspect,cleanup}});
