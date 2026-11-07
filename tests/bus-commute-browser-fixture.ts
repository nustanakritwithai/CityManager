import assert from 'node:assert/strict';
import {populationFixture} from './population-capacity-fixture.ts';
import {captureTrafficGameInput} from '../src/traffic/game.ts';
import {serialize,deserialize} from '../src/sim.ts';
import {createParkRuntime,serializeParkSession,deserializeParkSession} from '../src/park-runtime.ts';
import {createBus} from '../src/bus/buildings.ts';
import {createBusLine,busLineRoutes} from '../src/bus/lines.ts';
import {configureRoadPath} from '../src/road-topology.ts';
export function busCommuteBrowserFixture(){
 const c=populationFixture(4),at=(x:number,y:number)=>24*y+x;
 const b=structuredClone(c.buildings.find(b=>b.zone==='I')!),f=structuredClone(c.firms[0]);
 b.id=c.nextId++;f.id=c.nextId++;f.building=b.id;f.wallet=`firm:${f.id}`;c.accounts[f.wallet]=0;c.buildings.push(b);c.firms.push(f);
 c.cells.forEach(cell=>{cell.road=false;cell.zone=null;cell.building=null;});
 const draw=(p:number[])=>{const fresh=new Set(p);for(const i of p)c.cells[i].road=true;configureRoadPath(c,p,fresh,false);};
 draw(Array.from({length:24},(_,x)=>at(x,12)));
 const homes=c.buildings.filter(b=>b.zone==='R'),firms=c.buildings.filter(b=>b.zone==='I');
 for(const [i,b] of homes.entries())b.cell=at(3+i,11);
 for(const [i,b] of firms.entries())b.cell=at([6,9,19][i],11);
 for(const b of c.buildings)c.cells[b.cell]={road:false,zone:b.zone,building:b.id};
 c.employment=c.households.map(h=>({householdId:h.id,firmId:f.id,workers:1,skill:'general' as const,rank:'entry' as const,occupation:'manufacturing' as const}));
 c.bus=createBus();c.bus.depots.push({id:c.nextId++,cell:at(3,13),level:1,open:true,tick:0});
 c.bus.stops.push({id:c.nextId++,cell:at(3,12),side:'n',level:1},{id:c.nextId++,cell:at(19,12),side:'n',level:1});
 assert.ok(createBusLine(c,{depotId:c.bus.depots[0].id,stopIds:c.bus.stops.map(s=>s.id),busCount:3,busLevel:1}).ok);
 const restored=deserialize(serialize(c));assert.deepEqual(deserialize(serialize(restored)),restored);assert.equal(busLineRoutes(restored)[0].status,'running');
 const runtime=createParkRuntime(restored);
 const raw=serializeParkSession(restored,runtime);assert.deepEqual(deserializeParkSession(raw).city,restored);
 const commutes=captureTrafficGameInput(restored,{busCommutes:true}).commutes;assert.deepEqual(commutes,[{home:homes[0].cell,work:b.cell,workers:4}]);
 return {raw,home:homes[0].cell,work:b.cell,homeRoad:at(3,12),workRoad:at(19,12),population:4,buses:3};
}
