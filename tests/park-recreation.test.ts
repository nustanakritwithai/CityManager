import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceParkRecreation, createParkRecreation, restoreParkRecreation, serializeParkRecreation,
  DEFAULT_PARK_RECREATION_TUNING, PARK_RECREATION_MAX_RESIDENTS, PARK_RECREATION_MAX_SCORE_UNITS,
} from '../src/park-recreation.ts';
import type { ParkRecreationFrame, ParkRecreationState } from '../src/park-recreation.ts';

const resident = 'h:1:m:0';
const second = 'h:1:m:1';
const park = { parkId: 1, qualityPermille: 1000, comfortableCapacity: 3 };
const visit = { citizenId: resident, parkId: park.parkId, eligible: true };
function frame(minute: number, visits: ParkRecreationFrame['visits'] = [visit], overrides: Partial<ParkRecreationFrame> = {}): ParkRecreationFrame {
  return { minute, residentIds: [resident], parks: [park], visits, ...overrides };
}
function advanceUntil(state: ParkRecreationState, minute: number, visits: ParkRecreationFrame['visits'] = [visit]): ParkRecreationState {
  while (state.minute < minute) state = advanceParkRecreation(state, frame(state.minute + 1, visits));
  return state;
}

test('no actual visits means no earned state or effects, including old-save startup', () => {
  const tuning = { ...DEFAULT_PARK_RECREATION_TUNING };
  const initial = createParkRecreation(10_000, tuning);
  const state = advanceUntil(initial, 11_440, []);
  assert.equal(Object.keys(state.citizens).length, 0);
  assert.equal(state.minute, 11_440);
  assert.deepEqual(tuning, DEFAULT_PARK_RECREATION_TUNING);
  assert.equal(initial.minute, 10_000);
  assert.equal(Object.keys(initial.citizens).length, 0);
});

test('one observed eligible minute earns exactly .25 points without mutating inputs', () => {
  const initial = createParkRecreation();
  const observed = frame(1);
  const snapshot = JSON.stringify(observed);
  const state = advanceParkRecreation(initial, observed);
  assert.deepEqual({ ...state.citizens[resident] }, {
    scoreUnits: 250, decayRemainder: 0, dailyGainedUnits: 250, day: 0,
    earnedMinutes: 1, lastBenefitMinute: 1, lastCreditedParkId: park.parkId,
    lastGainUnits: 250, lastCrowdingPermille: 1000, lastQualityPermille: 1000,
  });
  assert.equal(JSON.stringify(observed), snapshot);
  assert.equal(Object.keys(initial.citizens).length, 0);
  assert.ok(Object.isFrozen(state) && Object.isFrozen(state.citizens) && Object.isFrozen(state.citizens[resident]));
});

test('repeated delivery is idempotent and pausing cannot produce benefit or decay', () => {
  const state = advanceParkRecreation(createParkRecreation(), frame(1));
  const before = serializeParkRecreation(state);
  for (let i = 0; i < 100; i++) assert.equal(advanceParkRecreation(state, frame(1)), state);
  assert.equal(serializeParkRecreation(state), before);
  const pausedReference = state; // Paused clocks dispatch no observation frames.
  assert.equal(serializeParkRecreation(pausedReference), before);
});

test('repeated visits earn at most 15 points per interval day and midnight uses the preceding minute', () => {
  const capped = advanceUntil(createParkRecreation(), 1440);
  assert.equal(capped.citizens[resident].dailyGainedUnits, 15000);
  assert.equal(capped.citizens[resident].earnedMinutes, 60);
  assert.equal(capped.citizens[resident].day, 0);
  assert.equal(capped.citizens[resident].lastBenefitMinute, 60);
  const nextDay = advanceParkRecreation(capped, frame(1441));
  assert.equal(nextDay.citizens[resident].day, 1);
  assert.equal(nextDay.citizens[resident].dailyGainedUnits, 250);
  assert.equal(nextDay.citizens[resident].earnedMinutes, 61);
  const beforeMidnight = createParkRecreation(1438, { gainUnitsPerMinute: 250, dailyCapUnits: 300, decayUnitsPerDay: 0 });
  const midnight = advanceUntil(beforeMidnight, 1440);
  assert.equal(midnight.citizens[resident].dailyGainedUnits, 300);
  assert.equal(midnight.citizens[resident].lastGainUnits, 50);
  assert.equal(advanceParkRecreation(midnight, frame(1441)).citizens[resident].dailyGainedUnits, 250);
});

