import assert from 'node:assert/strict';
import { deserialize, serialize } from '../src/sim.ts';
import { deserializeParkSession } from '../src/park-runtime.ts';

/** Preserve both assertions at the application save boundary: exact whole
 * session bytes, and the independently expected economic city/ledger state.
 */
export async function assertSavedCity(evaluate, expected) {
  const raw = await evaluate('localStorage.getItem("citymanager.save.v7")');
  assert.equal(raw, await evaluate('window.cityManager.sessionSnapshot()'), 'Storage contains the exact atomic session');
  const { city, runtime } = deserializeParkSession(raw);
  const expectedCity = typeof expected === 'string' ? deserialize(expected) : expected;
  assert.equal(serialize(city), serialize(expectedCity), 'Saved city bytes match the expected economic state');
  assert.deepEqual(city, expectedCity, 'Saved city records and balances match independently');
  assert.equal(runtime.recreation.minute, city.tick * 1440 + runtime.activity.minute, 'Saved clocks agree');
  return raw;
}
