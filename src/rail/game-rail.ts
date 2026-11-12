import { railAccessPath } from './access.ts';
import {roadLinked,roadNeighborsFor,type RoadMap} from '../road-topology.ts';

/** Ephemeral worker reservation, in the same representative units as road demand.
 * It does not become a rail rider until the host has accepted it. */
export type RailGameOffer={id:number;from:number;to:number;roadFrom:number;roadTo:number;persons:number;key:string};
export type RailGameContributor={from:number;to:number;roadFrom:number;roadTo:number;weight:number};
export type RailGameResult={id:number;accepted:boolean};
export type RailGameInput={stations:[number,number]|null;key:string|null;results:RailGameResult[]};
export type RailGameFrame={offers:RailGameOffer[];accepted:number;held:number};
export const RAIL_GAME_SHARE=.5, RAIL_GAME_CATCHMENT=3, RAIL_GAME_MAX_PENDING=128;
export function validRailGameInput(input:unknown):input is RailGameInput {
 const x=input as RailGameInput;
 return !!x&&(x.key===null||typeof x.key==='string'&&x.key.length>0&&x.key.length<=1000)&&(x.stations===null?x.key===null:x.key!==null)&&(x.stations===null||Array.isArray(x.stations)&&x.stations.length===2&&x.stations.every(n=>Number.isSafeInteger(n)&&n>=0))&&Array.isArray(x.results)&&x.results.length<=RAIL_GAME_MAX_PENDING&&x.results.every(r=>!!r&&Number.isSafeInteger(r.id)&&r.id>0&&typeof r.accepted==='boolean')&&new Set(x.results.map(r=>r.id)).size===x.results.length;
}
/** Only a covered representative OD can make an offer; host checks again at commit. */
export function railGameCovers(map:RoadMap,stations:[number,number],from:number,to:number):boolean {
 const [a,b]=stations;if(a===b||a>=map.cells.length||b>=map.cells.length)return false;
 const near=(x:number,y:number)=>{const p=railAccessPath(map,x,y);return !!p&&p.length-1<=RAIL_GAME_CATCHMENT;};
 return near(from,a)&&near(to,b)||near(from,b)&&near(to,a);
}

/** Bounded reverse pedestrian search: worker road ODs always end on road cells.
 * The result matches railAccessPath's road-edge policy without a BFS per OD. */
export function railGameCatchments(map:RoadMap,stations:[number,number]):[Set<number>,Set<number>] {
 if(stations[0]===stations[1]||stations.some(s=>s>=map.cells.length))return [new Set(),new Set()];
 const walk=(station:number)=>{const reached=new Set<number>([station]),q:[number,number][]=[[station,0]];
  for(let i=0;i<q.length;i++){const [at,depth]=q[i];if(depth>=RAIL_GAME_CATCHMENT)continue;
   for(const next of roadNeighborsFor(map,at)){if(reached.has(next)||!map.cells[next]?.road)continue;
    if(map.cells[at]?.road&&!roadLinked(map,at,next))continue;reached.add(next);q.push([next,depth+1]);}
  }return reached;};return [walk(stations[0]),walk(stations[1])];
}