test('idle decay carries fractional integer units and totals exactly 5 points over 1440 minutes', () => {
  let state = createParkRecreation(0, { gainUnitsPerMinute: 100000, dailyCapUnits: 100000, decayUnitsPerDay: 5000 });
  state = advanceParkRecreation(state, frame(1));
  const firstIdle = advanceParkRecreation(state, frame(2, []));
  assert.equal(firstIdle.citizens[resident].scoreUnits, 99997);
  assert.equal(firstIdle.citizens[resident].decayRemainder, 680);
  const allIdle = advanceUntil(firstIdle, 1441, []);
  assert.equal(allIdle.citizens[resident].scoreUnits, 95000);
  assert.equal(allIdle.citizens[resident].decayRemainder, 0);
  assert.equal(allIdle.citizens[resident].dailyGainedUnits, 0);
  assert.equal(allIdle.citizens[resident].earnedMinutes, 1);
  assert.equal(allIdle.citizens[resident].lastBenefitMinute, 1);
});

test('decay floors at zero, never creates debt, and never-visited time does not penalize first benefit', () => {
  const start = advanceUntil(createParkRecreation(), 1440, []);
  const first = advanceParkRecreation(start, frame(1441));
  assert.equal(first.citizens[resident].scoreUnits, 250);
  const expired = advanceUntil(first, 1585, []);
  assert.equal(expired.citizens[resident].scoreUnits, 0);
  assert.equal(expired.citizens[resident].decayRemainder, 0);
  const returning = advanceParkRecreation(expired, frame(1586));
  assert.equal(returning.citizens[resident].scoreUnits, 250);
});

test('crowding uses unique physical people including ineligible people, independent of duplicate observations', () => {
  const physical = [visit, { citizenId: second, parkId: park.parkId, eligible: false }];
  const observations = frame(1, [...physical, ...physical], {
    residentIds: [resident, second], parks: [{ ...park, comfortableCapacity: 1 }],
  });
  const state = advanceParkRecreation(createParkRecreation(), observations);
  assert.equal(state.citizens[resident].scoreUnits, 125);
  assert.equal(state.citizens[resident].lastCrowdingPermille, 500);
  assert.equal(state.citizens[second], undefined);
  assert.deepEqual(state, advanceParkRecreation(createParkRecreation(), { ...observations, visits: physical }));
});

test('quality and capacity bound benefit, and ineligible presence alone cannot earn', () => {
  const halfQuality = advanceParkRecreation(createParkRecreation(), frame(1, [visit], { parks: [{ ...park, qualityPermille: 500 }] }));
  assert.equal(halfQuality.citizens[resident].scoreUnits, 125);
  assert.equal(halfQuality.citizens[resident].lastQualityPermille, 500);
  for (const disabled of [{ ...park, qualityPermille: 0 }, { ...park, comfortableCapacity: 0 }]) {
    assert.equal(Object.keys(advanceParkRecreation(createParkRecreation(), frame(1, [visit], { parks: [disabled] })).citizens).length, 0);
  }
  assert.equal(Object.keys(advanceParkRecreation(createParkRecreation(), frame(1, [{ ...visit, eligible: false }])).citizens).length, 0);
});

test('ambiguous park overlap or conflicting eligibility rejects the whole transition atomically', () => {
  const state = advanceParkRecreation(createParkRecreation(), frame(1));
  const saved = serializeParkRecreation(state);
  const otherPark = { ...park, parkId: 2 };
  assert.throws(() => advanceParkRecreation(state, frame(2, [visit, { ...visit, parkId: otherPark.parkId }], { parks: [park, otherPark] })), /conflicting visits/);
  assert.throws(() => advanceParkRecreation(state, frame(2, [visit, { ...visit, eligible: false }])), /conflicting visits/);
  assert.equal(serializeParkRecreation(state), saved);
  assert.equal(advanceParkRecreation(state, frame(2)).citizens[resident].earnedMinutes, 2);
});

