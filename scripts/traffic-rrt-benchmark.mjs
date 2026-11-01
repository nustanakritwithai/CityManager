import {performance} from 'node:perf_hooks';
import {buildNetwork} from '../src/traffic/network.ts';
import {shortestPath} from '../src/traffic/routing.ts';
import {createRoadNavigator} from '../src/traffic/rrt-navigation.ts';
const net=buildNetwork({cells:Array.from({length:576},()=>({road:true}))}),times=new Map([...net.links.keys()].map(k=>[k,1]));
const ods=Array.from({length:64},(_,i)=>[i,575-i]);const results={baseline:[],rrt:[]};let stats;
for(let round=0;round<45;round++)for(const mode of round%2?['rrt','baseline']:['baseline','rrt']){const start=performance.now();const nav=mode==='rrt'?createRoadNavigator(net,times,{epoch:round}):null;for(const [a,b]of ods){if(nav)nav.route(a,b);else shortestPath(net,times,a,b);}const elapsed=performance.now()-start;if(round>=5)results[mode].push(elapsed);if(mode==='rrt')stats=nav.stats();}
for(const [mode,raw]of Object.entries(results)){const sorted=[...raw].sort((a,b)=>a-b);console.log(JSON.stringify({mode,n:raw.length,medianMs:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)],minMs:sorted[0],maxMs:sorted.at(-1)}));}console.log(JSON.stringify({lastWave:stats}));
