import { createCity, type City } from '../src/sim.ts';
import { emptyCrops, emptyProducts } from '../src/goods.ts';

/** Synthetic, reconciled capacity fixture, not a claim of naturally reachable growth or balance.
 * External utility contracts and initial business capital are explicit fixture inputs. */
export function populationFixture(count: number, families = false, jobs = true): City {
  const c = createCity(1, {starter:false}); c.tick = Math.max(400,count+1);
  c.cells.forEach(cell=>{cell.road=false;cell.zone=null;cell.building=null;});
  // Joined comb supplies every test parcel, using at most 192 buildings.
  for(let row=0;row<24;row++){c.cells[row*24].road=true;if(row%3===0)for(let x=0;x<24;x++)c.cells[row*24+x].road=true;}
  c.utilities.outside={power:10000,water:10000};
  const sites=c.cells.flatMap((cell,i)=>!cell.road&&Math.floor(i/24)%3===1?[i]:[]);
  const fund=(wallet:string,amount:number,reason:string,tick=0)=>{c.accounts[wallet]=(c.accounts[wallet]??0)+amount;c.accounts.outside-=amount;c.ledger.push({tick,from:'outside',to:wallet,amount,reason});};
  const homeIds:number[]=[];
  for(let n=0;n<Math.ceil(count/32)+1;n++){
    const id=c.nextId++,cell=sites.shift()!;c.cells[cell]={road:false,zone:'R',building:id};
    c.buildings.push({id,cell,zone:'R',level:9,housingType:'condo',age:c.tick});homeIds.push(id);
  }
  for(let n=0;n<count;n++){
    const id=c.nextId++,wallet=`household:${id}`,workforce=families?2:1;
    c.households.push({id,home:homeIds[Math.floor(n/32)],members:families?3:1,workforce,dependents:families?1:0,workerSkills:{general:workforce,manufacturing:0,retail:0},skillSource:families?'arrival-profile':'legacy-assumed',profile:families?'family':'legacy-worker',origin:families?'arrival':'legacy-v1',wallet,lastPurchaseTick:-1,needs:0});
    fund(wallet,150000,families?'New household arrival savings':'Historical household savings',families?n+1:0);
  }
  c.migration={arrivals:count,legacyHouseholds:families?0:count};
  if(jobs)for(let n=0;n<Math.min(64,Math.ceil(count*(families?2:1)/12)+1);n++){
    const bid=c.nextId++,id=c.nextId++,cell=sites.shift()!,wallet=`firm:${id}`;
    c.cells[cell]={road:false,zone:'I',building:bid};c.buildings.push({id:bid,cell,zone:'I',level:9,age:c.tick});
    c.firms.push({id,building:bid,zone:'I',recipe:'rice-mill',wallet,crops:emptyCrops(),products:emptyProducts(),workDays:{},inventory:0,cropInventory:0,cropCost:0,productionTick:0,owner:null,profit:0,lastMonthProfit:0,monthlyRevenue:0,monthlyExpense:0});
    fund(wallet,10000000,'Fixture business capital');
  }
  if(count>128)c.populationCapacityVersion=1;
  return c;
}


/** 666 families and two singles: exactly 2,000 people, with the real 64-firm cap. */
export function population2000Fixture(): City {
  const c=populationFixture(668,true);
  for(const h of c.households.slice(-2)) {
    h.members=1;h.workforce=1;h.dependents=0;h.profile='single-worker';h.workerSkills={general:1,manufacturing:0,retail:0};
  }
  return c;
}
