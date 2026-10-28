import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyFoodDemand } from '../src/food-demand.ts';

test('food demand follows all household members and uses their shared budget', () => {
  assert.deepEqual(dailyFoodDemand(3, 0, 2400, 800), { required: 3, purchased: 0, missing: 3, affordable: 3 });
  assert.deepEqual(dailyFoodDemand(3, 1, 800, 800), { required: 3, purchased: 1, missing: 2, affordable: 1 });
  assert.deepEqual(dailyFoodDemand(1, 1, 800, 800), { required: 1, purchased: 1, missing: 0, affordable: 0 });
  assert.throws(() => dailyFoodDemand(1, 2, 800, 800), RangeError);
});

test('food reporting sums only today’s actual purchases for the household', async () => {
  const { createCity, step } = await import('../src/sim.ts');
  const { householdFoodToday } = await import('../src/food-demand.ts');
  const city = createCity(61025); for (let i = 0; i < 20; i++) step(city);
  const household = city.households[0]; assert.ok(household);
  city.tick = 100;
  city.goodsLedger = [
    { tick: 100, from: 'firm:1', to: household.wallet, quantity: 2, reason: 'Household final consumption' },
    { tick: 99, from: 'firm:1', to: household.wallet, quantity: 9, reason: 'Household final consumption' },
    { tick: 100, from: 'firm:1', to: 'household:999', quantity: 9, reason: 'Household final consumption' },
  ];
  city.cropLedger = [{ tick: 100, kind: 'consumption', to: household.wallet, quantity: 1 } as typeof city.cropLedger[number]];
  assert.deepEqual(householdFoodToday(city, household), { required: household.members, purchased: 3, missing: Math.max(0, household.members - 3) });
});
