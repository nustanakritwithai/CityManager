import assert from 'node:assert/strict';
import test from 'node:test';
import {buildCampus,createCity,step,householdWorkerCount,adoptSavedEducation,serialize,deserialize} from '../src/sim.ts';
import {createParkRuntime,serializeParkSession} from '../src/park-runtime.ts';
import {restoreStartupCity} from '../src/startup-save.ts';
import {marketJournalForTest} from '../src/market-client.ts';
import {SAVE_KEY,PRE_AUTOSAVE_BACKUP} from '../src/save-storage.ts';
import {createEducation,educationGate,assertEducationInvariants,initialCampusReport,type EducationPeople,type EducationView} from '../src/education.ts';

const vacant=(city:ReturnType<typeof createCity>)=>city.cells.findIndex((cell,i)=>!cell.road&&cell.zone===null&&cell.building===null&&!city.plants.some(p=>p.cell===i)&&!city.parks.some(p=>p.cell===i)&&!city.education?.campuses.some(p=>p.cell===i)&&[i-1,i+1,i-24,i+24].some(n=>city.cells[n]?.road));

test('natural school enrollment never shares a worker with a newly opened business',()=>{
 const city=createCity(3);assert.equal(buildCampus(city,vacant(city),'school').ok,true);
 for(let day=0;day<90;day++){
  step(city);
  for(const h of city.households)assert.ok(householdWorkerCount(city,h.id)<=h.workforce,`day ${city.tick}: household ${h.id} has ${householdWorkerCount(city,h.id)} assignments for ${h.workforce} workers`);
 }
 const restored=deserialize(serialize(city));
 for(const h of restored.households)assert.ok(householdWorkerCount(restored,h.id)<=h.workforce);
});

test('previous v22 owner/student overlap loads without losing assets or rewriting the original',()=>{
 const city=createCity(3);delete city.education;
 for(let day=0;day<90&&!city.ownerLabor.length;day++)step(city);
 const owner=city.ownerLabor[0];assert.ok(owner);
 const h=city.households.find(h=>h.id===owner.householdId)!;assert.equal(h.workforce,1);
 adoptSavedEducation(city);assert.equal(buildCampus(city,vacant(city),'school').ok,true);
 city.education!.people=[{householdId:h.id,basic:0,higher:0,school:1,university:0,teacher:0,professor:0,campusId:city.education!.campuses[0].id,progress:12}];
 city.market=marketJournalForTest(null);city.market.guestId='00000000-0000-4000-8000-000000000003';
 const raw=serializeParkSession(city,createParkRuntime(city)),data=new Map([[SAVE_KEY,raw]]);
 const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);}};
 const restored=restoreStartupCity(storage,()=>createCity(999));
 assert.equal(restored.restored,true);assert.equal(data.size,1);assert.equal(storage.getItem(SAVE_KEY),raw);
 assert.ok(householdWorkerCount(restored.city,h.id)<=h.workforce);
 for(const key of ['accounts','ledger','goods','goodsLedger','crops','cropLedger','households','firms','education','market','buildings','parks','plants'] as const)assert.deepEqual(restored.city[key],city[key],`${key} survives assignment repair`);
 const next=serializeParkSession(restored.city,restored.runtime);restored.guard.write(next,null);
 assert.equal(storage.getItem(PRE_AUTOSAVE_BACKUP),raw);
 assert.deepEqual(deserialize(next).accounts,city.accounts);
});

const cohort=(changes:Partial<EducationPeople>={})=>({householdId:1,basic:1,higher:0,school:0,university:0,teacher:0,professor:0,campusId:null,progress:0,...changes});
function setup(person:EducationPeople,workforce:number,posts:EducationView['posts']){
 const state=createEducation('new-city');state.people=[person];state.residentBasic=person.basic;state.residentHigher=person.higher;
 if(person.campusId!==null)state.campuses=[{id:person.campusId,kind:person.professor||person.university?'university':'school',cell:0,level:1,tick:0,open:true,contract:0,workDays:{},report:initialCampusReport(person.professor||person.university?'university':'school',1)}];
 const buildings=[...new Set(posts.map(p=>p.firmId))].map(id=>({id,zone:'I' as const,level:3,firmId:id}));
 state.sustain=buildings.map(b=>({buildingId:b.id,days:30}));
 const view:EducationView={tick:30,households:[{id:1,workforce,wallet:'household:1',ownsFirm:posts.some(p=>p.owner)}],buildings,posts,road:()=>true,sparePower:10,spareWater:10,treasury:100000};
 assertEducationInvariants(state,view.households);return {state,view,buildings};
}
test('teaching and university study reserve their diplomas before economic gates',()=>{
 for(const role of ['teacher','university','professor'] as const){
  const {state,view,buildings}=setup(cohort({[role]:1,higher:role==='professor'?1:0,campusId:20}),2,[{firmId:30,householdId:1,workers:1,owner:false}]);
  const gate=educationGate(state,view,buildings[0]);assert.equal(gate.have,0,role);assert.ok(gate.blocked.length>0);
 }
});
test('one diploma cannot qualify simultaneous posts at two firms',()=>{
 const posts=[{firmId:30,householdId:1,workers:0,owner:true},{firmId:40,householdId:1,workers:1,owner:false}];
 for(const order of [posts,[...posts].reverse()]){
  const {state,view,buildings}=setup(cohort(),2,order);
  const qualified=buildings.map(b=>educationGate(state,view,b).have);
  assert.equal(qualified.reduce((sum,n)=>sum+n,0),1);
  assert.equal(educationGate(state,view,{id:30,zone:'I',level:3,firmId:30}).have,1,'allocation is stable by firm ID');
 }
});
test('a higher diploma remains basic-qualified at its one post, with remaining basic holders available elsewhere',()=>{
 const {state,view,buildings}=setup(cohort({basic:2,higher:1}),2,[{firmId:30,householdId:1,workers:1,owner:false},{firmId:40,householdId:1,workers:1,owner:false}]);
 assert.deepEqual(buildings.map(b=>educationGate(state,view,b).have),[1,1]);
 assert.deepEqual(buildings.map(b=>educationGate(state,view,{...b,level:6}).have),[1,0]);
});
