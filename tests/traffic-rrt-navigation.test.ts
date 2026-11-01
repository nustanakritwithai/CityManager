import test from 'node:test';
import assert from 'node:assert/strict';
import {buildNetwork,linkKey,type LinkNetwork} from '../src/traffic/network.ts';
import {configureRoadPath,type RoadMap} from '../src/road-topology.ts';
import {shortestPath,pathTime} from '../src/traffic/routing.ts';
import {planRoadRrt,createRoadNavigator,CAR_RRT_NODES,CAR_RRT_ATTEMPTS,CAR_RRT_WAVE_NODES,CAR_RRT_WAVE_ATTEMPTS} from '../src/traffic/rrt-navigation.ts';
import {TrafficGame} from '../src/traffic/game.ts';
const full=():RoadMap=>({cells:Array.from({length:576},()=>({road:true}))});
const blank=():RoadMap=>({cells:Array.from({length:576},()=>({road:false}))});
const costs=(net:LinkNetwork)=>new Map([...net.links.keys()].map(key=>[key,1]));
const legal=(net:LinkNetwork,path:readonly number[],from:number,to:number)=>{assert.equal(path[0],from);assert.equal(path.at(-1),to);assert.equal(new Set(path).size,path.length);for(let i=1;i<path.length;i++)assert.ok((net.out.get(path[i-1])??[]).some(edge=>edge.to===path[i]));};
function draw(map:RoadMap,path:number[],oneWay=false){const fresh=new Set(path.filter(i=>!map.cells[i].road));for(const i of path)map.cells[i].road=true;configureRoadPath(map,path,fresh,oneWay);}

