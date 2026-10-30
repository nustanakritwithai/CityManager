import type { CitizenVehiclePose } from '../citizen-vehicle-poses.ts';

/** Rendering input from the future road bridge, in world coordinates. These positions must come
 * from actual road occupancy, not planned taxi legs or estimated arrival times. */
export type TaxiRoadPose = Readonly<{ unitId: string; x: number; z: number; headingX: number; headingZ: number }>;

/** One yellow drawing per road-owned taxi. Reject invalid or duplicate identities so a broken
 * bridge cannot silently draw two vehicles for one taxi. Does not affect simulation or saves. */
export function taxiVehiclePoses(roadPoses: readonly TaxiRoadPose[]): CitizenVehiclePose[] {
  const ids = new Set<string>();
  return roadPoses.map(p => {
    if (!p.unitId || ids.has(p.unitId)) throw new Error('Invalid or duplicate taxi unit ID');
    ids.add(p.unitId);
    if (![p.x, p.z, p.headingX, p.headingZ].every(Number.isFinite)) throw new Error('Invalid taxi road pose');
    const length = Math.hypot(p.headingX, p.headingZ);
    if (!(length > 0)) throw new Error('Taxi heading must be nonzero');
    return { vehicleId: p.unitId, x: p.x, z: p.z, headingX: p.headingX / length, headingZ: p.headingZ / length, paint: 0 };
  });
}
