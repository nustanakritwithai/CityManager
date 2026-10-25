import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, deserialize, MONTH, serialize, step } from '../src/sim.ts';
import { createOwnerMonthlyBatch, type OwnerMonthlyBatchState } from '../src/owner-decision-monthly.ts';
import type { OwnerDecisionMode } from '../src/owner-decision-session.ts';

function monthEnd() {
  const city = createCity(61025);
  for (let day = 0; day < MONTH; day++) step(city);
  return city;
}

test('cancelling preserves completed markets and explicit same-month resume skips accepted commands', async () => {
  const city = monthEnd(); let mode: OwnerDecisionMode = 'typhoon-auto';
  const requests: number[] = [], executed: number[] = [];
  let notifySecond!: () => void, secondStarted = new Promise<void>(resolve => { notifySecond = resolve; });
  let secondAttempts = 0;
  const states: OwnerMonthlyBatchState[] = [];
  const batch = createOwnerMonthlyBatch({
    getContext: () => ({ city, mode }), getFirmIds: () => [3, 1, 2],
    onChange: state => states.push(state),
    processFirm: async (_current, firmId, controller) => {
      requests.push(firmId);
      if (firmId === 2 && secondAttempts++ === 0) {
        notifySecond();
        return new Promise(resolve => controller.signal.addEventListener('abort', () => resolve('cancelled'), { once: true }));
      }
      executed.push(firmId);
      return 'completed';
    },
  });

  const firstRun = batch.start();
  await secondStarted;
  mode = 'proposal'; batch.cancel();
  const paused = await firstRun;
  assert.equal(paused.status, 'paused'); assert.equal(paused.tick, MONTH);
  assert.deepEqual(paused.completedFirmIds, [1]); assert.equal(paused.nextFirmId, 2);
  assert.deepEqual(executed, [1]);

  assert.equal((await batch.start()).status, 'paused');
  assert.deepEqual(requests, [1, 2], 'proposal mode cannot resume the batch');
  mode = 'typhoon-auto';
  const resumed = await batch.start();
  assert.equal(resumed.status, 'complete');
  assert.deepEqual(requests, [1, 2, 2, 3]);
  assert.deepEqual(executed, [1, 2, 3], 'already accepted commands execute only once');
  assert.deepEqual(resumed.completedFirmIds, [1, 2, 3]);
  assert(states.some(state => state.status === 'paused' && state.nextFirmId === 2));
});

test('a response arriving after the city or tick changes invalidates the batch before the next market', async () => {
  const original = monthEnd(); let city = original; let mode: OwnerDecisionMode = 'typhoon-auto';
  const calls: number[] = [];
  const batch = createOwnerMonthlyBatch({
    getContext: () => ({ city, mode }), getFirmIds: () => [1, 2],
    processFirm: async () => { calls.push(1); city = createCity(61026); return 'completed'; },
  });

  const state = await batch.start();
  assert.equal(state.status, 'stale'); assert.deepEqual(state.completedFirmIds, []);
  assert.deepEqual(calls, [1]);
});

test('mode changes pause the batch until Typhoon auto is explicitly selected again', async () => {
  const city = monthEnd(); let mode: OwnerDecisionMode = 'proposal'; let calls = 0;
  const batch = createOwnerMonthlyBatch({
    getContext: () => ({ city, mode }), getFirmIds: () => [1],
    processFirm: async () => { calls++; return 'completed'; },
  });
  assert.equal((await batch.start()).status, 'idle'); assert.equal(calls, 0);
  mode = 'typhoon-auto';
  assert.equal((await batch.start()).status, 'complete'); assert.equal(calls, 1);
  assert.equal((await batch.start()).status, 'complete'); assert.equal(calls, 1);
});

