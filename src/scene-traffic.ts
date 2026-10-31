import { roadTopologyKey } from './road-topology.ts';
import { decorativePlan } from './traffic/flag.ts';
import { Entity, StandardMaterial, Color, BLEND_NORMAL } from 'playcanvas';
import type { CityView } from './renderer.ts';
import { MAX_CARS, MAX_TRUCKS, commuteGoal, keyHash, leaderAhead, overlapping, trafficPlan, type CommuteGoal, type Mover, type TrafficPlan } from './traffic-plan.ts';
import type { City } from './sim.ts';
import { START_HOUR } from './atmosphere.ts';

const CAR_COLOURS = ['#d9534f', '#e8a53a', '#4a90d9', '#58b368', '#e6e6e0', '#8e5ea2'];
const WALKER_COLOURS = ['#e07a5f', '#3d85c6', '#81b29a', '#f2cc8f', '#9b72aa', '#d9d9d9'];
// Cargo beds, in traffic-plan CARGO order: rice, vegetables, sugarcane, milled rice, canned food, sugar.
const CARGO_COLOURS = ['#e9cf6a', '#5fae4e', '#7cc5d9', '#f2ecdc', '#c8573f', '#ffffff'];
const CELL = 2, LANE = .36, SIDEWALK = .8, PARK = .68;
/** Car following: stop this far behind the vehicle ahead, drive at full pace from SAFE_GAP. */
const MIN_GAP = .14, SAFE_GAP = .75, ACCEL = 3, WAIT_LIMIT = 3, GHOST = 1.2;
/** Seconds a truck spends loading or unloading at each end of its delivery route. */
const DWELL = 3;
type Actor = {
  outbound?: number[]; inbound?: number[]; leg?: 'home' | 'work';
  key: string; kind: 'car' | 'truck' | 'walker'; entity: Entity; route: number[]; p: number; dir: 1 | -1; speed: number; v: number;
  rank: number; depart: number; errand: number; retire: boolean; parked: boolean; dwell: number; waited: number; ghost: number;
  x: number; z: number; hx: number; hz: number;
};

/**
 * Decorative traffic. Counts and routes come from trafficPlan() (real employment, deliveries,
 * residents, producing factories); movement is purely visual and never touches the simulation.
 * Commuters drive to work in the morning rush and home in the evening rush of the visual day and
 * park in between; each delivery route keeps its own truck, which stops to load at both ends; and
 * vehicles keep their distance in a lane, queueing instead of driving through each other.
 */
export class SceneTraffic {
  private readonly root = new Entity('Decorative city life');
  private readonly actors = new Map<string, Actor>();
  private readonly smoke = new Map<number, Entity>();
  private readonly puffMaterial = new StandardMaterial();
  private readonly lightMaterial = new StandardMaterial();
  private signature = '';
  private topologySignature = '';
  private enabled = true;
  private walkersEnabled = true;
  private clock = 0;
  private lastCity: City | null = null;
  private readonly view: CityView;

  constructor(view: CityView) {
    this.view = view;
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
  /** Read-only QA view: what is on the road now and how many vehicle bodies overlap. */
  get diagnostics() {
    const all = [...this.actors.values()], moving = all.filter(a => !a.parked && a.kind !== 'walker'), movers = moving.map(a => this.mover(a));
    let overlaps = 0;
    for (let i = 0; i < movers.length; i++) for (let j = i + 1; j < movers.length; j++) if (overlapping(movers[i], movers[j])) overlaps++;
    return {
      actors: all.length, cars: moving.filter(a => a.kind === 'car').length, trucks: moving.filter(a => a.kind === 'truck').length,
      parked: all.filter(a => a.parked).length, overlaps, creeping: moving.filter(a => a.ghost > 0).length,
    };
  }

  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.clear(); else { this.signature = ''; if (this.lastCity) this.sync(this.lastCity); }
    this.view.app.renderNextFrame = true;
  }

  /** Real park citizens replace decorative people; vehicles remain independent. */
  private carsEnabled = true;
  setWalkersEnabled(enabled: boolean) {
    if (enabled === this.walkersEnabled) return;
    this.walkersEnabled = enabled;
    if (!enabled) for (const [id, actor] of this.actors) if (actor.kind === 'walker') {
      actor.entity.destroy(); this.actors.delete(id);
    }
    this.signature = '';
    if (this.lastCity) this.sync(this.lastCity);
  }

  private clear() {
    for (const actor of this.actors.values()) actor.entity.destroy();
    for (const plume of this.smoke.values()) plume.destroy();
    this.actors.clear(); this.smoke.clear();
  }

