import { Entity, StandardMaterial, Color, BLEND_NORMAL } from 'playcanvas';
import type { CityView } from './renderer.ts';
import { trafficPlan, visualHash, type TrafficPlan } from './traffic-plan.ts';
import type { City } from './sim.ts';

const CAR_COLOURS = ['#d9534f', '#e8a53a', '#4a90d9', '#58b368', '#e6e6e0', '#8e5ea2'];
const WALKER_COLOURS = ['#e07a5f', '#3d85c6', '#81b29a', '#f2cc8f', '#9b72aa', '#d9d9d9'];
const CELL = 2, LANE = .36, SIDEWALK = .8;
type Actor = { key: string; kind: 'car' | 'truck' | 'walker'; entity: Entity; route: number[]; p: number; dir: 1 | -1; speed: number; oneWay: boolean; retire: boolean };

/**
 * Decorative traffic. Counts and routes come from trafficPlan() (real employment, deliveries,
 * residents, producing factories); movement is purely visual and never touches the simulation.
 */
export class SceneTraffic {
  private readonly root = new Entity('Decorative city life');
  private readonly actors = new Map<string, Actor>();
  private readonly smoke = new Map<number, Entity>();
  private readonly puffMaterial = new StandardMaterial();
  private readonly lightMaterial = new StandardMaterial();
  private signature = '';
  private enabled = true;
  private clock = 0;
  private lastCity: City | null = null;

  constructor(private readonly view: CityView) {
    view.app.root.addChild(this.root);
    this.puffMaterial.name = 'Factory smoke'; this.puffMaterial.diffuse = new Color(.78, .78, .8); this.puffMaterial.opacity = .5;
    this.puffMaterial.blendType = BLEND_NORMAL; this.puffMaterial.depthWrite = false; this.puffMaterial.useLighting = false;
    this.puffMaterial.emissive = new Color(.7, .7, .72); this.puffMaterial.update();
    this.lightMaterial.name = 'Vehicle lights'; this.lightMaterial.diffuse = new Color(.9, .85, .6);
    this.lightMaterial.emissive = new Color(1, .86, .55); this.lightMaterial.emissiveIntensity = 0; this.lightMaterial.update();
    view.atmosphere.registerGlow(this.lightMaterial, 2.2);
  }

