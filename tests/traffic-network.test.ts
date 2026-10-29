import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNetwork, rebuildRegion, linkKey, LANE_CAPACITY_VPH } from '../src/traffic/network.ts';
import { configureRoadPath, setRoadJunction, clearRoadDirections, type RoadMap } from '../src/road-topology.ts';

const S = 24;
const blank = (): RoadMap => ({ cells: Array.from({ length: S * S }, () => ({ road: false })) });
function draw(c: RoadMap, path: number[], oneWay = false) {
  const fresh = new Set(path.filter(i => !c.cells[i].road));
  for (const i of path) c.cells[i].road = true;
  configureRoadPath(c, path, fresh, oneWay);
}
test('two-way road: links both ways, 1 lane each', () => {
  const c = blank(); draw(c, [0, 1, 2]);
  const n = buildNetwork(c);
  assert.equal(n.links.size, 4);
  const l = n.links.get(linkKey(0, 1))!;
  assert.equal(l.lanes, 1); assert.equal(l.capacityPerHour, LANE_CAPACITY_VPH); assert.ok(l.length > 0 && l.freeFlowKmh > 0);
});
test('one-way road: only forward links, 2 lanes', () => {
  const c = blank(); draw(c, [0, 1, 2], true);
  const n = buildNetwork(c);
  assert.ok(n.links.has(linkKey(0, 1)) && n.links.has(linkKey(1, 2)));
  assert.ok(!n.links.has(linkKey(1, 0)) && !n.links.has(linkKey(2, 1)));
  assert.equal(n.links.get(linkKey(0, 1))!.lanes, 2);
});
test('parallel adjacent roads without junction stay separate', () => {
  const c = blank(); draw(c, [0, 1, 2]); draw(c, [S, S + 1, S + 2]);
  const n = buildNetwork(c);
  for (let x = 0; x < 3; x++) { assert.ok(!n.links.has(linkKey(x, S + x))); assert.ok(!n.links.has(linkKey(S + x, x))); }
});
test('cancelled junction removes links; incremental rebuild matches full build', () => {
  const c = blank(); draw(c, [0, 1, 2]); draw(c, [1, S + 1, 2 * S + 1]);
  const n = buildNetwork(c);
  assert.ok(n.links.has(linkKey(1, S + 1)));
  setRoadJunction(c, 1, S + 1, false);
  rebuildRegion(c, n, [1]);
  assert.ok(!n.links.has(linkKey(1, S + 1)) && !n.links.has(linkKey(S + 1, 1)));
  assert.deepEqual([...n.links.keys()].sort(), [...buildNetwork(c).links.keys()].sort());
  draw(c, [2, 3, 4], true); rebuildRegion(c, n, [2, 3, 4]);
  assert.deepEqual([...n.links.entries()].sort(), [...buildNetwork(c).links.entries()].sort());
  assert.equal(n.out.get(1)!.length, buildNetwork(c).out.get(1)!.length);
});

function assertLink(n: ReturnType<typeof buildNetwork>, from: number, to: number, lanes: number) {
  const link = n.links.get(linkKey(from, to))!;
  assert.ok(link, `${from}>${to}`);
  assert.equal(link.lanes, lanes, `${from}>${to} lanes`);
  assert.equal(link.capacityPerHour, lanes * LANE_CAPACITY_VPH, `${from}>${to} capacity`);
}

test('bidirectional branch at a one-way junction has one lane per direction', () => {
  const c = blank(); draw(c, [24, 25, 26, 27], true); draw(c, [25, 49, 73]);
  const n = buildNetwork(c);
  for (const [a, b] of [[25, 49], [49, 73]]) {
    assertLink(n, a, b, 1); assertLink(n, b, a, 1);
  }
  for (const [a, b] of [[24, 25], [25, 26], [26, 27]]) {
    assertLink(n, a, b, 2); assert.ok(!n.links.has(linkKey(b, a)));
  }
});

test('joining parallel roads does not copy an unrelated one-way lane count', () => {
  const c = blank(); draw(c, [0, 1, 2], true); draw(c, [24, 25, 26]);
  const n = buildNetwork(c);
  for (let x = 0; x < 3; x++) {
    assert.ok(!n.links.has(linkKey(x, 24 + x)) && !n.links.has(linkKey(24 + x, x)));
  }
  setRoadJunction(c, 1, 25, true); rebuildRegion(c, n, [1]);
  assertLink(n, 1, 25, 1); assertLink(n, 25, 1, 1);
  assertLink(n, 0, 1, 2); assertLink(n, 24, 25, 1); assertLink(n, 25, 24, 1);
  assert.deepEqual([...n.links.entries()].sort(), [...buildNetwork(c).links.entries()].sort());
});

test('junction and direction edits rebuild both lane counts and adjacency', () => {
  const c = blank(); draw(c, [24, 25, 26, 27], true); draw(c, [25, 49, 73]);
  const n = buildNetwork(c);
  const rebuild = (cells: number[]) => {
    rebuildRegion(c, n, cells);
    const full = buildNetwork(c);
    assert.deepEqual([...n.links.entries()].sort(), [...full.links.entries()].sort());
    assert.deepEqual(n.out, full.out);
  };
  setRoadJunction(c, 25, 49, false); rebuild([25]);
  assert.ok(!n.links.has(linkKey(25, 49)) && !n.links.has(linkKey(49, 25)));
  setRoadJunction(c, 25, 49, true); rebuild([49]);
  assertLink(n, 25, 49, 1); assertLink(n, 49, 25, 1);
  clearRoadDirections(c, [24, 25, 26, 27]); rebuild([24, 25, 26, 27]);
  assertLink(n, 24, 25, 1); assertLink(n, 25, 24, 1);
  draw(c, [25, 49, 73], true); rebuild([25, 49, 73]);
  assertLink(n, 25, 49, 2); assert.ok(!n.links.has(linkKey(49, 25)));
  assertLink(n, 24, 25, 1); assertLink(n, 25, 24, 1);
});
