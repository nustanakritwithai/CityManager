import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, buildRoad, zoneCell, access, buildReadyParcels, serialize, deserialize, summary, growthRound, growthRoundsDue, GROWTH_ROUNDS, GROWTH_ROUND_MINUTES, GATEWAY, SIZE, type City, type Zone } from '../src/sim.ts';
import { freshServerCityRaw } from '../src/fresh-server-city.ts';
import { deserializeParkSession, serializeParkSession, advanceParkRuntime } from '../src/park-runtime.ts';
import { createOwnerDecisionSession, replayOwnerJournal } from '../src/owner-decision-session.ts';
import { TILE_SCALE } from '../src/tile-scale.ts';
import { OUTSIDE_SUPPLY } from '../src/utilities.ts';
import { keepSupplied } from './plants.ts';

/** A town laid out as a player would: streets every third row; homes, farms, shops and a factory; plants as needed. */
function town(game: boolean, parcels = 40, big = false): City {
  const c = createCity(61025, { starter: false }); if (game) c.unlocks = { version: 1 };
  if (big) { c.tileScale = TILE_SCALE; c.utilities.outside = { power: OUTSIDE_SUPPLY.power * TILE_SCALE, water: OUTSIDE_SUPPLY.water * TILE_SCALE }; }
  const W = SIZE, H = Math.floor(c.cells.length / SIZE), gy = Math.floor(GATEWAY / SIZE);
  buildRoad(c, GATEWAY, gy * W + 1); buildRoad(c, 1, (H - 1) * W + 1);
  for (let y = 0; y < H; y += 3) buildRoad(c, y * W + 1, y * W + W - 1);
  const pattern = 'RRFRCRIRFRRCRF'; let k = 0, n = 0;
  for (let i = 0; i < c.cells.length && k < parcels; i++) {
    const cell = c.cells[i]; if (cell.road || cell.zone || !access(c, i)) continue;
    if (n++ % 6 === 5) continue;
    if (zoneCell(c, i, pattern[k++ % pattern.length] as Zone).ok && game) buildReadyParcels(c, i);
    if (keepSupplied(c, 60) && game) buildReadyParcels(c);
  }
  return c;
}
/** A day as the game plays it: the five growth rounds through the day, then midnight. */
function day(c: City, rounds = true) {
  if (rounds) while (growthRound(c)) keepSupplied(c, 60);
  step(c); keepSupplied(c, 60);
}
const people = (c: City) => c.households.reduce((n, h) => n + h.members, 0);
const workDays = (c: City) => c.firms.reduce((n, f) => n + Object.values(f.workDays).reduce((m, d) => m + d, 0), 0);

test('a growth round is due every four game hours from 04:00 to 20:00', () => {
  assert.equal(GROWTH_ROUND_MINUTES, 240); assert.equal(GROWTH_ROUNDS, 5);
  assert.deepEqual([0, 239, 240, 479, 480, 720, 960, 1199, 1200, 1439].map(growthRoundsDue), [0, 0, 1, 1, 2, 3, 4, 4, 5, 5]);
});

test('a round builds a waiting parcel and gives the open jobs to people without work, but counts no shift', () => {
  const c = town(true);
  for (let d = 0; d < 3; d++) day(c, false);
  // A farm parcel zoned without its building waits for the next round.
  const site = c.cells.findIndex((cell, i) => !cell.road && !cell.zone && cell.building === null && access(c, i));
  assert.equal(zoneCell(c, site, 'F').ok, true); assert.equal(c.cells[site].building, null);
  // Midnight's newcomers arrive after the day's hiring, so some are still without work.
  const shifts = workDays(c), waiting = summary(c);
  assert.ok(waiting.unemployed > 0 && waiting.openJobs > 0, `${waiting.unemployed} without work, ${waiting.openJobs} open jobs`);
  assert.equal(growthRound(c), true); assert.equal(c.growthRound, 1);
  assert.ok(c.firms.some(f => f.building === c.cells[site].building), 'the round built the waiting farm');
  assert.ok(summary(c).unemployed < waiting.unemployed, 'people without work take the open jobs in the round');
  assert.equal(workDays(c), shifts, 'a round counts no shift: wages stay on the daily step');
  // Five rounds a day at most; midnight starts the next day's rounds.
  while (growthRound(c)) { /* the rest of the day's rounds */ }
  assert.equal(c.growthRound, GROWTH_ROUNDS); assert.equal(growthRound(c), false);
  step(c); assert.equal(c.growthRound, undefined);
  assert.ok(workDays(c) > shifts, 'midnight counts the new workers\' first shift');
  assert.equal(growthRound(c), true); assert.equal(c.growthRound, 1);
});

