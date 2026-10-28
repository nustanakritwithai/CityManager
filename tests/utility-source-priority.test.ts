import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, GATEWAY, SIZE, type Household } from '../src/sim.ts';
import { utilityService } from '../src/utilities.ts';

function cityWithOppositePlant(kind: 'power' | 'water') {
  const city = createCity(1, { starter: false });
  const row = Math.floor(GATEWAY / SIZE);
  const roads = new Set(Array.from({ length: 7 }, (_, x) => GATEWAY + x));
  city.plants = [{ id: 99, cell: (row + 1) * SIZE + 5, kind, tick: 0 }];
  city.utilities.outside = kind === 'water' ? { power: 1, water: 20 } : { power: 20, water: 1 };
  city.buildings = [
    { id: 1, cell: (row - 1) * SIZE + 5, zone: 'R', level: 1, age: 1, housingType: 'cottage' },
    { id: 2, cell: (row - 1) * SIZE + 1, zone: 'R', level: 1, age: 1, housingType: 'cottage' },
  ];
  city.households = [{ id: 1, home: 1 }, { id: 2, home: 2 }] as Household[];
  return { city, roads };
}
test('a water plant must not change electricity priority when power is scarce', () => {
  const { city, roads } = cityWithOppositePlant('water');
  const service = utilityService(city, roads);
  assert.equal(service.served.get(2)?.power, true, 'home nearer the power source is served');
  assert.equal(service.served.get(1)?.power, false, 'distant home is unserved');
  assert.equal(service.served.get(1)?.water, true);
});
test('a power plant must not change water priority when water is scarce', () => {
  const { city, roads } = cityWithOppositePlant('power');
  const service = utilityService(city, roads);
  assert.equal(service.served.get(2)?.water, true, 'home nearer the water source is served');
  assert.equal(service.served.get(1)?.water, false, 'distant home is unserved');
  assert.equal(service.served.get(1)?.power, true);
});

test('a gateway with zero power supply is not a power source when a plant supplies the city', () => {
  const city = createCity(1, { starter: false }); const row = Math.floor(GATEWAY / SIZE);
  const roads = new Set(Array.from({ length: 7 }, (_, x) => GATEWAY + x));
  city.plants = [{ id: 99, cell: (row + 1) * SIZE + 5, kind: 'power', tick: 0 }];
  city.utilities.outside = { power: 0, water: 20 };
  city.buildings = [];
  for (let x = 0; x < 7; x++) city.buildings.push({ id: x + 1, cell: (row - 1) * SIZE + x, zone: 'C', level: 4, age: 1 });
  for (let x = 0; x < 6; x++) if (x !== 5) city.buildings.push({ id: x + 8, cell: (row + 1) * SIZE + x, zone: 'C', level: 4, age: 1 });
  const service = utilityService(city, roads);
  assert.equal(service.served.get(7)?.power, true, 'building next to the real power source is served');
  assert.equal(service.served.get(1)?.power, false, 'building farthest from the power plant is unserved');
});
