/** Deterministic recreation sidecar. One economic tick is still one day.
 * The caller supplies integer game minutes; neither wall time nor atmosphere is read.
 * Identities are constituent slots of existing household counts, not extra population.
 */
import { SIZE, type City } from './sim.ts';
import { WORKER_SKILLS } from './labor.ts';

export const PARK_VISITOR_CAPACITY = 6, MAX_PARK_VISITORS = 64;
export const MAX_PARK_ROUTE_SEARCHES = 256;
export const PARK_ACTIVITY_DAY_MINUTES = 1440, WORK_START_MINUTE = 480, WORK_END_MINUTE = 1020;
export const MAX_PARK_ROUTE_CELLS = 34;
export type ParkActivityPhase = 'travel' | 'enter' | 'stroll' | 'wait' | 'meet' | 'sit' | 'leave';
export type Citizen = { citizenId: string; householdId: number; memberSlot: number; homeId: number | null; employed: boolean; firmId: number | null; parkJobId: number | null };
export type ParkVisitor = Citizen & { homeId: number; homeCell: number; parkId: number; parkCell: number; slot: number; route: number[]; departureMinute: number; phase: ParkActivityPhase; phaseMinute: number; partnerId: string | null };
export type ParkActivityState = { version: 1; day: number; minute: number; visitors: ParkVisitor[]; visited: string[]; completed: number; cancelled: number; lastCancellation: string | null; routeSearches: number };
export type ParkVisitorSnapshot = ParkVisitor & { x: number; z: number; headingX: number; headingZ: number };
type Point = { x: number; z: number };
/** Read-only bridge to the reviewed workforce candidate; no assignment authority here. */
type StaffedPark = City['parks'][number] & { staffing?: { allocations: { householdId: number; parkId: number; skill: typeof WORKER_SKILLS[number]; workers: number }[] } };
type Job = { firmId: number | null; parkJobId: number | null };
const integer = (n: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): n is number => Number.isSafeInteger(n) && (n as number) >= min && (n as number) <= max;
const neighbours = (i: number) => [i % SIZE ? i - 1 : -1, i % SIZE < SIZE - 1 ? i + 1 : -1, i >= SIZE ? i - SIZE : -1, i < SIZE * (SIZE - 1) ? i + SIZE : -1].filter(n => n >= 0);
const centre = (cell: number): Point => ({ x: cell % SIZE + .5, z: Math.floor(cell / SIZE) + .5 });
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
const identity = (householdId: number, slot: number) => `h:${householdId}:m:${slot}`;
const hash = (value: string): number => { let n = 2166136261; for (const char of value) n = Math.imul(n ^ char.charCodeAt(0), 16777619); return n >>> 0; };

/** Skill pools occupy stable member slots in catalog order; owners precede wage jobs
 * within each skill, then firm ID. Municipal jobs append in park-ID order to the
 * remaining slots, matching the workforce allocator's residual pools. A change can reassign a slot's
 * job, but never changes its constituent identity or creates another worker.
 */
export function parkActivityCitizens(city: City): Citizen[] {
  const people: Citizen[] = [];
  for (const h of [...city.households].sort((a, b) => a.id - b.id)) {
    const jobs: (Job | null)[] = [];
    for (const skill of WORKER_SKILLS) {
      const allocations = [
        ...city.ownerLabor.filter(e => e.householdId === h.id && e.skill === skill).sort((a, b) => a.firmId - b.firmId),
        ...city.employment.filter(e => e.householdId === h.id && e.skill === skill).sort((a, b) => a.firmId - b.firmId)
      ];
      const pool: (Job | null)[] = [];
      for (const e of allocations) for (let i = 0; i < e.workers && pool.length < h.workerSkills[skill]; i++) pool.push({ firmId: e.firmId, parkJobId: null });
      for (const park of [...city.parks as StaffedPark[]].sort((a, b) => a.id - b.id)) {
        for (const a of park.staffing?.allocations ?? []) if (a.householdId === h.id && a.skill === skill && a.parkId === park.id) {
          for (let i = 0; i < a.workers && pool.length < h.workerSkills[skill]; i++) pool.push({ firmId: null, parkJobId: park.id });
        }
      }
      while (pool.length < h.workerSkills[skill]) pool.push(null);
      jobs.push(...pool);
    }
    for (let slot = 0; slot < h.members; slot++) people.push({ citizenId: identity(h.id, slot), householdId: h.id, memberSlot: slot, homeId: h.home, employed: jobs[slot] != null, firmId: jobs[slot]?.firmId ?? null, parkJobId: jobs[slot]?.parkJobId ?? null });
  }
  return people;
}

