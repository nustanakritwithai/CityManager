import { AppBase, AppOptions, createGraphicsDevice, DEVICETYPE_WEBGL2, RenderComponentSystem, CameraComponentSystem,
  LightComponentSystem, ContainerHandler, TextureHandler, Entity, Color, StandardMaterial, BoundingBox, type RenderComponent } from 'playcanvas';
import { CityAssets, disconnectedBuildingMaterial } from '../src/asset-models.ts';
import { SceneAtmosphere } from '../src/scene-atmosphere.ts';
import { atmosphereAt } from '../src/atmosphere.ts';

const canvas = document.querySelector('canvas')!;
canvas.width = innerWidth; canvas.height = innerHeight;
const options = new AppOptions();
options.graphicsDevice = await createGraphicsDevice(canvas, { deviceTypes: [DEVICETYPE_WEBGL2], antialias: true });
options.componentSystems = [RenderComponentSystem, CameraComponentSystem, LightComponentSystem];
options.resourceHandlers = [ContainerHandler, TextureHandler];
const app = new AppBase(canvas); app.init(options);
const camera = new Entity('Review camera');
camera.addComponent('camera', { clearColor: new Color(.1,.17,.23), fov: 40, nearClip: .1, farClip: 260 });
camera.setPosition(9, 10, 16); camera.lookAt(0, 2.4, 0); app.root.addChild(camera);
const atmosphere = new SceneAtmosphere(app, camera); atmosphere.setQuality('medium'); atmosphere.follow(22);
const assets = await CityAssets.load(app);
assets.glowRegistrar = (material, strength, blink) => atmosphere.registerGlow(material, strength, blink);
const ground = new Entity('Review floor'), floor = new StandardMaterial(); floor.diffuse = new Color(.29,.36,.35); floor.update();
ground.addComponent('render', { type: 'box', material: floor }); ground.setLocalScale(15,.08,8); ground.setLocalPosition(0,-.05,0); app.root.addChild(ground);
let controls: Entity[] = [];
let models: Entity[] = [], faded: StandardMaterial[] = [];
function show(night=false, occupied=true, disconnected=false) {
  for(const model of controls)model.destroy();controls=[];
  camera.setPosition(12,15,20);camera.lookAt(0,1.7,0);
  for(const model of models) model.destroy(); models=[];
  for(const material of faded) material.destroy(); faded=[];
  for(let level=1;level<=9;level++) {
    const model=assets.building('R',level,level,occupied); if(!model) throw Error(`Missing R${level}`);
    model.setLocalPosition(((level-1)%3-1)*3.4,0,(Math.floor((level-1)/3)-1)*4); app.root.addChild(model); models.push(model);
    if(disconnected) for(const render of model.findComponents('render') as RenderComponent[]) for(const instance of render.meshInstances) {
      const material=disconnectedBuildingMaterial(instance.material as StandardMaterial); faded.push(material); instance.material=material;
    }
  }
  atmosphere.apply(atmosphereAt(night?22:12));
  document.querySelector('#case')!.textContent=`R1–3 houses · R4–6 apartments · R7–9 luxury · ${night?'Night':'Day'} · ${disconnected?'Disconnected':occupied?'Occupied':'Empty'}`;
}
function inspect() { return models.map((model,index)=>{
  const renders=model.findComponents('render') as RenderComponent[]; let bounds:BoundingBox|undefined;
  for(const render of renders) for(const instance of render.meshInstances) { if(bounds)bounds.add(instance.aabb);else bounds=instance.aabb.clone(); }
  return {level:index+1,name:model.name,width:bounds!.halfExtents.x*2,depth:bounds!.halfExtents.z*2,height:bounds!.halfExtents.y*2,
    floors:renders.filter(r=>/^Apartment floor /.test(r.entity.name)).length,
    windows:renders.filter(r=>r.entity.name==='Apartment warm window').map(r=>(r.meshInstances[0].material as StandardMaterial).emissiveIntensity),
    courtLights:renders.filter(r=>r.entity.name==='Apartment courtyard lamp').map(r=>(r.meshInstances[0].material as StandardMaterial).emissiveIntensity),
    luxury:!!model.findByName('Luxury podium'),tanks:model.children.filter(child=>child.name==='Apartment rooftop tank').length,awning:!!model.findByName('Apartment entrance awning')};
}); }
function showControls(night=false) {
  for(const model of models)model.enabled=false;
  for(const model of controls)model.destroy();controls=[];
  for(const [index,level] of [3,4,7].entries()) {
    const model=assets.building('C',level-1,level,true);if(!model)throw Error(`Missing C${level}`);
    model.setLocalPosition((index-1)*3.4,0,0);app.root.addChild(model);controls.push(model);
  }
  camera.setPosition(9,10,16);camera.lookAt(0,2,0);atmosphere.apply(atmosphereAt(night?22:12));
  document.querySelector('#case')!.textContent=`Commercial controls C3 · C4 · C7 · ${night?'Night':'Day'} (unchanged)`;
}
function inspectControls(){return controls.map((model,index)=>({level:[3,4,7][index],apartments:(model.findComponents('render') as RenderComponent[]).some(r=>/^Apartment /.test(r.entity.name)),luxury:!!model.findByName('Luxury podium'),pool:!!model.findByName('Turquoise infinity pool'),beacon:!!model.findByName('Aviation beacon')}));}
camera.setPosition(12,15,20); camera.lookAt(0,1.7,0);
ground.setLocalScale(15,.08,15);
show();app.start();Object.assign(window,{apartmentReview:{ready:assets.status.failed.length===0,status:assets.status,show,inspect,showControls,inspectControls}});
