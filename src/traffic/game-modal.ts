import {roadNeighbors,roadTopologyKey,validateRoadTopology,type RoadMap} from '../road-topology.ts';
import {buildNetwork,type LinkNetwork} from './network.ts';
import {TAXI_DEPOT_UNITS,type TaxiDepotSite} from '../taxi/sites.ts';
import {TAXI_AVAILABILITY_CAP} from '../taxi/types.ts';
import {createRailGraph,type RailLink} from '../rail/graph.ts';
import {railAccessPath} from '../rail/access.ts';
import {normalizeTrafficGameSample,type GameDemand,type TrafficGameSample} from './game.ts';

/** Tunable game assumptions, NOT claims about real-world transport. One rate
 * unit is the game's representative road demand per real-time second. A taxi
 * request replaces one private-car unit by 0.5 loaded + 0.25 empty taxi units;
 * taxi vehicles enter the same shared road model rather than vanishing. */
export const GAME_TAXI_RADIUS_ROAD_HOPS=6, GAME_TAXI_CAPACITY_PER_UNIT=.15;
export const GAME_TAXI_LOADED_FACTOR=.5, GAME_TAXI_EMPTY_FACTOR=.25;
export const GAME_RAIL_CATCHMENT_CELLS=3, GAME_RAIL_MAX_SHARE=.6;
export type GameRailLine={id:string;revision:number;stations:[{cell:number;open:boolean},{cell:number;open:boolean}];links:RailLink[];capacity:number};
/** PR124 currently supports a single two-terminal shuttle; multiple lines
 * need an explicit shared-track capacity policy before being enabled. */
export type GameModalConfig={taxis:readonly TaxiDepotSite[];rail:readonly GameRailLine[]};
export type GameModalStats={clippedRate:number;clippedBefore:number;rawRoadBefore:number;rawRoadAfter:number;roadBefore:number;roadAfter:number;railDiverted:number;taxiDiverted:number;taxiLoaded:number;taxiEmpty:number;railByLine:{id:string;shifted:number}[];taxiByDepot:{id:number;shifted:number}[]};
const cell=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<576;
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const signature=(map:RoadMap)=>map.cells.map(c=>c.road?'1':'0').join('')+roadTopologyKey(map);
function reachable(net:LinkNetwork,starts:readonly number[],limit=Infinity):Map<number,number>{
 const result=new Map<number,number>(),q:number[]=[];for(const n of starts)if(!result.has(n)){result.set(n,0);q.push(n);}
 for(let i=0;i<q.length;i++){const from=q[i],d=result.get(from)!;if(d>=limit)continue;for(const l of net.out.get(from)??[])if(!result.has(l.to)){result.set(l.to,d+1);q.push(l.to);}}return result;
}
function railConnected(links:readonly RailLink[],from:number,to:number):boolean {
 const out=new Map<number,number[]>();for(const l of links)(out.get(l.from)??out.set(l.from,[]).get(l.from)!).push(l.to);
 const seen=new Set([from]),q=[from];for(let i=0;i<q.length;i++){const at=q[i];if(at===to)return true;for(const next of out.get(at)??[])if(!seen.has(next)){seen.add(next);q.push(next);}}return false;
}
/** Build only when city roads or the player's upgrade layout changes. The saved
 * prototypes are read as inputs; nothing here writes City, a financial journal or storage. */
