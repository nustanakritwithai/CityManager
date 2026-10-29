import type { AppBase } from 'playcanvas';
import { roadTopologyKey } from '../road-topology.ts';
import type { City } from '../sim.ts';
import { SceneCitizenVehicles } from '../scene-citizen-vehicles.ts';
import { TrafficClock, gameMinute } from './clock.ts';
import { changedRoadCells } from './flag.ts';
export { trafficModelEnabled } from './flag.ts';
import { animateFleet, createFleet, fleetPoses, updateFleet, type FleetState } from './fleet.ts';

/**
 * Game-side glue, created only when the flag is on. Owns the clock, the fleet and the instanced
 * renderer; reads City, never writes it. Old decorative traffic is hidden while this is active.
 */
export class TrafficLayer {
  readonly clock = new TrafficClock({ enabled: true });
  readonly fleet: FleetState = createFleet();
  private readonly cars: SceneCitizenVehicles;
  private roads: boolean[] = []; private topo = ''; private city: City | null = null;
  private readonly hideDecorative: () => void;
  constructor(app: AppBase, hideDecorative: () => void) { this.cars = new SceneCitizenVehicles(app); this.hideDecorative = hideDecorative; }
  /** Call after any map command (road build, split, bulldoze). Rebuilds only the changed region. */
  afterMapEdit(c: City): void {
    const roads = c.cells.map(x => x.road), topo = roadTopologyKey(c);
    if (c === this.city) { const changed = changedRoadCells(this.roads, roads, this.topo, topo); if (changed.length) this.clock.roadEdited(c, changed); }
    this.city = c; this.roads = roads; this.topo = topo;
  }
  frame(c: City, minuteOfDay: number, paused: boolean, dt: number): void {
    this.hideDecorative();
    if (c !== this.city) { this.fleet.links.clear(); this.afterMapEdit(c); }
    const ran = this.clock.advance(c, gameMinute(c.tick, minuteOfDay), paused), net = this.clock.network;
    if (ran.length && net) updateFleet(this.fleet, net, ran.at(-1)!.volumes);
    if (!net) { this.cars.sync([]); return; }
    if (!paused) animateFleet(this.fleet, dt);
    this.cars.sync(fleetPoses(this.fleet, net));
  }
  get diagnostics() { return { ...this.cars.diagnostics, totals: this.clock.totals, links: this.fleet.links.size }; }
}
