import test from 'node:test';
import assert from 'node:assert/strict';
import {createCity,buildRoad,buildParallelRoad,editRoadJunction,connectedRoads,access,bulldoze,serialize,deserialize,SIZE,GATEWAY} from '../src/sim.ts';
import {roadLinked,roadDriveAllowed,edgeKey,validateRoadTopology} from '../src/road-topology.ts';
import {shortestRoadRoute} from '../src/road-network.ts';
import {roadRoute} from '../src/traffic-plan.ts';
import {saveStoredCity,SAVE_KEY,EDUCATION_BACKUP_KEY,readStoredCity} from '../src/save-storage.ts';
const at=(x:number,y:number)=>y*SIZE+x;
function fixture(){const c=createCity(61025,{starter:false});assert.ok(buildRoad(c,GATEWAY,at(10,12)).ok);return c;}
test('parallel road stays separate until a chosen junction; old links elsewhere stay intact',()=>{
 const c=fixture();assert.ok(buildParallelRoad(c,at(0,13),at(10,13)).ok);
 for(let x=0;x<=10;x++)assert.equal(roadLinked(c,at(x,12),at(x,13)),false);
 assert.equal(access(c,at(5,13)),false);assert.equal(connectedRoads(c).has(at(5,13)),false);
 assert.ok(editRoadJunction(c,at(2,12),at(2,13),true).ok);
 assert.equal(connectedRoads(c).has(at(5,13)),true);
 const route=shortestRoadRoute(c,at(5,12),at(5,13));assert.equal(route.length,8);assert.ok(route.includes(at(2,12)));
 assert.ok(editRoadJunction(c,at(2,12),at(2,13),false).ok);assert.equal(connectedRoads(c).has(at(5,13)),false);
 assert.equal(roadLinked(c,GATEWAY,GATEWAY+1),true);
});
test('two adjacent opposite one-way carriageways require a lawful return route through chosen end junctions',()=>{
 const c=fixture();assert.ok(buildParallelRoad(c,at(0,12),at(10,12),true).ok);
 assert.ok(buildParallelRoad(c,at(10,13),at(0,13),true).ok);
 editRoadJunction(c,at(0,12),at(0,13),true);editRoadJunction(c,at(10,12),at(10,13),true);
 assert.ok(roadDriveAllowed(c,at(2,12),at(3,12)));assert.equal(roadDriveAllowed(c,at(3,12),at(2,12)),false);
 const roads=connectedRoads(c),out=roadRoute(roads,at(2,12),at(7,12),c),back=roadRoute(roads,at(7,12),at(2,12),c);
 assert.equal(out.length,6);assert.ok(back.length>out.length);assert.ok(back.some(i=>Math.floor(i/SIZE)===13));
 for(const route of [out,back])for(let i=1;i<route.length;i++)assert.ok(roadDriveAllowed(c,route[i-1],route[i]));
 assert.equal(roadDriveAllowed(c,at(5,12),at(5,13)),false);
});
test('invalid operations are side-effect free; explicit topology survives demolition and rebuild',()=>{
 const c=fixture(),before=serialize(c);assert.equal(buildParallelRoad(c,at(0,12),at(2,14),true).ok,false);assert.equal(serialize(c),before);
 assert.equal(editRoadJunction(c,at(0,12),at(1,13),false).ok,false);assert.equal(serialize(c),before);
 buildParallelRoad(c,at(1,13),at(6,13),true);assert.ok(bulldoze(c,at(3,13)).ok);
 assert.equal(c.roadTopology!.oneWay[at(3,13)],undefined);validateRoadTopology(c,c.roadTopology);
 assert.ok(buildRoad(c,at(3,13),at(3,13)).ok);assert.equal(c.roadTopology!.oneWay[at(3,13)],undefined);
});
test('legacy saves remain v19 and byte-equivalent; only explicit road editing opts into v20',()=>{
 const c=fixture(),old=serialize(c),loaded=deserialize(old);assert.equal(JSON.parse(old).version,22);assert.equal(serialize(loaded),old);
 buildParallelRoad(loaded,at(0,13),at(10,13),true);const raw=serialize(loaded);assert.equal(JSON.parse(raw).version,22);
 const restored=deserialize(raw);assert.equal(serialize(restored),raw);assert.deepEqual([...connectedRoads(restored)],[...connectedRoads(loaded)]);
 const legacy=JSON.parse(old); delete legacy.education; legacy.version=19; legacy.rulesVersion='chain-14';
 const legacyRaw=JSON.stringify(legacy),map=new Map([[SAVE_KEY,legacyRaw]]),s={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);}};
 saveStoredCity(s,raw,null);assert.equal(map.get(EDUCATION_BACKUP_KEY),legacyRaw);assert.deepEqual(readStoredCity(s,'backup'),{key:EDUCATION_BACKUP_KEY,raw:legacyRaw});
});
test('malformed topology, hidden legacy topology, nonadjacent links and invalid arrows are rejected',()=>{
 const c=fixture();buildParallelRoad(c,at(0,13),at(5,13),true);const raw=serialize(c);
 for(const mutate of [(v:any)=>{v.roadTopology.blocked=[edgeKey(at(0,12),at(2,12))];},(v:any)=>{v.roadTopology.oneWay[at(4,13)]=2;},(v:any)=>{v.roadTopology.blocked.push(v.roadTopology.blocked[0]);},(v:any)=>{v.version=19;v.rulesVersion='chain-14';}]){const v=JSON.parse(raw);mutate(v);assert.throws(()=>deserialize(JSON.stringify(v)));}
});

