/**
 * What the minimap and the city map draw for the railway: track runs, stations and the
 * train, in grid coordinates. Published by the rail manager on each sync; read-only here.
 */
export type RailMap={links:[number,number][];stations:{cell:number;index:number;waiting:number}[];train:{x:number;z:number;moving:boolean}|null;running:boolean};
let current:RailMap|null=null,key='null',revision=0;
/** Bumps the revision only when something visible changed (train position rounded to 1/20 cell). */
export function publishRailMap(map:RailMap|null){
  const next=map&&{...map,train:map.train&&{...map.train,x:Math.round(map.train.x*20)/20,z:Math.round(map.train.z*20)/20}},k=JSON.stringify(next);
  if(k===key)return;key=k;current=next;revision++;
}
export const publishedRailMap=()=>current;
export const railMapRevision=()=>revision;
/** Each track run once, whichever way its two links point. */
export function uniqueRuns(links:readonly {from:number;to:number}[]):[number,number][]{
  const seen=new Set<string>(),runs:[number,number][]=[];
  for(const l of links){const a=Math.min(l.from,l.to),b=Math.max(l.from,l.to),k=`${a}:${b}`;if(!seen.has(k)){seen.add(k);runs.push([a,b]);}}
  return runs;
}
/** One-line description of a rail cell for the city map's pointer readout. */
export function railCellNote(cell:number,map=current):string{
  if(!map)return '';
  const station=map.stations.find(s=>s.cell===cell);
  if(station)return `สถานีรถไฟ ${station.index}${map.running?` · รอ ${station.waiting} คน`:' · ยังไม่เปิดบริการ'}`;
  return map.links.some(([a,b])=>a===cell||b===cell)?'รางรถไฟ':'';
}
