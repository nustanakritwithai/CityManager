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
/** A day as the game plays it: the growth rounds through the day, then midnight. */
function day(c: City, rounds = true) {
  if (rounds) for (let round = 1; round <= GROWTH_ROUNDS; round++) {
    if (growthRound(c, round)) keepSupplied(c, 60);
  }
  step(c); keepSupplied(c, 60);
}
const people = (c: City) => c.households.reduce((n, h) => n + h.members, 0);
const workDays = (c: City) => c.firms.reduce((n, f) => n + Object.values(f.workDays).reduce((m, d) => m + d, 0), 0);

test('a growth round is due every three game hours from 03:00 to 21:00', () => {
  assert.equal(GROWTH_ROUND_MINUTES, 180);
  assert.equal(GROWTH_ROUNDS, 7);
  assert.deepEqual([0, 179, 180, 359, 360, 420, 539, 540, 720, 900, 1080, 1259, 1260, 1439].map(growthRoundsDue),
    [0, 0, 1, 1, 2, 2, 2, 3, 4, 5, 6, 6, 7, 7]);
});

test('a fresh server city with a supplied home welcomes its first households at 09:00 and saves on day zero', () => {
  const { city, runtime } = deserializeParkSession(freshServerCityRaw('11111111-1111-4111-8111-111111111111'));
  assert.equal(runtime.activity.minute, 420);
  assert.equal(buildRoad(city, GATEWAY, GATEWAY + 4).ok, true);
  const site = city.cells.findIndex((cell, i) => !cell.road && !cell.zone && access(city, i));
  assert.equal(zoneCell(city, site, 'R').ok, true);
  assert.equal(buildReadyParcels(city, site), 1);
  const advance = (minutes: number) => advanceParkRuntime(city, runtime, minutes, () => step(city),
    undefined, undefined, undefined, round => growthRound(city, round));

  advance(119);
  assert.equal(city.households.length, 0);
  assert.equal(city.growthRound, undefined, 'do not run 03:00 or 06:00 after starting at 07:00');
  advance(1);
  assert.equal(city.tick, 0);
  assert.ok(city.households.length > 0, 'a supplied home is enough for the first arrivals');
  assert.equal(city.growthRound, 3);
  const saved = serializeParkSession(city, runtime, city.market);
  const reloaded = deserializeParkSession(saved);
  assert.equal(serializeParkSession(reloaded.city, reloaded.runtime, reloaded.city.market), saved);
  const observed: number[] = [];
  advanceParkRuntime(reloaded.city, reloaded.runtime, 181, () => step(reloaded.city),
    undefined, undefined, undefined, round => { observed.push(round); growthRound(reloaded.city, round); });
  assert.deepEqual(observed, [4], 'reopening at 09:00 processes 12:00 next');
});

test('a fast clock advance runs growth before midnight and resumes on the next day', () => {
  const { city, runtime } = deserializeParkSession(freshServerCityRaw('11111111-1111-4111-8111-111111111111'));
  const rounds: Array<[number, number, number]> = [];
  advanceParkRuntime(city, runtime, 1200, () => step(city), undefined, undefined, undefined, round => {
    rounds.push([city.tick, runtime.activity.minute, round]);
    growthRound(city, round);
  });
  assert.deepEqual(rounds, [[0, 540, 3], [0, 720, 4], [0, 900, 5], [0, 1080, 6], [0, 1260, 7], [1, 180, 1]]);
  assert.equal(city.growthRound, 1);
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
  assert.equal(growthRound(c, 1), true); assert.equal(c.growthRound, 1);
  assert.ok(c.firms.some(f => f.building === c.cells[site].building), 'the round built the waiting farm');
  assert.ok(summary(c).unemployed < waiting.unemployed, 'people without work take the open jobs in the round');
  assert.equal(workDays(c), shifts, 'a round counts no shift: wages stay on the daily step');
  // Each time slot runs once; midnight starts the next day's rounds.
  assert.equal(growthRound(c, 1), false);
  for (let round = 2; round <= GROWTH_ROUNDS; round++) assert.equal(growthRound(c, round), true);
  assert.equal(c.growthRound, GROWTH_ROUNDS);
  assert.equal(growthRound(c, GROWTH_ROUNDS + 1), false);
  step(c); assert.equal(c.growthRound, undefined);
  assert.ok(workDays(c) > shifts, 'midnight counts the new workers\' first shift');
  assert.equal(growthRound(c, 1), true); assert.equal(c.growthRound, 1);
});

test('a city saved before the game kept its pace has no rounds, and an old save is unchanged', () => {
  const c = town(false), json = serialize(c);
  assert.equal(growthRound(c, 1), false); assert.equal(serialize(c), json);
  for (let d = 0; d < 5; d++) day(c);
  assert.equal(c.growthRound, undefined);
});

test('a save keeps the day\'s rounds; a bad count or a round ahead of the clock is refused', () => {
  const c = town(true); for (let d = 0; d < 2; d++) day(c, false);
  growthRound(c, 1); growthRound(c, 2);
  const json = serialize(c), back = deserialize(json);
  assert.equal(back.growthRound, 2); assert.equal(serialize(back), json);
  // The reloaded city plays the rest of the day the same way.
  for (let round = 3; round <= GROWTH_ROUNDS; round++) {
    growthRound(c, round);
    growthRound(back, round);
  }
  step(c); step(back); assert.equal(serialize(back), serialize(c));
  for (const bad of [0, GROWTH_ROUNDS + 1, 1.5, -1]) assert.throws(() => deserialize(json.replace('"growthRound":2', `"growthRound":${bad}`)), /growth round/i, String(bad));
  const old = town(false), raw = JSON.parse(serialize(old)); raw.growthRound = 1;
  assert.throws(() => deserialize(JSON.stringify(raw)), /growth round/i, 'only a city started in the game has rounds');
  // A session save: the clock must have reached every round the city ran.
  const { city, runtime } = deserializeParkSession(freshServerCityRaw('11111111-1111-4111-8111-111111111111'));
  advanceParkRuntime(city, runtime, 1440 - runtime.activity.minute + GROWTH_ROUND_MINUTES + 1, () => step(city));
  assert.equal(growthRoundsDue(runtime.activity.minute), 1);
  growthRound(city, 1);
  const session = serializeParkSession(city, runtime);
  assert.equal(deserializeParkSession(session).city.growthRound, 1);
  growthRound(city, 2);
  assert.throws(() => serializeParkSession(city, runtime), /ahead of the clock/);
});

test('rounds recorded as outside changes replay exactly in the owner journal', () => {
  const c = town(true, 24), session = createOwnerDecisionSession(c);
  for (let d = 0; d < 4; d++) {
    for (let round = 1; round <= GROWTH_ROUNDS; round++) {
      session.beforeExternal(c);
      assert.equal(growthRound(c, round), true);
      session.syncExternal(c, 'growth-round');
    }
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

test('a big town takes in a round\'s share of newcomers every three hours', { timeout: 300_000 }, () => {
  const fast = town(true, 60, true), slow = structuredClone(fast);
  for (let d = 0; d < 15; d++) { day(fast); day(slow, false); }
  assert.ok(fast.households.length > slow.households.length, `${fast.households.length} households with rounds, ${slow.households.length} without`);
  // Never more than a twentieth of the town waits without a home.
  assert.ok(fast.households.filter(h => h.home === null).length <= Math.max(2, Math.floor(fast.households.length * .05)));
});
