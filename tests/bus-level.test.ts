import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUS_CAPACITY, BUS_FARE_SATANG, busEnabled, type BusLevel, type BusLine, type BusState } from '../src/bus/types.ts';
import { BUS_LEVEL_FARE, BUS_LEVEL_UPKEEP, busLevelDisplayLines, busLevelQuote, busSeats, isBusLevel, lineSeatCapacity, nextBusLevel, upgradeBusLine } from '../src/bus/level.ts';

class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }

const line = (over: Partial<BusLine> = {}): BusLine => ({ id: 7, depotId: 1, stopIds: [1, 2], busCount: 2, busLevel: 1, ...over });
const state = (lines: BusLine[], over: Partial<BusState> = {}): BusState => ({
  version: 1, rules: 'bus-1',
  depots: [{ id: 1, cell: 4, level: 1, open: true, tick: 3 }],
  stops: [{ id: 1, cell: 8, side: 'n', level: 1 }, { id: 2, cell: 12, side: 's', level: 2 }],
  lines, ...over,
});
const on = () => { const s = new Mem(); assert.equal(busEnabled('?bus=1', s), true); return s; };

test('seat, fare and upkeep tables follow the shared capacity and stay display-only', () => {
  assert.deepEqual([1, 2, 3].map(level => busSeats(level as BusLevel)), [40, 60, 80]);
  for (const level of [1, 2, 3] as const) {
    assert.equal(busSeats(level), BUS_CAPACITY[level]);
    assert.equal(busLevelQuote(level).seats, BUS_CAPACITY[level]);
    assert.equal(busLevelQuote(level).fareSatang, BUS_LEVEL_FARE[level]);
    assert.equal(busLevelQuote(level).upkeepPerBusSatang, BUS_LEVEL_UPKEEP[level]);
    assert.ok(Object.isFrozen(busLevelQuote(level)));
  }
  assert.equal(BUS_LEVEL_FARE[1], BUS_FARE_SATANG);
  assert.deepEqual({ ...BUS_LEVEL_FARE }, { 1: 30, 2: 45, 3: 75 });
  assert.deepEqual({ ...BUS_LEVEL_UPKEEP }, { 1: 6_000, 2: 9_000, 3: 12_000 });
  assert.ok(Object.isFrozen(BUS_LEVEL_FARE) && Object.isFrozen(BUS_LEVEL_UPKEEP));
  assert.equal(lineSeatCapacity(line({ busLevel: 3, busCount: 2 })), BUS_CAPACITY[3] * 2);
  assert.equal(lineSeatCapacity(line({ busCount: 0 })), 0);
  assert.equal(nextBusLevel(1), 2); assert.equal(nextBusLevel(2), 3); assert.equal(nextBusLevel(3), null);
  assert.equal(isBusLevel(2), true); assert.equal(isBusLevel(4), false);
  assert.throws(() => busSeats(4 as BusLevel)); assert.throws(() => lineSeatCapacity(line({ busCount: -1 })));
  assert.throws(() => lineSeatCapacity(line({ busLevel: 0 as BusLevel })));
});

test('display lines quote seats, fare and upkeep without a city', () => {
  assert.deepEqual(busLevelDisplayLines(line()), [
    'ระดับ 1 · 40 ที่นั่ง',
    'ค่าโดยสาร 0.30 ฿ (ยังไม่เก็บเงิน)',
    'บำรุง 60 ฿/คัน/เดือน · ทั้งสาย 120 ฿ (2 คัน)',
  ]);
  assert.deepEqual(busLevelDisplayLines(line({ busLevel: 2, busCount: 1 })), [
    'ระดับ 2 · 60 ที่นั่ง',
    'ค่าโดยสาร 0.45 ฿ (ยังไม่เก็บเงิน)',
    'บำรุง 90 ฿/คัน/เดือน · ทั้งสาย 90 ฿ (1 คัน)',
  ]);
  assert.equal(busLevelDisplayLines(line({ busLevel: 3, busCount: 0 }))[0], 'ระดับ 3 · 80 ที่นั่ง');
});