/** Shared availability input for leisure and the separate recreation observer. */
export function parkActivityUnavailableCitizenIds(city: City, minuteOfDay: number): Set<string> {
  if (!integer(minuteOfDay, 0, 1440)) throw new RangeError('Invalid activity minute');
  return new Set(minuteOfDay >= WORK_START_MINUTE && minuteOfDay < WORK_END_MINUTE
    ? parkActivityCitizens(city).filter(p => p.employed).map(p => p.citizenId) : []);
}
export function parkActivityAbsoluteMinute(state: Pick<ParkActivityState, 'day' | 'minute'>): number {
  const absolute = state.day * 1440 + state.minute;
  if (!integer(state.day) || !integer(state.minute, 0, 1440) || !integer(absolute)) throw new RangeError('Activity clock exceeds safe absolute minutes');
  return absolute;
}

function walkable(city: City): Set<number> {
  const blocked = new Set([...city.buildings.map(b => b.cell), ...city.plants.map(p => p.cell), ...city.parks.map(p => p.cell)]);
  return new Set(city.cells.flatMap((c, i) => c.building === null && !blocked.has(i) ? [i] : []));
}

/** Read-only cache for one synchronous advance. Never retain across city edits,
 * economic days or asynchronous work. Identity allocation still has one owner.
 */
export type ParkActivityContext = { city: City; day: number; citizens: Citizen[]; people: ReadonlyMap<string, Citizen>; open: ReadonlySet<number>; unavailableCitizenIds?: ReadonlySet<string> };
export function prepareParkActivity(city: City): ParkActivityContext {
  const citizens = parkActivityCitizens(city);
  return { city, day: city.tick, citizens, people: new Map(citizens.map(p => [p.citizenId, p])), open: walkable(city) };
}
function checkContext(city: City, context: ParkActivityContext) {
  if (context.city !== city || context.day !== city.tick) throw new Error('Expired park activity context');
}

/** Bounded orthogonal BFS. Only the home/target endpoints may be occupied.
 * There is no water terrain in canonical City; all routing stays inside the map.
 */
export function parkPedestrianRoute(city: City, homeCell: number, parkCell: number): number[] {
  if (!integer(homeCell, 0, SIZE * SIZE - 1) || !integer(parkCell, 0, SIZE * SIZE - 1) || homeCell === parkCell) return [];
  const open = walkable(city), previous = new Map<number, number>([[homeCell, -1]]), depth = new Map([[homeCell, 1]]), queue = [homeCell];
  for (let q = 0; q < queue.length; q++) {
    const here = queue[q];
    if (depth.get(here)! >= MAX_PARK_ROUTE_CELLS) continue;
    for (const next of neighbours(here)) {
      if (previous.has(next) || (!open.has(next) && next !== parkCell)) continue;
      previous.set(next, here); depth.set(next, depth.get(here)! + 1);
      if (next === parkCell) { const path = [next]; for (let at = here; at !== -1; at = previous.get(at)!) path.push(at); return path.reverse(); }
      queue.push(next);
    }
  }
  return [];
}

export function createParkActivity(city: City, minuteOfDay = 0): ParkActivityState {
  if (!integer(minuteOfDay, 0, 1440)) throw new RangeError('Activity minute must be an integer from 0 to 1440');
  return { version: 1, day: city.tick, minute: minuteOfDay, visitors: [], visited: [], completed: 0, cancelled: 0, lastCancellation: null, routeSearches: 0 };
}
function assertDay(city: City, state: ParkActivityState): void {
  if (city.tick !== state.day) throw new Error('Activity day differs from economic day; explicitly call startParkActivityDay after the economic step');
}
/** Explicit discontinuity for a new economic day (also usable for skipped days).
 * Integration should finish 1440 activity minutes, step City once, then call this.
 */
export function startParkActivityDay(city: City, state: ParkActivityState): void {
  if (city.tick <= state.day) throw new Error('New activity day requires a later economic tick');
  const interrupted = state.visitors.length;
  Object.assign(state, createParkActivity(city));
  if (interrupted) { state.cancelled = interrupted; state.lastCancellation = 'economic day advanced before active visits returned'; }
}

/** Removes invalid reservations immediately; it never teleports actors through a
 * new obstacle. Cancellation is exposed separately from completed home returns.
 */
