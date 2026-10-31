/**
 * Tunable vehicle spacing for the traffic game, the representative fleet and decorative traffic.
 * Lengths are the shipped mesh sizes in world units (2 world units = one road tile), not the
 * shorter stand-ins from the design note: sedan/SUV bodies are 0.42, the truck is 0.72, and a
 * level-1 bus is 0.78 (level 2 is 1.02, level 3 is 1.32). Bumper gap is front of the follower to
 * rear of the leader. Decorative cars are drawn at `decorativeCar` because that mesh is scaled.
 */
export const TRAFFIC_SPACING = Object.freeze({
  standstillGap: 0.09,
  headwayFactor: 0.18,
  brakingZone: 0.25,
  maxPerLanePerTile: 3,
  worldPerTile: 2,
  maxSpeedTiles: 1,
  accel: 3,
  /** Half-width of the keep-out around a junction cell centre, in tiles. Fits 3 sedans per lane. */
  junctionHalfTiles: 0.14,
  lengths: Object.freeze({
    sedan: 0.42,
    suv: 0.42,
    truck: 0.72,
    bus: 0.78,
    decorativeCar: 0.6,
  }),
});

export type LaneVehicle = { posOnLane: number; speed: number; maxSpeed: number; length: number };

/** Centre gap along the lane minus half of each vehicle. Positive means clear space. */
export function bumperGap(follower: Pick<LaneVehicle, 'posOnLane' | 'length'>, leader: Pick<LaneVehicle, 'posOnLane' | 'length'>): number {
  return (leader.posOnLane - follower.posOnLane) - leader.length / 2 - follower.length / 2;
}

/** Standstill gap plus a time headway. `speed` is world units per second, same units as the gap. */
export function desiredFollowingGap(speed: number): number {
  return TRAFFIC_SPACING.standstillGap + Math.max(0, speed) * TRAFFIC_SPACING.headwayFactor;
}

/**
 * Speed the follower should be moving this instant. Inside the braking zone the result blends
 * toward the leader; inside the desired gap it eases down so the bumper gap does not close
 * through `standstillGap`. `leaderSpeed === null` means the lane ahead is empty.
 */
export function followingTargetSpeed(gap: number, speed: number, maxSpeed: number, leaderSpeed: number | null): number {
  if (leaderSpeed === null || !Number.isFinite(gap)) return maxSpeed;
  const desired = desiredFollowingGap(speed);
  const { standstillGap, brakingZone } = TRAFFIC_SPACING;
  if (gap <= standstillGap) return gap < standstillGap ? 0 : Math.min(Math.max(0, speed), Math.max(0, leaderSpeed));
  if (gap < desired) {
    const span = Math.max(1e-6, desired - standstillGap);
    return Math.max(0, leaderSpeed) * ((gap - standstillGap) / span);
  }
  if (gap < desired + brakingZone) {
    const u = (gap - desired) / brakingZone;
    return Math.max(0, leaderSpeed) + (maxSpeed - Math.max(0, leaderSpeed)) * u;
  }
  return maxSpeed;
}

/** Integrate one follower for `dt` seconds. Positions are centres along the lane in world units. */
export function updateVehicleFollowing(current: LaneVehicle, leader: LaneVehicle | null, dt: number): void {
  const step = Math.max(0, dt);
  const gap = leader ? bumperGap(current, leader) : Infinity;
  const aimed = followingTargetSpeed(gap, current.speed, current.maxSpeed, leader ? leader.speed : null);
  current.speed = aimed < current.speed ? aimed : Math.min(aimed, current.speed + TRAFFIC_SPACING.accel * step);
  if (leader && Number.isFinite(gap)) current.speed = Math.min(current.speed, Math.max(0, gap - TRAFFIC_SPACING.standstillGap) / Math.max(step, 1e-4));
  let next = current.posOnLane + current.speed * step;
  if (leader) {
    const minCentre = leader.posOnLane - leader.length / 2 - current.length / 2 - TRAFFIC_SPACING.standstillGap;
    if (next > minCentre) { next = minCentre; current.speed = Math.min(current.speed, Math.max(0, leader.speed)); }
  }
  current.posOnLane = next;
}

export type Box = { minX: number; maxX: number; minZ: number; maxZ: number };
/** Axis-aligned footprint. Headings are grid-aligned. */
export function vehicleBox(p: { x: number; z: number; headingX: number; headingZ: number }, length: number, width: number): Box {
  const along = length / 2, side = width / 2, ax = Math.abs(p.headingX) > Math.abs(p.headingZ);
  const ex = ax ? along : side, ez = ax ? side : along;
  return { minX: p.x - ex, maxX: p.x + ex, minZ: p.z - ez, maxZ: p.z + ez };
}
export function boxesOverlap(a: Box, b: Box, slack = 0): boolean {
  return a.minX < b.maxX - slack && b.minX < a.maxX - slack && a.minZ < b.maxZ - slack && b.minZ < a.maxZ - slack;
}

/**
 * Slide cars backward along their heading until they clear bus bodies. Buses stay put so a stop
 * call is not pulled off the kerb. Returns a new array; does not mutate inputs.
 */
export function separateCarsFromBuses<T extends { x: number; z: number; headingX: number; headingZ: number }>(
  cars: readonly T[],
  buses: readonly { x: number; z: number; headingX: number; headingZ: number; length: number; width: number }[],
  carLength = TRAFFIC_SPACING.lengths.sedan,
  carWidth = 0.3,
): T[] {
  if (!buses.length || !cars.length) return cars.slice();
  const busBoxes = buses.map(b => vehicleBox(b, b.length, b.width));
  return cars.map(car => {
    let x = car.x, z = car.z;
    const hx = car.headingX, hz = car.headingZ;
    for (let n = 0; n < 90; n++) {
      const box = vehicleBox({ x, z, headingX: hx, headingZ: hz }, carLength, carWidth);
      if (!busBoxes.some(b => boxesOverlap(box, b, 0.01))) break;
      x -= hx * 0.02; z -= hz * 0.02;
    }
    return x === car.x && z === car.z ? car : { ...car, x, z };
  });
}
