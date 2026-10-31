/**
 * Bus level upgrade (PR B8): a line's vehicle class steps 1 → 2 → 3.
 *
 * Seats are read from BUS_CAPACITY in ./types.ts.
 * Fare and monthly upkeep are display figures only.
 * Depot size, stop level and the city.bus save envelope belong to PR 2
 * (feat/bus-buildings). Movement belongs to PR 4. The only write is
 * BusLine.busLevel, the field BusState already stores.
 *
 * Numbers are placeholders pending owner balance, same status as BUS_FARE_SATANG.
 * Mode-share keeps the flat shadow fare until an owner points it at BUS_LEVEL_FARE.
 */
import { BUS_CAPACITY, BUS_FARE_SATANG, busEnabled, type BusLevel, type BusLine, type BusState } from './types.ts';

/** Per-person fare by bus level, satang. Display only. Level 1 is the shared flat fare. */
export const BUS_LEVEL_FARE: Readonly<Record<BusLevel, number>> = Object.freeze({ 1: BUS_FARE_SATANG, 2: 45, 3: 75 });
/** Monthly upkeep per bus by level, satang. Display only. Never charged. */
export const BUS_LEVEL_UPKEEP: Readonly<Record<BusLevel, number>> = Object.freeze({ 1: 6_000, 2: 9_000, 3: 12_000 });

export function isBusLevel(level: number): level is BusLevel {
  return level === 1 || level === 2 || level === 3;
}
/** Seats on one bus of this level. Same table as BUS_CAPACITY. */
export function busSeats(level: BusLevel): number {
  if (!isBusLevel(level)) throw new RangeError('bus level');
  return BUS_CAPACITY[level];
}
const fleetCount = (busCount: number) => Number.isSafeInteger(busCount) && busCount >= 0;
/** Seats if every bus on the line is in service (count × BUS_CAPACITY). PR 4 applies the real schedule. */
export function lineSeatCapacity(line: Pick<BusLine, 'busLevel' | 'busCount'>): number {
  if (!isBusLevel(line.busLevel)) throw new RangeError('bus level');
  if (!fleetCount(line.busCount)) throw new RangeError('bus count');
  const seats = BUS_CAPACITY[line.busLevel];
  if (line.busCount > 0 && seats > Math.floor(Number.MAX_SAFE_INTEGER / line.busCount)) throw new RangeError('bus count');
  return line.busCount * seats;
}
export type BusLevelQuote = Readonly<{ level: BusLevel; seats: number; fareSatang: number; upkeepPerBusSatang: number }>;
/** Display card for one level. Does not read or write a city. */
export function busLevelQuote(level: BusLevel): BusLevelQuote {
  if (!isBusLevel(level)) throw new RangeError('bus level');
  return Object.freeze({ level, seats: BUS_CAPACITY[level], fareSatang: BUS_LEVEL_FARE[level], upkeepPerBusSatang: BUS_LEVEL_UPKEEP[level] });
}
/** Next vehicle class, or null at level 3. */
export function nextBusLevel(level: BusLevel): BusLevel | null {
  if (!isBusLevel(level) || level === 3) return null;
  return (level + 1) as BusLevel;
}

const baht = (satang: number) => {
  const whole = Math.floor(satang / 100), frac = satang % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0')}`;
};
/** Thai lines a later panel can show. Money has not moved. */
export function busLevelDisplayLines(line: Pick<BusLine, 'busLevel' | 'busCount'>): readonly string[] {
  const q = busLevelQuote(line.busLevel);
  if (!fleetCount(line.busCount)) throw new RangeError('bus count');
  const fleet = q.upkeepPerBusSatang * line.busCount;
  return Object.freeze([
    `ระดับ ${q.level} · ${q.seats} ที่นั่ง`,
    `ค่าโดยสาร ${baht(q.fareSatang)} ฿ (ยังไม่เก็บเงิน)`,
    `บำรุง ${baht(q.upkeepPerBusSatang)} ฿/คัน/เดือน · ทั้งสาย ${baht(fleet)} ฿ (${line.busCount} คัน)`,
  ]);
}

export type BusUpgradeReason = 'disabled' | 'missing' | 'invalid-level' | 'max-level' | 'invalid-fleet';
export type BusUpgrade =
  | { ok: true; from: BusLevel; to: BusLevel; line: BusLine; quote: BusLevelQuote; lineUpkeepSatang: number; message: string }
  | { ok: false; reason: BusUpgradeReason; message: string };
const MESSAGE: Record<BusUpgradeReason, string> = {
  disabled: 'ระบบรถเมล์ยังไม่เปิดใช้',
  missing: 'ไม่พบสายรถเมล์',
  'invalid-level': 'ระดับรถเมล์ต้องเป็น 1, 2 หรือ 3',
  'max-level': 'รถเมล์สายนี้เป็นระดับสูงสุดแล้ว',
  'invalid-fleet': 'จำนวนรถในสายไม่ถูกต้อง',
};
const refuse = (reason: BusUpgradeReason): BusUpgrade => ({ ok: false, reason, message: MESSAGE[reason] });

/**
 * Raise one line's bus level by one step. Mutates `line.busLevel` and nothing else.
 * `enabled` defaults to the shared flag (`?bus=1` / `?bus=0`). No ledger entry.
 */
export function upgradeBusLine(state: Pick<BusState, 'lines'>, lineId: number, enabled = busEnabled()): BusUpgrade {
  if (!enabled) return refuse('disabled');
  if (!state || typeof state !== 'object' || !Array.isArray(state.lines) || !Number.isSafeInteger(lineId) || lineId < 1) return refuse('missing');
  const matches = state.lines.filter(line => line?.id === lineId);
  if (matches.length !== 1) return refuse('missing');
  const line = matches[0];
  if (!isBusLevel(line.busLevel)) return refuse('invalid-level');
  const to = nextBusLevel(line.busLevel);
  if (to === null) return refuse('max-level');
  if (!fleetCount(line.busCount)) return refuse('invalid-fleet');
  const quote = busLevelQuote(to);
  if (line.busCount > 0 && quote.upkeepPerBusSatang > Math.floor(Number.MAX_SAFE_INTEGER / line.busCount)) return refuse('invalid-fleet');
  const from = line.busLevel;
  line.busLevel = to;
  const lineUpkeepSatang = quote.upkeepPerBusSatang * line.busCount;
  const message = `ยกระดับรถเมล์สาย #${line.id} เป็นระดับ ${to} · ${quote.seats} ที่นั่ง · ค่าโดยสาร ${baht(quote.fareSatang)} ฿ · บำรุง ${baht(quote.upkeepPerBusSatang)} ฿/คัน/เดือน`;
  return { ok: true, from, to, line, quote, lineUpkeepSatang, message };
}
