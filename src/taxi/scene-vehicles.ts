import type { AppBase } from 'playcanvas';
import { SceneCitizenVehicles } from '../scene-citizen-vehicles.ts';
import { taxiVehiclePoses, type TaxiRoadPose } from './vehicle-poses.ts';

/** Inert drawing adapter. The host must supply authoritative positions from the road bridge. */
export class SceneTaxiVehicles {
  private readonly cars: SceneCitizenVehicles;
  constructor(app: AppBase) { this.cars = new SceneCitizenVehicles(app, ['#f2c94c'], { taxi: true }); }
  sync(poses: readonly TaxiRoadPose[]): void { this.cars.sync(taxiVehiclePoses(poses)); }
  setEnabled(enabled: boolean): void { this.cars.setEnabled(enabled); }
  get diagnostics() { return this.cars.diagnostics; }
  destroy(): void { this.cars.destroy(); }
}
