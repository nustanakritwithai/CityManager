import test from 'node:test';
import assert from 'node:assert/strict';
import { createParkRecreation, advanceParkRecreation } from '../src/park-recreation.ts';
import { parkRecreationPanelData } from '../src/park-recreation-panel.ts';

test('read-only panel includes never-visit residents in average and shows zero earned today at midnight', () => {
  const before = createParkRecreation(1439);
  const state = advanceParkRecreation(before, { minute: 1440, residentIds: ['a', 'b'],
    parks: [{ parkId: 1, qualityPermille: 1000, comfortableCapacity: 3 }],
    visits: [{ citizenId: 'a', parkId: 1, eligible: true }] });
  const bytes = JSON.stringify(state), panel = parkRecreationPanelData(state, ['a', 'b']);
  assert.equal(panel.average, .125); assert.equal(panel.withBenefit, 1); assert.equal(panel.population, 2);
  assert.equal(panel.rows[0].gainedToday, 0, 'previous interval belongs to the previous day');
  assert.equal(panel.rows[0].lastCreditedParkId, 1); assert.equal(panel.rows[1].lastBenefitMinute, null);
  assert.equal(JSON.stringify(state), bytes);
});
