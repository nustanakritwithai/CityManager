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
  const ax=(link.from%24-11.5)*2,az=(Math.floor(link.from/24)-11.5)*2,bx=(link.to%24-11.5)*2,bz=(Math.floor(link.to/24)-11.5)*2,horizontal=az===bz,x=(ax+bx)/2,z=(az+bz)/2;
  box(x,.12,z,horizontal?2:.55,.08,horizontal?.55:2,'#8e8b7b');
  for(const side of [-.18,.18])box(x+(horizontal?0:side),.19,z+(horizontal?side:0),horizontal?2:.045,.055,horizontal?.045:2,'#d1d7ce');
  for(const offset of [-.75,-.25,.25,.75])box(x+(horizontal?offset:0),.16,z+(horizontal?0:offset),horizontal?.08:.65,.06,horizontal?.65:.08,'#665848');
 }
 return [...batches.values()];
}
