import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_CYCLE_SECONDS, LOCKED_HOURS, advanceHour, atmosphereAt, cycleRate, formatClock, isRaining, phaseOf,
  resolveHour, seasonWeights, dominantSeason, sunPosition, wrapHour
} from '../src/atmosphere.ts';
import { createCity, serialize, step } from '../src/sim.ts';

test('one visual day lasts the configured real seconds at 1× and speed is capped', () => {
  assert.equal(advanceHour(0, DAY_CYCLE_SECONDS, 1), 0);
  assert.ok(Math.abs(advanceHour(6, DAY_CYCLE_SECONDS / 4, 1) - 12) < 1e-9);
  assert.equal(cycleRate(0), 0);
  assert.equal(cycleRate(1), 1);
  assert.equal(cycleRate(10), 2);
  assert.equal(advanceHour(23, -5, 1), 23, 'time never runs backwards');
  assert.equal(wrapHour(-1), 23);
});

test('locked and local modes resolve without reading the simulation', () => {
  assert.equal(resolveHour('night', 3), LOCKED_HOURS.night);
  assert.equal(resolveHour('auto', 25), 1);
  assert.equal(resolveHour('local', 0, new Date(2026, 0, 1, 18, 30)), 18.5);
  assert.equal(formatClock(7.5), '07:30');
  assert.equal(formatClock(23.999), '23:59');
});

test('sun rises east, peaks at noon and is below the horizon at night', () => {
  assert.ok(sunPosition(7)[0] > 0, 'morning sun is east (+x)');
  assert.ok(sunPosition(17)[0] < 0, 'evening sun is west (-x)');
  assert.ok(sunPosition(12)[1] > sunPosition(9)[1]);
  assert.ok(sunPosition(0)[1] < 0);
  assert.deepEqual(['night', 'dawn', 'day', 'dusk', 'night'].map(String), [2, 6, 12, 18, 22].map(phaseOf));
});

test('night lights and lighting follow the hour; light always points downward', () => {
  for (let hour = 0; hour < 24; hour += .25) {
    const a = atmosphereAt(hour);
    assert.ok(a.lightDirection[1] < 0, `light shines downward at ${hour}`);
    assert.ok(a.night >= 0 && a.night <= 1);
    assert.ok(a.ambient.every(v => v > .15), `night stays readable at ${hour}`);
    for (const value of [...a.skyZenith, ...a.skyHorizon, ...a.fogColor]) assert.ok(Number.isFinite(value) && value >= 0);
  }
  assert.equal(atmosphereAt(12.5).night, 0);
  assert.equal(atmosphereAt(1).night, 1);
  assert.ok(atmosphereAt(12.5).lightIntensity > atmosphereAt(1).lightIntensity);
  assert.ok(atmosphereAt(12.5, undefined, .8).lightIntensity < atmosphereAt(12.5).lightIntensity, 'overcast dims the sun');
});

test('Thai seasons blend over game months and always sum to one', () => {
  assert.equal(dominantSeason(seasonWeights(30 * 3.5)), 'hot');
  assert.equal(dominantSeason(seasonWeights(30 * 8)), 'rainy');
  assert.equal(dominantSeason(seasonWeights(30 * 0.2)), 'cool');
  assert.equal(dominantSeason(seasonWeights(30 * 11.8)), 'cool');
  for (let tick = 0; tick < 720; tick += 7) {
    const w = seasonWeights(tick);
    assert.ok(Math.abs(w.hot + w.rainy + w.cool - 1) < 1e-9);
  }
});

test('rain is deterministic per real-time window and mostly in the rainy season', () => {
  let rainy = 0, cool = 0;
  for (let period = 0; period < 400; period++) {
    if (isRaining(61025, period, { hot: 0, rainy: 1, cool: 0 })) rainy++;
    if (isRaining(61025, period, { hot: 0, rainy: 0, cool: 1 })) cool++;
    assert.equal(isRaining(61025, period, { hot: 0, rainy: 1, cool: 0 }), isRaining(61025, period + .7, { hot: 0, rainy: 1, cool: 0 }));
  }
  assert.ok(rainy > 150 && rainy < 290, `rainy season showers: ${rainy}`);
  assert.ok(cool < 30, `cool season showers: ${cool}`);
});

test('atmosphere evaluation never changes simulation state or RNG', () => {
  const city = createCity(61025); for (let i = 0; i < 45; i++) step(city);
  const before = serialize(city);
  for (let hour = 0; hour < 24; hour += .5) atmosphereAt(hour, seasonWeights(city.tick), .4);
  for (let period = 0; period < 50; period++) isRaining(city.seed, period, seasonWeights(city.tick));
  assert.equal(serialize(city), before);
});
