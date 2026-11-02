import { expandedCellCoordinate } from '../expanded-map-grid.ts';
import type {RailGraph} from './graph.ts';
export type TrackMeshData={color:string;positions:number[];normals:number[];indices:number[];boxes:number};
/** Static track boxes batched by shared finish: three meshes, not seven draws per edge. */
export function trackMeshData(graph:RailGraph):TrackMeshData[]{
 const batches=new Map<string,TrackMeshData>();
 const box=(x:number,y:number,z:number,w:number,h:number,d:number,color:string)=>{
  let b=batches.get(color);if(!b){b={color,positions:[],normals:[],indices:[],boxes:0};batches.set(color,b);}b.boxes++;
  const faces=[[[1,0,0],[[1,-1,-1],[1,1,-1],[1,1,1],[1,-1,1]]],[[-1,0,0],[[-1,-1,1],[-1,1,1],[-1,1,-1],[-1,-1,-1]]],[[0,1,0],[[-1,1,-1],[-1,1,1],[1,1,1],[1,1,-1]]],[[0,-1,0],[[-1,-1,1],[-1,-1,-1],[1,-1,-1],[1,-1,1]]],[[0,0,1],[[1,-1,1],[1,1,1],[-1,1,1],[-1,-1,1]]],[[0,0,-1],[[-1,-1,-1],[-1,1,-1],[1,1,-1],[1,-1,-1]]]];
  for(const [normal,corners] of faces){const base=b.positions.length/3;for(const p of corners as number[][]){b.positions.push(x+p[0]*w/2,y+p[1]*h/2,z+p[2]*d/2);b.normals.push(...normal as number[]);}b.indices.push(base,base+1,base+2,base,base+2,base+3);}
 };
 const seen=new Set<string>();
 for(const link of graph.links){const key=[Math.min(link.from,link.to),Math.max(link.from,link.to)].join(':');if(seen.has(key))continue;seen.add(key);
  const a=expandedCellCoordinate(link.from),b=expandedCellCoordinate(link.to),ax=(a.x-11.5)*2,az=(a.z-11.5)*2,bx=(b.x-11.5)*2,bz=(b.z-11.5)*2,horizontal=az===bz,x=(ax+bx)/2,z=(az+bz)/2;
  // Grey ballast bed, dark sleepers across it and two bright steel rails on top.
  box(x,.1,z,horizontal?2:.74,.06,horizontal?.74:2,'#a7a397');
  for(const offset of [-.75,-.25,.25,.75])box(x+(horizontal?offset:0),.145,z+(horizontal?0:offset),horizontal?.1:.6,.04,horizontal?.6:.1,'#5a4a3b');
  for(const side of [-.18,.18])box(x+(horizontal?0:side),.19,z+(horizontal?side:0),horizontal?2:.05,.05,horizontal?.05:2,'#d8dee3');
 }
 return [...batches.values()];
}

/** Track direction at a station from its links; a station with no track yet faces east-west. */
export function stationAxis(cell:number,graph:RailGraph){const link=graph.links.find(l=>l.from===cell||l.to===cell);if(!link)return 'x';return Math.abs(link.to-link.from)===1?'x':'z';}
/** Whether only one track leaves the station, so the line ends here and needs a buffer stop. */
export function stationEnds(cell:number,graph:RailGraph){const out=new Set(graph.links.filter(l=>l.from===cell).map(l=>l.to));return out.size===1?[...out][0]:null;}