test('goal RRT reuses deterministic seeded exploration and actually selects diverse optimal complete routes',()=>{
 const net=buildNetwork(full()),times=costs(net),baseline=shortestPath(net,times,25,125)!,paths=new Set<string>();let accepted=0,different=0;
 for(let seed=0;seed<20;seed++){
  const options={seed,epoch:3},a=planRoadRrt(net,times,25,125,options);assert.deepEqual(planRoadRrt(net,times,25,125,options),a);assert.ok(a.expanded<CAR_RRT_NODES&&a.iterations<=CAR_RRT_ATTEMPTS);
  const nav=createRoadNavigator(net,times,options),result=nav.route(25,125);assert.ok(result.path);legal(net,result.path,25,125);assert.ok(result.cost<=pathTime(baseline,times)+1e-9);
  if(result.source==='rrt'){accepted++;paths.add(result.path.join(','));if(result.path.join(',')!==baseline.join(','))different++;}
 }
 assert.ok(accepted>0&&different>0,'RRT is used, not an always-discarded decorative search');assert.ok(paths.size>1);
});
test('one-way topology and unreachable goals never yield a wrong roaming endpoint',()=>{
 const map=blank();draw(map,[25,26,27,28],true);draw(map,[100,101]);const net=buildNetwork(map),times=costs(net);
 const nav=createRoadNavigator(net,times,{epoch:0});const forward=nav.route(25,28);legal(net,forward.path!,25,28);assert.equal(nav.route(28,25).path,null);assert.equal(nav.route(25,101).path,null);
 for(let seed=0;seed<12;seed++)assert.equal(planRoadRrt(net,times,28,25,{seed,epoch:0}).path,null);
});
test('bounded miss on a long legal route falls back to the exact destination',()=>{
 const map=blank(),path=[...Array.from({length:24},(_,i)=>i),47,...Array.from({length:24},(_,i)=>71-i),72,...Array.from({length:24},(_,i)=>96+i)];draw(map,path,true);const net=buildNetwork(map),times=costs(net);
 const candidate=planRoadRrt(net,times,path[0],path.at(-1)!,{seed:4,epoch:0});assert.equal(candidate.path,null);assert.ok(candidate.expanded<CAR_RRT_NODES);
 const result=createRoadNavigator(net,times,{epoch:0}).route(path[0],path.at(-1)!);assert.equal(result.source,'dijkstra');legal(net,result.path!,path[0],path.at(-1)!);
});
test('weighted candidate cannot buy diversity with a slower scenic detour',()=>{
 const net=buildNetwork(full()),times=costs(net);for(const [key,edge]of net.links)if(edge.to%24===3)times.set(key,50);
 for(let seed=0;seed<20;seed++){const route=createRoadNavigator(net,times,{seed,epoch:2}).route(25,125);assert.ok(route.path);assert.equal(route.cost,pathTime(shortestPath(net,times,25,125)!,times));legal(net,route.path,25,125);}
});
test('wave-wide budget, memoization and output isolation bound repeated OD work',()=>{
 const net=buildNetwork(full()),times=costs(net),nav=createRoadNavigator(net,times,{epoch:0});
 for(let i=0;i<64;i++)nav.route(i,575-i);const before=nav.stats();assert.ok(before.expanded<=CAR_RRT_WAVE_NODES&&before.iterations<=CAR_RRT_WAVE_ATTEMPTS);assert.ok(before.budgetExhausted>0);
 const a=nav.route(0,575);a.path!.push(-1);const b=nav.route(0,575);legal(net,b.path!,0,575);const after=nav.stats();assert.equal(after.expanded,before.expanded);assert.equal(after.iterations,before.iterations);assert.ok(after.cacheHits>=2);
 const fallback=createRoadNavigator(net,times,{epoch:0,nodeBudget:0,attemptBudget:0}).route(25,125);assert.equal(fallback.source,'dijkstra');
});
test('nonpositive and nonfinite costs or unbounded options fail closed',()=>{
 const net=buildNetwork(full()),times=costs(net),key=linkKey(0,1);for(const invalid of[0,-1,NaN,Infinity]){const bad=new Map(times).set(key,invalid);assert.throws(()=>createRoadNavigator(net,bad,{epoch:0}),/positive/);}
 assert.throws(()=>planRoadRrt(net,times,0,2,{seed:1,epoch:0,maxNodes:10000}),/budget/);
 assert.throws(()=>createRoadNavigator(net,times,{epoch:0,nodeBudget:100000}),/budget/);
});
test('ordinary car worker applies RRT planning deterministically without changing admitted actor identity on map-stable replans',()=>{
 const sample={map:full(),demand:[{from:25,to:125,rate:1}]},a=new TrafficGame(sample),b=new TrafficGame(sample);assert.ok(a.frame.navigation!.accepted>0);
 for(let i=0;i<20;i++){assert.deepEqual(a.step(),b.step());const copy=a.clone();assert.deepEqual(copy.frame,a.frame);assert.deepEqual(copy.step(),a.clone().step());}
 const before=a.frame;a.setSample(sample);assert.deepEqual(a.frame,before);assert.deepEqual(a.step(true),before);
 const snapshot=JSON.stringify(sample);a.step();assert.equal(JSON.stringify(sample),snapshot);
});
test('invalid and absent graph endpoints fail closed, including same-cell requests',()=>{
 const map=blank();draw(map,[25,26]);const net=buildNetwork(map),times=costs(net),nav=createRoadNavigator(net,times,{epoch:0});
 for(const endpoint of[-1,NaN,Infinity,1.5]){assert.throws(()=>nav.route(endpoint,endpoint),/endpoint/);assert.throws(()=>planRoadRrt(net,times,endpoint,endpoint,{seed:1,epoch:0}),/endpoint/);}
 assert.equal(nav.route(999,999).path,null);assert.equal(planRoadRrt(net,times,999,999,{seed:1,epoch:0}).path,null);assert.deepEqual(nav.route(25,25).path,[25]);
});
test('periodic RRT seed epochs never replace an admitted actor route and road repair pins its current edge',()=>{
 const map=full(),game=new TrafficGame({map,demand:[{from:25,to:550,rate:1}]});
 const actors=()=> (game as unknown as {cars:{id:number;path:number[];index:number;progress:number}[]}).cars;
 for(let i=0;i<30;i++){const before=new Map(actors().map(a=>[a.id,[...a.path]]));game.step();for(const a of actors())if(before.has(a.id))assert.deepEqual(a.path,before.get(a.id),'periodic new-OD exploration must not churn a live route');}
 const before=new Map(actors().map(a=>[a.id,{from:a.path[a.index],to:a.path[a.index+1],progress:a.progress}]));
 const used=new Set([...before.values()].flatMap(a=>[a.from,a.to]));const removed=map.cells.findIndex((_,i)=>!used.has(i)&&i!==25&&i!==550);map.cells[removed].road=false;game.setSample({map,demand:[{from:25,to:550,rate:1}]});
 for(const a of actors()){const old=before.get(a.id)!;assert.equal(a.path[a.index],old.from);assert.equal(a.path[a.index+1],old.to);assert.equal(a.progress,old.progress);assert.ok(!a.path.slice(a.index).includes(removed));}
});
test('default production seed distributes actual new trips across useful alternatives while each ID keeps its route until arrival',()=>{
 const map=full(),game=new TrafficGame({map,demand:[{from:25,to:125,rate:.25}]}),net=buildNetwork(map);
 type Actor={id:number;path:number[];index:number};
 const actors=()=> (game as unknown as {cars:Actor[]}).cars;
 const born=new Map<number,number[]>(),routes=new Set<string>();let rrtAssignedBirths=0;
 const observe=()=>{for(const a of actors()){
  const prior=born.get(a.id);if(prior)assert.deepEqual(a.path,prior,'same admitted ID retains its chosen route');
  else {legal(net,a.path,25,125);assert.equal(a.path.length,9,'alternatives remain shortest eight-edge routes, not scenic detours');born.set(a.id,[...a.path]);routes.add(a.path.join(','));
   const od=(game as unknown as {ods:{path:number[]|null}[]}).ods[0];if(game.frame.navigation!.accepted>0&&JSON.stringify(a.path)===JSON.stringify(od.path))rrtAssignedBirths++;
  }
 }};
 for(let i=0;i<100;i++){game.step();observe();}
 assert.equal(born.size,25);assert.ok(routes.size>1);assert.ok(rrtAssignedBirths>1,'actual births consume RRT-selected OD routes with the unmodified production seed');
 game.setSample({map,demand:[]});for(let i=0;i<60&&actors().length;i++){game.step();observe();}
 assert.equal(game.frame.completed,born.size,'every original ID reaches the real destination');assert.equal(game.frame.cancelled,0);assert.equal(game.frame.dropped,0);assert.equal(actors().length,0);
});