test('park runtime and existing market identity survive the road envelope without changing their data',async()=>{
 const {readFileSync}=await import('node:fs');
 const {deserializeParkSession,serializeParkSession}=await import('../src/park-runtime.ts');
 const {marketJournalForTest}=await import('../src/market-client.ts');
 const raw=readFileSync(new URL('./fixtures/retail-v18-park-session.json',import.meta.url),'utf8');
 const {city,runtime}=deserializeParkSession(raw);const market=marketJournalForTest(null);market.guestId='00000000-0000-4000-8000-000000000003';
 assert.ok(buildRoad(city,GATEWAY,GATEWAY+1).ok);
 const pair=city.cells.flatMap((c,i)=>c.road&&i%SIZE<SIZE-1&&city.cells[i+1]?.road?[[i,i+1]]:[])[0];assert.ok(pair);
 editRoadJunction(city,pair[0],pair[1],false);
 const saved=serializeParkSession(city,runtime,market),loaded=deserializeParkSession(saved);
 assert.equal(JSON.parse(saved).version,20);assert.deepEqual(loaded.city.market,market);assert.deepEqual(loaded.runtime,runtime);
 assert.equal(roadLinked(loaded.city,pair[0],pair[1]),false);
});

test('normal strokes connect adjacent parallel roads without an extra join command and preserve arrows',()=>{
 const c=fixture();buildParallelRoad(c,at(0,12),at(10,12),true);buildParallelRoad(c,at(10,13),at(0,13),true);
 const money=c.accounts.treasury,arrows={...c.roadTopology!.oneWay};
 assert.ok(buildParallelRoad(c,at(4,12),at(4,13)).ok);
 assert.ok(roadLinked(c,at(4,12),at(4,13)));assert.equal(roadLinked(c,at(5,12),at(5,13)),false);
 assert.deepEqual(c.roadTopology!.oneWay,arrows);assert.equal(c.accounts.treasury,money);
 editRoadJunction(c,at(4,12),at(4,13),false);assert.equal(roadLinked(c,at(4,12),at(4,13)),false);
 buildParallelRoad(c,at(4,12),at(4,13));assert.ok(roadLinked(c,at(4,12),at(4,13)));
});
test('drawing a crossing preserves both existing directions and opens only the chosen new stroke',()=>{
 const c=fixture();buildParallelRoad(c,at(5,10),at(5,14));
 assert.ok(roadLinked(c,at(4,12),at(5,12)));assert.ok(roadLinked(c,at(5,12),at(6,12)));
 assert.ok(roadLinked(c,at(5,11),at(5,12)));assert.ok(roadLinked(c,at(5,12),at(5,13)));
 assert.equal(roadLinked(c,at(5,11),at(4,12)),false);assert.equal(serialize(deserialize(serialize(c))),serialize(c));
});
test('single-tile gap repair and no-op redraw keep legacy topology and accounting unchanged',()=>{
 const c=fixture();bulldoze(c,at(5,12));const expected=deserialize(serialize(c));
 buildRoad(expected,at(5,12),at(5,12));buildParallelRoad(c,at(5,12),at(5,12));assert.deepEqual(c,expected);
 const before=serialize(c);assert.ok(buildParallelRoad(c,at(3,12),at(5,12)).ok);assert.equal(serialize(c),before);
});
