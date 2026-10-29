import test from 'node:test';
import assert from 'node:assert/strict';
import { HOUSING_LEVELS, getHousingCapacity } from '../src/housing.ts';
import { buildPark, createCity, deserialize, serialize, step, housingUpgradeStatus, homeOccupancy, householdWorkerCount } from '../src/sim.ts';
import { advanceParkRuntime, createParkRuntime, serializeParkSession, deserializeParkSession } from '../src/park-runtime.ts';
import { SAVE_KEY, FARM_LEVEL_BACKUP_KEY, readStoredCity, saveStoredCity } from '../src/save-storage.ts';

function fixture() {
  const city = createCity(61025); for (let n = 0; n < 119; n++) step(city);
  const home = city.buildings.find(b => b.zone === 'R' && homeOccupancy(city, b.id).households === 1 && city.households.some(h => h.home === b.id && householdWorkerCount(city, h.id) > 0 && city.tick - h.lastPurchaseTick <= 3))!;
  assert.ok(home); return { city, home };
}

test('all residential levels have explicit monotonic dual capacities and strict type pairings', () => {
  assert.deepEqual(HOUSING_LEVELS.map(x => [x.type, x.tierLevel, x.households, x.persons]), [
    ['cottage', 1, 1, 4], ['cottage', 2, 2, 8], ['cottage', 3, 3, 12],
    ['apartment', 1, 5, 20], ['apartment', 2, 8, 32], ['apartment', 3, 12, 48],
    ['condo', 1, 16, 64], ['condo', 2, 24, 96], ['condo', 3, 32, 128],
  ]);
  for (const [i, x] of HOUSING_LEVELS.entries()) assert.deepEqual(getHousingCapacity(x.type, i + 1), { households: x.households, persons: x.persons });
  assert.throws(() => getHousingCapacity('cottage', 4)); assert.throws(() => getHousingCapacity('apartment', 7));
});

/** Move other existing households into the home until its current household slots are full. */
function fill(city: ReturnType<typeof createCity>, home: { id: number; level: number }): boolean {
  const need = HOUSING_LEVELS[home.level - 1].households - homeOccupancy(city, home.id).households;
  const movers = city.households.filter(h => h.home !== null && h.home !== home.id).slice(0, Math.max(0, need));
  if (movers.length < need) return false;
  for (const h of movers) h.home = home.id;
  return true;
}

test('each autonomous upgrade keeps the same parcel, identity, households and actual funding', () => {
  let upgraded = 0;
  for (let level = 1; level < 9; level++) {
    const { city, home } = fixture(); home.level = level; home.housingType = HOUSING_LEVELS[level - 1].type;
    const full = fill(city, home);
    const id = home.id, cell = home.cell, residents = city.households.filter(h => h.home === id).map(h => [h.id, h.members, h.wallet]);
    const before = city.ledger.filter(e => e.reason === 'Outside residential height investment').length;
    if (!full) {
      // Not enough households in the city to fill this tier: the occupancy gate must hold it and say why.
      assert.ok(level >= 3, `levels 1-2 are never occupancy gated (${level})`);
      assert.ok(housingUpgradeStatus(city, home).blocked.some(r => r.includes('เต็มทุกช่อง')));
      step(city); assert.equal(home.level, level, `gated ${level}`); continue;
    }
    step(city);
    assert.equal(home.level, level + 1, `upgrade ${level}`); assert.equal(home.housingType, HOUSING_LEVELS[level].type); upgraded++;
    assert.equal(home.id, id); assert.equal(home.cell, cell); assert.equal(city.cells[cell].building, id);
    assert.deepEqual(city.households.filter(h => h.home === id).map(h => [h.id, h.members, h.wallet]), residents);
    assert.equal(city.ledger.filter(e => e.reason === 'Outside residential height investment' && e.tick === city.tick).length > 0, true);
    assert.ok(city.ledger.filter(e => e.reason === 'Outside residential height investment').length > before);
    assert.equal(Object.values(city.accounts).reduce((a, b) => a + b, 0), 0);
    assert.deepEqual(deserialize(serialize(city)), city);
  }
  assert.ok(upgraded >= 3, `cottage 1-2 and at least one filled gated tier upgrade (${upgraded})`);
});

test('apartment and condo tiers upgrade only when every household slot is taken', () => {
  const { city, home } = fixture(); home.level = 3; home.housingType = 'cottage';
  assert.ok(homeOccupancy(city, home.id).households < 3);
  assert.ok(housingUpgradeStatus(city, home).blocked.some(r => r.includes('เต็มทุกช่อง')));
  const vacant = structuredClone(city); step(vacant); assert.equal(vacant.buildings.find(b => b.id === home.id)!.level, 3);
  assert.equal(fill(city, home), true); assert.equal(homeOccupancy(city, home.id).households, 3);
  assert.ok(!housingUpgradeStatus(city, home).blocked.some(r => r.includes('เต็มทุกช่อง')));
  step(city); assert.equal(home.level, 4); assert.equal(home.housingType, 'apartment');
});

