/** Deterministic peak-hour estimates, not observed individual journeys.
 * Sources are existing household job allocations, roads and park footpaths.
 * This snapshot never changes pay, trips, happiness, the clock, or save data.
 */
import type { City } from './sim.ts';
import { parkPedestrianRoute } from './park-activity.ts';
import { roadNeighborsFor } from './road-topology.ts';
import { buildNetwork, linkKey, TILE_LENGTH_M } from './traffic/network.ts';
import { linkTimes, pathTime, shortestTree } from './traffic/routing.ts';

/** Provisional peak assumes three quarters of workers assigned car routes travel
 * in one hour, one vehicle each. */
export const COMMUTE_PEAK_SHARE = .75;
const PARK_WALK_SECONDS_PER_TILE = TILE_LENGTH_M * 3.6 / 5;
export type CommuteEstimate = { householdId: number; workers: number; reachableWorkers: number;
  unreachableWorkers: number; averageSeconds: number | null; freeFlowSeconds: number | null };
type Job = { householdId: number; home: number | null; work: number | null; workers: number; parkJob: boolean };
type Paths = { outbound: number[] | null; inbound: number[] | null; walkSeconds: number | null };

/** A synchronous snapshot. Discard after any job, home or road edit. */
export function prepareCommuteEstimates(city: City) {
  const buildings = new Map(city.buildings.map(b => [b.id, b.cell]));
  const homes = new Map(city.households.map(h => [h.id, h.home === null ? null : buildings.get(h.home) ?? null]));
  const firms = new Map(city.firms.map(f => [f.id, buildings.get(f.building) ?? null]));
  const parks = new Map(city.parks.map(p => [p.id, p.cell]));
  const campuses = new Map((city.education?.campuses ?? []).map(c => [c.id, c.cell]));
  const jobs: Job[] = [];
  const add = (householdId: number, work: number | null | undefined, workers: number, parkJob = false) => {
    if (homes.has(householdId) && workers > 0) jobs.push({ householdId, home: homes.get(householdId)!, work: work ?? null, workers, parkJob });
  };
  for (const a of city.employment) add(a.householdId, firms.get(a.firmId), a.workers);
  for (const a of city.ownerLabor) add(a.householdId, firms.get(a.firmId), a.workers);
  for (const park of city.parks) for (const a of park.staffing?.allocations ?? []) add(a.householdId, parks.get(a.parkId), a.workers, true);
  for (const person of city.education?.people ?? []) if (person.campusId !== null) add(person.householdId, campuses.get(person.campusId), person.teacher + person.professor);
  if (!jobs.length) return {all:[] as CommuteEstimate[], estimates:new Map<number,CommuteEstimate>(), atHome:(_householdId:number,_homeCell:number):CommuteEstimate|undefined=>undefined, moved:(_householdId:number,_homeCell:number):void=>{}};
  const net = buildNetwork(city), freeTimes = linkTimes(net, new Map());
  const frontage = new Map<number, number[]>();
  const roadsAt = (cell: number | null): number[] => {
    if (cell === null) return [];
    let roads = frontage.get(cell);
    if (!roads) { roads = (city.cells[cell]?.road ? [cell] : roadNeighborsFor(city, cell).filter(n => city.cells[n]?.road)).sort((a,b) => a-b); frontage.set(cell, roads); }
    return roads;
  };
  const trees = new Map<number, Map<number, number>>();
  const route = (from: number, to: number): number[] | null => {
    if (from === to) return [from];
    let tree = trees.get(from); if (!tree) { tree = shortestTree(net, freeTimes, from); trees.set(from, tree); }
    if (!tree.has(to)) return null;
    const path = [to]; while (path[0] !== from) path.unshift(tree.get(path[0])!); return path;
  };
  const best = (origin: number | null, destination: number | null): number[] | null => {
    let selected: number[] | null = null, cost = Infinity;
    for (const from of roadsAt(origin)) for (const to of roadsAt(destination)) {
      const candidate = route(from, to); if (!candidate) continue;
      const seconds = pathTime(candidate, freeTimes);
      if (seconds < cost) { cost = seconds; selected = candidate; }
    }
    return selected;
  };
  const routes = new Map<string, Paths>();
  const pathsFor = (home: number | null, job: Job): Paths => {
    const { work, parkJob } = job;
    const key = `${home}:${work}:${parkJob}`;
    let paths = routes.get(key);
    if (!paths) {
      const outbound = best(home, work), inbound = best(work, home);
      const walk = parkJob && (!outbound || !inbound) && home !== null && work !== null
        ? parkPedestrianRoute(city, home, work) : [];
      paths = walk.length > 1
        ? { outbound: null, inbound: null, walkSeconds: (walk.length - 1) * PARK_WALK_SECONDS_PER_TILE }
        : { outbound, inbound, walkSeconds: null };
      routes.set(key, paths);
    }
    return paths;
  };
  const byHousehold = new Map<number,{job:Job;paths:Paths}[]>();
  const volumes = [new Map<string, number>(), new Map<string, number>()];
  const load=(maps:Map<string,number>[], paths:Paths, workers:number) => {
    [paths.outbound,paths.inbound].forEach((path,direction)=>{
      if (!path) return;
      for (let n=1;n<path.length;n++) { const key=linkKey(path[n-1],path[n]); maps[direction].set(key,Math.max(0,(maps[direction].get(key)??0)+workers*COMMUTE_PEAK_SHARE)); }
    });
  };
  for(const job of jobs){const paths=pathsFor(job.home,job);const rows=byHousehold.get(job.householdId)??[];rows.push({job,paths});byHousehold.set(job.householdId,rows);load(volumes,paths,job.workers);}
  let times=volumes.map(v=>linkTimes(net,v));
  const summarize=(householdId:number,rows:{job:Job;paths:Paths}[],costs:Map<string,number>[]):CommuteEstimate => {
    let workers=0,reachable=0,seconds=0,free=0;
    for(const {job,paths:{outbound,inbound,walkSeconds}} of rows){
      workers+=job.workers;
      if (walkSeconds !== null) {
        reachable += job.workers;
        seconds += walkSeconds * job.workers;
        free += walkSeconds * job.workers;
        continue;
      }
      if(!outbound||!inbound)continue; reachable+=job.workers;
      seconds+=Math.max(pathTime(outbound,costs[0]),pathTime(inbound,costs[1]))*job.workers;
      free+=Math.max(pathTime(outbound,freeTimes),pathTime(inbound,freeTimes))*job.workers;
    }
    return {householdId,workers,reachableWorkers:reachable,unreachableWorkers:workers-reachable,
      averageSeconds:reachable?seconds/reachable:null,freeFlowSeconds:reachable?free/reachable:null};
  };
  let all:CommuteEstimate[]=[]; const estimates=new Map<number,CommuteEstimate>();
  const refresh=()=>{all=[...byHousehold].sort(([a],[b])=>a-b).map(([id,rows])=>summarize(id,rows,times));estimates.clear();for(const row of all)estimates.set(row.householdId,row);};
  refresh();
  /** Hypothetical relocation uses the same traffic assumptions, removing this
   * household's old demand before adding the proposed one. It is never applied. */
  function atHome(householdId:number,homeCell:number):CommuteEstimate|undefined {
    const rows=byHousehold.get(householdId);if(!rows)return undefined;
    const nextVolumes=volumes.map(v=>new Map(v));
    const next=rows.map(({job,paths})=>{load(nextVolumes,paths,-job.workers);const replacement=pathsFor(homeCell,job);load(nextVolumes,replacement,job.workers);return {job,paths:replacement};});
    return summarize(householdId,next,nextVolumes.map(v=>linkTimes(net,v)));
  }
  /** Advance this snapshot only after the caller successfully commits the same move. */
  function moved(householdId:number,homeCell:number):void {
    const rows=byHousehold.get(householdId);if(!rows)return;
    for(const row of rows){load(volumes,row.paths,-row.job.workers);row.job.home=homeCell;row.paths=pathsFor(homeCell,row.job);load(volumes,row.paths,row.job.workers);}
    times=volumes.map(v=>linkTimes(net,v));refresh();
  }
  return {get all(){return all;},estimates,atHome,moved};
}
/** One estimate per household with an assigned job. Unrouteable is a modeled
 * condition, not evidence that a person tried or failed a real trip. */
export function estimateHouseholdCommutes(city: City): CommuteEstimate[] { return prepareCommuteEstimates(city).all; }
