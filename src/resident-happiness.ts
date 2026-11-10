/** Provisional household wellbeing model. Commutes are planning estimates, not
 * observed journeys; amenity access is distance to a facility, not service use. */
import type { City } from './sim.ts';
import { expandedCellCoordinate } from './expanded-map-grid.ts';
import { estimateHouseholdCommutes, type CommuteEstimate } from './resident-commute.ts';

export const HAPPINESS_BASE = 80, HAPPINESS_DISTRESS = 30, HAPPINESS_DEPARTURE_DAYS = 30;
export type HappinessRow = { householdId:number; score:number; distressDays:number };
export type HappinessState = { version:1; day:number; rows:HappinessRow[] };
export type HomeAmenity = { parkNearby:boolean; schoolNearby:boolean; points:number };
const distance = (a:number,b:number) => {const x=expandedCellCoordinate(a),y=expandedCellCoordinate(b); return Math.abs(x.x-y.x)+Math.abs(x.z-y.z);};
/** Provisional walking-distance proxy: nearby facilities, not measured use. */
export function homeAmenities(city:City, cell:number):HomeAmenity {
  const parkNearby=city.parks.some(p=>distance(cell,p.cell)<=6);
  const schoolNearby=!!city.education?.campuses.some(c=>c.kind==='school' && c.open && c.report.operatingSeats>0 && distance(cell,c.cell)<=8);
  return {parkNearby,schoolNearby,points:(parkNearby?10:0)+(schoolNearby?10:0)};
}
export function happinessTarget(amenities:HomeAmenity, commute?:CommuteEstimate) {
  const inaccessible=commute?.workers ? Math.round(60*commute.unreachableWorkers/commute.workers):0;
  // Link costs assume 100 m tiles and 40 km/h. Long trips and congestion use
  // the same estimated seconds; no unsupported claim of actual failure.
  const long=(commute?.averageSeconds??0)>300?10:0;
  const delay=commute?.averageSeconds != null && commute.freeFlowSeconds != null && commute.averageSeconds - commute.freeFlowSeconds >= 10 && commute.averageSeconds >= commute.freeFlowSeconds * 1.02 ? 10 : 0;
  return Math.max(0,Math.min(100,60+amenities.points-inaccessible-long-delay));
}
export function happinessTargets(city:City): Map<number,{target:number;parkNearby:boolean;schoolNearby:boolean;workers:number;unreachableWorkers:number;commuteSeconds:number|null;delaySeconds:number|null}> {
 const commutes=new Map(estimateHouseholdCommutes(city).map(row=>[row.householdId,row]));
 const homes=new Map(city.buildings.map(b=>[b.id,b.cell]));
 const result=new Map<number,{target:number;parkNearby:boolean;schoolNearby:boolean;workers:number;unreachableWorkers:number;commuteSeconds:number|null;delaySeconds:number|null}>();
 for(const h of city.households){
  const cell=h.home===null?undefined:homes.get(h.home), amenities=cell===undefined?{parkNearby:false,schoolNearby:false,points:0}:homeAmenities(city,cell), commute=commutes.get(h.id);
  result.set(h.id,{target:happinessTarget(amenities,commute),parkNearby:amenities.parkNearby,schoolNearby:amenities.schoolNearby,workers:commute?.workers??0,unreachableWorkers:commute?.unreachableWorkers??0,commuteSeconds:commute?.averageSeconds??null,delaySeconds:commute?.averageSeconds != null && commute.freeFlowSeconds != null ? Math.max(0,commute.averageSeconds-commute.freeFlowSeconds) : null});
 }
 return result;
}
/** One update per economic day. Recovery is faster than deterioration. */
export function advanceHappiness(city:City, previous?:HappinessState):HappinessState {
 if(previous && previous.day!==city.tick-1) throw Error('Happiness clock differs');
 const old=new Map((previous?.rows??[]).map(r=>[r.householdId,r])), targets=happinessTargets(city);
 return {version:1,day:city.tick,rows:[...city.households].sort((a,b)=>a.id-b.id).map(h=>{
   const prior=old.get(h.id), target=targets.get(h.id)!.target, start=prior?.score??HAPPINESS_BASE;
   const score=start>target?Math.max(target,start-1):Math.min(target,start+2);
   return {householdId:h.id,score,distressDays:score<HAPPINESS_DISTRESS?Math.min(HAPPINESS_DEPARTURE_DAYS,(prior?.distressDays??0)+1):0};
 })};
}
export function validateHappiness(city:City, value:unknown):asserts value is HappinessState {
 const v=value as HappinessState;
 const valid=(n:unknown,max:number)=>Number.isSafeInteger(n) && Number(n)>=0 && Number(n)<=max;
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!=='day,rows,version'||v.version!==1||v.day!==city.tick||!Array.isArray(v.rows)||v.rows.length!==city.households.length)throw Error('Invalid happiness state');
 const ids=new Set(city.households.map(h=>h.id)); let last=0;
 for(const row of v.rows){if(!row||typeof row!=='object'||Object.keys(row).sort().join(',')!=='distressDays,householdId,score'||!Number.isSafeInteger(row.householdId)||row.householdId<=last||!ids.has(row.householdId)||!valid(row.score,100)||!valid(row.distressDays,HAPPINESS_DEPARTURE_DAYS)||row.distressDays>city.tick||(row.score>=HAPPINESS_DISTRESS&&row.distressDays!==0))throw Error('Invalid happiness row'); last=row.householdId;}
}