  /** Cheap to call every render; the plan is rebuilt only when the day or the road network changes. */
  sync(city: City) {
    // A loaded or new city is a different simulation even if its tick and topology match.
    // Retiring actors belong to the previous city and must not survive a replacement.
    if (this.lastCity && this.lastCity !== city) { this.clear(); this.signature = ''; this.topologySignature = ''; }
    this.lastCity = city;
    if (!this.enabled) return;
    const roads = city.cells.reduce((n, cell) => n + (cell.road ? 1 : 0), 0);
    const topology = city.cells.map(c=>c.road?'1':'0').join('') + roadTopologyKey(city);
    if (topology !== this.topologySignature) { for (const actor of this.actors.values()) actor.entity.destroy(); this.actors.clear(); this.topologySignature = topology; }
    const key = `${city.tick}:${roads}:${topology}:${city.buildings.length}:${city.employment.length}`;
    if (key === this.signature) return;
    this.signature = key;
    this.apply(trafficPlan(city), city);
  }

  /** The aggregate traffic fleet replaces decorative cars only; trucks and smoke stay. */
  setCarsEnabled(enabled: boolean) {
    if (enabled === this.carsEnabled) return;
    this.carsEnabled = enabled;
    // Moving decorative cars give way to the fleet, but commuters' parked cars stay at the kerb.
    if (!enabled) for (const [id, actor] of this.actors) if (actor.kind === 'car' && !actor.parked) {
      const goal = this.goal(actor);
      if (goal === 'cruise' || actor.retire) { actor.entity.destroy(); this.actors.delete(id); }
      else if (actor.outbound) this.parkDirected(actor, goal); else this.park(actor, goal === 'work' ? actor.route.length - 1 : 0);
    }
    this.signature = '';
    if (this.lastCity) this.sync(this.lastCity);
  }

  private apply(plan: TrafficPlan, city: City) {
    plan = decorativePlan(plan, { cars: true, walkers: this.walkersEnabled });
    const wanted = new Map([...plan.cars, ...plan.trucks, ...plan.walkers].map(v => [v.key, v.route] as const));
    // Gone from the plan: finish the trip, then leave. A changed road network re-routes at once.
    for (const actor of this.actors.values()) {
      const route = wanted.get(actor.key);
      if (!route) actor.retire = true;
      else if (route.join() !== (actor.outbound ?? actor.route).join()) { actor.entity.destroy(); this.actors.delete(actor.key); }
    }
    for (const car of plan.cars) this.add(car.key, 'car', car.route, car.colour, car.returnRoute);
    for (const truck of plan.trucks) this.add(truck.key, 'truck', truck.route, truck.colour, truck.returnRoute);
    for (const walker of plan.walkers) this.add(walker.key, 'walker', walker.route, walker.colour);
    // Keep the screen within the caps: over them, leaving vehicles go at once (parked ones first).
    for (const [kind, cap] of [['car', MAX_CARS], ['truck', MAX_TRUCKS]] as const) {
      const own = [...this.actors.values()].filter(a => a.kind === kind), leaving = own.filter(a => a.retire).sort((a, b) => Number(b.parked) - Number(a.parked));
      for (let extra = own.length - cap; extra > 0 && leaving.length; extra--) { const a = leaving.shift()!; a.entity.destroy(); this.actors.delete(a.key); }
    }
    const live = new Set(plan.smoke);
    for (const [cell, plume] of this.smoke) if (!live.has(cell)) { plume.destroy(); this.smoke.delete(cell); }
    for (const cell of live) if (!this.smoke.has(cell)) this.smoke.set(cell, this.makePlume(cell, city.buildings.find(b => b.cell === cell)?.level ?? 1));
    this.view.app.renderNextFrame = true;
  }