export function compileGameModal(map:RoadMap,config:GameModalConfig) {
 if(!map||!Array.isArray(map.cells)||map.cells.length!==576||map.cells.some(c=>!c||typeof c.road!=='boolean')||!config||!Array.isArray(config.taxis)||config.taxis.length>4||!Array.isArray(config.rail)||config.rail.length>1)throw Error('Invalid modal game configuration');
 if(map.roadTopology)validateRoadTopology(map,map.roadTopology);
 const net=buildNetwork(map),ids=new Set<number>();
 const taxis=[...(config.taxis as readonly TaxiDepotSite[])].sort((a,b)=>a.id-b.id).map(d=>{
  if(!Number.isSafeInteger(d.id)||d.id<1||ids.has(d.id)||!cell(d.cell)||(d.level!==1&&d.level!==2)||typeof d.open!=='boolean')throw Error('Invalid taxi depot');ids.add(d.id);
  const starts=roadNeighbors(d.cell).filter(i=>map.cells[i].road),coverage=d.open?reachable(net,starts,GAME_TAXI_RADIUS_ROAD_HOPS):new Map<number,number>();
  return {id:d.id,coverage,capacity:d.open?TAXI_DEPOT_UNITS[d.level]*GAME_TAXI_CAPACITY_PER_UNIT:0};
 });
 const lineIds=new Set<string>();
 const rail=[...(config.rail as readonly GameRailLine[])].sort((a,b)=>a.id.localeCompare(b.id)).map(line=>{
  if(typeof line.id!=='string'||!line.id||line.id.length>100||lineIds.has(line.id)||!Array.isArray(line.stations)||line.stations.length!==2||!finite(line.capacity)||line.capacity>20||!Array.isArray(line.links)||line.links.length>2208)throw Error('Invalid rail line');lineIds.add(line.id);
  const [a,b]=line.stations;if(!a||!b||!cell(a.cell)||!cell(b.cell)||a.cell===b.cell||typeof a.open!=='boolean'||typeof b.open!=='boolean')throw Error('Invalid rail stations');
  // Reuse PR124's rail topology validation and preserve its round-trip requirement.
  const graph=createRailGraph(line.revision,line.links);
  // PR124's current placement policy reserves empty parcels and has no grade
  // crossings; never infer an illegal railway through an occupied road.
  if(map.cells[a.cell].road||map.cells[b.cell].road||graph.links.some(l=>map.cells[l.from].road||map.cells[l.to].road))throw Error('Rail cannot overlap roads');
  const active=a.open&&b.open&&railConnected(graph.links,a.cell,b.cell)&&railConnected(graph.links,b.cell,a.cell);
  return {id:line.id,a:a.cell,b:b.cell,capacity:active?line.capacity:0};
 });
 return {net,taxis,rail,signature:signature(map)};
}
/** Allocate only truly covered raw OD rows before representative binning: an
 * uncovered source must never receive another area's rail/taxi benefit merely
 * because the display model groups them together. Proportional budgets remain
 * bounded; all clipping is explicitly reported. Never mutates the input. */
