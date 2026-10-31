import test from 'node:test';
import assert from 'node:assert/strict';
import { collectTaxiFares, createCity, deserialize, serialize, taxiTripFare, TAXI_TRIP_FARE } from '../src/sim.ts';
import { createTaxiSession } from '../src/taxi/session.ts';
import { taxiSiteReason } from '../src/taxi/placement.ts';
import { captureTrafficGameInput, TrafficGame, type TrafficGameSample } from '../src/traffic/game.ts';

test('taxi depots survive snapshot -> load and respawn in the traffic game', () => {
  const city = createCity(61025), session = createTaxiSession();
  session.bind(city);
  const site = city.cells.findIndex((_, i) => taxiSiteReason(city, i, true) === null);
  assert.ok(site >= 0);
  assert.equal(session.place(city, site, true, true).ok, true);
  const id = session.depots()[0].id;
  assert.equal(session.upgrade(id).ok, true);
  const loaded = deserialize(serialize(city));
  assert.deepEqual(loaded.taxi, city.taxi);
  const restored = createTaxiSession(); restored.bind(loaded);
  assert.deepEqual(restored.depots(), [{ id, cell: site, level: 2, open: true }]);
  assert.deepEqual(captureTrafficGameInput(loaded, { taxiEnabled: true }).taxis, [{ id, cell: site, level: 2, open: true }]);
});

test('old saves without a taxi section load with no depots', () => {
  const raw = serialize(createCity(61025));
  assert.equal(raw.includes('"taxi"'), false);
  const loaded = deserialize(raw), session = createTaxiSession(); session.bind(loaded);
  assert.equal(loaded.taxi, undefined);
  assert.deepEqual(session.depots(), []);
});

test('a completed taxi trip credits its fare to the treasury ledger', () => {
  const roads = new Set([25, 26, 27, 28]);
  const sample: TrafficGameSample = { map: { cells: Array.from({ length: 576 }, (_, i) => ({ road: roads.has(i) })) }, demand: [{ from: 25, to: 28, rate: 1, taxiRate: 1 } as TrafficGameSample['demand'][number]] };
  const game = new TrafficGame(sample);
  let f = game.frame;
  for (let i = 0; i < 20 && !f.taxiTrips; i++) { game.step(); f = game.frame; }
  assert.ok(f.taxiTrips && f.taxiTrips.trips >= 1, JSON.stringify(f.taxiTrips));
  const { trips, tiles } = f.taxiTrips!;
  assert.equal(tiles, trips * 3);
  const city = createCity(61025), before = city.accounts.treasury;
  const fare = collectTaxiFares(city, trips, tiles);
  assert.equal(fare, taxiTripFare(trips, tiles));
  assert.equal(fare, trips * TAXI_TRIP_FARE.base + tiles * TAXI_TRIP_FARE.perTile);
  assert.equal(city.accounts.treasury, before + fare);
  assert.deepEqual(city.ledger.at(-1), { tick: city.tick, from: 'outside', to: 'treasury', amount: fare, reason: 'Taxi fares' });
  assert.equal(deserialize(serialize(city)).accounts.treasury, before + fare);
});

test('fares accrue in memory and post one integer ledger entry per in-game day', async () => {
  const { createTaxiFareAccumulator } = await import('../src/taxi/fares.ts');
  const city = createCity(61025), acc = createTaxiFareAccumulator(), start = city.ledger.length, before = city.accounts.treasury;
  let trips = 0, tiles = 0, posted = 0;
  acc.observe(city, { trips, tiles }, true);
  for (let day = 0; day < 5; day++) {
    for (let frame = 0; frame < 600; frame++) { if (frame % 3 === 0) { trips++; tiles += 4; } posted += acc.observe(city, { trips, tiles }, true); }
    city.tick++; posted += acc.observe(city, { trips, tiles }, true);
  }
  const fares = city.ledger.slice(start).filter(e => e.reason === 'Taxi fares');
  assert.equal(fares.length, 5);
  for (const e of fares) { assert.ok(Number.isSafeInteger(e.amount) && e.amount > 0); assert.equal(e.from, 'outside'); assert.equal(e.to, 'treasury'); }
  assert.equal(posted, taxiTripFare(trips, tiles));
  assert.equal(city.accounts.treasury, before + posted);
  assert.deepEqual(acc.pending(), { trips: 0, tiles: 0 });
  // Paused/preview frames accrue nothing; a game reset (counter drops) is not a negative fare.
  acc.observe(city, { trips: trips + 50, tiles: tiles + 200 }, false); acc.observe(city, { trips: 1, tiles: 3 }, true);
  city.tick++; assert.equal(acc.observe(city, { trips: 1, tiles: 3 }, true), taxiTripFare(1, 3));
  assert.equal(deserialize(serialize(city)).accounts.treasury, city.accounts.treasury);
});

test('first taxi save keeps a compressed before-taxi backup that still restores losslessly', async () => {
  const { SAVE_KEY, TAXI_BACKUP_KEY, saveStoredCity, readStoredCity } = await import('../src/save-storage.ts');
  const { buildTaxiDepot } = await import('../src/taxi/placement.ts');
  const city = createCity(61025);
  for (let i = 0; i < 4000; i++) city.ledger.push({ ...city.ledger[0], amount: 1, from: 'outside', to: 'upkeep', reason: `padding ${i}` });
  city.accounts.outside -= 4000; city.accounts.upkeep += 4000;
  const plain = serialize(city); assert.ok(plain.length > 64000);
  const mem = new Map<string, string>(), quota = plain.length * 1.3; // room for the new primary, not for a second raw copy
  const used = () => [...mem].reduce((n, [k, v]) => n + k.length + v.length, 0);
  const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { const prev = mem.get(k)?.length ?? 0; if (used() - prev + v.length > quota) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); mem.set(k, v); }, removeItem: (k: string) => void mem.delete(k), get length() { return mem.size; }, key: (n: number) => [...mem.keys()][n] ?? null, clear: () => mem.clear() };
  mem.set(SAVE_KEY, plain);
  const site = city.cells.findIndex((_, i) => taxiSiteReason(city, i, true) === null);
  assert.equal(buildTaxiDepot(city, site, true).ok, true);
  const next = serialize(city);
  mem.delete(SAVE_KEY); mem.set(SAVE_KEY, plain); // saveStoredCity replaces the primary itself
  saveStoredCity(st as any, next, null);
  const backup = mem.get(TAXI_BACKUP_KEY)!;
  assert.ok(backup.length < plain.length / 2, `backup ${backup.length} vs raw ${plain.length}`);
  assert.equal(readStoredCity({ getItem: (k: string) => k === SAVE_KEY ? null : mem.get(k) ?? null } as any, 'backup')?.raw, plain);
  assert.equal(deserialize(mem.get(SAVE_KEY)!).taxi?.depots.length, 1);
  // A second save does not add another backup copy.
  saveStoredCity(st as any, serialize(city), null); assert.equal(mem.get(`${TAXI_BACKUP_KEY}.1`), undefined);
});
