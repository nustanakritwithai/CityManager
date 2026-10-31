// Regenerates the committed save-smoke fixtures (tests/fixtures/save-smoke/*.json) from the
// current save format. Run only when intentionally refreshing fixtures; CI loads the committed
// files to prove saves written by previous builds still load and re-save.
import {writeFile,mkdir} from 'node:fs/promises';
import {createCity,step,SIZE} from '../src/sim.ts';import {createParkRuntime,serializeParkSession} from '../src/park-runtime.ts';
import {buildBusDepot,buildBusStop} from '../src/bus/placement.ts';import {createBusLine} from '../src/bus/lines.ts';
const dir=new URL('../tests/fixtures/save-smoke/',import.meta.url);await mkdir(dir,{recursive:true});
const save=async(name,c)=>{const raw=serializeParkSession(c,createParkRuntime(c));await writeFile(new URL(name,dir),raw);console.log(name,raw.length);};
let c=createCity(3,{starter:true});for(let i=0;i<65;i++)step(c);await save('small-day65.json',c);
c=createCity(5,{starter:true});for(let i=0;i<40;i++)step(c);
let depot=null;const stops=[];for(let i=0;i<SIZE*SIZE;i++){if(!depot&&buildBusDepot(c,i,true).ok){depot=c.bus.depots.at(-1).id;continue;}if(stops.length<3&&buildBusStop(c,i,undefined,true).ok)stops.push(c.bus.stops.at(-1).id);}
if(!depot||stops.length<2)throw Error('could not place bus fixture');const line=createBusLine(c,{depotId:depot,stopIds:stops,busCount:1,busLevel:1});if(!line.ok)throw Error('bus line '+JSON.stringify(line));
for(let i=0;i<20;i++)step(c);await save('bus-optional-day60.json',c);
c=createCity(7,{starter:true});const days=Number(process.env.LARGE_DAYS||800);for(let i=0;i<days;i++)step(c);await save(`large-day${days}.json`,c);
