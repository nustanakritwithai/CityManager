import test from 'node:test';
import assert from 'node:assert/strict';
import { SceneTraffic } from '../src/scene-traffic.ts';
import { createCity } from '../src/sim.ts';

test('replacing a city clears old visual traffic and rebuilds even with the same signature', () => {
  const city = createCity(1, { starter: true }), replacement = structuredClone(city);
  let clears = 0, plans = 0;
  const subject = { lastCity: null, enabled: true, signature: '', topologySignature: '', actors: new Map(),
    clear() { clears++; }, apply() { plans++; } };
  const sync = SceneTraffic.prototype.sync as unknown as (this: typeof subject, city: typeof city) => void;
  sync.call(subject, city); sync.call(subject, city);
  assert.equal(plans, 1); assert.equal(clears, 0);
  sync.call(subject, replacement);
  assert.equal(clears, 1); assert.equal(plans, 2);
});