test('off mode pauses in-flight work and cannot resume until Typhoon auto is explicitly selected', async () => {
  const city = monthEnd(); let mode: OwnerDecisionMode = 'typhoon-auto';
  const requests: number[] = [];
  let secondStarted!: () => void; const waiting = new Promise<void>(resolve => { secondStarted = resolve; });
  let secondAttempt = 0;
  const batch = createOwnerMonthlyBatch({
    getContext: () => ({ city, mode }), getFirmIds: () => [1, 2],
    processFirm: async (_city, firmId, controller) => {
      requests.push(firmId);
      if (firmId === 2 && secondAttempt++ === 0) {
        secondStarted();
        return new Promise(resolve => controller.signal.addEventListener('abort', () => resolve('cancelled'), { once: true }));
      }
      return 'completed';
    },
  });

  const firstRun = batch.start(); await waiting;
  mode = 'off'; batch.cancel();
  assert.equal((await firstRun).status, 'paused');
  assert.equal((await batch.start()).status, 'paused');
  assert.deepEqual(requests, [1, 2], 'off mode must not issue more work');
  mode = 'typhoon-auto';
  assert.equal((await batch.start()).status, 'complete');
  assert.deepEqual(requests, [1, 2, 2]);
});

test('the next month creates a fresh batch rather than reusing the prior month cursor', async () => {
  const city = monthEnd(); const requests: Array<{ tick: number; firmId: number }> = [];
  const batch = createOwnerMonthlyBatch({
    getContext: () => ({ city, mode: 'typhoon-auto' }), getFirmIds: () => [1],
    processFirm: async (current, firmId) => { requests.push({ tick: current.tick, firmId }); return 'completed'; },
  });
  assert.equal((await batch.start()).status, 'complete');
  for (let day = 0; day < MONTH; day++) step(city);
  const nextMonth = await batch.start();
  assert.equal(nextMonth.status, 'complete'); assert.equal(nextMonth.tick, MONTH * 2);
  assert.deepEqual(requests, [{ tick: MONTH, firmId: 1 }, { tick: MONTH * 2, firmId: 1 }]);
});

test('a loaded or replacement city invalidates an in-flight reply and restarts from its own first market', async () => {
  let city = monthEnd(); let mode: OwnerDecisionMode = 'typhoon-auto';
  const requests: number[] = []; let release!: (result: 'completed') => void;
  let notifyStarted!: () => void; const started = new Promise<void>(resolve => { notifyStarted = resolve; });
  let first = true;
  const batch = createOwnerMonthlyBatch({
    getContext: () => ({ city, mode }), getFirmIds: () => [1, 2],
    processFirm: async (_current, firmId) => {
      requests.push(firmId);
      if (first) {
        first = false; notifyStarted();
        return new Promise(resolve => { release = resolve; });
      }
      return 'completed';
    },
  });

  const oldRun = batch.start(); await started;
  city = deserialize(serialize(city)); mode = 'proposal';
  release('completed');
  assert.equal((await oldRun).status, 'stale', 'a response for the pre-load city must be discarded');
  assert.equal((await batch.start()).status, 'stale', 'proposal mode must not resume an old batch');
  assert.deepEqual(requests, [1]);
  mode = 'typhoon-auto';
  const freshRun = await batch.start();
  assert.equal(freshRun.status, 'complete'); assert.equal(freshRun.tick, MONTH);
  assert.deepEqual(requests, [1, 1, 2], 'a loaded city starts a new month batch without replaying old progress');
});

test('duplicate starts share one in-flight market request and a late same-city reply cannot advance the batch', async () => {
  const city = monthEnd(); let release!: (result: 'completed') => void;
  let notifyStarted!: () => void; const started = new Promise<void>(resolve => { notifyStarted = resolve; });
  const requests: number[] = [];
  const batch = createOwnerMonthlyBatch({
    getContext: () => ({ city, mode: 'typhoon-auto' }), getFirmIds: () => [1, 2],
    processFirm: async (_current, firmId) => {
      requests.push(firmId); notifyStarted();
      return new Promise(resolve => { release = resolve; });
    },
  });

  const firstRun = batch.start(); await started;
  const duplicateStart = batch.start();
  assert.deepEqual(requests, [1], 'concurrent starts must not duplicate a provider request');
  step(city); release('completed');
  const [firstResult, duplicateResult] = await Promise.all([firstRun, duplicateStart]);
  assert.equal(firstResult.status, 'stale'); assert.equal(duplicateResult.status, 'stale');
  assert.deepEqual(requests, [1], 'a late response must not advance to another market');
  assert.deepEqual(firstResult.completedFirmIds, []);
});
