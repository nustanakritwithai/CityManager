import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, buildPark, bulldoze, GATEWAY, parkStaffingStatus, type City } from '../src/sim.ts';
import { createParkRuntime, advanceParkRuntime, reconcileParkRuntime, serializeParkSession, deserializeParkSession } from '../src/park-runtime.ts';
import { parkActivityCitizens, parkActivityUnavailableCitizenIds } from '../src/park-activity.ts';
import { createOwnerDecisionSession } from '../src/owner-decision-session.ts';
import { SAVE_KEY, PARK_WORKFORCE_BACKUP_KEY, saveStoredCity } from '../src/save-storage.ts';

function fixture(): City {
  const c = createCity(61025);
  for (let d = 0; d < 45; d++) step(c);
  for (let i = 0; i < c.cells.length; i++) if (c.cells[i].road && i !== GATEWAY) assert.ok(bulldoze(c, i).ok);
  const home = c.buildings.find(b => b.zone === 'R')!;
  const distance = (i: number) => Math.abs(i % 24 - home.cell % 24) + Math.abs(Math.floor(i / 24) - Math.floor(home.cell / 24));
  const sites = c.cells.map((_, i) => i).sort((a, b) => distance(a) - distance(b) || a - b);
  assert.ok(sites.some(i => buildPark(c, i).ok)); step(c);
  assert.equal(parkStaffingStatus(c, c.parks[0]).employed, 1);
  return deserialize(serialize(c));
}
const initial = serialize(fixture());
const fresh = () => deserialize(initial);

test('actual arrivals and eligible intervals alone earn recreation; municipal workers never overlap on-duty visits', () => {
  const c = fresh(), r = createParkRuntime(c), before = serialize(c);
  let arrivals = 0, credited = 0;
  for (let minute = 0; minute < 1320; minute++) {
    const current = structuredClone(r.activity), previous = r.recreation;
    const unavailable = parkActivityUnavailableCitizenIds(c, current.minute);
    advanceParkRuntime(c, r, 1, () => step(c));
    for (const v of r.activity.visitors) if (v.phase === 'enter' && v.phaseMinute === 0) arrivals++;
    for (const [id, result] of Object.entries(r.recreation.citizens)) if (result.earnedMinutes > (previous.citizens[id]?.earnedMinutes ?? 0)) {
      const actual = current.visitors.find(v => v.citizenId === id)!;
      assert.ok(actual && ['stroll', 'wait', 'meet', 'sit'].includes(actual.phase));
      assert.equal(unavailable.has(id), false); assert.equal(result.lastQualityPermille, 1000); credited++;
    }
  }
  assert.ok(arrivals > 0 && credited > 0 && r.activity.completed > 0);
  assert.equal(serialize(c), before, 'activity/scoring never write money, labor or needs');
  assert.equal(new Set(parkActivityCitizens(c).map(p => p.citizenId)).size, c.households.reduce((n, h) => n + h.members, 0));
});

test('fractional pause, batches and atomic reload preserve the complete session across daily payroll', () => {
  const run = (batch: number, reload: boolean) => {
    let c = fresh(), r = createParkRuntime(c), elapsed = 0;
    while (elapsed < 2880) {
      const count = Math.min(batch, 2880 - elapsed);
      advanceParkRuntime(c, r, count, () => step(c)); elapsed += count;
      if (reload && elapsed < 2880) ({ city: c, runtime: r } = deserializeParkSession(serializeParkSession(c, r)));
    }
    advanceParkRuntime(c, r, .25, () => step(c));
    const before = serializeParkSession(c, r);
    advanceParkRuntime(c, r, 0, () => assert.fail('pause cannot step economy'));
    assert.equal(serializeParkSession(c, r), before);
    return before;
  };
  assert.equal(run(1, false), run(37, true));
  const { city, runtime } = deserializeParkSession(run(60, false));
  const reference = fresh(); step(reference); step(reference);
  assert.equal(serialize(city), serialize(reference));
  assert.equal(runtime.activity.minute, 0); assert.equal(runtime.minuteRemainder, .25);
});

test('no-park runtime preserves two 360-day economic baselines and the owner-session daily path', () => {
  for (const seed of [61025, 20261023]) {
    const c = createCity(seed), ref = deserialize(serialize(c)), r = createParkRuntime(c);
    for (let d = 0; d < 360; d++) { advanceParkRuntime(c, r, 1440, () => step(c)); step(ref); }
    assert.equal(serialize(c), serialize(ref)); assert.deepEqual(Object.keys(r.recreation.citizens), []);
    assert.equal(r.recreation.minute, 360 * 1440);
  }
  const c = fresh(), ref = fresh(), r = createParkRuntime(c), owner = createOwnerDecisionSession(c);
  advanceParkRuntime(c, r, 1440, () => { owner.advance(c); }); step(ref);
  assert.equal(serialize(c), serialize(ref)); assert.equal(owner.getStats().issue, null);
});