export function reconcileParkActivity(city: City, state: ParkActivityState, context?: ParkActivityContext): void {
  assertDay(city, state);
  if (context) checkContext(city, context);
  const { people, open } = context ?? prepareParkActivity(city);
  state.visited = state.visited.filter(id => people.has(id));
  state.visitors = state.visitors.filter(v => {
    const p = people.get(v.citizenId), home = city.buildings.find(b => b.id === v.homeId), park = city.parks.find(p => p.id === v.parkId);
    let reason: string | null = null;
    if (!p || p.homeId !== v.homeId || home?.cell !== v.homeCell || park?.cell !== v.parkCell) reason = 'resident, home or park removed/changed';
    else if (v.route.slice(1, -1).some(cell => !open.has(cell))) reason = 'pedestrian route obstructed';
    else if (p.employed && state.minute >= WORK_START_MINUTE && state.minute < WORK_END_MINUTE) reason = 'work reservation now active';
    if (reason) { state.cancelled++; state.lastCancellation = reason; return false; }
    v.employed = p!.employed; v.firmId = p!.firmId; v.parkJobId = p!.parkJobId; return true;
  });
  for (const v of state.visitors) if (v.phase === 'meet' && !state.visitors.some(p => p.citizenId === v.partnerId && p.partnerId === v.citizenId && p.phase === 'meet' && p.parkId === v.parkId)) {
    v.phase = 'wait'; v.phaseMinute = 0; v.partnerId = null;
  }
}

const duration = (v: ParkVisitor) => v.phase === 'travel' ? (v.route.length - 1) * 2 : v.phase === 'leave' ? (v.route.length + 2) * 2 : v.phase === 'enter' ? 4 : v.phase === 'stroll' ? 12 : v.phase === 'sit' ? 18 : 12;
const setPhase = (v: ParkVisitor, phase: ParkActivityPhase) => { v.phase = phase; v.phaseMinute = 0; v.partnerId = null; };
function admit(city: City, state: ParkActivityState, context?: ParkActivityContext): void {
  if (state.minute < 600 || state.minute > 1140 || state.minute % 15) return;
  const visited = new Set(state.visited), people = (context?.citizens ?? parkActivityCitizens(city)).filter(p => !context?.unavailableCitizenIds?.has(p.citizenId) && p.homeId !== null && !visited.has(p.citizenId) && (!p.employed || state.minute >= WORK_END_MINUTE));
  // Per-admission cache shares even failed searches across all residents of a
  // building. It cannot become stale across construction edits or another minute.
  const routesByHome = new Map<number, { park: City['parks'][number]; route: number[] }[]>();
  const homes = [...new Set(people.map(p => p.homeId!))].sort((a, b) => a - b);
  // At the canonical maximum of 32 parks, eight complete home choices fit each
  // pass. Rotate these groups so unreachable low-ID homes cannot monopolize work.
  const offset = homes.length ? ((Math.floor((state.minute - 600) / 15) + state.day * 37) * 8) % homes.length : 0;
  const homeOrder = new Map(homes.map((id, i) => [id, (i - offset + homes.length) % homes.length]));
  people.sort((a, b) => homeOrder.get(a.homeId!)! - homeOrder.get(b.homeId!)! || hash(`${state.day}:${a.citizenId}`) - hash(`${state.day}:${b.citizenId}`) || a.citizenId.localeCompare(b.citizenId));
  let searches = 0;
  for (const p of people) {
    if (state.visitors.length >= MAX_PARK_VISITORS) break;
    const home = city.buildings.find(b => b.id === p.homeId && b.zone === 'R'); if (!home) continue;
    let choices = routesByHome.get(home.id);
    if (!choices) {
      const parks = [...city.parks].filter(park => state.visitors.filter(v => v.parkId === park.id).length < PARK_VISITOR_CAPACITY);
      // Evaluate a home's complete choice set or defer it, never choose from a
      // truncated park list merely because its nearest park appeared too late.
      if (searches + parks.length > MAX_PARK_ROUTE_SEARCHES) break;
      choices = parks.map(park => { searches++; state.routeSearches++; return { park, route: parkPedestrianRoute(city, home.cell, park.cell) }; }).filter(p => p.route.length > 1)
        .sort((a, b) => a.route.length - b.route.length || a.park.id - b.park.id);
      routesByHome.set(home.id, choices);
    }
    const choice = choices.find(p => state.visitors.filter(v => v.parkId === p.park.id).length < PARK_VISITOR_CAPACITY); if (!choice) continue;
    // Real saved departures have one-minute headway at each home's edge. A
    // scheduled constituent is still at home and is not rendered as a walker.
    const departureMinute = Math.max(state.minute, ...state.visitors.filter(v => v.homeId === home.id).map(v => v.departureMinute + 1));
    // Worst-case round trip + enter/stroll/wait/meeting/sit returns before 22:00.
    if (departureMinute + choice.route.length * 4 + 70 > 1320) continue;
    const used = new Set(state.visitors.filter(v => v.parkId === choice.park.id).map(v => v.slot));
    const slot = Array.from({ length: PARK_VISITOR_CAPACITY }, (_, i) => i).find(i => !used.has(i))!;
    state.visitors.push({ ...p, homeId: home.id, homeCell: home.cell, parkId: choice.park.id, parkCell: choice.park.cell, slot, route: choice.route, departureMinute, phase: 'travel', phaseMinute: 0, partnerId: null });
    state.visited.push(p.citizenId);
  }
}

