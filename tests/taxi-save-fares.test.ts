import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, deserialize, serialize, step } from '../src/sim.ts';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { treasuryBudget } from '../src/overview-data.ts';
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

test('visual taxi trips never enter city accounting across speeds, pause and reload', { timeout: 60_000 }, () => {
  // Production must not connect cosmetic traffic counters to the money ledger.
  const scan = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? scan(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []);
  for (const file of scan(new URL('../src', import.meta.url).pathname))
    assert.doesNotMatch(readFileSync(file, 'utf8'), /createTaxiFareAccumulator|collectTaxiFares|taxiFares\.observe/, file);
  const roads = new Set([25, 26, 27, 28]);
  const sample: TrafficGameSample = { map: { cells: Array.from({ length: 576 }, (_, i) => ({ road: roads.has(i) })) }, demand: [{ from: 25, to: 28, rate: 1, taxiRate: 1 } as TrafficGameSample['demand'][number]] };
  function run(visualStepsPerDay: number) {
    let city = createCity(61025);
    const session = createTaxiSession(); session.bind(city);
    const site = city.cells.findIndex((_, i) => taxiSiteReason(city, i, true) === null);
    assert.equal(session.place(city, site, true, true).ok, true);
    const game = new TrafficGame(sample);
    for (let day = 0; day < 60; day++) {
      // Rendering may repeat while paused, but city time and money must not move.
      const beforePause = serialize(city); for (let i = 0; i < 5; i++) game.step();
      assert.equal(serialize(city), beforePause);
      for (let i = 0; i < visualStepsPerDay; i++) game.step();
      step(city);
      if (day === 29) city = deserialize(serialize(city));
    }
    assert.ok(game.frame.taxiTrips && game.frame.taxiTrips.trips > 0, 'visual taxi vehicles still complete');
    assert.equal(city.ledger.some(e => e.reason === 'Taxi fares'), false);
    assert.equal(city.taxi?.depots.length, 1, 'depot remains saved and functional');
    return { treasury: city.accounts.treasury, ledger: city.ledger, trips: game.frame.taxiTrips.trips };
  }
  const slowVisual = run(2), fastVisual = run(100);
  assert.ok(fastVisual.trips > slowVisual.trips, 'test actually varies cosmetic traffic rate');
  assert.equal(slowVisual.treasury, fastVisual.treasury);
  assert.deepEqual(slowVisual.ledger, fastVisual.ledger);
});

test('an open depot with no city demand earns no fares', () => {
  const city = createCity(1, { starter: false });
  const session = createTaxiSession(); session.bind(city);
  const site = city.cells.findIndex((_, i) => taxiSiteReason(city, i, true) === null);
  assert.equal(session.place(city, site, true, true).ok, true);
  const input = captureTrafficGameInput(city, { taxiEnabled: true });
  assert.equal(input.homes.length, 0); assert.equal(input.destinations.length, 0);
  assert.equal(input.taxis.length, 1);
  for (let i = 0; i < 60; i++) step(city);
  assert.equal(city.ledger.some(e => e.reason === 'Taxi fares'), false);
  assert.equal(city.taxi?.depots[0].open, true);
});

test('historical fare entries and treasury survive loading without new taxi revenue', () => {
  const c = createCity(61025), amount = 12_345;
  // A legitimate journal entry from an earlier version, not a new payment.
  c.accounts.outside -= amount; c.accounts.treasury += amount;
  c.ledger.push({ tick: c.tick, from: 'outside', to: 'treasury', amount, reason: 'Taxi fares' });
  const before = c.accounts.treasury, old = serialize(c), loaded = deserialize(old);
  assert.equal(loaded.accounts.treasury, before);
  assert.deepEqual(loaded.ledger, c.ledger);
  assert.equal(treasuryBudget(loaded).income.find(e => e.key === 'legacy-taxi-fares')?.amount, amount);
  const reference = createCity(61025);
  for (let i = 0; i < 20; i++) { step(loaded); step(reference); }
  assert.equal(loaded.ledger.filter(e => e.reason === 'Taxi fares').length, 1, 'no new fare before normal journal compaction');
  for (let i = 20; i < 60; i++) { step(loaded); step(reference); }
  assert.equal(loaded.accounts.treasury - reference.accounts.treasury, amount, 'historical balance survives compaction');
  assert.equal(loaded.ledger.some(e => e.reason === 'Taxi fares'), false, 'only normal historical compaction removes old raw rows');
  assert.deepEqual(deserialize(serialize(loaded)), loaded);
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