test('removed resident records are pruned and returning identities start with implicit zero', () => {
  const state = advanceParkRecreation(createParkRecreation(), frame(1));
  const removed = advanceParkRecreation(state, frame(2, [], { residentIds: [] }));
  assert.equal(Object.keys(removed.citizens).length, 0);
  const returned = advanceParkRecreation(removed, frame(3));
  assert.equal(returned.citizens[resident].scoreUnits, 250);
  assert.equal(returned.citizens[resident].earnedMinutes, 1);
});

test('save/reload preserves exact decay carry, cap, diagnostics and subsequent behavior', () => {
  const original = advanceUntil(createParkRecreation(), 38);
  assert.notEqual(original.citizens[resident].decayRemainder, 0);
  const restored = restoreParkRecreation(serializeParkRecreation(original), original.minute);
  assert.deepEqual(restored, original);
  assert.notEqual(restored, original);
  assert.deepEqual(advanceUntil(restored, 1500), advanceUntil(original, 1500));
  const parsed = JSON.parse(serializeParkRecreation(original));
  const detached = restoreParkRecreation(parsed);
  parsed.citizens[resident].scoreUnits = 0;
  assert.deepEqual(detached, original);
});

test('different playback batch sizes consume the same real frames with identical results', () => {
  const frames = Array.from({ length: 1440 }, (_, i) => frame(i + 1, i % 7 < 3 ? [visit] : []));
  const slow = frames.reduce(advanceParkRecreation, createParkRecreation());
  for (const batchSize of [2, 17, 120, 1440]) {
    let fast = createParkRecreation();
    for (let offset = 0; offset < frames.length; offset += batchSize) {
      for (const observation of frames.slice(offset, offset + batchSize)) fast = advanceParkRecreation(fast, observation);
    }
    assert.deepEqual(fast, slow);
  }
});

test('one continuous idle day and interrupted idle stepping including reload are identical', () => {
  const earned = advanceUntil(createParkRecreation(), 60);
  const continuous = advanceUntil(earned, 1500, []);
  const half = advanceUntil(earned, 780, []);
  const resumed = advanceUntil(restoreParkRecreation(serializeParkRecreation(half), 780), 1500, []);
  assert.deepEqual(resumed, continuous);
  assert.equal(continuous.citizens[resident].scoreUnits, earned.citizens[resident].scoreUnits - 5000);
  assert.equal(continuous.citizens[resident].decayRemainder, earned.citizens[resident].decayRemainder);
});

test('score is bounded at 100 points and cap consumes only actual score gain', () => {
  const tuning = { gainUnitsPerMinute: 100000, dailyCapUnits: 100000, decayUnitsPerDay: 0 };
  const full = advanceUntil(createParkRecreation(0, tuning), 1450);
  assert.equal(full.citizens[resident].scoreUnits, PARK_RECREATION_MAX_SCORE_UNITS);
  assert.equal(full.citizens[resident].dailyGainedUnits, 0);
  assert.equal(full.citizens[resident].earnedMinutes, 1);
  assert.equal(full.citizens[resident].lastGainUnits, 100000);
});

test('missing, backward, fractional and unsafe clock frames fail closed without replaying benefit', () => {
  const state = advanceParkRecreation(createParkRecreation(), frame(1));
  const before = serializeParkRecreation(state);
  for (const minute of [0, -1, 3, 1441, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => advanceParkRecreation(state, frame(minute)), RangeError);
    assert.equal(serializeParkRecreation(state), before);
  }
  const nearLimit = createParkRecreation(Number.MAX_SAFE_INTEGER - 1);
  assert.equal(advanceParkRecreation(nearLimit, frame(Number.MAX_SAFE_INTEGER)).minute, Number.MAX_SAFE_INTEGER);
});

