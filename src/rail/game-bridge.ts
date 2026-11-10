import {railPath} from './graph.ts';
import type {RailNetworkRuntime} from './network-runtime.ts';
import type {RailGameFrame,RailGameInput,RailGameResult} from './game-rail.ts';

/** The road worker owns held demand until a committed frame reaches this host.
 * Results are echoed until the worker reports those offers no longer pending. */
export class RailGameBridge {
 private bound:RailNetworkRuntime|null=null;private generation=0;
 private results=new Map<number,RailGameResult>();private enabled=false;
 private readonly epoch:string;private readonly getRail:()=>RailNetworkRuntime|null|undefined;
 constructor(epoch:string,getRail:()=>RailNetworkRuntime|null|undefined){this.epoch=epoch;this.getRail=getRail;}
 private runtime():RailNetworkRuntime|null {
  const rail=this.getRail()??null;
  if(rail!==this.bound){this.bound=rail;this.generation++;rail?.bindTrafficEpoch(this.epoch);}
  return rail;
 }
 private config():Pick<RailGameInput,'stations'|'key'> {
  const rail=this.runtime();if(!rail)return {stations:null,key:null};const s=rail.snapshot,service=s.service;
  if(!service||!s.model?.accepting||!service.snapshot.enabled||s.stations.length!==2||!Object.values(service.snapshot.openStations).every(Boolean))return {stations:null,key:null};
  const [a,b]=s.stations;if(!railPath(s.graph,a.cell,b.cell)||!railPath(s.graph,b.cell,a.cell))return {stations:null,key:null};
  return {stations:[a.cell,b.cell],key:JSON.stringify([this.generation,s.cityId,s.epoch,s.graph.revision,a.id,a.cell,b.id,b.cell])};
 }
 /** Avoid changing the no-rail game when this city has never enabled rail. */
 input():RailGameInput|undefined {
  const config=this.config();if(config.stations)this.enabled=true;
  if(!this.enabled&&!this.results.size)return undefined;
  return {...config,results:[...this.results.values()].map(r=>({...r}))};
 }
 onFrame(frame:RailGameFrame|undefined,allowNew=true):void {
  if(!frame)return;const present=new Set(frame.offers.map(o=>o.id));
  for(const id of this.results.keys())if(!present.has(id))this.results.delete(id);
  for(const offer of frame.offers){if(this.results.has(offer.id)||!allowNew)continue;
   const config=this.config(),rail=this.bound;
   const accepted=!!rail&&!!config.key&&config.key===offer.key&&rail.acceptTrafficDemand({epoch:this.epoch,sequence:offer.id,from:offer.from,to:offer.to,persons:offer.persons}).accepted;
   this.results.set(offer.id,{id:offer.id,accepted});
  }
 }
}
