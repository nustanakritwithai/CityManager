import {roamRng} from '../taxi/rrt-roam.ts';
import {linkKey,type LinkNetwork} from './network.ts';
import {shortestPath,pathTime} from './routing.ts';

/** Goal-directed counterpart of the existing taxi RRT roam planner. It samples
 * legal road nodes, never free-space steering, and never returns a partial trip. */
export const CAR_RRT_NODES=48,CAR_RRT_ATTEMPTS=192,CAR_RRT_GOAL_BIAS=.8;
export const CAR_RRT_WAVE_NODES=512,CAR_RRT_WAVE_ATTEMPTS=2048;
export const CAR_NAVIGATION_SEED=0x43525254;
export type NavigationStats={attempted:number;accepted:number;fallback:number;unreachable:number;expanded:number;iterations:number;cacheHits:number;budgetExhausted:number};
export const emptyNavigationStats=():NavigationStats=>({attempted:0,accepted:0,fallback:0,unreachable:0,expanded:0,iterations:0,cacheHits:0,budgetExhausted:0});
export type RoadNavigation={path:number[]|null;source:'rrt'|'dijkstra'|'unreachable';cost:number};
export type RrtRouteOptions={seed:number;epoch:number;width?:number;maxNodes?:number;maxAttempts?:number};

function validate(net:LinkNetwork,times:ReadonlyMap<string,number>,o:RrtRouteOptions){
 if(!Number.isSafeInteger(o.seed)||!Number.isSafeInteger(o.epoch)||o.epoch<0||!Number.isSafeInteger(o.width??24)||(o.width??24)<1)throw Error('Invalid road navigation seed/epoch/grid');
 const maxNodes=o.maxNodes??CAR_RRT_NODES,maxAttempts=o.maxAttempts??CAR_RRT_ATTEMPTS;
 if(!Number.isSafeInteger(maxNodes)||maxNodes<1||maxNodes>CAR_RRT_NODES||!Number.isSafeInteger(maxAttempts)||maxAttempts<0||maxAttempts>CAR_RRT_ATTEMPTS)throw Error('Invalid bounded road RRT budget');
 for(const [key]of net.links){const cost=times.get(key);if(cost===undefined||!Number.isFinite(cost)||cost<=0)throw Error('Road navigation requires finite positive link costs');}
}
function validateEndpoints(from:number,to:number){
 if(!Number.isSafeInteger(from)||from<0||!Number.isSafeInteger(to)||to<0)throw Error('Invalid road navigation endpoint');
}
function explore(net:LinkNetwork,times:ReadonlyMap<string,number>,from:number,to:number,o:RrtRouteOptions,cells:readonly number[]){
 const maxNodes=o.maxNodes??CAR_RRT_NODES,maxAttempts=o.maxAttempts??CAR_RRT_ATTEMPTS,width=o.width??24;
 const rng=roamRng(o.seed,`car-od:${from}:${to}`,o.epoch,from),parent=new Map<number,number>([[from,-1]]),nodes=[from];
 const distance=(a:number,b:number)=>Math.abs(a%width-b%width)+Math.abs(Math.floor(a/width)-Math.floor(b/width));
 let iterations=0;
 while(!parent.has(to)&&nodes.length<maxNodes&&iterations<maxAttempts){
  iterations++;const sample=rng()<CAR_RRT_GOAL_BIAS?to:cells[Math.floor(rng()*cells.length)];
  let near:number|undefined,nearest=Infinity;
  for(const node of nodes){if(!(net.out.get(node)??[]).some(edge=>!parent.has(edge.to)))continue;const d=distance(node,sample);if(d<nearest||(d===nearest&&(near===undefined||node<near))){near=node;nearest=d;}}
  if(near===undefined)break;
  const edges=(net.out.get(near)??[]).filter(edge=>!parent.has(edge.to)).sort((a,b)=>distance(a.to,sample)-distance(b.to,sample)||(times.get(linkKey(a.from,a.to))!-times.get(linkKey(b.from,b.to))!)||a.to-b.to);
  if(!edges.length)continue;
  const first=edges[0],d=distance(first.to,sample),cost=times.get(linkKey(first.from,first.to))!;
  const tied=edges.filter(edge=>distance(edge.to,sample)===d&&times.get(linkKey(edge.from,edge.to))===cost),step=tied[Math.floor(rng()*tied.length)];
  parent.set(step.to,near);nodes.push(step.to);
 }
 let path:number[]|null=null;
 if(parent.has(to)){path=[to];while(path[0]!==from){const previous=parent.get(path[0]);if(previous===undefined||previous<0||path.length>maxNodes)throw Error('Invalid road RRT tree');path.unshift(previous);}}
 return {path,expanded:nodes.length-1,iterations};
}
/** Standalone bounded candidate for tests/tools. A miss is null, never a roaming endpoint. */
export function planRoadRrt(net:LinkNetwork,times:ReadonlyMap<string,number>,from:number,to:number,o:RrtRouteOptions){
 validate(net,times,o);validateEndpoints(from,to);const cells=[...new Set([...net.links.values()].flatMap(edge=>[edge.from,edge.to]))].sort((a,b)=>a-b);
 if(!cells.includes(from)||!cells.includes(to))return {path:null,expanded:0,iterations:0};
 return explore(net,times,from,to,o,cells);
}
/** One cost/topology epoch: baseline reachability + bounded candidate exploration.
 * Accept equal-cost RRT diversity, never a more expensive scenic detour. Memoized
 * OD results and a shared wave budget bound peak work independently of actor count. */
