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
let models: Entity[] = [], faded: StandardMaterial[] = [];
const cells = [0,1,2].map(variant => {
  for (let cell = 0; cell < 100; cell++) if ((((Math.imul(cell >>> 0,1103515245)+12345) >>> 16) & 0x7fff) % 3 === variant) return cell;
  throw Error('No variant cell');
});
function show(zone: 'R'|'C', actualLevel: number, night = false, occupied = true, disconnected = false) {
  for (const model of models) model.destroy(); models = [];
  for (const material of faded) material.destroy(); faded = [];
  for (let variant = 0; variant < 3; variant++) {
    const model = assets.building(zone, zone === 'C' ? actualLevel - 1 : actualLevel, cells[variant], occupied);
    if (!model) throw Error(`Missing tower ${variant}`);
    model.setLocalPosition((variant - 1) * 3.6, 0, 0); app.root.addChild(model); models.push(model);
    if (disconnected) for (const render of model.findComponents('render') as RenderComponent[]) for (const instance of render.meshInstances) {
      const material = disconnectedBuildingMaterial(instance.material as StandardMaterial); faded.push(material); instance.material = material;
    }
  }
  atmosphere.apply(atmosphereAt(night ? 21.5 : 12.5));
  document.querySelector('#case')!.textContent = `${zone}${actualLevel} · ${night ? 'Night' : 'Day'}${!occupied ? ' · unoccupied' : ''}${disconnected ? ' · disconnected' : ''}`;
}
function inspect() {
  return models.map(model => {
    let bounds: BoundingBox | undefined;
    for (const render of model.findComponents('render') as RenderComponent[]) for (const instance of render.meshInstances) {
      if (bounds) bounds.add(instance.aabb); else bounds = instance.aabb.clone();
    }
    const beacon = model.findByName('Aviation beacon') as Entity | null;
    const pool = model.findByName('Turquoise infinity pool') as Entity | null;
    return { podium: !!model.findByName('Luxury podium'), shaft: !!model.findByName('Luxury setback shaft'), crown: !!model.findByName('Luxury flat crown'),
      pool: !!pool, poolOpacity: (pool?.render?.meshInstances[0].material as StandardMaterial | undefined)?.opacity,
      rail: !!model.findByName('Glass balcony rail'), beacon: !!beacon,
      intensity: (beacon?.render?.meshInstances[0].material as StandardMaterial | undefined)?.emissiveIntensity ?? 0,
      rooms: model.findComponents('render').filter(r => r.entity.name === 'Tower room overlays').length,
      width: bounds!.halfExtents.x * 2, depth: bounds!.halfExtents.z * 2, height: bounds!.halfExtents.y * 2 };
  });
}
// Capture only an observed live phase. Freeze dt atomically with the observation;
// screenshots may take longer than a pulse on CI, but no material value is fabricated.
function freezeBeaconPhase(on: boolean) {
  const rows = inspect();
  if (!rows.length || !rows.every(row => row.beacon && (on ? row.intensity > 0 : row.intensity === 0))) return false;
  app.timeScale = 0; return true;
}
function resumeAnimation() { app.timeScale = 1; }
show('R',4); app.start();
Object.assign(window, { towerReview: { ready: assets.status.failed.length === 0, status: assets.status, show, inspect, freezeBeaconPhase, resumeAnimation } });
