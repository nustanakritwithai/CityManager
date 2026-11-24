import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, buildRoad, buildPlant, zoneCell, explainCell, buildReadyParcels, serialize, deserialize, connectedRoads, INSTANT_BUILDS, GATEWAY, SIZE, type City, type Zone } from '../src/sim.ts';
import { freshServerCityRaw } from '../src/fresh-server-city.ts';
import { deserializeParkSession, serializeParkSession, advanceParkRuntime } from '../src/park-runtime.ts';
import { parcelChecklist } from '../src/place-checklist.ts';
import { thaiMessage } from '../src/event-text.ts';
import { createOwnerDecisionSession, replayOwnerJournal } from '../src/owner-decision-session.ts';
import { keepSupplied } from './plants.ts';

const gx = GATEWAY % SIZE, gy = Math.floor(GATEWAY / SIZE);
/** An empty map started in the game (`unlocks`) or not, with a road east from the gate along the gate's row. */
function city(game: boolean, road = 10): City {
  const c = createCity(61025, { starter: false });
  if (game) c.unlocks = { version: 1 };
  if (road) assert.ok(buildRoad(c, GATEWAY, gy * SIZE + gx + road).ok);
  return c;
}
/** Parcels south and north of that road. */
const south = (x: number) => (gy + 1) * SIZE + gx + x, north = (x: number) => (gy - 1) * SIZE + gx + x;
/** What the game does when the player taps a parcel with a zone tool. */
function place(c: City, i: number, zone: Zone): number { assert.ok(zoneCell(c, i, zone).ok); return buildReadyParcels(c, i); }

