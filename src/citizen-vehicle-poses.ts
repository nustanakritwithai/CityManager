/** Renderer-neutral vehicle pose (adapted from PR #84; per-citizen journey fields removed). */
export type CitizenVehiclePose = { vehicleId: string; x: number; z: number; headingX: number; headingZ: number; paint: number; scale?: number; /** Read-only legal upstream centre bound for cosmetic queue reflow. */ laneMin?: number; /** Actual terminal road centre, only on final model link. */ exitX?:number;exitZ?:number; speed?:number; /** Read-only next turn intent; never a motion target. */ upcomingTurn?:{x:number;z:number;headingX:number;headingZ:number;nodeX?:number;nodeZ?:number;incomingHeadingX?:number;incomingHeadingZ?:number;entryX?:number;entryZ?:number;visit?:number} };
/** World matrix for the low-poly car, whose long axis is local +Z. */
export function writeVehicleMatrix(target: Float32Array, offset: number, pose: CitizenVehiclePose): void {
  const k = pose.scale ?? 1, x = pose.headingX * k, z = pose.headingZ * k;
  target.set([z, 0, -x, 0, 0, k, 0, 0, x, 0, z, 0, pose.x, .14, pose.z, 1], offset);
}
