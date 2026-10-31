import { AppBase, BoundingBox, Vec3, Entity, StandardMaterial, Color, BLEND_NORMAL, type RenderComponent } from 'playcanvas';
import type { CityAssets } from './asset-models.ts';
import { factoryLevel } from './factory-levels.ts';
import { RECIPE, type CropMix, type RecipeId } from './goods.ts';

/** Visual-only activity: allocated labour, connected utilities and the actual recipe's input. */
export function factoryWorking(workers: number, connected: boolean, supplied: boolean, recipe: RecipeId | undefined, crops: CropMix): boolean {
  return workers > 0 && connected && supplied && !!recipe && crops[RECIPE[recipe].crop] >= 2;
}
export function factoryVisualTier(level: number) {
  factoryLevel(level); // Preserve the simulation's strict absolute-level contract.
  return { tanks: level >= 7 ? 3 : level >= 5 ? 2 : 1, chimneys: level >= 6 ? 2 : 1, annex: level >= 6, lights: level >= 8 };
}
export function factoryBounds(entity: Entity): BoundingBox {
  let bounds: BoundingBox | undefined;
  for (const render of entity.findComponents('render') as RenderComponent[]) for (const mesh of render.meshInstances) {
    if (bounds) bounds.add(mesh.aabb); else bounds = mesh.aabb.clone();
  }
  if (!bounds) throw Error('Factory part has no renderable bounds');
  return bounds;
}
/** Locate the mouth from the highest authored vertices, not a potentially offset base AABB. */
export function factoryChimneyTip(entity: Entity) {
  const points: Vec3[] = [];
  let top = -Infinity;
  for (const render of entity.findComponents('render') as RenderComponent[]) for (const instance of render.meshInstances) {
    if (!instance.mesh) continue;
    const positions: number[] = []; instance.mesh.getPositions(positions);
    const transform = instance.node.getWorldTransform();
    for (let i = 0; i < positions.length; i += 3) {
      const p = transform.transformPoint(new Vec3(positions[i], positions[i + 1], positions[i + 2]));
      points.push(p); top = Math.max(top, p.y);
    }
  }
  const mouth = points.filter(p => p.y >= top - .002);
  if (!mouth.length) throw Error('Factory chimney has no mouth vertices');
  return { x: (Math.min(...mouth.map(p => p.x)) + Math.max(...mouth.map(p => p.x))) / 2,
    y: top, z: (Math.min(...mouth.map(p => p.z)) + Math.max(...mouth.map(p => p.z))) / 2 };
}
// Shared materials and one app update, never timers, particle systems or per-factory lights.
export class FactoryVisuals {
  private materials = new Map<string, StandardMaterial>();
  private smoke = new Set<{ root: Entity; puffs: Entity[]; tips: { x: number; y: number; z: number }[] }>();
  private seconds = 0;
  static readonly SMOKE_BUDGET = 96;
  get smokeCount() { let n = 0; for (const group of this.smoke) n += group.puffs.length; return n; }
  private app: AppBase;
  private glow: (material: StandardMaterial, strength: number, blink?: boolean) => void;
  constructor(app: AppBase, glow: (material: StandardMaterial, strength: number, blink?: boolean) => void) {
    this.app = app; this.glow = glow;
    app.on('update', this.update, this);
    app.once('destroy', () => { app.off('update', this.update, this); this.smoke.clear(); for (const m of this.materials.values()) m.destroy(); this.materials.clear(); });
  }
  private material(color: string, glow = 0, blink = false) {
    const key = `${color}:${glow}:${blink}`;
    let material = this.materials.get(key);
    if (!material) {
      material = new StandardMaterial(); material.name = `Factory ${key}`; material.diffuse = new Color().fromString(color); material.gloss = .35; material.emissiveIntensity = 0;
      if (glow) { material.emissive = material.diffuse.clone(); material.emissiveIntensity = 0; this.glow(material, glow, blink); }
      if (color === '#c3c8cb') { material.opacity = .22; material.blendType = BLEND_NORMAL; material.depthWrite = false; }
      material.update(); this.materials.set(key, material);
    }
    return material;
  }
  private part(root: Entity, name: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string, type: 'box' | 'cylinder' | 'sphere' = 'box', glow = 0, blink = false) {
    const e = new Entity(name); e.addComponent('render', { type, material: this.material(color, glow, blink), castShadows: glow === 0 && sy > .08, receiveShadows: true });
    e.setLocalPosition(x,y,z); e.setLocalScale(sx,sy,sz); root.addChild(e); return e;
  }
  /** Fit each admitted model into a disjoint slot, deriving height/pivot from real bounds. */
  private fit(root: Entity, e: Entity, name: string, x: number, z: number, width: number, depth: number, maxHeight: number) {
    e.name = name;
    const before = factoryBounds(e), scale = Math.min(width / (before.halfExtents.x * 2), depth / (before.halfExtents.z * 2), maxHeight / (before.halfExtents.y * 2));
    e.setLocalScale(e.getLocalScale().clone().mulScalar(scale));
    const fitted = factoryBounds(e);
    const position = e.getLocalPosition();
    e.setLocalPosition(position.x + x - fitted.center.x, position.y + .1 - fitted.center.y + fitted.halfExtents.y, position.z + z - fitted.center.z);
    root.addChild(e); return factoryBounds(e);
  }
  build(assets: CityAssets | null, level: number, cell: number, working: boolean, powered: boolean, low = false, reducedMotion = false): Entity {
    if (level < 4) throw Error('Factory complex requires absolute level 4–9');
    const tier = factoryVisualTier(level), root = new Entity(`Factory complex L${level}`);
    const hall = assets?.building('I', factoryLevel(level).model, cell, powered);
    let hallBounds: BoundingBox;
    if (hall) hallBounds = this.fit(root, hall, 'Factory main hall', .24, -.06, 1.02, .87, 1.12 + (level - 4) * .04);
    else { const base = this.part(root, 'Factory main hall', .24,.43,-.06,1.02,.66,.87,'#af8871'); this.part(root,'Factory hall roof',.24,.79,-.06,1.06,.06,.91,'#69767b'); hallBounds = factoryBounds(base); }
    for (let n = 0; n < tier.tanks; n++) {
      const z = -.40 + n * .42, tank = assets?.detail('tank', .30);
      const tankBounds = tank ? this.fit(root,tank,`Factory input tank ${n}`,-.62,z,.30,.30,.70 + n * .08) : factoryBounds(this.part(root,`Factory input tank ${n}`,-.62,.39,z,.30,.58,.30,'#bac6c9','cylinder'));
      const edge = tankBounds.center.x + tankBounds.halfExtents.x;
      // Pipes meet the tank edge and hall wall, not their interiors. Pipe rack runs in the clear service aisle.
      this.part(root,'Yellow feed pipe',(edge - .34) / 2,.24,z,-.34 - edge,.035,.035,'#d9ae44');
    }
    this.part(root,'Metal service manifold',-.34,.24,.02,.035,.035,.88,'#8b999f');
    const wall = hallBounds.center.x - hallBounds.halfExtents.x;
    this.part(root,'Hall feed pipe',(wall - .34) / 2,.24,-.06,wall + .34,.035,.035,'#d9ae44');
    if (tier.annex) {
      this.part(root,'Factory loading annex',.20,.29,.59,.68,.38,.30,'#a77455');
      this.part(root,'Factory annex roof',.20,.50,.59,.73,.04,.34,'#677d84');
      this.part(root,'Factory loading door',.20,.25,.744,.24,.27,.015,'#475a65');
    }
    const tips: { x: number; y: number; z: number }[] = [];
    for (let n = 0; n < tier.chimneys; n++) {
      const x = .02 + n * .48, z = -.69, chimney = assets?.detail('chimney',.22);
      if (chimney) this.fit(root,chimney,`Factory chimney ${n}`,x,z,.22,.22,1.65 + level * .035);
      const stack = chimney ?? this.part(root,`Factory chimney ${n}`,x,.91,z,.18,1.62,.18,'#8e7364','cylinder');
      const tip = factoryChimneyTip(stack), top = tip.y;
      tips.push(tip);
      if (tier.lights) this.part(root,'Factory red warning',x + .08,top - .04,z,.045,.035,.045,'#f14d38','sphere',powered ? 3 : 0,true);
    }
    if (tier.lights) for (const x of [-.73,.70]) {
      this.part(root,'Factory security pole',x,.38,.76,.025,.56,.025,'#62777e');
      this.part(root,'Factory warm yard light',x,.67,.76,.085,.035,.065,'#ffd497','box',powered ? 2.4 : 0);
    }
    if (level >= 9) this.part(root,'Factory annex upper office',.20,.62,.59,.50,.20,.24,'#a8bec5');
    if (working && !low && !reducedMotion && this.smokeCount + tips.length * 3 <= FactoryVisuals.SMOKE_BUDGET) {
      const puffs: Entity[] = [];
      for (const tip of tips) for (let n = 0; n < 3; n++) puffs.push(this.part(root,'Factory chimney smoke',tip.x,tip.y,tip.z,.07,.09,.07,'#c3c8cb','sphere'));
      for (const p of puffs) p.render!.castShadows = false;
      const group = { root, tips, puffs }; this.smoke.add(group); root.once('destroy', () => this.smoke.delete(group)); this.update(0);
    }
    return root;
  }
  update(dt: number) {
    this.seconds += Math.min(Math.max(dt,0),.1);
    for (const group of this.smoke) for (let n = 0; n < group.puffs.length; n++) {
      const t = (this.seconds * .32 + (n % 3) / 3) % 1, tip = group.tips[Math.floor(n / 3)], puff = group.puffs[n];
      const size = .065 + t * .075;
      puff.setLocalPosition(tip.x + t * .07,tip.y + .035 + t * .48,tip.z + t * .025); puff.setLocalScale(size,size * 1.3,size);
    }
    if (this.smoke.size) this.app.renderNextFrame = true;
  }
}