test('unfunded or unstaffed parks can be visited but give no staffed-service benefit', () => {
  const c = fresh(); c.parks[0].staffing = { allocations: [], workDays: {} };
  const r = createParkRuntime(c);
  advanceParkRuntime(c, r, 1320, () => step(c));
  assert.ok(r.activity.completed > 0); assert.deepEqual(Object.keys(r.recreation.citizens), []);
});

test('frame budget slows playback at real minute boundaries without skipped activity or catch-up debt', () => {
  const c = fresh(), r = createParkRuntime(c), ref = fresh(), expected = createParkRuntime(ref);
  let checks = 0;
  advanceParkRuntime(c, r, 1300.75, () => step(c), undefined, () => ++checks < 620);
  assert.equal(r.activity.minute, 620); assert.equal(r.minuteRemainder, 0);
  advanceParkRuntime(ref, expected, 620, () => step(ref));
  assert.equal(serializeParkSession(c, r), serializeParkSession(ref, expected));
  const saved = serializeParkSession(c, r);
  advanceParkRuntime(c, r, 0, () => assert.fail('pause'));
  assert.equal(serializeParkSession(c, r), saved);
  advanceParkRuntime(c, r, 820, () => step(c));
  advanceParkRuntime(ref, expected, 820, () => step(ref));
  assert.equal(serializeParkSession(c, r), serializeParkSession(ref, expected));
});

test('synchronous owner automation observes a complete boundary and can pause the remaining frame', () => {
  const c = fresh(), r = createParkRuntime(c), start = c.tick;
  const days = advanceParkRuntime(c, r, 2880.5, () => step(c), () => {
    reconcileParkRuntime(c, r);
    assert.equal(r.activity.day, c.tick); assert.equal(r.activity.minute, 0);
    assert.doesNotThrow(() => serializeParkSession(c, r));
    return false;
  });
  assert.equal(days, 1); assert.equal(c.tick, start + 1);
  assert.equal(r.minuteRemainder, 0); assert.equal(r.recreation.minute, c.tick * 1440);
});

test('paused demolition cancels visitors immediately without crediting the reservation ledger', () => {
  const c = fresh(), r = createParkRuntime(c);
  advanceParkRuntime(c, r, 600, () => step(c)); assert.ok(r.activity.visitors.length > 0);
  const minute = r.recreation.minute, earned = JSON.stringify(r.recreation);
  assert.ok(bulldoze(c, c.parks[0].cell).ok); reconcileParkRuntime(c, r);
  assert.equal(r.activity.visitors.length, 0); assert.ok(r.activity.cancelled > 0);
  assert.equal(r.recreation.minute, minute); assert.equal(JSON.stringify(r.recreation), earned);
});

test('save rejects mismatched clocks or malformed sidecars before replacing live state; legacy starts with zero benefit', () => {
  const c = fresh(), r = createParkRuntime(c); advanceParkRuntime(c, r, 650.5, () => step(c));
  const saved = serializeParkSession(c, r), parsed = JSON.parse(saved);
  assert.equal(serializeParkSession(...Object.values(deserializeParkSession(saved)) as [City, typeof r]), saved);
  assert.equal(Object.hasOwn(deserializeParkSession(saved).city, 'parkRuntime'), false);
  for (const edit of [
    (v: any) => v.parkRuntime.recreation.minute++, (v: any) => v.parkRuntime.activity.day++,
    (v: any) => { delete v.parkRuntime.recreation; }, (v: any) => v.parkRuntime.minuteRemainder = 1,
    (v: any) => v.parkRuntime.activity.visitors[0].parkJobId = undefined,
  ]) { const bad = structuredClone(parsed); edit(bad); assert.throws(() => deserializeParkSession(JSON.stringify(bad))); }
  assert.equal(serializeParkSession(c, r), saved);
  const old = JSON.parse(serialize(c)); old.version = 14; old.rulesVersion = 'chain-9'; delete old.factoryProgressionStartTick;
  for (const p of old.parks) delete p.staffing;
  const raw = JSON.stringify(old), restored = deserializeParkSession(raw);
  assert.equal(restored.runtime.recreation.minute, c.tick * 1440);
  assert.deepEqual(Object.keys(restored.runtime.recreation.citizens), []);
  const data = new Map([[SAVE_KEY, raw]]);
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  saveStoredCity(storage, serializeParkSession(restored.city, restored.runtime), null);
  assert.equal(data.get(PARK_WORKFORCE_BACKUP_KEY), raw);
});
