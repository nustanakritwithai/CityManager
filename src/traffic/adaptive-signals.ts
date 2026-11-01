import {roadTopologyKey,type RoadMap} from '../road-topology.ts';

/** Exact worker/display binding; includes edits while the city identity stays unchanged. */
export function signalTopologyKey(map:RoadMap):string {return map.cells.map(c=>c.road?'1':'0').join('')+roadTopologyKey(map);}
export type TrafficSignalFrame={topology:string;phases:{node:number;approach:number|null;state:'green'|'all-red'}[]};

/** Ephemeral worker-clock signals. An approach is one inbound link, so turns
 * never gain a conflicting permissive phase. Physical grants remain separate. */
export const SIGNAL_MIN_GREEN=10, SIGNAL_MAX_GREEN=40, SIGNAL_CLEARANCE=2, SIGNAL_URGENT_WAIT=60; // 5 substeps/sec
export type SignalDemand={approach:number;queue:number;oldest:number;coordination?:number};
export type SignalPhase={approach:number|null;since:number;clearUntil:number;previous?:number};
export function chooseSignal(phase:SignalPhase|undefined, demand:readonly SignalDemand[], now:number, occupied:boolean):SignalPhase {
  // Only feasible lane heads are supplied. A blocked exit is not a promise of service.
  const ranked=[...demand].sort((a,b)=>{
    const urgentA=now-a.oldest>=SIGNAL_URGENT_WAIT,urgentB=now-b.oldest>=SIGNAL_URGENT_WAIT;
    return Number(urgentB)-Number(urgentA)||(urgentA&&urgentB?a.oldest-b.oldest:0)||
      (b.queue+(now-b.oldest)/10+(b.coordination??0))-(a.queue+(now-a.oldest)/10+(a.coordination??0))||a.oldest-b.oldest||a.approach-b.approach;
  });
  const best=ranked[0];
  if(!phase)return {approach:occupied?null:best?.approach??null,since:now,clearUntil:now+(occupied?SIGNAL_CLEARANCE:0)};
  if(phase.approach===null){
    if(occupied)return {...phase,approach:null,since:now,clearUntil:now+SIGNAL_CLEARANCE};
    if(now<phase.clearUntil)return phase;
    // A max-green handoff must offer a different still-feasible approach,
    // not immediately reselect the largest queue after the all-red.
    const next=ranked.find(d=>d.approach!==phase.previous)??best;
    return {approach:next?.approach??null,since:now,clearUntil:now};
  }
  const active=demand.find(d=>d.approach===phase.approach),other=ranked.find(d=>d.approach!==phase.approach);
  // Never revoke an occupied corridor. The clearance clock starts after it clears.
  if(occupied)return phase;
  const age=now-phase.since;
  if((!active&&other)||(other&&age>=SIGNAL_MIN_GREEN&&(age>=SIGNAL_MAX_GREEN||now-other.oldest>=SIGNAL_URGENT_WAIT||best?.approach!==phase.approach)))
    return {approach:null,since:now,clearUntil:now+SIGNAL_CLEARANCE,previous:phase.approach};
  return phase;
}
