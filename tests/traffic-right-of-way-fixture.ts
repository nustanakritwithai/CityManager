import assert from 'node:assert/strict';
import {populationFixture} from './population-capacity-fixture.ts';
import {trafficGapBusyFixture} from './traffic-gap-fixture.ts';
import {buildBusDepot,buildBusStop} from '../src/bus/placement.ts';
import {createBusLine,busLineRoutes} from '../src/bus/lines.ts';
import {roadNeighbors} from '../src/road-topology.ts';
import {createParkRuntime,serializeParkSession,deserializeParkSession} from '../src/park-runtime.ts';
import type {BusLevel} from '../src/bus/types.ts';
/** Synthetic, canonical server-seed only. No player data or alternate worker inputs. */
export function trafficRightOfWayFixture(level:BusLevel=1,dense=true):string {
 if(!dense){const session=deserializeParkSession(trafficGapBusyFixture());session.city.bus!.lines[0].busLevel=level;return serializeParkSession(session.city,session.runtime,session.market);}
 const city=populationFixture(32,true),homes=city.buildings.filter(b=>b.zone==='R'),firms=city.buildings.filter(b=>b.zone!=='R');
 city.cells.forEach(c=>{c.road=false;c.zone=null;c.building=null;});
 for(let row=10;row<=14;row++)for(let col=6;col<=14;col++)city.cells[row*24+col].road=true;
 for(const cell of [255,256,340,341])city.cells[cell].road=true;
 for(let col=0;col<6;col++)city.cells[12*24+col].road=true;
 for(const [i,b]of homes.entries()){b.cell=[223,225][i];city.cells[b.cell]={road:false,zone:b.zone,building:b.id};}
 for(const [i,b]of firms.entries()){b.cell=[227,229,367,369,371,373,375][i];city.cells[b.cell]={road:false,zone:b.zone,building:b.id};}
 const depot=buildBusDepot(city,222,true);assert.equal(depot.ok,true,JSON.stringify(depot));
 for(const cell of [255,341]){const result=buildBusStop(city,cell,undefined,true);assert.equal(result.ok,true,JSON.stringify({cell,...result}));}
 assert.equal(createBusLine(city,{depotId:city.bus!.depots[0].id,stopIds:city.bus!.stops.map(s=>s.id),busCount:1,busLevel:level}).ok,true);
 const session=deserializeParkSession(serializeParkSession(city,createParkRuntime(city)));
 return serializeParkSession(session.city,session.runtime,session.market);
}
export function trafficRightOfWayWitness(raw:string){
 const {city}=deserializeParkSession(raw),routes=busLineRoutes(city);
 const paths=routes.flatMap(r=>[r.fromDepot,...r.legs.map(l=>l.path)]).filter((p):p is readonly number[]=>Array.isArray(p));
 const encountered=new Set(paths.flatMap(path=>path.filter(cell=>roadNeighbors(cell).filter(n=>city.cells[n].road).length>2)));
 return {roads:city.cells.filter(c=>c.road).length,encounteredConflictNodes:encountered.size,level:city.bus!.lines[0].busLevel};
}
