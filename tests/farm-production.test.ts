import test from 'node:test';
import assert from 'node:assert/strict';
import { FARM_YIELD_PER_WORKER, farmProductionFertility, farmYieldPerWorker } from '../src/farm-production.ts';
import { proposeHarvest } from '../src/agriculture.ts';
import { createCity, step, zoneCell, access, serialize, deserialize } from '../src/sim.ts';

test('all soil values yield the same future harvest at every staffing level', () => {
  const city = { tick: 2, farmSoilIndependentStartTick: 1, resources: { fertility: [0, 20, 49, 50, 70, 84, 100] } };
  for (let cell = 0; cell < city.resources.fertility.length; cell++) {
    assert.equal(farmYieldPerWorker(city, cell), FARM_YIELD_PER_WORKER);
    for (let workers = 1; workers <= 6; workers++) {
      const proposal = proposeHarvest({ cropInventory: 0, cropCost: 0, productionTick: 1 }, { tick: 2, workers, fertility: farmProductionFertility(city, cell), operational: true, capacity: 168 });
      assert.equal(proposal.quantity, 24 * workers);
    }
    assert.equal(proposeHarvest({ cropInventory: 167, cropCost: 0, productionTick: 1 }, { tick: 2, workers: 6, fertility: farmProductionFertility(city, cell), operational: true, capacity: 168 }).quantity, 1);
  }
});

test('migration boundary preserves settled soil rates but forecasts the uniform next harvest', () => {
  const city = { tick: 10, farmSoilIndependentStartTick: 10, resources: { fertility: [0, 72, 100] } };
  assert.deepEqual(city.resources.fertility.map((_, i) => farmProductionFertility(city, i, 10)), [50, 72, 100]);
  assert.deepEqual(city.resources.fertility.map((_, i) => farmProductionFertility(city, i, 11)), [100, 100, 100]);
  assert.deepEqual(city.resources.fertility.map((_, i) => farmYieldPerWorker(city, i)), [24, 24, 24]);
});

test('real farms on low, medium and high soil each harvest 24 lots with one worker', () => {
  for (const band of [(f: number) => f < 50, (f: number) => f >= 50 && f < 84, (f: number) => f >= 84]) {
    let city = createCity(61025);
    for (let i = 0; i < city.cells.length; i++) if (city.cells[i].zone === 'F') zoneCell(city, i, null);
    const cell = city.cells.findIndex((c, i) => !c.road && c.zone === null && access(city, i) && band(city.resources.fertility[i]));
    assert.ok(cell >= 0);
    assert.ok(zoneCell(city, cell, 'F').ok);
    city = deserialize(serialize(city));
    for (let day = 0; day < 90; day++) {
      step(city);
      if (city.cropLedger.some(e => e.kind === 'harvest')) break;
    }
    const building = city.buildings.find(b => b.cell === cell)!;
    const farm = city.firms.find(f => f.building === building.id)!;
    const first = city.cropLedger.find(e => e.kind === 'harvest' && e.to === farm.wallet)!;
    assert.ok(first);
    assert.equal(first.workers, 1);
    assert.equal(first.quantity, 24);
    assert.deepEqual(deserialize(serialize(city)), city);
  }
});