export function allocateGameModes(sample:TrafficGameSample,context:ReturnType<typeof compileGameModal>):{sample:TrafficGameSample;stats:GameModalStats} {
 const normalized=normalizeTrafficGameSample(sample);
 if(signature(normalized.sample.map)!==context.signature)throw Error('Modal network changed; rebuild coverage');
 // Reconstruct the same representative bins as the core, then apportion each
 // bin's bounded modeled mass back to its original OD members proportionally.
 // Mode coverage is tested per member, not on the representative endpoint.
 const grouped=new Map<string,GameDemand>();
 for(const d of sample.demand){if(d.from===d.to)continue;const key=`${d.from}:${d.to}`,old=grouped.get(key);if(old)old.rate+=d.rate;else grouped.set(key,{...d});}
 const raw=[...grouped.values()].sort((a,b)=>a.from-b.from||a.to-b.to),bins=Math.min(raw.length,64),rows:GameDemand[]=[],ranges:{start:number;end:number;representative:GameDemand}[]=[];
 for(let i=0;i<bins;i++){
  const start=Math.floor(i*raw.length/bins),end=Math.floor((i+1)*raw.length/bins),slice=raw.slice(start,end),total=slice.reduce((n,d)=>n+d.rate,0),modeled=normalized.sample.demand[i].rate,base=rows.length;
  let assigned=0;for(let j=0;j<slice.length;j++){const amount=j===slice.length-1?Math.max(0,modeled-assigned):total?modeled*slice[j].rate/total:0;rows.push({...slice[j],rate:amount});assigned+=amount;}
  ranges.push({start:base,end:rows.length,representative:normalized.sample.demand[i]});
 }
 const railTarget=new Map<string,{i:number;desired:number}[]>(),taxiTarget=new Map<number,{i:number;desired:number}[]>(),railShift=rows.map(()=>0),taxiShift=rows.map(()=>0);
 const accessCache=new Map<string,number>();
 const access=(from:number,to:number)=>{const key=`${from}:${to}`;if(!accessCache.has(key)){const path=railAccessPath(normalized.sample.map,from,to);accessCache.set(key,path?path.length-1:Infinity);}return accessCache.get(key)!;};
 for(let i=0;i<rows.length;i++){
  const d=rows[i],candidates=context.rail.flatMap(line=>{
   if(line.capacity<=0)return [];const fa=access(d.from,line.a),fb=access(d.from,line.b),ta=access(d.to,line.a),tb=access(d.to,line.b);
   const ab=fa<=GAME_RAIL_CATCHMENT_CELLS&&tb<=GAME_RAIL_CATCHMENT_CELLS,ba=fb<=GAME_RAIL_CATCHMENT_CELLS&&ta<=GAME_RAIL_CATCHMENT_CELLS;
   return ab||ba?[{line,score:Math.min(ab?fa+tb:Infinity,ba?fb+ta:Infinity)}]:[];
  }).sort((a,b)=>a.score-b.score||a.line.id.localeCompare(b.line.id));
  if(candidates[0]){const id=candidates[0].line.id;(railTarget.get(id)??railTarget.set(id,[]).get(id)!).push({i,desired:d.rate*GAME_RAIL_MAX_SHARE});}
 }
 const railByLine=context.rail.map(line=>{const targets=railTarget.get(line.id)??[],wanted=targets.reduce((n,x)=>n+x.desired,0),scale=wanted?Math.min(1,line.capacity/wanted):0;let shifted=0;for(const t of targets){const amount=t.desired*scale;railShift[t.i]=amount;shifted+=amount;}return {id:line.id,shifted};});
 const paths=new Map<number,Map<number,number>>();
 for(let i=0;i<rows.length;i++){
  const d=rows[i];let reach=paths.get(d.from);if(!reach){reach=reachable(context.net,[d.from]);paths.set(d.from,reach);}if(!reach.has(d.to))continue;
  const choice=context.taxis.filter(t=>t.capacity>0&&t.coverage.has(d.from)).sort((a,b)=>a.coverage.get(d.from)!-b.coverage.get(d.from)!||a.id-b.id)[0];
  if(choice)(taxiTarget.get(choice.id)??taxiTarget.set(choice.id,[]).get(choice.id)!).push({i,desired:(d.rate-railShift[i])*TAXI_AVAILABILITY_CAP});
 }
 const taxiByDepot=context.taxis.map(depot=>{const targets=taxiTarget.get(depot.id)??[],wanted=targets.reduce((n,x)=>n+x.desired,0),scale=wanted?Math.min(1,depot.capacity/wanted):0;let shifted=0;for(const t of targets){const amount=t.desired*scale;taxiShift[t.i]=amount;shifted+=amount;}return {id:depot.id,shifted};});
 const taxiVehicle=taxiShift.map(n=>n*(GAME_TAXI_LOADED_FACTOR+GAME_TAXI_EMPTY_FACTOR));
 const afterRows=rows.map((d,i)=>d.rate-railShift[i]-taxiShift[i]+taxiVehicle[i]);
 // taxiRate is the cab flow dispatched on that OD (loaded trip plus empty reposition),
 // already included in `rate`. Private cars are the remainder. Omitted when zero so a
 // city without taxis keeps the previous demand objects.
 const demand:GameDemand[]=ranges.map(range=>{const rate=afterRows.slice(range.start,range.end).reduce((a,b)=>a+b,0),taxiRate=taxiVehicle.slice(range.start,range.end).reduce((a,b)=>a+b,0);const row:GameDemand={...range.representative,rate};if(taxiRate>1e-12)row.taxiRate=taxiRate;else delete row.taxiRate;return row;});
 const railDiverted=railShift.reduce((a,b)=>a+b,0),taxiDiverted=taxiShift.reduce((a,b)=>a+b,0),taxiLoaded=taxiDiverted*GAME_TAXI_LOADED_FACTOR,taxiEmpty=taxiDiverted*GAME_TAXI_EMPTY_FACTOR;
 const rawRoadBefore=raw.reduce((n,d)=>n+d.rate,0),rawRoadAfter=rawRoadBefore-railDiverted-taxiDiverted+taxiLoaded+taxiEmpty;
 const roadBefore=normalized.sample.demand.reduce((n,d)=>n+d.rate,0),roadAfter=demand.reduce((n,d)=>n+d.rate,0);
 return {sample:{map:normalized.sample.map,demand,clippedRate:normalized.clippedRate},stats:{clippedRate:normalized.clippedRate,clippedBefore:normalized.clippedRate,rawRoadBefore,rawRoadAfter,roadBefore,roadAfter,railDiverted,taxiDiverted,taxiLoaded,taxiEmpty,railByLine,taxiByDepot}};
}
