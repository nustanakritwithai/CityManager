import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, buildRoad, zoneCell, bulldoze, step, GATEWAY, SIZE } from '../src/sim.ts';
import { thaiMessage, appendEvent, EVENT_LOG_LIMIT } from '../src/event-text.ts';

const thai = /[฀-๿]/;

test('every message the simulator produces in play gets Thai text', () => {
  const c = createCity(61025), seen = new Set<string>();
  const record = (text: string) => { seen.add(text); assert.match(thaiMessage(text), thai, `untranslated: ${text}`); };
  record(c.lastEvent);
  record(buildRoad(c, GATEWAY, GATEWAY + 4).message);
  record(buildRoad(c, GATEWAY, GATEWAY + 4).message);
  record(buildRoad(c, 3 * SIZE + 3, 3 * SIZE + 6).message);
  record(buildRoad(c, -1, 5).message);
  for (const zone of ['R', 'C', 'I', 'F', null] as const) { record(zoneCell(c, 11 * SIZE + 2, zone).message); record(zoneCell(c, 2 * SIZE + 20, zone).message); }
  record(zoneCell(c, GATEWAY + 1, 'R').message);
  const poor = c.resources.fertility.findIndex(f => f < 50); record(zoneCell(c, poor, 'F').message);
  record(bulldoze(c, GATEWAY).message); record(bulldoze(c, -3).message); record(bulldoze(c, 3 * SIZE + 3).message);
  for (let t = 0; t < 120; t++) { step(c); record(c.lastEvent); }
  c.accounts.treasury = 0; record(buildRoad(c, 20 * SIZE, 20 * SIZE + 5).message); record(bulldoze(c, GATEWAY + 1).message);
  assert.ok(seen.size >= 15, `covered ${seen.size} distinct messages`);
  assert.ok([...seen].some(t => t.startsWith('Household #')), 'arrivals covered');
  assert.ok([...seen].some(t => t.startsWith('Month settled')), 'month settlement covered');
});

test('translations keep the real numbers and zone names', () => {
  assert.equal(thaiMessage('Built 7 road cells.'), 'สร้างถนน 7 ช่องแล้ว');
  assert.match(thaiMessage('Household #42 arrived with 3 members and 2 workforce; outside arrival savings recorded once.'), /#42.*3 คน.*2 คน/);
  assert.match(thaiMessage('I building #9 grew: road + utilities'), /^โรงงาน #9/);
  assert.match(thaiMessage('Farm needs fertility 50% or more; parcel fertility 31%.'), /50%.*31%/);
  assert.equal(thaiMessage('Something new'), 'Something new', 'unknown text is shown unchanged');
});

test('the event log is newest first, bounded and skips same-day repeats', () => {
  let log = appendEvent([], 1, 'Month settled: x');
  log = appendEvent(log, 1, 'Month settled: x');
  assert.equal(log.length, 1);
  for (let i = 0; i < 40; i++) log = appendEvent(log, i + 2, `Built ${i} road cells.`);
  assert.equal(log.length, EVENT_LOG_LIMIT); assert.equal(log[0].text, 'สร้างถนน 39 ช่องแล้ว');
});