  private add(key: string, kind: Actor['kind'], route: number[], colour: number, returnRoute?: number[]) {
    const existing = this.actors.get(key);
    if (existing) { existing.retire = false; return; }
    const entity = new Entity(`${kind} ${key}`), view = this.view, box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, c: string | StandardMaterial) => view.box(entity, x, y, z, sx, sy, sz, c, false);
    if (kind === 'car') {
      const c = CAR_COLOURS[colour % CAR_COLOURS.length];
      box(0, .1, 0, .3, .1, .6, c); box(0, .19, -.03, .24, .09, .3, '#cfe3ee'); box(0, .11, .31, .24, .04, .03, this.lightMaterial);
    } else if (kind === 'truck') {
      box(0, .12, .2, .32, .16, .22, '#e8e0cf'); box(0, .15, -.12, .36, .22, .5, '#4a6572'); box(0, .27, -.12, .3, .03, .44, CARGO_COLOURS[colour % CARGO_COLOURS.length]); box(0, .09, .32, .26, .04, .03, this.lightMaterial);
    } else {
      const c = WALKER_COLOURS[colour % WALKER_COLOURS.length];
      box(0, .05, 0, .07, .1, .06, '#3b4258'); box(0, .15, 0, .1, .13, .08, c); box(0, .26, 0, .075, .075, .075, '#f1c9a5');
    }
    this.root.addChild(entity);
    // Seeded by the whole key: actors that share a route still start apart and keep their own pace.
    const seed = keyHash(key), pace = keyHash(`${key}:pace`);
    const speed = kind === 'walker' ? .45 + pace * .2 : kind === 'truck' ? 1.5 + pace * .3 : 2 + pace * .6;
    const actor: Actor = {
      key, kind, entity, route, p: seed * Math.max(0, route.length - 1), dir: seed < .5 ? 1 : -1, speed, v: speed, rank: seed,
      depart: keyHash(`${key}:depart`), errand: keyHash(`${key}:errand`), retire: false, parked: false, dwell: 0, waited: 0, ghost: 0, x: 0, z: 0, hx: 0, hz: 1,
    };
    if (returnRoute) { actor.outbound = route; actor.inbound = returnRoute; actor.leg = seed < .5 ? 'work' : 'home'; actor.route = actor.leg === 'work' ? route : returnRoute; actor.dir = 1; actor.p = seed * Math.max(0, actor.route.length - 1); }
    // A commuter appears where the hour puts it: parked at home or at work, or out on an errand.
    if (kind === 'car') { const goal = this.goal(actor); if (goal !== 'cruise') { if (actor.outbound) this.parkDirected(actor, goal); else this.park(actor, goal === 'work' ? route.length - 1 : 0); } }
    if (kind === 'car' && !this.carsEnabled && !actor.parked) { entity.destroy(); return; }
    this.actors.set(key, actor); if (actor.parked) this.placeParked(actor); else this.move(actor, 0); // placed at once, even while the game is paused
  }

  private goal(actor: Actor): CommuteGoal { return commuteGoal(this.view.atmosphere.hour ?? START_HOUR, actor.depart, actor.errand); }

  private parkDirected(actor: Actor, reached: 'home' | 'work') {
    actor.leg = reached === 'home' ? 'work' : 'home';
    actor.route = actor.leg === 'work' ? actor.outbound! : actor.inbound!;
    actor.p = 0; actor.dir = 1; actor.parked = true; actor.v = 0; this.placeParked(actor);
  }

  private park(actor: Actor, at: number) {
    actor.p = at; actor.dir = at === 0 ? 1 : -1; actor.parked = true; actor.v = 0; this.placeParked(actor);
  }

  /** Parked vehicles sit visibly at the kerb, outside the driving lane, spread along the block. */
  private placeParked(actor: Actor) {
    const route = actor.route; if (!route.length) return;
    const i = Math.min(Math.max(Math.round(actor.p), 0), route.length - 1), j = i === 0 ? Math.min(1, route.length - 1) : i - 1;
    const from = this.view.position(route[i]), to = this.view.position(route[j]);
    let hx = to.x - from.x, hz = to.z - from.z; const len = Math.hypot(hx, hz);
    if (len) { hx /= len; hz /= len; } else { hx = 0; hz = 1; }
    const along = (actor.rank - .5) * 1.1, x = from.x + hx * along + hz * PARK, z = from.z + hz * along - hx * PARK;
    actor.x = x; actor.z = z; actor.hx = hx; actor.hz = hz; actor.entity.enabled = true;
    actor.entity.setLocalPosition(x, .14, z); actor.entity.setLocalEulerAngles(0, Math.atan2(hx, hz) * 180 / Math.PI, 0);
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
    for (const actor of [...this.actors.values()]) {
      if (!actor.parked) continue;
      if (actor.retire) { actor.entity.destroy(); this.actors.delete(actor.key); continue; }
      // Trucks load for a moment; commuters leave when their rush (or an errand) comes.
      const leave = actor.kind === 'truck' ? (actor.dwell -= step) <= 0 : this.goal(actor) !== (actor.leg ? (actor.leg === 'work' ? 'home' : 'work') : actor.p === 0 ? 'home' : 'work');
      if (leave && actor.kind === 'car' && !this.carsEnabled) {
        // The fleet drives; a decorative car just turns up parked at its next stop.
        const goal = this.goal(actor);
        if (goal !== 'cruise') { if (actor.outbound) this.parkDirected(actor, goal); else this.park(actor, goal === 'work' ? actor.route.length - 1 : 0); }
      } else if (leave) { actor.parked = false; actor.entity.enabled = true; actor.v = 0; }
    }
    this.follow(step);
    for (const actor of [...this.actors.values()]) if (!actor.parked) this.move(actor, step);
    for (const plume of this.smoke.values()) plume.children.forEach((puff, k) => {
      const phase = (this.clock * .3 + k / 3) % 1, size = .1 + .36 * Math.sin(phase * Math.PI);
      puff.setLocalPosition(phase * .35, phase * 1.5, phase * .2); puff.setLocalScale(size, size, size);
    });
    this.view.app.renderNextFrame = true;
  }

  private mover(a: Actor): Mover { return { x: a.x, z: a.z, hx: a.hx, hz: a.hz, length: a.kind === 'truck' ? .72 : .6, width: a.kind === 'truck' ? .36 : .3, rank: a.rank }; }

  /** Each vehicle slows behind the one ahead in its lane and stops short of it, so lines queue instead of overlapping. */
  private follow(dt: number) {
    const vehicles = [...this.actors.values()].filter(a => !a.parked && a.kind !== 'walker'), movers = vehicles.map(a => this.mover(a));
    const ahead = vehicles.map((_, i) => leaderAhead(movers, i));
    vehicles.forEach((a, i) => {
      let { leader, gap } = ahead[i];
      // Two vehicles waiting on each other (a crossing): the lower rank goes first.
      if (leader >= 0 && ahead[leader].leader === i && a.rank < vehicles[leader].rank) leader = -1;
      // Nothing waits forever: after a long stop, creep through for a moment.
      if (a.ghost > 0) { a.ghost -= dt; leader = -1; }
      const target = leader < 0 ? a.speed : a.speed * Math.min(1, Math.max(0, (gap - MIN_GAP) / (SAFE_GAP - MIN_GAP)));
      a.v = target < a.v ? target : Math.min(target, a.v + ACCEL * dt);
      a.waited = a.v < .05 ? a.waited + dt : 0;
      if (a.waited > WAIT_LIMIT) { a.waited = 0; a.ghost = GHOST; }
    });
  }

  private move(actor: Actor, dt: number) {
    let last = actor.route.length - 1;
    if (last > 0) {
      actor.p += actor.dir * (actor.kind === 'walker' ? actor.speed : actor.v) * dt / CELL;
      if (actor.leg && actor.p >= last) {
        if (actor.retire) { actor.entity.destroy(); this.actors.delete(actor.key); return; }
        const reached = actor.leg;
        if (actor.kind === 'truck' || this.goal(actor) === reached) { this.parkDirected(actor, reached); actor.dwell = DWELL; return; }
        actor.leg = reached === 'home' ? 'work' : 'home'; actor.route = actor.leg === 'work' ? actor.outbound! : actor.inbound!; actor.p = 0; actor.dir = 1; last = actor.route.length - 1;
      } else if (!actor.leg && (actor.p >= last || actor.p <= 0)) {
        const end = actor.p >= last ? last : 0;
        if (actor.retire) { actor.entity.destroy(); this.actors.delete(actor.key); return; }
        if (actor.kind === 'truck') { this.park(actor, end); actor.dwell = DWELL; return; }
        // A commuter parks once it reaches where it wants to be; errands turn round.
        if (actor.kind === 'car') { const goal = this.goal(actor); if (goal === (end === 0 ? 'home' : 'work')) { this.park(actor, end); return; } }
        actor.p = end; actor.dir = end === last ? -1 : 1;
      }
    }
    const a = Math.min(Math.max(Math.floor(actor.p), 0), Math.max(0, last - 1)), b = Math.min(a + 1, last), t = last > 0 ? actor.p - a : 0;
    const from = this.view.position(actor.route[a]), to = this.view.position(actor.route[b]);
    let hx = (to.x - from.x) * actor.dir, hz = (to.z - from.z) * actor.dir;
    const length = Math.hypot(hx, hz) || 1; hx /= length; hz /= length;
    // Right-hand lane or sidewalk, relative to the direction of travel.
    const oneway = this.lastCity?.roadTopology?.oneWay[actor.route[a]] || this.lastCity?.roadTopology?.oneWay[actor.route[b]];
    const offset = actor.kind === 'walker' ? SIDEWALK : oneway && actor.rank < .5 ? -LANE : LANE, sway = actor.kind === 'walker' && last === 0 ? Math.sin(this.clock * .8 + actor.route[0]) * .5 : 0;
    const x = from.x + (to.x - from.x) * t + hz * offset + (last === 0 ? sway : 0), z = from.z + (to.z - from.z) * t - hx * offset;
    actor.x = x; actor.z = z; actor.hx = hx; actor.hz = hz;
    actor.entity.setLocalPosition(x, .14, z);
    actor.entity.setLocalEulerAngles(0, Math.atan2(hx, hz) * 180 / Math.PI, 0);
  }
}
