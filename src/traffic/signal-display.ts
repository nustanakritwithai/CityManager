import { expandedCellCoordinate } from '../expanded-map-grid.ts';
import {roadDriveAllowed,roadNeighborsFor,type RoadMap} from '../road-topology.ts';
import {signalTopologyKey} from './adaptive-signals.ts';
export type SignalPhase={node:number;approach:number|null;state:'green'|'all-red'};
export type SignalFrame={topology:string;phases:readonly SignalPhase[]};
export type SignalHead={node:number;approach:number;x:number;z:number;headingX:number;headingZ:number;state:'green'|'red';allRed:boolean};
export const SIGNAL_STOP_OFFSET=.86,SIGNAL_ROADSIDE_OFFSET=.85;
/** Render-only, accepted-worker-state mapper. No clocks, routing or movement authority. */
export class TrafficSignalDisplay {
 private topology='';private incoming=new Map<number,number[]>();private heads:SignalHead[]=[];
 reset(map:RoadMap):void {
  this.topology=signalTopologyKey(map);this.incoming.clear();this.heads=[];
  map.cells.forEach((c,node)=>{if(c.road)this.incoming.set(node,roadNeighborsFor(map,node).filter(from=>roadDriveAllowed(map,from,node)));});
 }
 clear():void{this.heads=[];}
 accept(frame:SignalFrame|undefined):readonly SignalHead[]{
  this.heads=[];if(!frame||frame.topology!==this.topology)return this.heads;
  const seen=new Set<number>();
  for(const p of frame.phases){
   const arms=this.incoming.get(p.node);if(seen.has(p.node)||!arms||!['green','all-red'].includes(p.state)||p.state==='green'&&(p.approach===null||!arms.includes(p.approach))||p.state==='all-red'&&p.approach!==null)throw Error('Invalid committed traffic signal');seen.add(p.node);
   for(const from of arms){const node=expandedCellCoordinate(p.node), source=expandedCellCoordinate(from),hx=Math.sign(node.x-source.x),hz=Math.sign(node.z-source.z);
    this.heads.push({node:p.node,approach:from,x:(node.x-11.5)*2-hx*SIGNAL_STOP_OFFSET+hz*SIGNAL_ROADSIDE_OFFSET,z:(node.z-11.5)*2-hz*SIGNAL_STOP_OFFSET-hx*SIGNAL_ROADSIDE_OFFSET,headingX:hx,headingZ:hz,state:p.state==='green'&&p.approach===from?'green':'red',allRed:p.state==='all-red'});
   }
  }
  return this.heads;
 }
 get diagnostics(){return {topology:this.topology,heads:this.heads.map(h=>({...h})),junctions:new Set(this.heads.map(h=>h.node)).size};}
}
/** Shared local +Z arrow / transverse stop bar; shape disambiguates colour. */
export function signalSymbol(state:'green'|'red'):{positions:number[];indices:number[]} {
 const points=state==='green'?[[-.035,-.08],[.035,-.08],[.035,.015],[.085,.015],[0,.105],[-.085,.015],[-.035,.015]]:[[-.085,-.025],[.085,-.025],[.085,.025],[-.085,.025]];
 return {positions:points.flatMap(([x,z])=>[x,.755,z]),indices:state==='green'?[0,2,1,0,6,2,5,4,3]:[0,2,1,0,3,2]};
}
export function writeSignalMatrix(target:Float32Array,offset:number,p:SignalHead):void{const x=p.headingX,z=p.headingZ;target.set([z,0,-x,0,0,1,0,0,x,0,z,0,p.x,0,p.z,1],offset);}