export function createRoadNavigator(net:LinkNetwork,times:ReadonlyMap<string,number>,o:{seed?:number;epoch:number;width?:number;nodeBudget?:number;attemptBudget?:number}){
 const options={seed:o.seed??CAR_NAVIGATION_SEED,epoch:o.epoch,width:o.width??24};validate(net,times,options);
 const nodeBudget=o.nodeBudget??CAR_RRT_WAVE_NODES,attemptBudget=o.attemptBudget??CAR_RRT_WAVE_ATTEMPTS;
 if(!Number.isSafeInteger(nodeBudget)||nodeBudget<0||nodeBudget>CAR_RRT_WAVE_NODES||!Number.isSafeInteger(attemptBudget)||attemptBudget<0||attemptBudget>CAR_RRT_WAVE_ATTEMPTS)throw Error('Invalid routing wave budget');
 const cells=[...new Set([...net.links.values()].flatMap(edge=>[edge.from,edge.to]))].sort((a,b)=>a-b),memo=new Map<string,RoadNavigation>(),stats=emptyNavigationStats();
 const copy=(r:RoadNavigation):RoadNavigation=>({...r,path:r.path&&[...r.path]});
 return {stats:()=>({...stats}),route(from:number,to:number):RoadNavigation{
  validateEndpoints(from,to);
  const key=`${from}:${to}`,cached=memo.get(key);if(cached){stats.cacheHits++;return copy(cached);}
  const baseline=cells.includes(from)&&cells.includes(to)?shortestPath(net,times,from,to):null;let result:RoadNavigation;
  if(!baseline){stats.unreachable++;result={path:null,source:'unreachable',cost:Infinity};}
  else {
   const best=pathTime(baseline,times);result={path:baseline,source:'dijkstra',cost:best};
   const remainingNodes=nodeBudget-stats.expanded,remainingAttempts=attemptBudget-stats.iterations;
   if(from!==to&&remainingNodes>0&&remainingAttempts>0){
    stats.attempted++;const candidate=explore(net,times,from,to,{...options,maxNodes:Math.min(CAR_RRT_NODES,remainingNodes+1),maxAttempts:Math.min(CAR_RRT_ATTEMPTS,remainingAttempts)},cells);stats.expanded+=candidate.expanded;stats.iterations+=candidate.iterations;
    if(candidate.path&&candidate.path[0]===from&&candidate.path.at(-1)===to&&candidate.path.every((cell,i)=>i===0||(net.out.get(candidate.path![i-1])??[]).some(edge=>edge.to===cell))){
     const cost=pathTime(candidate.path,times);if(cost<=best+1e-9){result={path:candidate.path,source:'rrt',cost};stats.accepted++;}
    }
   }else if(from!==to)stats.budgetExhausted++;
   if(result.source==='dijkstra')stats.fallback++;
  }
  memo.set(key,result);return copy(result);
 }};
}
