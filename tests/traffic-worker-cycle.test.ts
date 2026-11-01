import test from 'node:test';import assert from 'node:assert/strict';import {TrafficGame} from '../src/traffic/game.ts';
function sample(size:number,rate:number,variant=0){const roads=new Set<number>();for(let y=3;y<size+3;y++)for(let x=3;x<size+3;x++)roads.add(y*24+x);const c=[75,3*24+size+2,(size+2)*24+3,(size+2)*24+size+2];const demand=c.flatMap(from=>c.filter(to=>to!==from).map(to=>({from,to,rate:rate*(variant&&from===75?.75:1)})));return {map:{cells:Array.from({length:576},(_,i)=>({road:roads.has(i)}))},demand:variant?demand.reverse():demand};}
for(const size of[3,5])for(const rate of[.25,.5,1])test(`${size}x${size} cyclic demand at ${rate} retains progress and every admitted ID drains after new births stop`,()=>{
 const s=sample(size,rate),g=new TrafficGame(s);let completed=0;const known=new Map<number,string>();
 for(let i=1;i<=240;i++){const f=g.step();for(const a of(g as any).cars){const path=JSON.stringify(a.path);if(known.has(a.id))assert.equal(path,known.get(a.id));else known.set(a.id,path);}assert.ok(Math.abs(f.offered-f.completed-f.cars.length-f.waiting-f.dropped-f.cancelled)<1e-6);if(i%60===0){assert.ok(f.completed>completed,'sustained completion progress, not a permanent queue plateau');completed=f.completed;}}
 const before=g.frame,remaining=new Set(before.cars.map(c=>c.id));g.setSample({map:s.map,demand:[]});for(let i=0;i<240&&g.frame.cars.length;i++){const f=g.step();for(const c of f.cars)assert.ok(remaining.has(c.id),'no replacement identities while draining');}
 assert.equal(g.frame.cars.length,0);assert.equal(g.frame.completed,before.completed+remaining.size);assert.equal(g.frame.dropped,before.dropped);assert.equal(g.frame.cancelled,before.cancelled+before.waiting,'only explicitly removed waiting demand is cancelled, never admitted cars');
});
test('rotating a free single-car ring and asymmetric demand preserve deterministic clones',()=>{
 const s=sample(3,.1,1),g=new TrafficGame(s),copy=g.clone();for(let i=0;i<160;i++)assert.deepEqual(g.step(),copy.step());const before=g.frame;g.setSample({map:s.map,demand:[]});for(let i=0;i<120&&g.frame.cars.length;i++)g.step();assert.equal(g.frame.cars.length,0);assert.equal(g.frame.completed,before.completed+before.cars.length);
});
test('free one-car ring remains admissible, full second-slot ring is rejected, shared PCU is respected and retained grants do not move twice',()=>{
 const cells=new Set([75,76,99,100]),g=new TrafficGame({map:{cells:Array.from({length:576},(_,i)=>({road:cells.has(i)}))},demand:[]});
 const paths=[[75,76,100],[76,100,99],[100,99,75],[99,75,76]],intern=g as any;
 const actors=paths.map((path,id)=>({id:id+1,destination:path[2],path,index:0,progress:.645,speed:0,lane:0,blocked:false}));intern.cars=structuredClone(actors);assert.equal(intern.admissionIsAcyclic(new Map()),true);
 const originalBusLoad=intern.busLoad.bind(intern);intern.busLoad=()=>2;assert.equal(intern.admissionIsAcyclic(new Map()),false,'shared link PCU capacity can close the remaining holding slot');intern.busLoad=originalBusLoad;
 intern.cars=[...structuredClone(actors),...actors.map(a=>({...structuredClone(a),id:a.id+4,progress:.39}))];assert.equal(intern.admissionIsAcyclic(new Map()),false);
 assert.equal(intern.admissionIsAcyclic(new Map([[75,1]])),false,'holder already outgoing from75 must not be projected a second edge');
 intern.cars=structuredClone(actors);for(let i=0;i<20&&intern.cars.length;i++)g.step();assert.equal(intern.cars.length,0,'free single-car ring really rotates and drains');
});
test('every substep preserves the projected grant dependency invariant during saturated fresh-grid admission',()=>{
 const g=new TrafficGame(sample(3,1)),intern=g as any,original=intern.substep.bind(intern);let checked=0;intern.substep=(dt:number,grant:Map<number,number>)=>{original(dt,grant);assert.equal(intern.admissionIsAcyclic(grant),true);checked++;};for(let i=0;i<120;i++)g.step();assert.equal(checked,600);
});
test('unrelated road addition preserves every active route; unoccupied future closure repairs legally and drains without changing IDs or occupied edges',()=>{
 const s=sample(5,.25),g=new TrafficGame(s);for(let i=0;i<10;i++)g.step();const before=(g as any).cars.map((a:any)=>structuredClone(a));s.map.cells[50].road=true;g.setSample(s);assert.deepEqual((g as any).cars.map((a:any)=>({id:a.id,path:a.path,index:a.index,progress:a.progress})),before.map((a:any)=>({id:a.id,path:a.path,index:a.index,progress:a.progress})));
 const occupied=new Set(g.frame.cars.flatMap(c=>[c.from,c.to])),destinations=new Set(s.demand.map(d=>d.to)),future=new Set<number>((g as any).cars.flatMap((a:any)=>a.path.slice(a.index+2))),removed=[...future].find(n=>!occupied.has(n)&&!destinations.has(n))!;assert.notEqual(removed,undefined);
 const pinned=new Map(g.frame.cars.map(c=>[c.id,{from:c.from,to:c.to,progress:c.progress}]));s.map.cells[removed].road=false;g.setSample(s);for(const c of g.frame.cars){assert.deepEqual({from:c.from,to:c.to,progress:c.progress},pinned.get(c.id));}for(const a of(g as any).cars)assert.ok(!a.path.slice(a.index).includes(removed));
 for(let i=0;i<240;i++)g.step();const active=g.frame.cars.length,completed=g.frame.completed;g.setSample({map:s.map,demand:[]});for(let i=0;i<240&&g.frame.cars.length;i++)g.step();assert.equal(g.frame.cars.length,0);assert.equal(g.frame.completed,completed+active);
});
test('removing asphalt under an admitted body holds that same car visibly until restoration, never reports false arrival',()=>{
 const s=sample(3,.1),g=new TrafficGame(s);for(let i=0;i<12;i++)g.step();const car=g.frame.cars[0];assert.ok(car);s.map.cells[car.to].road=false;g.setSample(s);for(let i=0;i<10;i++)g.step();const held=g.frame.cars.find(c=>c.id===car.id)!;assert.ok(held);assert.equal(held.from,car.from);assert.equal(held.to,car.to);assert.equal(held.progress,car.progress);assert.equal(held.blocked,true);
});
