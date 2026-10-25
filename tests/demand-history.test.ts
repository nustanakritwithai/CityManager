import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, summary } from '../src/sim.ts';
import { recordDemand, demandSparkline, DEMAND_HISTORY_DAYS } from '../src/demand-history.ts';

test('demand history keeps one sample per day, the last 30 days, per city object', () => {
  const city = createCity();
  let history = recordDemand(city, summary(city).demand); recordDemand(city, summary(city).demand);
  assert.equal(history.length, 1, 'repeat renders on one day keep one sample');
  assert.equal(demandSparkline(history, 'R'), null);
  for (let d = 0; d < 40; d++) { step(city); history = recordDemand(city, summary(city).demand); }
  assert.equal(history.length, DEMAND_HISTORY_DAYS);
  assert.equal(history.at(-1)!.tick, city.tick);
  assert.match(demandSparkline(history, 'C')!, /<polyline points="[\d., ]+"/);
  assert.equal(recordDemand(createCity(), summary(city).demand).length, 1, 'a different city starts its own history');
});