/** Integer stepping makes batched, single-minute and save/resume execution equal.
 * Zero minutes is a true pause. Reconciliation while paused is an explicit call.
 */
export function advanceParkActivity(city: City, state: ParkActivityState, minutes: number, context?: ParkActivityContext): void {
  assertDay(city, state);
  if (!integer(minutes, 0, 1440 - state.minute)) throw new RangeError('Advance must use whole game minutes within the current economic day');
  if (!minutes) return;
  reconcileParkActivity(city, state, context);
  for (let i = 0; i < minutes; i++) {
    state.minute++;
    for (const v of state.visitors) {
      if (state.minute <= v.departureMinute) continue;
      v.phaseMinute++;
      if (v.phaseMinute < duration(v)) continue;
      if (v.phase === 'travel') setPhase(v, 'enter');
      else if (v.phase === 'enter') setPhase(v, 'stroll');
      else if (v.phase === 'stroll') setPhase(v, 'wait');
      else if (v.phase === 'wait' || v.phase === 'meet') setPhase(v, v.slot < 2 ? 'sit' : 'leave');
      else if (v.phase === 'sit') setPhase(v, 'leave');
    }
    state.visitors = state.visitors.filter(v => { if (v.phase === 'leave' && v.phaseMinute >= duration(v)) { state.completed++; return false; } return true; });
    for (const park of [...city.parks].sort((a, b) => a.id - b.id)) {
      const waiting = state.visitors.filter(v => v.parkId === park.id && v.phase === 'wait').sort((a, b) => a.slot - b.slot);
      for (let j = 0; j + 1 < waiting.length; j += 2) { const a = waiting[j], b = waiting[j + 1]; setPhase(a, 'meet'); setPhase(b, 'meet'); a.partnerId = b.citizenId; b.partnerId = a.citizenId; }
    }
    admit(city, state, context);
  }
}

function anchor(v: ParkVisitor): Point {
  const c = centre(v.parkCell);
  // Exactly two real benches. Remaining reservations stand on the cross path.
  return v.slot < 2 ? { x: c.x + (v.slot ? .24 : -.24), z: c.z + .29 } : { x: c.x + (v.slot - 3.5) * .14, z: c.z + .125 };
}
function routePoints(v: ParkVisitor): Point[] {
  const points = v.route.map(centre);
  points[0] = lerp(points[0], points[1], .5);
  points[points.length - 1] = lerp(points[points.length - 1], points[points.length - 2], .5);
  return points;
}
function motion(v: ParkVisitor): Point[] {
  const route = routePoints(v), c = centre(v.parkCell), cross = { x: c.x, z: c.z + .125 }, a = anchor(v), shoulder = { x: a.x, z: cross.z };
  if (v.phase === 'travel') return route;
  if (v.phase === 'enter') return [route.at(-1)!, c, cross, shoulder, a];
  if (v.phase === 'leave') return [a, shoulder, cross, c, ...route.reverse()];
  if (v.phase === 'stroll') return [a, shoulder, cross, { x: c.x + .3, z: cross.z }, cross, { x: c.x, z: c.z - .3 }, cross, shoulder, a];
  return [a, a];
}
/** Positions are uncentered tile units; renderer world=(coordinate-SIZE/2)*unit.
 * Renderer animation may decorate gait, but the simulation alone chooses actions.
 */
