import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, isMarket, isRetail, marketConversionStatus, marketToConvert, retailGrowthStatus } from '../src/sim.ts';

test('market conversion preview agrees with the conversion gate and explains blockers', () => {
  const c = createCity(61025);
  for (let d = 0; d < 400; d++) {
    step(c);
    for (const f of c.firms.filter(isMarket)) {
      const s = marketConversionStatus(c, f);
      if (s.next) assert.equal(marketToConvert(c)?.id, f.id);
      if (marketToConvert(c)?.id === f.id) assert.equal(s.reasons.filter(r => !r.includes('ต้องการร้านค้า')).length, 0);
      else if (!s.next) assert.ok(s.reasons.length > 0 || marketToConvert(c) !== undefined);
    }
  }
});

test('retail growth profit blocker states the threshold', () => {
  const c = createCity(61025);
  for (let d = 0; d < 45; d++) step(c);
  const shop = c.firms.find(isRetail)!; shop.lastMonthProfit = -100;
  assert.ok(retailGrowthStatus(c, shop).reasons.some(r => /มากกว่า \d/.test(r)));
});
