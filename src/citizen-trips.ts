/** Real-person transport planning. Pure, uncapped and independent of rendering.
 * Plans are intentions, never evidence of arrival, production or vehicle ownership.
 * Runtime integration must supply a persistent fleet and canonical game clock.
 */
export type TripRequest = {
  id: string; citizenId: string; householdId: number; origin: number; destination: number;
  route: readonly number[]; earliestDeparture: number; latestDeparture: number;
  canDrive: boolean;
};
export type RidePlan = {
  id: string; driverId: string; householdId: number; departure: number;
  route: number[]; requestIds: string[]; passengerIds: string[];
  stops: { routeIndex: number; citizenIds: string[] }[];
};
export type TripPlanningResult = {
  rides: RidePlan[];
  waiting: { requestId: string; reason: 'no-route' | 'no-driver' }[];
};

/** Only share a prefix of the driver's actual route. There is no invented detour,
 * cross-household pooling, instant transfer, or dropping people from the result.
 * The driver has the last stop. Seat count includes the driver.
 */
export type RidePlanningPolicy = { sameDestinationOnly?: boolean; spreadDepartures?: boolean };
const departureHash=(value:string)=>{let h=2166136261;for(const c of value)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
export function planFamilyRides(requests: readonly TripRequest[], seats = 4, policy:RidePlanningPolicy = {}): TripPlanningResult {
  if (!Number.isSafeInteger(seats) || seats < 1) throw new RangeError('Invalid vehicle seats');
  const ids = new Set<string>(), people = new Set<string>();
  const groups = new Map<string, TripRequest[]>();
  const result: TripPlanningResult = { rides: [], waiting: [] };
  for (const r of requests) {
    if (!r.id || !r.citizenId || ids.has(r.id) || people.has(r.citizenId)) throw new Error('Duplicate or missing trip/person identity');
    ids.add(r.id); people.add(r.citizenId);
    if (![r.householdId, r.origin, r.destination, r.earliestDeparture, r.latestDeparture, ...r.route].every(n => Number.isSafeInteger(n) && n >= 0)
      || r.latestDeparture < r.earliestDeparture) throw new RangeError('Invalid trip request');
    if (r.origin >= 576 || r.destination >= 576 || r.route.some(n => n >= 576)) throw new RangeError('Trip outside the city map');
    if (r.route.length === 0) { result.waiting.push({ requestId: r.id, reason: 'no-route' }); continue; }
    if (r.route[0] !== r.origin || r.route.at(-1) !== r.destination) throw new Error('Trip route endpoints mismatch');
    const key = `${r.householdId}:${r.origin}`;
    const group = groups.get(key) ?? []; group.push(r); groups.set(key, group);
  }
  for (const key of [...groups.keys()].sort()) {
    const group = groups.get(key)!.sort((a, b) => b.route.length - a.route.length || a.id.localeCompare(b.id));
    const remaining = new Set(group.map(r => r.id));
    for (const driver of group) {
      if (!driver.canDrive || !remaining.has(driver.id)) continue;
      const members = [driver];
      let earliest = driver.earliestDeparture, latest = driver.latestDeparture;
      // Non-drivers first so a compatible rider is not stranded by another driver.
      const candidates = [...group].sort((a, b) => Number(a.canDrive) - Number(b.canDrive) || a.id.localeCompare(b.id));
      for (const rider of candidates) {
        if (members.length >= seats) break;
        if (rider.id === driver.id || !remaining.has(rider.id) || rider.route.length > driver.route.length) continue;
        if (policy.sameDestinationOnly && rider.destination !== driver.destination) continue;
        if (!rider.route.every((cell, i) => cell === driver.route[i])) continue;
        const start = Math.max(earliest, rider.earliestDeparture), end = Math.min(latest, rider.latestDeparture);
        if (start > end) continue;
        members.push(rider); earliest = start; latest = end;
      }
      const stops = new Map<number, string[]>();
      for (const member of members) {
        remaining.delete(member.id);
        const i = member.route.length - 1, occupants = stops.get(i) ?? [];
        occupants.push(member.citizenId); stops.set(i, occupants);
      }
      result.rides.push({ id: `ride:${driver.id}`, driverId: driver.citizenId, householdId: driver.householdId,
        departure: earliest + (policy.spreadDepartures ? departureHash(`${driver.householdId}:${driver.origin}:${driver.destination}:${Math.floor(earliest/1440)}`) % (latest-earliest+1) : 0), route: [...driver.route], requestIds: members.map(r => r.id), passengerIds: members.map(r => r.citizenId),
        stops: [...stops].sort(([a], [b]) => a - b).map(([routeIndex, citizenIds]) => ({ routeIndex, citizenIds: citizenIds.sort() })) });
    }
    for (const r of group) if (remaining.has(r.id)) result.waiting.push({ requestId: r.id, reason: 'no-driver' });
  }
  result.waiting.sort((a, b) => a.requestId.localeCompare(b.requestId));
  return result;
}
