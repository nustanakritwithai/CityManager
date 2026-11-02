import test from 'node:test';
import assert from 'node:assert/strict';
import {createCity,type City} from '../src/sim.ts';
import {WORKER_SKILLS} from '../src/labor.ts';
import {educationOccupied} from '../src/education.ts';
import {parkActivityCitizens,forEachParkActivityEmployedCitizen,parkActivityUnavailableCitizenIds,type Citizen} from '../src/park-activity.ts';
import {populationFixture} from './population-capacity-fixture.ts';

// Reference of the pre-index assignment contract: owner then wages by firm ID,
// then parks in park ID order; education occupies the first free worker slots.
function originalRoster(city:City):{citizens:Citizen[];unavailable:Set<string>} {
  const citizens:Citizen[]=[],unavailable=new Set<string>();
  for(const h of [...city.households].sort((a,b)=>a.id-b.id)){
    const jobs:{firmId:number|null;parkJobId:number|null}[]=[];
    for(const skill of WORKER_SKILLS){
      const pool:({firmId:number|null;parkJobId:number|null}|null)[]=[];
      const rows=[...city.ownerLabor.filter(e=>e.householdId===h.id&&e.skill===skill).sort((a,b)=>a.firmId-b.firmId),
        ...city.employment.filter(e=>e.householdId===h.id&&e.skill===skill).sort((a,b)=>a.firmId-b.firmId)];
      for(const e of rows)for(let i=0;i<e.workers&&pool.length<h.workerSkills[skill];i++)pool.push({firmId:e.firmId,parkJobId:null});
      for(const park of [...city.parks].sort((a,b)=>a.id-b.id))for(const e of park.staffing?.allocations??[])if(e.householdId===h.id&&e.skill===skill&&e.parkId===park.id)
        for(let i=0;i<e.workers&&pool.length<h.workerSkills[skill];i++)pool.push({firmId:null,parkJobId:park.id});
      while(pool.length<h.workerSkills[skill])pool.push(null);
      jobs.push(...pool as typeof jobs);
    }
    let education=educationOccupied(city.education,h.id);
    for(let slot=0;slot<h.members;slot++){
      const citizenId=`h:${h.id}:m:${slot}`,job=jobs[slot],employed=job!=null;
      const study=!employed&&slot<h.workforce&&education>0;if(study)education--;
      if(employed||study)unavailable.add(citizenId);
      citizens.push({citizenId,householdId:h.id,memberSlot:slot,homeId:h.home,employed,firmId:job?.firmId??null,parkJobId:job?.parkJobId??null});
    }
  }
  return {citizens,unavailable};
}

test('indexed workforce and education match original roster order with overlapping assignments',()=>{
  const c=createCity(1,{starter:false});
  c.households=Array.from({length:80},(_,i)=>({id:80-i,home:i%3?7:null,members:4,workforce:3,dependents:1,workerSkills:{general:2,manufacturing:1,retail:1},skillSource:'arrival-profile',profile:'family',origin:'arrival',wallet:`h:${i}`,lastPurchaseTick:-1,needs:0}));
  c.ownerLabor=[];c.employment=[];
  for(const h of c.households){
    if(h.id%2)c.ownerLabor.push({householdId:h.id,firmId:20+h.id%3,skill:'general',workers:1});
    c.employment.push({householdId:h.id,firmId:40+h.id%7,skill:'general',workers:1,occupation:'manufacturing',rank:'entry'});
    c.employment.push({householdId:h.id,firmId:30+h.id%5,skill:'manufacturing',workers:1,occupation:'manufacturing',rank:'entry'});
  }
  c.employment.reverse();c.ownerLabor.reverse();
  c.parks=[{id:9,cell:30,tick:0,level:1,staffing:{workDays:{},allocations:c.households.map(h=>({householdId:h.id,parkId:9,skill:'retail' as const,workers:1}))}},
    {id:3,cell:31,tick:0,level:1,staffing:{workDays:{},allocations:c.households.map(h=>({householdId:h.id,parkId:h.id%2?3:999,skill:'general' as const,workers:1}))}}];
  c.education!.people=c.households.map(h=>({householdId:h.id,basic:0,higher:0,school:h.id%2,university:0,teacher:0,professor:0,campusId:null,progress:0}));
  // Duplicate rows deliberately verify the original find-first behavior.
  c.education!.people.push({...c.education!.people[0],school:0});
  const before=structuredClone(c),expected=originalRoster(c);
  assert.deepEqual(parkActivityCitizens(c),expected.citizens);
  const actual:unknown[]=[];forEachParkActivityEmployedCitizen(c,(citizenId,homeId,firmId,parkJobId)=>actual.push({citizenId,homeId,firmId,parkJobId}));
  assert.deepEqual(actual,expected.citizens.filter(person=>person.employed).map(({citizenId,homeId,firmId,parkJobId})=>({citizenId,homeId,firmId,parkJobId})));
  assert.deepEqual(parkActivityUnavailableCitizenIds(c,600),expected.unavailable);
  assert.deepEqual(parkActivityUnavailableCitizenIds(c,1020),new Set());
  assert.deepEqual(c,before);
});

test('employee visitor matches the full roster for a dense city and an empty city',()=>{
  for(const c of [createCity(1,{starter:false}),populationFixture(334,true)]){
    const actual:unknown[]=[];forEachParkActivityEmployedCitizen(c,(citizenId,homeId,firmId,parkJobId)=>actual.push({citizenId,homeId,firmId,parkJobId}));
    assert.deepEqual(actual,parkActivityCitizens(c).filter(person=>person.employed).map(({citizenId,homeId,firmId,parkJobId})=>({citizenId,homeId,firmId,parkJobId})));
  }
});