test('upgrade explains and respects road, utility and resident financial conditions', () => {
  const { city, home } = fixture(); home.level = 3; home.housingType = 'cottage';
  assert.equal(housingUpgradeStatus(city, home).next?.type, 'apartment');
  city.households.filter(h => h.home === home.id).forEach(h => { city.accounts[h.wallet] = 0; });
  // Prevent the imminent month-end from paying a wage and making the household eligible;
  // the panel previews that month-end, so it must see the same unpaid state.
  city.firms.forEach(f => { city.accounts[f.wallet] = 0; f.workDays = {}; });
  assert.ok(housingUpgradeStatus(city, home).blocked.some(x => x.includes('200')));
  step(city); assert.equal(home.level, 3);
  const other = fixture(); other.home.level = 3; other.city.utilities.outside = { power: 0, water: 0 };
  assert.ok(housingUpgradeStatus(other.city, other.home).blocked.some(x => x.includes('น้ำและไฟ')));
  step(other.city); assert.equal(other.home.level, 3);
});

test('v15 park session migrates without changing state, rejects new housing under old version and keeps backup', () => {
  const { city, home } = fixture(); assert.equal(buildPark(city, 0).ok, true);
  const runtime = createParkRuntime(city); advanceParkRuntime(city, runtime, 650.5, () => step(city));
  const session = JSON.parse(serializeParkSession(city, runtime));
  session.version = 15; session.rulesVersion = 'chain-10'; delete session.factoryProgressionStartTick; delete session.farmLevelStartTick; const old = JSON.stringify(session);
  const restored = deserializeParkSession(old);
  assert.deepEqual(restored.city, { ...city, factoryProgressionStartTick: city.tick, farmLevelStartTick: city.tick }); assert.deepEqual(restored.runtime, runtime);
  const saved = serializeParkSession(restored.city, restored.runtime);
  assert.deepEqual(deserializeParkSession(saved), restored);
  const bad = structuredClone(session); const b = bad.buildings.find((x: { id: number }) => x.id === home.id); b.level = 4; b.housingType = 'apartment';
  assert.throws(() => deserializeParkSession(JSON.stringify(bad)));
  const data = new Map([[SAVE_KEY, old]]), storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
  saveStoredCity(storage, saved, null); assert.equal(data.get(FARM_LEVEL_BACKUP_KEY), old); assert.equal(readStoredCity(storage, 'backup')?.raw, old);
});

test('future and mismatched housing schemas are rejected without changing the saved snapshot', () => {
  const { city, home } = fixture(), original = serialize(city), parsed = JSON.parse(original);
  for (const edit of [
    (v: any) => { v.version = 20; },
    (v: any) => { v.rulesVersion = 'chain-10'; },
    (v: any) => { const b = v.buildings.find((item: any) => item.id === home.id); b.level = 4; b.housingType = 'cottage'; },
    (v: any) => { const b = v.buildings.find((item: any) => item.id === home.id); b.level = 10; b.housingType = 'condo'; },
  ]) { const bad = structuredClone(parsed); edit(bad); assert.throws(() => deserialize(JSON.stringify(bad))); }
  assert.equal(serialize(city), original);
});

test('full or failed v15 backup prevents replacement of the original save', () => {
  const { city } = fixture(), current = JSON.parse(serialize(city)); current.version = 15; current.rulesVersion = 'chain-10'; delete current.factoryProgressionStartTick; delete current.farmLevelStartTick;
  const old = JSON.stringify(current), next = serialize(deserialize(old));
  const data = new Map<string, string>([[SAVE_KEY, old]]);
  for (let i = 0; i < 8; i++) data.set(i ? `${FARM_LEVEL_BACKUP_KEY}.${i}` : FARM_LEVEL_BACKUP_KEY, `prior-${i}`);
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
  assert.throws(() => saveStoredCity(storage, next, null), /Farm level backup slots are full/);
  assert.equal(data.get(SAVE_KEY), old);
  const blocked = new Map<string, string>([[SAVE_KEY, old]]);
  const failing = { getItem: (k: string) => blocked.get(k) ?? null, setItem: (k: string, v: string) => { if (k === FARM_LEVEL_BACKUP_KEY) throw new Error('quota'); blocked.set(k, v); } };
  assert.throws(() => saveStoredCity(failing, next, null), /quota/);
  assert.equal(blocked.get(SAVE_KEY), old);
});