test('a city saved before the game kept its pace has no rounds, and an old save is unchanged', () => {
  const c = town(false), json = serialize(c);
  assert.equal(growthRound(c), false); assert.equal(serialize(c), json);
  for (let d = 0; d < 5; d++) day(c);
  assert.equal(c.growthRound, undefined);
});

test('a save keeps the day\'s rounds; a bad count or a round ahead of the clock is refused', () => {
  const c = town(true); for (let d = 0; d < 2; d++) day(c, false);
  growthRound(c); growthRound(c);
  const json = serialize(c), back = deserialize(json);
  assert.equal(back.growthRound, 2); assert.equal(serialize(back), json);
  // The reloaded city plays the rest of the day the same way.
  while (growthRound(c)) { /* */ } while (growthRound(back)) { /* */ }
  step(c); step(back); assert.equal(serialize(back), serialize(c));
  for (const bad of [0, 6, 1.5, -1]) assert.throws(() => deserialize(json.replace('"growthRound":2', `"growthRound":${bad}`)), /growth round/i, String(bad));
  const old = town(false), raw = JSON.parse(serialize(old)); raw.growthRound = 1;
  assert.throws(() => deserialize(JSON.stringify(raw)), /growth round/i, 'only a city started in the game has rounds');
  // A session save: the clock must have reached every round the city ran.
  const { city, runtime } = deserializeParkSession(freshServerCityRaw('11111111-1111-4111-8111-111111111111'));
  advanceParkRuntime(city, runtime, 1440 - runtime.activity.minute + 4 * 60 + 1, () => step(city));
  assert.equal(growthRoundsDue(runtime.activity.minute), 1);
  growthRound(city);
  const session = serializeParkSession(city, runtime);
  assert.equal(deserializeParkSession(session).city.growthRound, 1);
  growthRound(city);
  assert.throws(() => serializeParkSession(city, runtime), /ahead of the clock/);
});

test('rounds recorded as outside changes replay exactly in the owner journal', () => {
  const c = town(true, 24), session = createOwnerDecisionSession(c);
  for (let d = 0; d < 4; d++) {
    while (true) { session.beforeExternal(c); const ran = growthRound(c); session.syncExternal(c, 'growth-round'); if (!ran) break; }
    session.advance(c); keepSupplied(c, 60); session.syncExternal(c, 'test-supply');
  }
  assert.equal(session.getStats().recording, true, `journal issue: ${session.getStats().issue}`);
  const replayed = replayOwnerJournal(JSON.parse(JSON.stringify(session.exportJournal())));
  assert.equal(replayed.ok, true, replayed.code);
  assert.equal(serialize(replayed.city!), serialize(c));
});

test('with rounds a town grows faster than with midnight alone', { timeout: 300_000 }, () => {
  const fast = town(true, 60), slow = structuredClone(fast);
  for (let d = 0; d < 20; d++) { day(fast); day(slow, false); }
  assert.ok(people(fast) > people(slow), `${people(fast)} people with rounds, ${people(slow)} without`);
  const json = serialize(fast); assert.equal(serialize(deserialize(json)), json);
});

test('a big town takes in a round\'s share of newcomers every four hours', { timeout: 300_000 }, () => {
  const fast = town(true, 60, true), slow = structuredClone(fast);
  for (let d = 0; d < 15; d++) { day(fast); day(slow, false); }
  assert.ok(fast.households.length > slow.households.length, `${fast.households.length} households with rounds, ${slow.households.length} without`);
  // Never more than a twentieth of the town waits without a home.
  assert.ok(fast.households.filter(h => h.home === null).length <= Math.max(2, Math.floor(fast.households.length * .05)));
});