test('a parcel zoned by a connected road rises at once in a city started in the game', () => {
  const c = city(true), i = south(2);
  assert.equal(place(c, i, 'R'), 1);
  const b = c.buildings.find(v => v.cell === i);
  assert.ok(b && b.zone === 'R' && b.age === 0 && c.tick === 0, 'built before any day passes');
  assert.ok(c.ledger.some(e => e.tick === 0 && e.reason === 'Outside residential developer investment'), 'the developer pays for it now');
  assert.match(c.lastEvent, /^R building #\d+ built: road, water and power are ready\./);
  assert.match(thaiMessage(c.lastEvent), /^บ้าน #\d+ สร้างเสร็จแล้ว ถนน น้ำ และไฟพร้อม$/);
  // A city saved before keeps the three-day review: nothing rises on placement.
  const old = city(false);
  assert.equal(place(old, i, 'R'), 0);
  assert.equal(old.cells[i].building, null);
  assert.match(old.lastEvent, /Growth is evaluated every 3 days\./);
});

test('homes, farms and shops rise as they are placed; a factory after the first still waits for an investor', () => {
  const c = city(true);
  for (const [x, zone] of [[2, 'R'], [3, 'F'], [4, 'I'], [5, 'C'], [6, 'C'], [7, 'R']] as const) assert.equal(place(c, south(x), zone), 1, `${zone} at ${x}`);
  assert.equal(place(c, south(8), 'I'), 0, 'the second factory needs capital from an owner, a factory or outside investors');
  assert.equal(c.cells[south(8)].building, null);
  assert.equal(parcelChecklist(c, south(8))!.checks.find(check => check.state === 'fail')?.key, 'industry');
});

test('a town built on its first morning saves and loads, as a plain save and as a server session', () => {
  const c = city(true);
  for (const [x, zone] of [[2, 'R'], [3, 'F'], [4, 'I'], [5, 'C']] as const) place(c, south(x), zone);
  assert.equal(c.tick, 0);
  assert.equal(serialize(deserialize(serialize(c))), serialize(c), 'the factory funded on the first day is a valid save');
  // A new server city: built on placement before its first midnight, saved, loaded and played on.
  const session = deserializeParkSession(freshServerCityRaw('11111111-1111-4111-8111-111111111111'));
  const town = session.city, road = [...connectedRoads(town)].length;
  assert.ok(buildRoad(town, GATEWAY, gy * SIZE + gx + 10).ok);
  assert.ok([...connectedRoads(town)].length > road);
  for (const [x, zone] of [[2, 'R'], [3, 'F'], [4, 'I'], [5, 'C']] as const) place(town, south(x), zone);
  assert.equal(town.buildings.length, 4);
  const loaded = deserializeParkSession(serializeParkSession(town, session.runtime, town.market));
  assert.equal(serialize(loaded.city), serialize(town));
  advanceParkRuntime(loaded.city, loaded.runtime, 1440, () => step(loaded.city), () => true, () => true);
  assert.equal(loaded.city.tick, 1, 'the loaded town plays its first day');
});

test('a road that reaches waiting parcels raises them at once', () => {
  const c = city(true, 0);
  for (const [x, zone] of [[2, 'R'], [3, 'R'], [4, 'F']] as const) assert.equal(place(c, south(x), zone), 0, 'no road yet');
  assert.equal(parcelChecklist(c, south(4))!.checks.find(check => check.state === 'fail')?.key, 'road');
  assert.ok(buildRoad(c, GATEWAY, gy * SIZE + gx + 10).ok);
  assert.equal(buildReadyParcels(c, gy * SIZE + gx + 10), 3, 'the road command builds every parcel it reached');
  assert.deepEqual([2, 3, 4].map(x => c.buildings.find(b => b.cell === south(x))?.zone), ['R', 'R', 'F']);
});

test('water and power still decide: a parcel the network cannot supply waits, and a new plant raises it', () => {
  const c = city(true, 23);
  let x = 1, waiting = -1;
  // Farms and shops draw water and power; the gate's supply runs out after a few.
  for (; x <= 23 && waiting < 0; x++) if (!place(c, south(x), x % 2 ? 'F' : 'C')) waiting = south(x);
  assert.ok(waiting >= 0, 'the gate cannot supply every parcel');
  const short = parcelChecklist(c, waiting)!.checks.find(check => check.state === 'fail')?.key;
  assert.ok(short === 'water' || short === 'power', `waits for ${short}`);
  let plant = north(x);
  for (const kind of ['water', 'power'] as const) { assert.ok(buildPlant(c, plant, kind).ok, `${kind} plant`); buildReadyParcels(c, plant); plant = north(++x); }
  assert.notEqual(c.cells[waiting].building, null, 'the new plants supply it and it rises');
});

test(`one command raises at most ${INSTANT_BUILDS}, the parcel just zoned among them, and the next command the rest`, () => {
  const c = city(true, 0), parcels = [...Array(23).keys()].flatMap(k => [south(k + 1), north(k + 1)]);
  for (const i of parcels.slice(0, 30)) assert.equal(place(c, i, 'R'), 0, 'no road yet');
  assert.ok(buildRoad(c, GATEWAY, gy * SIZE + gx + 23).ok);
  const last = parcels[30];
  assert.equal(place(c, last, 'R'), INSTANT_BUILDS);
  assert.notEqual(c.cells[last].building, null, 'the parcel just zoned rose first');
  const left = parcels.slice(0, 31).filter(i => c.cells[i].building === null);
  assert.equal(left.length, 31 - INSTANT_BUILDS);
  for (const i of left) assert.equal(explainCell(c, i).at(-2), 'Eligible; it is built with your next map command or at midnight.');
  assert.equal(buildReadyParcels(c), left.length);
});

test('the same commands give the same city, and the owner journal replays them exactly', () => {
  const play = () => {
    const c = city(true), session = createOwnerDecisionSession(c);
    for (const [x, zone] of [[2, 'R'], [3, 'R'], [4, 'F'], [5, 'I'], [6, 'C']] as const) {
      session.beforeExternal(c); place(c, south(x), zone); session.syncExternal(c, 'player-map-command');
    }
    for (let d = 0; d < 5; d++) { session.advance(c); keepSupplied(c); session.syncExternal(c, 'test-supply'); }
    session.beforeExternal(c); place(c, north(3), 'R'); session.syncExternal(c, 'player-map-command');
    for (let d = 0; d < 3; d++) session.advance(c);
    return { c, session };
  };
  const a = play(), b = play();
  assert.equal(serialize(a.c), serialize(b.c));
  assert.equal(a.session.getStats().recording, true, `journal issue: ${a.session.getStats().issue}`);
  const replayed = replayOwnerJournal(JSON.parse(JSON.stringify(a.session.exportJournal())));
  assert.equal(replayed.ok, true, replayed.code);
  assert.equal(serialize(replayed.city!), serialize(a.c));
});

test('a day after placement the town runs on what rose: families arrive for the work there is', () => {
  const c = city(true);
  for (const [x, zone] of [[2, 'R'], [3, 'R'], [4, 'R'], [5, 'R'], [6, 'F'], [7, 'I'], [8, 'C'], [9, 'C']] as const) place(c, south(x), zone);
  for (let d = 0; d < 30; d++) { step(c); keepSupplied(c); }
  const people = c.households.reduce((n, h) => n + h.members, 0);
  assert.ok(people >= 6, `${people} people after a month`);
  assert.ok(c.households.every(h => h.home !== null), 'everyone has a home');
});
