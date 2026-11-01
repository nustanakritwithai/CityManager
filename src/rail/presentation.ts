import type { RailGraph } from './graph.ts';
import type { PassengerRailConfig, PassengerRailSnapshot } from './passenger.ts';

/** Read-only grid coordinates. Weighted edge durations, not equal-length visual segments. */
export function railTrainPose(config: PassengerRailConfig, graph: RailGraph, state: PassengerRailSnapshot, fraction=0) {
  if(graph.revision!==state.graphRevision||!Number.isFinite(fraction)||fraction<0||fraction>=1)throw Error('Invalid rail render clock');
  const t=state.train,station=config.stations.find(s=>s.id===t.station);
  if(!station)throw Error('Unknown train station');
  if(!t.destination)return {x:station.cell%24,z:Math.floor(station.cell/24),headingX:1,headingZ:0,moving:false};
  const segments=t.path.slice(1).map((to,i)=>{const from=t.path[i],link=graph.links.find(l=>l.from===from&&l.to===to);if(!link)throw Error('Train path missing');return link;});
  if(!segments.length)throw Error('Moving train has no path');
  let elapsed=segments.reduce((n,l)=>n+l.minutes,0)-t.remainingMinutes+fraction;
  for(let i=0;i<segments.length;i++){
    const l=segments[i];if(elapsed<l.minutes||i===segments.length-1){
      const progress=Math.max(0,Math.min(1,elapsed/l.minutes)),x=l.from%24,z=Math.floor(l.from/24),dx=l.to%24-x,dz=Math.floor(l.to/24)-z;
      return {x:x+dx*progress,z:z+dz*progress,headingX:dx,headingZ:dz,moving:true};
    }elapsed-=l.minutes;
  }
  throw Error('Invalid train geometry');
}
export function railStationRows(config: PassengerRailConfig,state:PassengerRailSnapshot){
  return config.stations.map(station=>{
    const batches=state.batches.filter(b=>b.fromStation===station.id);
    return {...station,open:state.openStations[station.id],access:batches.filter(b=>b.readyAtMinute>state.minute).reduce((n,b)=>n+b.outside,0),
      outside:batches.filter(b=>b.readyAtMinute<=state.minute).reduce((n,b)=>n+b.outside,0),waiting:batches.reduce((n,b)=>n+b.waiting,0)};
  });
}