test('invalid observations and unknown identities reject atomically', () => {
  const state = advanceParkRecreation(createParkRecreation(), frame(1));
  const before = serializeParkRecreation(state);
  const invalid: ParkRecreationFrame[] = [
    frame(2, [visit], { residentIds: [resident, resident] }),
    frame(2, [{ ...visit, citizenId: 'ghost' }]),
    frame(2, [{ ...visit, parkId: 999 }]),
    frame(2, [visit], { parks: [{ ...park, parkId: 0 }] }),
    frame(2, [{ ...visit, eligible: 1 as unknown as boolean }]),
    frame(2, [visit], { parks: [park, park] }),
    frame(2, [visit], { parks: [{ ...park, qualityPermille: 1001 }] }),
    frame(2, [visit], { parks: [{ ...park, comfortableCapacity: 0.5 }] }),
    frame(2, [], { residentIds: Array.from({ length: PARK_RECREATION_MAX_RESIDENTS + 1 }, (_, i) => `h:${i}:m:0`) }),
  ];
  for (const observation of invalid) {
    assert.throws(() => advanceParkRecreation(state, observation), RangeError);
    assert.equal(serializeParkRecreation(state), before);
  }
});

test('strict tuning and sidecar validation rejects corrupt, unknown and stale state', () => {
  for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, 100001]) {
    for (const key of ['gainUnitsPerMinute', 'dailyCapUnits', 'decayUnitsPerDay']) {
      assert.throws(() => createParkRecreation(0, { ...DEFAULT_PARK_RECREATION_TUNING, [key]: value }), RangeError);
    }
  }
  assert.throws(() => createParkRecreation(-1), RangeError);
  const state = advanceParkRecreation(createParkRecreation(), frame(1));
  assert.throws(() => restoreParkRecreation(serializeParkRecreation(state), 2), /clock mismatch/);
  for (const invalid of [null, [], 'invalid json', {}, { ...state, version: 2 }, { ...state, extra: true }]) {
    assert.throws(() => restoreParkRecreation(invalid), RangeError);
  }
  for (const [key, value] of Object.entries({ scoreUnits: 100001, decayRemainder: 1440, dailyGainedUnits: 15001, day: 1, earnedMinutes: 2, lastBenefitMinute: 2, lastGainUnits: -1, lastCrowdingPermille: 1001, lastQualityPermille: 0 })) {
    const invalid = JSON.parse(serializeParkRecreation(state));
    invalid.citizens[resident][key] = value;
    assert.throws(() => restoreParkRecreation(invalid), RangeError, key);
  }
});

test('zero tuning values disable respective effects without fabricating records', () => {
  for (const key of ['gainUnitsPerMinute', 'dailyCapUnits']) {
    const state = advanceUntil(createParkRecreation(0, { ...DEFAULT_PARK_RECREATION_TUNING, [key]: 0 }), 1440);
    assert.equal(Object.keys(state.citizens).length, 0);
  }
  const earned = advanceParkRecreation(createParkRecreation(0, { ...DEFAULT_PARK_RECREATION_TUNING, decayUnitsPerDay: 0 }), frame(1));
  assert.equal(advanceUntil(earned, 1441, []).citizens[resident].scoreUnits, 250);
});

test('full roster remains bounded and input ordering does not affect canonical state', () => {
  const residentIds = Array.from({ length: PARK_RECREATION_MAX_RESIDENTS }, (_, i) => `h:${i}:m:0`);
  const visits = residentIds.map(citizenId => ({ ...visit, citizenId }));
  const observed = frame(1, visits, { residentIds, parks: [{ ...park, comfortableCapacity: PARK_RECREATION_MAX_RESIDENTS }] });
  const state = advanceParkRecreation(createParkRecreation(), observed);
  assert.equal(Object.keys(state.citizens).length, PARK_RECREATION_MAX_RESIDENTS);
  const reversed = advanceParkRecreation(createParkRecreation(), { ...observed, residentIds: [...residentIds].reverse(), visits: [...visits].reverse() });
  assert.equal(serializeParkRecreation(reversed), serializeParkRecreation(state));
  const reduced = advanceParkRecreation(state, frame(2, [], { residentIds: [residentIds[0]] }));
  assert.equal(Object.keys(reduced.citizens).length, 1);
});
