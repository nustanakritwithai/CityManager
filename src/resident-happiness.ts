/** Provisional household wellbeing model. Commutes are planning estimates, not
 * observed journeys; amenity access is distance to a facility, not service use. */
import type { City } from './sim.ts';
import { expandedCellCoordinate } from './expanded-map-grid.ts';
import { estimateHouseholdCommutes, type CommuteEstimate } from './resident-commute.ts';
import { DEFAULT_TAX_RATES, taxRatesAt, type TaxRates } from './city-tax-policy.ts';

export const HAPPINESS_BASE = 80, HAPPINESS_DISTRESS = 30, HAPPINESS_DEPARTURE_DAYS = 30;
export const HAPPINESS_UNEMPLOYED_POINTS = 25;
export type HappinessRow = { householdId:number; score:number; distressDays:number };
export type HappinessState = { version:1; day:number; rows:HappinessRow[] };
export type HomeAmenity = { parkNearby:boolean; schoolNearby:boolean; points:number };
type HappinessTarget = {
  target: number;
  parkNearby: boolean;
  schoolNearby: boolean;
  workers: number;
  unreachableWorkers: number;
  commuteSeconds: number | null;
  delaySeconds: number | null;
  wageTaxPoints: number;
  profitTaxPoints: number;
  unemployedWorkers: number;
  unemploymentPoints: number;
};
/** Each household has one score, including households with multiple members. */
export function averageHouseholdHappiness(state?: HappinessState): number | null {
  return state?.rows.length ? state.rows.reduce((sum, row) => sum + row.score, 0) / state.rows.length : null;
}
const distance = (a:number,b:number) => {const x=expandedCellCoordinate(a),y=expandedCellCoordinate(b); return Math.abs(x.x-y.x)+Math.abs(x.z-y.z);};
/** Provisional walking-distance proxy: nearby facilities, not measured use. */
export function homeAmenities(city:City, cell:number):HomeAmenity {
  const parkNearby=city.parks.some(p=>distance(cell,p.cell)<=6);
  const schoolNearby=!!city.education?.campuses.some(c=>c.kind==='school' && c.open && c.report.operatingSeats>0 && distance(cell,c.cell)<=8);
  return {parkNearby,schoolNearby,points:(parkNearby?10:0)+(schoolNearby?10:0)};
}
/** Tax points apply once per household and use the original rates as neutral. */
export function taxHappinessPoints(rates: TaxRates) {
  return {
    wage: DEFAULT_TAX_RATES.wage - rates.wage,
    profit: DEFAULT_TAX_RATES.profit - rates.profit,
  };
}
export function happinessTarget(amenities:HomeAmenity, commute?:CommuteEstimate, taxPoints = 0, unemploymentPoints = 0) {
  const inaccessible=commute?.workers ? Math.round(60*commute.unreachableWorkers/commute.workers):0;
  // Link costs assume 100 m tiles and 40 km/h. Long trips and congestion use
  // the same estimated seconds; no unsupported claim of actual failure.
  const long=(commute?.averageSeconds??0)>300?10:0;
  const delay=commute?.averageSeconds != null && commute.freeFlowSeconds != null && commute.averageSeconds - commute.freeFlowSeconds >= 10 && commute.averageSeconds >= commute.freeFlowSeconds * 1.02 ? 10 : 0;
  return Math.max(0,Math.min(100,60+amenities.points-inaccessible-long-delay+taxPoints-unemploymentPoints));
}
export function happinessTargets(city: City): Map<number, HappinessTarget> {
  const commutes = new Map(estimateHouseholdCommutes(city).map(row => [row.householdId, row]));
  const homes = new Map(city.buildings.map(b => [b.id, b.cell]));
  const education = new Map(city.education?.people.map(person => [person.householdId, person]));
  const tax = taxHappinessPoints(taxRatesAt(city.taxPolicy, city.tick));
  const earnWages = new Set<number>();
  const ownBusinesses = new Set<number>();
  if (tax.wage) {
    for (const job of city.employment) if (job.workers > 0) earnWages.add(job.householdId);
    for (const park of city.parks) {
      for (const job of park.staffing?.allocations ?? []) if (job.workers > 0) earnWages.add(job.householdId);
    }
    for (const person of education.values()) if (person.teacher + person.professor > 0) earnWages.add(person.householdId);
  }
  if (tax.profit) {
    for (const firm of city.firms) if (firm.owner) ownBusinesses.add(firm.owner.householdId);
  }
  const result = new Map<number, HappinessTarget>();
  for (const h of city.households) {
    const cell = h.home === null ? undefined : homes.get(h.home);
    const amenities = cell === undefined ? { parkNearby: false, schoolNearby: false, points: 0 } : homeAmenities(city, cell);
    const commute = commutes.get(h.id);
    const educationRole = education.get(h.id);
    const studying = (educationRole?.school ?? 0) + (educationRole?.university ?? 0);
    const unemployedWorkers = Math.max(0, h.workforce - (commute?.workers ?? 0) - studying);
    const unemploymentPoints = unemployedWorkers * HAPPINESS_UNEMPLOYED_POINTS;
    const wageTaxPoints = earnWages.has(h.id) ? tax.wage : 0;
    const profitTaxPoints = ownBusinesses.has(h.id) ? tax.profit : 0;
    result.set(h.id, {
      target: happinessTarget(amenities, commute, wageTaxPoints + profitTaxPoints, unemploymentPoints),
      parkNearby: amenities.parkNearby,
      schoolNearby: amenities.schoolNearby,
      workers: commute?.workers ?? 0,
      unreachableWorkers: commute?.unreachableWorkers ?? 0,
      commuteSeconds: commute?.averageSeconds ?? null,
      delaySeconds: commute?.averageSeconds != null && commute.freeFlowSeconds != null
        ? Math.max(0, commute.averageSeconds - commute.freeFlowSeconds) : null,
      wageTaxPoints,
      profitTaxPoints,
      unemployedWorkers,
      unemploymentPoints,
    });
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
 const households = new Map(city.households.map(h => [h.id, h]));
 const arrivals = new Map<string, number>();
 for (const entries of [city.history?.structuralProofs ?? [], city.ledger]) {
   for (const entry of entries) {
     if (entry.reason === 'New household arrival savings') arrivals.set(entry.to, entry.tick);
   }
 }
 let last=0;
 for(const row of v.rows){
   if(!row||typeof row!=='object'||Object.keys(row).sort().join(',')!=='distressDays,householdId,score'||!Number.isSafeInteger(row.householdId)||row.householdId<=last||!valid(row.score,100)||!valid(row.distressDays,HAPPINESS_DEPARTURE_DAYS))throw Error('Invalid happiness row');
   const household = households.get(row.householdId);
   if (!household) throw Error('Invalid happiness row');
   const arrival = household.origin === 'arrival' ? arrivals.get(household.wallet) : 0;
   if (arrival === undefined) throw Error('Invalid happiness row');
   // Arrivals get their first update on the day they enter. Legacy households
   // have no arrival receipt and can have been updated since day one.
   const days = city.tick - Math.max(1, arrival) + 1;
   if (row.score < HAPPINESS_BASE - days || row.score > HAPPINESS_BASE + 2 * days) throw Error('Invalid happiness row');
   // Losing at most one point per day bounds the length of a continuous streak.
   const below = row.score < HAPPINESS_DISTRESS;
   const minimum = below ? HAPPINESS_DISTRESS - row.score : 0;
   const maximum = below ? Math.max(0, days - (HAPPINESS_BASE - HAPPINESS_DISTRESS)) : 0;
   if(row.distressDays < minimum || row.distressDays > maximum)throw Error('Invalid happiness row');
   last=row.householdId;
 }
}
