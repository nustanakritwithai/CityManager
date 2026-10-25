import test from 'node:test';
import assert from 'node:assert/strict';
import { SIZE, buildRoad, createCity, serialize, step } from '../src/sim.ts';
import { EDGES, GROUP_ORDER, NODES, cascade, downstream, networkChanges, networkEvents, networkSnapshot, networkValues, pastSnapshot, whatIf } from '../src/city-network.ts';
import { layoutNetwork } from '../src/network-layout.ts';

test('every link joins two known variables once, and every variable is linked', () => {
  const ids = new Set(NODES.map(n => n.id));
  assert.equal(ids.size, NODES.length);
  const pairs = new Set<string>();
  for (const e of EDGES) {
    assert.ok(ids.has(e.from) && ids.has(e.to), `${e.from} → ${e.to}`);
    assert.notEqual(e.from, e.to); assert.ok(e.why.length > 8);
    const key = `${e.from}>${e.to}`; assert.ok(!pairs.has(key), key); pairs.add(key);
    if (e.stream) assert.equal(NODES.find(n => n.id === e.stream)?.kind, 'flow');
  }
  for (const n of NODES) assert.ok(EDGES.some(e => e.from === n.id || e.to === n.id), n.id);
});

test('values are read-only, finite and follow a real road build through the chain', () => {
  const city = createCity(61025);
  for (let i = 0; i < 5; i++) step(city);
  const bytes = serialize(city), before = networkValues(city), snap = networkSnapshot(city);
  assert.equal(serialize(city), bytes, 'reading the network leaves the city untouched');
  for (const n of NODES) assert.ok(Number.isFinite(before[n.id]), n.id);
  const row = 2 * SIZE; assert.ok(!city.cells[row + 3].road);
  assert.ok(buildRoad(city, row + 2, row + 8).ok);
  const after = networkValues(city), changed = networkChanges(before, after, downstream(['roads']));
  assert.ok(changed.get('roads')! > 0); assert.ok(changed.get('treasury')! < 0);
  const events = networkEvents(snap, city);
  assert.ok(events.some(e => e.node === 'roads' && e.text.startsWith('สร้างถนน')));
  const pulses = cascade(['roads'], changed);
  assert.ok(pulses.some(p => p.edge.from === 'roads' && p.edge.to === 'treasury' && p.effect === -1));
  assert.ok(pulses.every(p => changed.has(p.edge.to)), 'pulses only land on variables that moved');
});

test('what-if follows signs downstream and the 30-day snapshot replays recent events', () => {
  const { reached } = whatIf('roads');
  assert.equal(reached.get('treasury'), -1); assert.equal(reached.get('access'), 1);
  const city = createCity(61025);
  for (let i = 0; i < 40; i++) step(city);
  const events = networkEvents(pastSnapshot(city, 30), city);
  assert.ok(events.every(e => e.tick >= city.tick - 29 && e.tick <= city.tick));
  assert.deepEqual(events.map(e => e.tick), [...events.map(e => e.tick)].sort((a, b) => a - b));
});

test('the 3D layout is deterministic, on the unit sphere and keeps nodes apart', () => {
  const a = layoutNetwork(NODES, EDGES, GROUP_ORDER), b = layoutNetwork(NODES, EDGES, GROUP_ORDER);
  assert.deepEqual(a, b);
  const points = NODES.map(n => a[n.id]);
  assert.ok(points.every(p => Math.hypot(p.x, p.y, p.z) <= 1 + 1e-9));
  let closest = Infinity;
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) closest = Math.min(closest, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y, points[i].z - points[j].z));
  assert.ok(closest > 0.12, `closest pair ${closest}`);
});
