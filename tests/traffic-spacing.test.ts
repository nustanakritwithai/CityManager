import test from 'node:test';
import assert from 'node:assert/strict';
import { LANE_SLOTS, LANE_END, SLOT_PITCH, CAR_LENGTH, QUEUE_GAP } from '../src/citizen-road-queue.ts';
import { overlappingPairs } from '../src/citizen-road-queue.ts';
import { TRAFFIC_SPACING, bumperGap, desiredFollowingGap, updateVehicleFollowing, separateCarsFromBuses, vehicleBox, boxesOverlap, type LaneVehicle } from '../src/traffic/spacing.ts';
import { TrafficGame, type TrafficGameSample } from '../src/traffic/game.ts';
import { gamePoses } from '../src/traffic/game-poses.ts';

const car = (pos: number, speed: number, max = TRAFFIC_SPACING.maxSpeedTiles * TRAFFIC_SPACING.worldPerTile): LaneVehicle =>
  ({ posOnLane: pos, speed, maxSpeed: max, length: TRAFFIC_SPACING.lengths.sedan });

test('three sedans fit on a lane and the standstill bumper gap is 0.09 world units', () => {
  assert.equal(TRAFFIC_SPACING.maxPerLanePerTile, 3);
  assert.equal(LANE_SLOTS, 3);
  assert.ok(Math.abs(QUEUE_GAP * TRAFFIC_SPACING.worldPerTile - TRAFFIC_SPACING.standstillGap) < 1e-9);
  assert.ok(Math.abs(SLOT_PITCH - (CAR_LENGTH + QUEUE_GAP)) < 1e-9);
  const centres = [LANE_END - 2 * SLOT_PITCH, LANE_END - SLOT_PITCH, LANE_END];
  for (let i = 1; i < centres.length; i++) {
    const gap = (centres[i] - centres[i - 1]) * TRAFFIC_SPACING.worldPerTile - TRAFFIC_SPACING.lengths.sedan;
    assert.ok(Math.abs(gap - 0.09) < 1e-9, String(gap));
  }
});

test('a stopped leader is queued at the standstill gap and never overlapped', () => {
  const leader = car(5, 0, 0), follower = car(5 - 3, 2);
  for (let i = 0; i < 80; i++) updateVehicleFollowing(follower, leader, 0.05);
  const gap = bumperGap(follower, leader);
  assert.ok(Math.abs(gap - TRAFFIC_SPACING.standstillGap) < 0.02, String(gap));
  assert.ok(gap >= TRAFFIC_SPACING.standstillGap - 1e-6);
  assert.ok(follower.speed < 0.05);
});

test('moving followers settle on standstillGap + speed * headwayFactor', () => {
  const max = TRAFFIC_SPACING.maxSpeedTiles * TRAFFIC_SPACING.worldPerTile;
  // Already at max speed, so the follower can only fall back — start inside the desired gap.
  const leader = car(0, max), follower = car(-(TRAFFIC_SPACING.lengths.sedan + 0.12), max);
  for (let i = 0; i < 400; i++) {
    leader.posOnLane += leader.speed * 0.05;
    updateVehicleFollowing(follower, leader, 0.05);
  }
  const gap = bumperGap(follower, leader);
  const expected = desiredFollowingGap(follower.speed);
  assert.ok(Math.abs(follower.speed - max) < 0.15, String(follower.speed));
  assert.ok(Math.abs(gap - expected) < 0.08, `gap ${gap} expected ${expected}`);
  assert.ok(gap > TRAFFIC_SPACING.standstillGap);
});

test('queued traffic keeps a bumper gap and at most 3 vehicles per lane, with no pose overlap', () => {
  const roads = new Set([25, 26, 27, 28, 50]);
  const sample: TrafficGameSample = { map: { cells: Array.from({ length: 576 }, (_, i) => ({ road: roads.has(i) })) }, demand: [{ from: 25, to: 28, rate: 4 }] };
  const game = new TrafficGame(sample);
  for (let i = 0; i < 40; i++) game.step();
  const frame = game.frame;
  assert.ok(Math.abs(frame.offered - frame.completed - frame.dropped - frame.cancelled - frame.waiting - frame.moving) < 1e-6);
  const approach = frame.cars.filter(c => c.from === 25 && c.to === 26);
  assert.ok(approach.length >= 2 && approach.length <= 3, JSON.stringify(approach.map(c => c.progress)));
  const ordered = [...approach].sort((a, b) => (a.progress ?? 0) - (b.progress ?? 0));
  for (let i = 1; i < ordered.length; i++) {
    const gap = ((ordered[i].progress ?? 0) - (ordered[i - 1].progress ?? 0)) * TRAFFIC_SPACING.worldPerTile - TRAFFIC_SPACING.lengths.sedan;
    assert.ok(gap >= TRAFFIC_SPACING.standstillGap - 0.02, String(gap));
  }
  assert.deepEqual(overlappingPairs(gamePoses(frame.cars, frame.groups)), []);
  for (const group of frame.groups) if (!group.closed) assert.ok(group.amount <= group.storage);
});

test('a straight road platoons more than one car per tile without clipping', () => {
  const roads = new Set([25, 26, 27, 28]);
  const sample: TrafficGameSample = { map: { cells: Array.from({ length: 576 }, (_, i) => ({ road: roads.has(i) })) }, demand: [{ from: 25, to: 28, rate: 4 }] };
  const game = new TrafficGame(sample);
  for (let i = 0; i < 25; i++) game.step();
  const frame = game.frame;
  const counts = new Map<string, number>();
  for (const c of frame.cars) counts.set(`${c.from}>${c.to}`, (counts.get(`${c.from}>${c.to}`) ?? 0) + 1);
  assert.ok([...counts.values()].some(n => n >= 2), JSON.stringify([...counts]));
  assert.ok([...counts.values()].every(n => n <= 3));
  assert.deepEqual(overlappingPairs(gamePoses(frame.cars, frame.groups)), []);
});

test('cars yield backward to a bus and leave the bus on its stop', () => {
  const bus = { x: 0, z: 0, headingX: 1, headingZ: 0, length: 1.32, width: 0.38 };
  const carPose = { vehicleId: 'game:1', x: 0.2, z: 0, headingX: 1, headingZ: 0, paint: 0 };
  assert.equal(boxesOverlap(vehicleBox(carPose, 0.42, 0.3), vehicleBox(bus, bus.length, bus.width)), true);
  const [shifted] = separateCarsFromBuses([carPose], [bus]);
  assert.equal(boxesOverlap(vehicleBox(shifted, 0.42, 0.3), vehicleBox(bus, bus.length, bus.width), 0.01), false);
  assert.ok(shifted.x < carPose.x);
  assert.equal(bus.x, 0);
});
