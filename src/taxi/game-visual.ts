import type { CitizenVehiclePose } from '../citizen-vehicle-poses.ts';
import type { GameCar, GameRenderGroup } from '../traffic/game.ts';
import { GAME_VISUAL_CAR_CAP, gamePoses } from '../traffic/game-poses.ts';
import type { TaxiRoadPose } from './vehicle-poses.ts';

/** One yellow cab. Heading is never zero, which the taxi mesh rejects. */
export function taxiPoseFromCitizen(p: CitizenVehiclePose): TaxiRoadPose {
  return { unitId: p.vehicleId, x: p.x, z: p.z, headingX: p.headingX === 0 && p.headingZ === 0 ? 1 : p.headingX, headingZ: p.headingZ };
}
/** Yellow poses for taxi actors already admitted by the traffic game.
 *  Private cars stay on the citizen fleet; these ids are not drawn twice. */
export function trafficTaxiPoses(cars: readonly GameCar[], groups: readonly GameRenderGroup[]): TaxiRoadPose[] {
  const taxis = cars.filter(c => (c as GameCar & { taxi?: boolean }).taxi);
  if (!taxis.length) return [];
  return gamePoses(taxis, groups, 24, 2, GAME_VISUAL_CAR_CAP, true).map(taxiPoseFromCitizen);
}