export function parkActivityVisitors(state: ParkActivityState): ParkVisitorSnapshot[] {
  return state.visitors.filter(v => state.minute >= v.departureMinute).map(v => {
    const points = motion(v), lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.z - points[i].z)), total = lengths.reduce((a, b) => a + b, 0);
    let distance = total * v.phaseMinute / duration(v), segment = 0;
    while (segment < lengths.length - 1 && distance > lengths[segment]) distance -= lengths[segment++];
    const a = points[segment], b = points[segment + 1], length = lengths[segment], position = lerp(a, b, length ? distance / length : 0);
    const partner = state.visitors.find(p => p.citizenId === v.partnerId), look = partner ? anchor(partner) : null;
    const dx = look ? look.x - position.x : b.x - a.x, dz = look ? look.z - position.z : b.z - a.z, magnitude = Math.hypot(dx, dz);
    return { ...v, route: [...v.route], ...position, headingX: magnitude ? dx / magnitude : 0, headingZ: magnitude ? dz / magnitude : -1 };
  });
}

export function parkActivityDiagnostics(state: ParkActivityState) {
  return { day: state.day, minute: state.minute, activeReservations: state.visitors.length, inside: state.visitors.filter(v => v.phase !== 'travel' && v.phase !== 'leave').length,
    completedReturns: state.completed, cancelled: state.cancelled, lastCancellation: state.lastCancellation,
    meetingPairs: state.visitors.filter(v => v.phase === 'meet').length / 2, visitedToday: state.visited.length, routeSearches: state.routeSearches };
}
export function serializeParkActivity(state: ParkActivityState): string { return JSON.stringify(state); }

/** Strict structural validation before reconciling stale references/topology.
 * Malformed files are rejected, while legitimate demolitions cancel reservations.
 */
export function restoreParkActivity(city: City, json: string): ParkActivityState {
  if (json.length > 2_000_000) throw new Error('Corrupt park activity: excessive save size');
  const s = JSON.parse(json) as ParkActivityState;
  const fail = () => { throw new Error('Corrupt park activity sidecar'); };
  if (!s || s.version !== 1 || !integer(s.day) || !integer(s.minute, 0, 1440) || !integer(s.completed) || !integer(s.cancelled) || !integer(s.routeSearches) || !(s.lastCancellation === null || typeof s.lastCancellation === 'string') || !Array.isArray(s.visitors) || s.visitors.length > MAX_PARK_VISITORS || !Array.isArray(s.visited) || s.visited.some(id => typeof id !== 'string' || !/^h:[1-9]\d*:m:\d+$/.test(id)) || new Set(s.visited).size !== s.visited.length) fail();
  const ids = new Set<string>(), reservations = new Set<string>();
  for (const v of s.visitors) {
    if (!v || !integer(v.householdId, 1) || !integer(v.memberSlot) || v.citizenId !== identity(v.householdId, v.memberSlot) || ids.has(v.citizenId) || !s.visited.includes(v.citizenId) || !integer(v.homeId, 1) || !integer(v.homeCell, 0, SIZE * SIZE - 1) || !integer(v.parkId, 1) || !integer(v.parkCell, 0, SIZE * SIZE - 1) || !integer(v.slot, 0, 5) || reservations.has(`${v.parkId}:${v.slot}`) || typeof v.employed !== 'boolean' || !(v.firmId === null || integer(v.firmId, 1)) || !integer(v.departureMinute, 600, 1320) || !['travel', 'enter', 'stroll', 'wait', 'meet', 'sit', 'leave'].includes(v.phase) || !integer(v.phaseMinute) || !Array.isArray(v.route) || v.route.length < 2 || v.route.length > MAX_PARK_ROUTE_CELLS || v.route[0] !== v.homeCell || v.route.at(-1) !== v.parkCell || new Set(v.route).size !== v.route.length || v.route.some((cell, i) => !integer(cell, 0, SIZE * SIZE - 1) || (i > 0 && !neighbours(v.route[i - 1]).includes(cell))) || v.phaseMinute >= duration(v) || (v.phase === 'sit' && v.slot > 1) || !(v.partnerId === null || typeof v.partnerId === 'string') || (v.phase === 'meet') !== (v.partnerId !== null) || (v.phase === 'travel' && v.phaseMinute !== Math.max(0, s.minute - v.departureMinute)) || (v.phase !== 'travel' && v.departureMinute > s.minute)) fail();
    if (!(v.parkJobId === null || integer(v.parkJobId, 1)) || (v.parkJobId !== null && v.firmId !== null)) fail();
    ids.add(v.citizenId); reservations.add(`${v.parkId}:${v.slot}`);
  }
  for (const v of s.visitors) if (v.phase === 'meet' && !s.visitors.some(p => p !== v && p.citizenId === v.partnerId && p.partnerId === v.citizenId && p.phase === 'meet' && p.phaseMinute === v.phaseMinute && p.parkId === v.parkId)) fail();
  assertDay(city, s); reconcileParkActivity(city, s); return s;
}
