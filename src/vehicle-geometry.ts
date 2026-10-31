/** Cosmetic geometry only. +Z is forward; nothing here reads the city or its RNG. */
export type VehicleKind = 'sedan' | 'suv' | 'taxi' | 'truck';
export type VehicleRole = 'paint' | 'dark' | 'glass' | 'cargo' | 'headlight' | 'taillight' | 'sign';
export type VehiclePart = { x:number; y:number; z:number; sx:number; sy:number; sz:number; role:VehicleRole };
const part=(role:VehicleRole,x:number,y:number,z:number,sx:number,sy:number,sz:number):VehiclePart=>({role,x,y,z,sx,sy,sz});
export function vehicleVariant(id:string): 'sedan'|'suv' {
  let hash=2166136261; for(let i=0;i<id.length;i++)hash=Math.imul(hash^id.charCodeAt(i),16777619);
  return (hash>>>0)%3===0?'suv':'sedan';
}
export function vehicleParts(kind:VehicleKind):VehiclePart[] {
  if(kind==='truck')return [
    part('dark',0,.065,-.025,.30,.07,.65),
    part('paint',0,.14,.215,.32,.16,.23),
    part('glass',0,.25,.205,.285,.09,.19),
    part('paint',0,.305,.205,.32,.025,.23),
    part('dark',0,.16,-.12,.36,.19,.48),
    part('cargo',0,.265,-.12,.32,.04,.44),
    ...[-.11,.11].flatMap(x=>[part('headlight',x,.135,.335,.07,.04,.01),part('taillight',x,.12,-.365,.07,.04,.01)]),
  ];
  const suv=kind==='suv', height=suv?.235:.215, cabinLength=suv?.29:.23;
  return [
    part('dark',0,.045,0,.25,.05,.39),
    part('paint',0,.115,0,.28,.10,.418),
    part('glass',0,height,-.025,.235,suv?.14:.10,cabinLength),
    part('paint',0,height+(suv?.077:.057),-.025,.245,.024,cabinLength-.015),
    ...(kind==='taxi'?[part('sign',0,.300,-.025,.12,.035,.055)]:[]),
    ...[-.095,.095].flatMap(x=>[part('headlight',x,.125,.205,.065,.035,.01),part('taillight',x,.125,-.205,.065,.035,.01)]),
  ];
}
export function vehiclePartColor(role:VehicleRole,paint:string,cargo='#e9cf6a'):string {
  return ({paint,dark:'#222c35',glass:'#263e4c',cargo,headlight:'#fff0b3',taillight:'#f04c42',sign:'#fff4c2'})[role];
}
const FACES=[
 {n:[1,0,0],v:[[1,-1,-1],[1,1,-1],[1,1,1],[1,-1,1]]},
 {n:[-1,0,0],v:[[-1,-1,1],[-1,1,1],[-1,1,-1],[-1,-1,-1]]},
 {n:[0,1,0],v:[[-1,1,-1],[-1,1,1],[1,1,1],[1,1,-1]]},
 {n:[0,-1,0],v:[[-1,-1,1],[-1,-1,-1],[1,-1,-1],[1,-1,1]]},
 {n:[0,0,1],v:[[1,-1,1],[1,1,1],[-1,1,1],[-1,-1,1]]},
 {n:[0,0,-1],v:[[-1,-1,-1],[-1,1,-1],[1,1,-1],[1,-1,-1]]},
];
/** Bake all parts into one mesh, not a child Entity per box. Colors are RGB bytes. */
export function vehicleMeshData(parts:readonly VehiclePart[],paint:string,cargo?:string){
 const positions:number[]=[],normals:number[]=[],colors:number[]=[],indices:number[]=[];
 for(const p of parts){const hex=vehiclePartColor(p.role,paint,cargo),rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
  // Lamp patches need only the outward face; no hidden box backs/sides.
  const faces=p.role==='headlight'?FACES.filter(f=>f.n[2]===1):p.role==='taillight'?FACES.filter(f=>f.n[2]===-1):FACES;
  for(const f of faces){const base=positions.length/3;for(const v of f.v){positions.push(p.x+v[0]*p.sx/2,p.y+v[1]*p.sy/2,p.z+v[2]*p.sz/2);normals.push(...f.n);colors.push(...rgb,255);}indices.push(base,base+1,base+2,base,base+2,base+3);}
 }
 return {positions,normals,colors,indices};
}