test('?bus=1 upgrades 1 → 2 → 3 and ?bus=0 leaves the line alone', () => {
  const remembered = on();
  const live = state([line()]);
  const depots = live.depots, stops = live.stops;
  const first = upgradeBusLine(live, 7, busEnabled('', remembered));
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.from, 1); assert.equal(first.to, 2);
  assert.equal(first.quote.seats, 60); assert.equal(first.quote.fareSatang, 45); assert.equal(first.quote.upkeepPerBusSatang, 9_000);
  assert.equal(first.lineUpkeepSatang, 18_000);
  assert.equal(live.lines[0].busLevel, 2);
  assert.match(first.message, /สาย #7 เป็นระดับ 2 · 60 ที่นั่ง · ค่าโดยสาร 0\.45 ฿ · บำรุง 90 ฿/);
  const second = upgradeBusLine(live, 7, true);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.to, 3); assert.equal(second.quote.seats, BUS_CAPACITY[3]); assert.equal(live.lines[0].busLevel, 3);
  assert.match(second.message, /80 ที่นั่ง · ค่าโดยสาร 0\.75 ฿ · บำรุง 120 ฿/);
  const third = upgradeBusLine(live, 7, true);
  assert.deepEqual(third, { ok: false, reason: 'max-level', message: 'รถเมล์สายนี้เป็นระดับสูงสุดแล้ว' });
  assert.equal(live.lines[0].busLevel, 3);
  assert.equal(live.depots, depots); assert.equal(live.stops, stops);
  assert.equal(live.version, 1); assert.equal(live.rules, 'bus-1');
  assert.deepEqual(live.depots, [{ id: 1, cell: 4, level: 1, open: true, tick: 3 }]);
  assert.deepEqual(live.stops, [{ id: 1, cell: 8, side: 'n', level: 1 }, { id: 2, cell: 12, side: 's', level: 2 }]);

  const off = state([line()]);
  const forgotten = new Mem();
  busEnabled('?bus=1', forgotten); busEnabled('?bus=0', forgotten);
  const blocked = upgradeBusLine(off, 7, busEnabled('', forgotten));
  assert.deepEqual(blocked, { ok: false, reason: 'disabled', message: 'ระบบรถเมล์ยังไม่เปิดใช้' });
  assert.equal(off.lines[0].busLevel, 1);
  assert.equal(upgradeBusLine(off, 7, false).ok, false);
  assert.equal(off.lines[0].busLevel, 1);
});

test('default flag is off, so an unguarded call does not change busLevel', () => {
  const idle = state([line()]);
  assert.equal(upgradeBusLine(idle, 7).ok, false);
  assert.equal(idle.lines[0].busLevel, 1);
});

test('upgrade writes busLevel only', () => {
  const row = line({ busCount: 4, stopIds: [2, 1, 2] });
  const before = structuredClone(row);
  const result = upgradeBusLine(state([row]), 7, true);
  assert.equal(result.ok, true);
  assert.deepEqual({ ...row, busLevel: 1 }, before);
  assert.deepEqual(Object.keys(row).sort(), ['busCount', 'busLevel', 'depotId', 'id', 'stopIds']);
  assert.equal(row.busLevel, 2); assert.equal(row.busCount, 4); assert.deepEqual(row.stopIds, [2, 1, 2]);
  assert.equal(lineSeatCapacity(row), BUS_CAPACITY[2] * 4);
  const empty = line({ id: 8, busCount: 0 });
  const raised = upgradeBusLine(state([empty]), 8, true);
  assert.equal(raised.ok, true);
  if (raised.ok) assert.equal(raised.lineUpkeepSatang, 0);
  assert.equal(empty.busLevel, 2);
});

test('validation refuses a bad target and does not mutate siblings', () => {
  const a = line({ id: 1, busLevel: 2 });
  const b = line({ id: 3, busLevel: 1 });
  const box = state([a, b]);
  assert.equal(upgradeBusLine(box, 9, true).reason, 'missing');
  assert.equal(upgradeBusLine(box, 0, true).reason, 'missing');
  assert.equal(upgradeBusLine(box, 1.5, true).reason, 'missing');
  assert.equal(upgradeBusLine({ lines: [] }, 1, true).reason, 'missing');
  const dup = state([line({ id: 1 }), line({ id: 1, busLevel: 2 })]);
  assert.equal(upgradeBusLine(dup, 1, true).reason, 'missing');
  assert.equal(dup.lines[0].busLevel, 1); assert.equal(dup.lines[1].busLevel, 2);
  const badLevel = state([line({ busLevel: 4 as BusLevel })]);
  assert.equal(upgradeBusLine(badLevel, 7, true).reason, 'invalid-level');
  assert.equal(badLevel.lines[0].busLevel, 4);
  const badFleet = state([line({ busCount: -2 })]);
  assert.equal(upgradeBusLine(badFleet, 7, true).reason, 'invalid-fleet');
  assert.equal(badFleet.lines[0].busLevel, 1);
  const overflow = state([line({ busCount: Number.MAX_SAFE_INTEGER })]);
  assert.equal(upgradeBusLine(overflow, 7, true).reason, 'invalid-fleet');
  assert.equal(overflow.lines[0].busLevel, 1);
  assert.equal(upgradeBusLine(box, 1, true).ok, true);
  assert.equal(a.busLevel, 3); assert.equal(b.busLevel, 1);
  assert.equal(a.depotId, 1);
});

test('level module does not own save, capacity digits, or the traffic bridge', () => {
  const src = readFileSync('src/bus/level.ts', 'utf8');
  assert.match(src, /BUS_CAPACITY/);
  assert.doesNotMatch(src, /BUS_CAPACITY\s*=/);
  assert.doesNotMatch(src, /\b(40|60|80)\b/);
  assert.doesNotMatch(src, /validateBus|serialize|deserialize|localStorage|sim\.ts|save-|traffic\/bridge|transfer\(/);
  const share = readFileSync('src/bus/mode-share.ts', 'utf8');
  assert.doesNotMatch(share, /bus\/level|BUS_LEVEL_FARE|BUS_LEVEL_UPKEEP/);
});
