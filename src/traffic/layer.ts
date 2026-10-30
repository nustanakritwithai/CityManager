import type { AppBase } from 'playcanvas';
import { roadTopologyKey } from '../road-topology.ts';
import type { City } from '../sim.ts';
import { SceneCitizenVehicles } from '../scene-citizen-vehicles.ts';
import { TrafficClock, gameMinute } from './clock.ts';
import { changedRoadCells } from './flag.ts';
import { activeCars, createFleet, fleetPoses, setFleetDemand, stepFleet, type FleetState } from './fleet.ts';
export { trafficModelEnabled } from './flag.ts';
/**
 * Game-side glue, created only when the flag is on. Owns the clock, the fleet and the instanced
 * renderer; reads City, never writes it. Road changes from any source are detected by comparing
 * the road signature every frame, and rebuild only the changed region.
 */
export class TrafficLayer {
  readonly clock = new TrafficClock({ enabled: true });
  fleet: FleetState = createFleet();
  private readonly cars: SceneCitizenVehicles;
  private readonly onScreen: (cell: number) => boolean;
  private roads: boolean[] = []; private topo = ''; private sig = ''; private city: City | null = null;
  constructor(app: AppBase, onScreen: (cell: number) => boolean = () => true) { this.cars = new SceneCitizenVehicles(app); this.onScreen = onScreen; }
  /** Optional explicit nudge after a map command; frame() also catches every other edit path. */
  afterMapEdit(c: City): void { this.checkRoads(c); }
  private checkRoads(c: City): void {
    const sig = c.cells.map(x => x.road ? '1' : '0').join('') + roadTopologyKey(c);
    if (c === this.city && sig === this.sig) return;
    const roads = c.cells.map(x => x.road), topo = roadTopologyKey(c);
    if (c === this.city) { const changed = changedRoadCells(this.roads, roads, this.topo, topo); if (changed.length) this.clock.roadEdited(c, changed); }
    else this.fleet = createFleet();
    this.city = c; this.roads = roads; this.topo = topo; this.sig = sig;
  }
  frame(c: City, minuteOfDay: number, paused: boolean, dt: number): void {
    this.checkRoads(c);
    const ran = this.clock.advance(c, gameMinute(c.tick, minuteOfDay), paused), net = this.clock.network, last = this.clock.last;
    if (ran.length && net && last) setFleetDemand(this.fleet, net, this.clock.lastOd, last.assigned, last.times);
    if (!net) { this.cars.sync([]); return; }
    if (!paused) stepFleet(this.fleet, net, Math.min(dt, .25));
    const seen = new Map<number, boolean>(), visible = (cell: number) => { let v = seen.get(cell); if (v === undefined) seen.set(cell, v = this.onScreen(cell)); return v; };
    this.cars.sync(fleetPoses(this.fleet, net, visible));
  }
  get diagnostics() { return { ...this.cars.diagnostics, active: activeCars(this.fleet), simulated: this.fleet.cars.length, totals: this.clock.totals }; }
}