  get count() { return this.actors.size; }
  get plumes() { return this.smoke.size; }

  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.clear(); else { this.signature = ''; if (this.lastCity) this.sync(this.lastCity); }
    this.view.app.renderNextFrame = true;
  }

  private clear() {
    for (const actor of this.actors.values()) actor.entity.destroy();
    for (const plume of this.smoke.values()) plume.destroy();
    this.actors.clear(); this.smoke.clear();
  }

  /** Cheap to call every render; the plan is rebuilt only when the day or the road network changes. */
  sync(city: City) {
    this.lastCity = city;
    if (!this.enabled) return;
    const roads = city.cells.reduce((n, cell) => n + (cell.road ? 1 : 0), 0);
    const key = `${city.tick}:${roads}:${city.buildings.length}:${city.employment.length}`;
    if (key === this.signature) return;
    this.signature = key;
    this.apply(trafficPlan(city), city);
  }

  private apply(plan: TrafficPlan, city: City) {
    const wanted = new Set([...plan.cars, ...plan.trucks, ...plan.walkers].map(v => v.key));
    for (const actor of this.actors.values()) if (!actor.oneWay && !wanted.has(actor.key)) actor.retire = true; // finish the pass, then leave
    for (const car of plan.cars) this.add(car.key, 'car', car.route, car.colour, false);
    for (const truck of plan.trucks) this.add(truck.key, 'truck', truck.route, 0, true);
    for (const walker of plan.walkers) this.add(walker.key, 'walker', walker.route, walker.colour, false);
    const live = new Set(plan.smoke);
    for (const [cell, plume] of this.smoke) if (!live.has(cell)) { plume.destroy(); this.smoke.delete(cell); }
    for (const cell of live) if (!this.smoke.has(cell)) this.smoke.set(cell, this.makePlume(cell, city.buildings.find(b => b.cell === cell)?.level ?? 1));
    this.view.app.renderNextFrame = true;
  }

  private add(key: string, kind: Actor['kind'], route: number[], colour: number, oneWay: boolean) {
    const existing = this.actors.get(key);
    if (existing) { existing.retire = false; return; }
    const entity = new Entity(`${kind} ${key}`), view = this.view, box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, c: string | StandardMaterial) => view.box(entity, x, y, z, sx, sy, sz, c, false);
    if (kind === 'car') {
      const c = CAR_COLOURS[colour % CAR_COLOURS.length];
      box(0, .1, 0, .3, .1, .6, c); box(0, .19, -.03, .24, .09, .3, '#cfe3ee'); box(0, .11, .31, .24, .04, .03, this.lightMaterial);
    } else if (kind === 'truck') {
      box(0, .12, .2, .32, .16, .22, '#e8e0cf'); box(0, .15, -.12, .36, .22, .5, '#4a6572'); box(0, .09, .32, .26, .04, .03, this.lightMaterial);
    } else {
      const c = WALKER_COLOURS[colour % WALKER_COLOURS.length];
      box(0, .05, 0, .07, .1, .06, '#3b4258'); box(0, .15, 0, .1, .13, .08, c); box(0, .26, 0, .075, .075, .075, '#f1c9a5');
    }
    this.root.addChild(entity);
    const seed = visualHash(route[0], route.length + key.length);
    const speed = kind === 'walker' ? .45 + seed * .2 : kind === 'truck' ? 1.5 + seed * .3 : 2 + seed * .6;
    // Spread starting positions so a fleet released on one tick does not move in lockstep.
    const actor: Actor = { key, kind, entity, route, p: oneWay ? 0 : seed * Math.max(0, route.length - 1), dir: 1, speed, oneWay, retire: false };
    this.actors.set(key, actor); this.move(actor, 0); // placed at once, even while the game is paused
  }

  private makePlume(cell: number, level: number): Entity {
    const plume = new Entity(`Factory smoke ${cell}`), { x, z } = this.view.position(cell);
    plume.setLocalPosition(x + (level >= 2 ? .68 : .5), level >= 2 ? 1.5 : 1.1, z + (level >= 2 ? -.62 : -.35));
    for (let k = 0; k < 3; k++) {
      const puff = new Entity(`Puff ${k}`);
      puff.addComponent('render', { type: 'sphere', material: this.puffMaterial, castShadows: false, receiveShadows: false });
      plume.addChild(puff);
    }
    this.root.addChild(plume); return plume;
  }

  /** Advance decorative motion; `running` is false while the game is paused or hidden. */
  update(dt: number, running: boolean) {
    if (!this.enabled || !running || (!this.actors.size && !this.smoke.size)) return;
    const step = Math.min(dt, .1); this.clock += step;
    for (const actor of [...this.actors.values()]) this.move(actor, step);
    for (const plume of this.smoke.values()) plume.children.forEach((puff, k) => {
      const phase = (this.clock * .3 + k / 3) % 1, size = .1 + .36 * Math.sin(phase * Math.PI);
      puff.setLocalPosition(phase * .35, phase * 1.5, phase * .2); puff.setLocalScale(size, size, size);
    });
    this.view.app.renderNextFrame = true;
  }

  private move(actor: Actor, dt: number) {
    const last = actor.route.length - 1;
    if (last > 0) {
      actor.p += actor.dir * actor.speed * dt / CELL;
      if (actor.p >= last) {
        if (actor.oneWay || actor.retire) { actor.entity.destroy(); this.actors.delete(actor.key); return; }
        actor.p = last; actor.dir = -1;
      } else if (actor.p <= 0) {
        if (actor.retire) { actor.entity.destroy(); this.actors.delete(actor.key); return; }
        actor.p = 0; actor.dir = 1;
      }
    }
    const a = Math.min(Math.max(Math.floor(actor.p), 0), Math.max(0, last - 1)), b = Math.min(a + 1, last), t = last > 0 ? actor.p - a : 0;
    const from = this.view.position(actor.route[a]), to = this.view.position(actor.route[b]);
    let hx = (to.x - from.x) * actor.dir, hz = (to.z - from.z) * actor.dir;
    const length = Math.hypot(hx, hz) || 1; hx /= length; hz /= length;
    // Right-hand lane or sidewalk, relative to the direction of travel.
    const offset = actor.kind === 'walker' ? SIDEWALK : LANE, sway = actor.kind === 'walker' && last === 0 ? Math.sin(this.clock * .8 + actor.route[0]) * .5 : 0;
    const x = from.x + (to.x - from.x) * t + hz * offset + (last === 0 ? sway : 0), z = from.z + (to.z - from.z) * t - hx * offset;
    actor.entity.setLocalPosition(x, actor.kind === 'walker' ? .14 : .14, z);
    actor.entity.setLocalEulerAngles(0, Math.atan2(hx, hz) * 180 / Math.PI, 0);
  }
}
