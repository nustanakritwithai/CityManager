import {linkKey,type LinkNetwork} from './network.ts';
import {SIGNAL_MIN_GREEN,type SignalPhase} from './adaptive-signals.ts';
/** At most eight road tiles to the next controlled junction. No branch is skipped. */
export const SIGNAL_CORRIDOR_TILES=8,SIGNAL_NEIGHBOR_BIAS=.75;
export type SignalCorridor={from:number;to:number;approach:number;distance:number;first:number};
export type NeighborSignalState={node:number;phase:SignalPhase|undefined;queue:number;space:number;byApproach:Readonly<Record<number,number>>};
export function buildSignalCorridors(network:LinkNetwork,junctions:ReadonlySet<number>,bends:ReadonlySet<number>):ReadonlyMap<string,SignalCorridor>{
 const result=new Map<string,SignalCorridor>();
 for(const from of [...junctions].filter(n=>!bends.has(n)).sort((a,b)=>a-b))for(const start of network.out.get(from)??[]){
  let previous=from,current=start.to;const seen=new Set([from]);
  for(let distance=1;distance<=SIGNAL_CORRIDOR_TILES;distance++){
   if(seen.has(current))break;seen.add(current);
   if(junctions.has(current)&&!bends.has(current)){result.set(linkKey(from,start.to),{from,to:current,approach:previous,distance,first:start.to});break;}
   const onward=(network.out.get(current)??[]).filter(edge=>edge.to!==previous);if(onward.length!==1)break;
   previous=current;current=onward[0].to;
  }
 }
 return result;
}
/** Soft, bounded forecast only. A phase is not a space reservation, and no
 * forecast can veto a feasible buffered movement or outrank urgent local age.
 * .75 queue units equal 1.5 seconds of ordinary local age weighting. */
export function neighborSignalBias(state:NeighborSignalState|undefined,incoming:number,travelSteps:number,now:number,localSpace:number,farPressure=0):number {
 if(!state||localSpace<=0)return 0;
 const phase=state.phase,incomingQueue=state.byApproach[incoming]??0;
 const aligned=incomingQueue>0&&phase?.approach===incoming&&now+travelSteps-phase.since<=SIGNAL_MIN_GREEN;
 const receiving=Math.max(0,Math.min(1,state.space))*Math.max(0,Math.min(1,localSpace));
 // Partial occupancy is normal buffering, not proof of spillback. Likewise
 // max-green is a ceiling, not a promise that green lasts until arrival.
 const pressure=state.space<=0?Math.min(1,incomingQueue/3):0;
 const bias=(aligned?SIGNAL_NEIGHBOR_BIAS*receiving:0)-.5*pressure-.25*Math.max(0,Math.min(1,farPressure));
 return Math.max(-SIGNAL_NEIGHBOR_BIAS,Math.min(SIGNAL_NEIGHBOR_BIAS,bias));
}
