/** Renderer-neutral vehicle pose (adapted from PR #84; per-citizen journey fields removed). */
export type CitizenVehiclePose = { vehicleId: string; x: number; z: number; headingX: number; headingZ: number; paint: number };
/** World matrix for the low-poly car, whose long axis is local +Z. */
export function writeVehicleMatrix(target: Float32Array, offset: number, pose: CitizenVehiclePose): void {
  const x = pose.headingX, z = pose.headingZ;
  target.set([z, 0, -x, 0, 0, 1, 0, 0, x, 0, z, 0, pose.x, .14, pose.z, 1], offset);
}
