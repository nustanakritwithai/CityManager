// Bounded fixed8s versus adaptive calibration, not a browser/mobile speed claim.
// Creates temporary sibling modules for a matched controller-only ablation; cleans them on completion.
// node --experimental-strip-types scripts/traffic-adaptive-calibration.mjs
import {writeFileSync,readFileSync,unlinkSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const fixed=`import {SIGNAL_MAX_GREEN,SIGNAL_CLEARANCE} from './adaptive-signals.ts';
export function chooseSignal(phase,demand,now,occupied){
 const rows=[...demand].sort((a,b)=>a.approach-b.approach), best=rows[0];
 if(!phase)return {approach:occupied?null:best?.approach??null,since:now,clearUntil:now+(occupied?SIGNAL_CLEARANCE:0)};
 if(phase.approach===null){if(occupied)return {...phase,since:now,clearUntil:now+SIGNAL_CLEARANCE};if(now<phase.clearUntil)return phase;
 const next=rows.find(d=>d.approach>(phase.previous??-1))??best;return {approach:next?.approach??null,since:now,clearUntil:now};}
 if(occupied)return phase;
 if(now-phase.since>=SIGNAL_MAX_GREEN&&rows.some(d=>d.approach!==phase.approach))return {approach:null,since:now,clearUntil:now+SIGNAL_CLEARANCE,previous:phase.approach};
 return phase;
}`;
writeFileSync(root+'src/traffic/.fixed-signals.ts',fixed);
writeFileSync(root+'src/traffic/.fixed-game.ts',readFileSync(root+'src/traffic/game.ts','utf8').replace('chooseSignal,signalTopologyKey','signalTopologyKey').replace("import type {GameModalStats}","import {chooseSignal} from './.fixed-signals.ts';\nimport type {GameModalStats}"));
try{
 const {TrafficGame:Adaptive}=await import(root+'src/traffic/game.ts'),{TrafficGame:Fixed}=await import(root+'src/traffic/.fixed-game.ts');
 const roads=new Set([49,50,51,26,74]),map={cells:Array.from({length:576},(_,i)=>({road:roads.has(i)}))};
 for(const [name,rates] of [['asymmetric',[3,.2,.2,.2]],['sparse',[1,.03,.04,.05]],['saturated',[2,2,2,2]],['bursty',[1,.05,.05,.05]]])for(const [model,G] of [['fixed8s',Fixed],['adaptive',Adaptive]]){
 const demand=[[49,51],[26,74],[51,26],[74,49]].map(([from,to],i)=>({from,to,rate:rates[i]})),g=new G({map,demand});let blocked=0,seen=new Set(),waits={},prev=g.frame,counts={};
 const sub=g.substep.bind(g);g.substep=(dt,grant)=>{sub(dt,grant);for(const [node,id]of grant){const key=node+':'+id;if(seen.has(key))continue;const car=g.cars.find(c=>c.id===id);const req=g.junctionRequests.get(id);if(!car||!req||car.path[car.index+1]!==node)continue;seen.add(key);const approach=car.path[car.index];(waits[approach]??=[]).push((g.junctionClock-req.since)/5);}};
 for(let i=1;i<=600;i++){if(name==='bursty'&&i%40===0){const peak=(i/40)%4;g.setSample({map,demand:demand.map((d,n)=>({...d,rate:n===peak?2:.02}))});}const f=g.step(),ids=new Set(f.cars.map(c=>c.id));for(const c of prev.cars)if(!ids.has(c.id))counts[c.destination]=(counts[c.destination]??0)+1;prev=f;blocked+=f.blocked;}
 const tails=Object.fromEntries(Object.entries(waits).map(([k,v])=>{v.sort((a,b)=>a-b);return [k,{n:v.length,p95:v[Math.floor((v.length-1)*.95)],max:v.at(-1)}]}));
 console.log(JSON.stringify({name,model,seconds:600,completed:g.frame.completed,blockedCarSeconds:blocked,dropped:g.frame.dropped,counts,waitToFirstGrantSeconds:tails}));
 }
}finally{unlinkSync(root+'src/traffic/.fixed-signals.ts');unlinkSync(root+'src/traffic/.fixed-game.ts');}
