// Matched, bounded in-worker coordination ablation; no browser/mobile claim.
// node --experimental-strip-types scripts/traffic-signal-coordination-calibration.mjs
import {TrafficGame} from '../src/traffic/game.ts';
const corridor=[49,50,51,52,53,54,26,74,29,77],adjacent=[49,50,51,52,26,74,27,75];
const scenarios=[
 {name:'corridor',roads:corridor,ods:[[49,54,1],[54,49,.2],[26,74,.05],[29,77,.05]]},
 {name:'two-adjacent',roads:adjacent,ods:[[49,52,1],[52,49,.2],[26,74,.1],[27,75,.1]]},
 {name:'unequal-crossflows',roads:corridor,ods:[[49,54,1],[54,49,.3],[26,74,.1],[29,77,.6]]},
 {name:'four-junction-rrt',roads:[...Array.from({length:12},(_,i)=>49+i),26,74,29,77,32,80,35,83],ods:[[49,60,1],[60,49,.2],[26,74,.05],[29,77,.1],[32,80,.6],[35,83,.1]]},
 {name:'spillback-repair',roads:corridor,ods:[[49,54,1],[54,49,.3],[26,74,.1],[29,77,.6]],cut:77}
];
for(const scenario of scenarios)for(const coordinated of [false,true]){
 const map={cells:Array.from({length:576},(_,i)=>({road:scenario.roads.includes(i)}))},demand=scenario.ods.map(([from,to,rate])=>({from,to,rate})),g=new TrafficGame({map,demand});
 if(!coordinated)g.coordinateSignals=()=>{};
 let blocked=0,previous=g.frame,counts={},waits={},seen=new Set(),maxError=0;
 const sub=g.substep.bind(g);g.substep=(dt,grant)=>{sub(dt,grant);for(const [node,id]of grant){const key=node+':'+id;if(seen.has(key))continue;const car=g.cars.find(c=>c.id===id),req=g.junctionRequests.get(id);if(!car||!req||car.path[car.index+1]!==node)continue;seen.add(key);(waits[car.path[car.index]]??=[]).push((g.junctionClock-req.since)/5);}};
 for(let i=1;i<=600;i++){
  if(scenario.cut&&i===100){const cut=structuredClone(map);cut.cells[scenario.cut].road=false;g.setSample({map:cut,demand});}if(scenario.cut&&i===300)g.setSample({map,demand});
  const f=g.step(),ids=new Set(f.cars.map(c=>c.id));for(const c of previous.cars)if(!ids.has(c.id))counts[c.destination]=(counts[c.destination]??0)+1;previous=f;blocked+=f.blocked;maxError=Math.max(maxError,Math.abs(f.offered-f.completed-f.dropped-f.cancelled-f.waiting-f.moving));
 }
 const tails=Object.fromEntries(Object.entries(waits).map(([key,values])=>{values.sort((a,b)=>a-b);return [key,{n:values.length,p95:values[Math.floor((values.length-1)*.95)],max:values.at(-1)}]}));
 console.log(JSON.stringify({name:scenario.name,model:coordinated?'coordinated':'independent',seconds:600,completed:g.frame.completed,blockedCarSeconds:blocked,dropped:g.frame.dropped,counts,maxError,waitToFirstGrantSeconds:tails,peers:g.signalPeers.stats()}));
}
