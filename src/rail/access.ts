import {roadLinked,roadNeighbors,type RoadMap} from '../road-topology.ts';
import {safeCount} from './graph.ts';
/** Pedestrians use actual connected road edges; vehicle one-way arrows do not block walking.
 * The two endpoint parcels may be off-road. No straight-line radius or hidden teleport. */
export function railAccessPath(map:RoadMap,from:number,to:number):number[]|null{
  if(!safeCount(from)||!safeCount(to)||from>=576||to>=576)throw Error('Invalid rail access endpoint');
  if(from===to)return [from];
  const queue=[from],previous=new Map<number,number>();previous.set(from,from);
  for(let at=0;at<queue.length;at++)for(const next of roadNeighbors(queue[at])){
    const current=queue[at];if(previous.has(next))continue;
    const legal=map.cells[current]?.road&&map.cells[next]?.road?roadLinked(map,current,next)
      :current===from&&!map.cells[current]?.road&&map.cells[next]?.road || next===to&&!map.cells[next]?.road&&map.cells[current]?.road;
    if(!legal)continue;previous.set(next,current);
    if(next===to){const path=[to];while(path[0]!==from)path.unshift(previous.get(path[0])!);return path;}
    queue.push(next);
  }
  return null;
}
