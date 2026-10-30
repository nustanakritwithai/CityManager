import test from 'node:test';
import assert from 'node:assert/strict';
import {TrafficFlow} from '../src/traffic/flow.ts';
import {buildNetwork} from '../src/traffic/network.ts';

const road = () => buildNetwork({cells: Array.from({length:576}, (_, i) => ({road:[25,26,27,28,50].includes(i)}))}, {capacityPerLane:30});
const loaded = () => {const f = new TrafficFlow(); f.advancePeriod(road(), [{from:25,to:28,vehicles:100}]); return f;};

test('restore rejects invented admission even when total offered mass balances', () => {
  const state = loaded().snapshot;
  state.admitted = state.completed; // On-road mass still exists, but was never admitted.
  assert.ok(state.batches.length > 0);
  assert.throws(() => TrafficFlow.restore(state), /admission/i);
});

test('restore rejects impossible path geometry and unexpected fields', () => {
  const state = loaded().snapshot;
  state.batches[0].path = [23,24]; // Consecutive indices wrap around a row, not adjacent roads.
  state.batches[0].index = 0;
  assert.throws(() => TrafficFlow.restore(state), /path|admitted/i);
  assert.throws(() => TrafficFlow.restore({...loaded().snapshot, forgottenQueue:20}), /fields|snapshot/i);
});

test('failed restore cannot mutate the original flow and returned snapshots cannot mutate it', () => {
  const flow = loaded(), before = flow.snapshot, copy = flow.snapshot;
  copy.waiting.length = 0;
  assert.throws(() => TrafficFlow.restore(copy));
  assert.deepEqual(flow.snapshot, before);
});
