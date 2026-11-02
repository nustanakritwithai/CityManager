import {populationFixture} from './population-capacity-fixture.ts';
import {deserialize,serialize,step} from '../src/sim.ts';
import {advanceParkRuntime,createParkRuntime,deserializeParkSession,serializeParkSession} from '../src/park-runtime.ts';

/** Synthetic but fully validated server-save city. Real simulated employment
 * feeds a road crossing; no traffic identities or worker results are injected. */
export function workExpiryBrowserFixture(mode:'closure'|'signal'='closure'){
 const city=populationFixture(32,true);step(city);
 city.cells.forEach(cell=>{cell.road=false;cell.zone=null;cell.building=null;});
 for(let x=0;x<=19;x++)city.cells[12*24+x].road=true;
 for(let y=5;y<=19;y++)city.cells[y*24+8].road=true;
 const homes=city.buildings.filter(b=>b.zone==='R'),firms=city.buildings.filter(b=>b.zone!=='R');
 for(const [i,b] of homes.entries()){b.cell=13*24+5+i;city.cells[b.cell]={road:false,zone:b.zone,building:b.id};}
 for(const [i,b] of firms.entries()){b.cell=13*24+10+i;city.cells[b.cell]={road:false,zone:b.zone,building:b.id};}
 if(mode==='signal'){
  city.cells[homes[1].cell]={road:false,zone:null,building:null};homes[1].cell=6*24+9;
  city.cells[homes[1].cell]={road:false,zone:'R',building:homes[1].id};
  for(const household of city.households.slice(16))household.home=homes[1].id;
 }
 const validated=deserialize(serialize(city)),runtime=createParkRuntime(validated);
 advanceParkRuntime(validated,runtime,mode==='signal'?1015:1018,()=>step(validated));
 const raw=serializeParkSession(validated,runtime);deserializeParkSession(raw);
 return {city:validated,runtime,raw,closedRoad:12*24+10};
}
