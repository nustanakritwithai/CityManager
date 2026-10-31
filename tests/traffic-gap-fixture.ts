import {populationFixture} from './population-capacity-fixture.ts';
import {serializeParkSession,deserializeParkSession,createParkRuntime} from '../src/park-runtime.ts';
/** Synthetic 32-family queue fixture: same fixed bottleneck as strict bypass preflight.
 * No simulation acceleration, player data, invented cash transfer or worker-input override. */
export function trafficGapBusyFixture():string {
 const city=populationFixture(32,true),homes=city.buildings.filter(b=>b.zone==='R'),firms=city.buildings.filter(b=>b.zone!=='R');
 city.cells.forEach(c=>{c.road=false;c.zone=null;c.building=null;});
 for(const i of [272,273,274,275,...Array.from({length:10},(_,i)=>288+i)])city.cells[i].road=true;
 for(const [i,b]of homes.entries()){b.cell=[271,248][i];city.cells[b.cell]={road:false,zone:b.zone,building:b.id};}
 for(const [i,b]of firms.entries()){b.cell=[251,276,400,401,402,403,404][i];city.cells[b.cell]={road:false,zone:b.zone,building:b.id};}
 // Canonicalize through the real migration/history boundary before the mock ACK.
 const restored=deserializeParkSession(serializeParkSession(city,createParkRuntime(city)));return serializeParkSession(restored.city,restored.runtime,restored.market);
}
