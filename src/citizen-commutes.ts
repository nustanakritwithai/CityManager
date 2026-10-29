/** Read-only bridge from existing household identities/jobs to real commute intent.
 * Does not assign jobs, mint citizens, mutate money or assume that a trip arrived.
 */
import { parkActivityCitizens, WORK_START_MINUTE, type Citizen } from './park-activity.ts';
import { roadDriveAllowed, roadNeighbors } from './road-topology.ts';
import { type City } from './sim.ts';
import { type TripRequest } from './citizen-trips.ts';
export type CommuteIntent = {
  citizen: Citizen; homeCell: number | null; workCell: number | null;
  request: TripRequest | null; blocked: 'missing-home' | 'missing-workplace' | 'no-route' | null;
};
/** Multi-source directed search: a legal frontage wins over an arbitrary lowest-ID
 * access cell. Local road islands work without a gateway, provided a route exists.
 */
export function citizenDriveRoute(city: City, originParcel: number, destinationParcel: number): number[] {
  const frontage = (cell: number) => city.cells[cell]?.road ? [cell] : roadNeighbors(cell).filter(n=>city.cells[n]?.road).sort((a,b)=>a-b);
  const starts=frontage(originParcel), goals=new Set(frontage(destinationParcel));
  const previous=new Map<number,number>(starts.map(n=>[n,-1])), queue=[...starts];
  for(let at=0;at<queue.length;at++) {
    const here=queue[at];
    if(goals.has(here)) {
      const route:number[]=[];
      for(let n=here;n!==-1;n=previous.get(n)!)route.push(n);
      return route.reverse();
    }
    for(const next of roadNeighbors(here)) if(!previous.has(next)&&roadDriveAllowed(city,here,next)) {
      previous.set(next,here);queue.push(next);
    }
  }
  return [];
}
/** Departure policy remains a caller input until pacing is playtested. No sky clock.
 * This creates outbound intent only; it cannot create a return vehicle at work.
 */
export function planCitizenCommutes(city: City, earliestMinute=WORK_START_MINUTE-60, latestMinute=WORK_START_MINUTE-30): CommuteIntent[] {
  if(!Number.isSafeInteger(earliestMinute)||!Number.isSafeInteger(latestMinute)||earliestMinute<0||latestMinute<earliestMinute||latestMinute>=1440)throw new RangeError('Invalid commute window');
  const buildings=new Map(city.buildings.map(b=>[b.id,b.cell]));
  const firms=new Map(city.firms.map(f=>[f.id,buildings.get(f.building)??null]));
  const parks=new Map(city.parks.map(p=>[p.id,p.cell]));
  const campuses=new Map(city.education?.campuses.map(p=>[p.id,p.cell])??[]);
  const routeCache=new Map<string,number[]>();
  return parkActivityCitizens(city).filter(p=>p.employed).map(citizen=>{
    const homeCell=citizen.homeId===null?null:buildings.get(citizen.homeId)??null;
    const workCell=citizen.firmId!==null?firms.get(citizen.firmId)??null:citizen.parkJobId!==null?parks.get(citizen.parkJobId)??null:citizen.campusJobId!=null?campuses.get(citizen.campusJobId)??null:null;
    if(homeCell===null||workCell===null)return {citizen,homeCell,workCell,request:null,blocked:homeCell===null?'missing-home' as const:'missing-workplace' as const};
    const key=`${homeCell}:${workCell}`;
    let route=routeCache.get(key);if(!route){route=citizenDriveRoute(city,homeCell,workCell);routeCache.set(key,route);}
    const base=city.tick*1440;
    if(!Number.isSafeInteger(base+latestMinute))throw new RangeError('Commute clock overflow');
    return {citizen,homeCell,workCell,blocked:route.length?null:'no-route' as const,
      request:route.length?{id:`commute:${city.tick}:${citizen.citizenId}`,citizenId:citizen.citizenId,householdId:citizen.householdId,
      origin:route[0],destination:route.at(-1)!,route:[...route],earliestDeparture:base+earliestMinute,latestDeparture:base+latestMinute,
      // Existing worker slots have no licence field. V1 permits employed members to drive;
      // dependent slots are not silently turned into drivers or labelled children.
      canDrive:true}:null};
  });
}
