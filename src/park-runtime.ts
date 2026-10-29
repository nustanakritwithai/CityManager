/** Application clock and atomic local save for the reviewed park components.
 * The economic engine remains the only owner of jobs, payroll and daily steps.
 */
import { deserialize, serialize, type City } from './sim.ts';
import { parkWorkers, PARK_STAFF } from './parks.ts';
import { createParkActivity, advanceParkActivity, reconcileParkActivity, startParkActivityDay,
  parkActivityAbsoluteMinute, prepareParkActivity, restoreParkActivity, WORK_START_MINUTE, WORK_END_MINUTE, type ParkActivityState } from './park-activity.ts';
import { createParkRecreation, advanceParkRecreation, restoreParkRecreation, type ParkRecreationState } from './park-recreation.ts';
import { observeParkRecreationMinute, parkRecreationResidentIds, PROPOSED_PARK_COMFORT } from './park-recreation-activity.ts';

export const GAME_MINUTES_PER_DAY = 1440;
export type ParkRuntime = { version: 1; activity: ParkActivityState; recreation: ParkRecreationState; minuteRemainder: number };

export function createParkRuntime(city: City): ParkRuntime {
  const activity = createParkActivity(city);
  return { version: 1, activity, recreation: createParkRecreation(parkActivityAbsoluteMinute(activity)), minuteRemainder: 0 };
}

/** City edits cancel stale activity even while paused; they never award minutes. */
export function reconcileParkRuntime(city: City, runtime: ParkRuntime): void {
  reconcileParkActivity(city, runtime.activity);
  const residents = new Set(parkRecreationResidentIds(city));
  if (Object.keys(runtime.recreation.citizens).some(id => !residents.has(id))) {
    runtime.recreation = restoreParkRecreation({ ...runtime.recreation,
      citizens: Object.fromEntries(Object.entries(runtime.recreation.citizens).filter(([id]) => residents.has(id))) },
    parkActivityAbsoluteMinute(runtime.activity));
  }
}

/** One economic day per 1440 actual minutes. A zero advance is a true pause.
 * Normal playback still requests 1440 minutes/second; citizen view requests one.
 */
export type CityMinuteObserver = { beforeMinute?: (absoluteMinute:number)=>void; afterDay?:()=>void; unavailableCitizenIds?:()=>ReadonlySet<string> };
export function advanceParkRuntime(city: City, runtime: ParkRuntime, minutes: number, advanceDay: () => void, afterDay?: () => boolean | void, continueFrame?: () => boolean, observer?:CityMinuteObserver): number {
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440 * 120) throw new RangeError('Invalid park clock advance');
  if (minutes === 0) return 0;
  if (runtime.activity.day !== city.tick || runtime.recreation.minute !== parkActivityAbsoluteMinute(runtime.activity)) throw new Error('Park clocks differ');
  const total = runtime.minuteRemainder + minutes;
  let remaining = Math.floor(total), days = 0, processed = 0;
  runtime.minuteRemainder = total - remaining;
  reconcileParkRuntime(city, runtime);
  const prepare = () => {
    const activity = prepareParkActivity(city);
    return { activity, onDuty: new Set(activity.citizens.filter(p => p.employed).map(p => p.citizenId)),
      parkPolicy: new Map(city.parks.map(p => [p.id, {
        qualityPermille: Math.round(parkWorkers(p) / PARK_STAFF.slots * 1000), comfortableCapacity: PROPOSED_PARK_COMFORT,
      }])) };
  };
  let context = prepare();
  const offDuty = new Set<string>();
  while (remaining > 0) {
    // Application-only pacing budget: stop at an observed minute, never jump the
    // game clock or accumulate catch-up debt. Heavy frames slow playback.
    if (processed > 0 && continueFrame?.() === false) { runtime.minuteRemainder = 0; break; }
    observer?.beforeMinute?.(parkActivityAbsoluteMinute(runtime.activity)+1);
    context.activity.unavailableCitizenIds=observer?.unavailableCitizenIds?.();
    // With neither parks nor any earned benefit there are no observations to miss.
    // Preserve the no-park economy's cost and byte-for-byte behavior.
    if (!city.parks.length && !runtime.activity.visitors.length && !Object.keys(runtime.recreation.citizens).length) {
      const count = Math.min(remaining, observer ? 1 : GAME_MINUTES_PER_DAY - runtime.activity.minute);
      runtime.activity.minute += count; remaining -= count;
      processed += count;
      runtime.recreation = createParkRecreation(parkActivityAbsoluteMinute(runtime.activity), runtime.recreation.tuning);
    } else {
      reconcileParkActivity(city, runtime.activity, context.activity);
      const frame = observeParkRecreationMinute(city, runtime.activity, { parkPolicy: context.parkPolicy,
        unavailableCitizenIds: context.activity.unavailableCitizenIds ?? (runtime.activity.minute >= WORK_START_MINUTE && runtime.activity.minute < WORK_END_MINUTE ? context.onDuty : offDuty) });
      const nextRecreation = advanceParkRecreation(runtime.recreation, frame);
      advanceParkActivity(city, runtime.activity, 1, context.activity);
      runtime.recreation = nextRecreation;
      remaining--;
      processed++;
    }
    if (runtime.activity.minute === GAME_MINUTES_PER_DAY) {
      const before = city.tick;
      advanceDay();
      if (city.tick !== before + 1) throw new Error('Park runtime requires exactly one economic day');
      startParkActivityDay(city, runtime.activity); days++;
      reconcileParkRuntime(city, runtime);
      observer?.afterDay?.();
      // UI/owner automation can render or pause synchronously. Publish the whole
      // boundary first, then stop this wall-time request at that explicit pause.
      if (afterDay?.() === false) { runtime.minuteRemainder = 0; break; }
      context = prepare();
    }
  }
  return days;
}

function restoreRuntime(city: City, value: unknown): ParkRuntime {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid park runtime');
  const raw = value as ParkRuntime;
  if (Object.keys(raw).sort().join(',') !== 'activity,minuteRemainder,recreation,version' || raw.version !== 1
    || !Number.isFinite(raw.minuteRemainder) || raw.minuteRemainder < 0 || raw.minuteRemainder >= 1) throw new Error('Invalid park runtime fields');
  const activity = restoreParkActivity(city, JSON.stringify(raw.activity));
  // Production saves always complete the economic boundary before becoming observable.
  if (activity.minute === 1440) throw new Error('Incomplete park day boundary');
  const runtime: ParkRuntime = { version: 1, activity, minuteRemainder: raw.minuteRemainder,
    recreation: restoreParkRecreation(raw.recreation, parkActivityAbsoluteMinute(activity)) };
  reconcileParkRuntime(city, runtime);
  return runtime;
}

/** City and all minute state share one storage write and the existing backup policy.
 * The unpublished v15/chain-10 envelope adds one optional, versioned application field.
 */
export function serializeParkSession(city: City, runtime: ParkRuntime, market?: City['market']): string {
  const validated = restoreRuntime(city, runtime);
  const json = JSON.stringify({ ...JSON.parse(serialize(city, market)), parkRuntime: validated });
  if (json.length > 12_000_000) throw new Error('Save journal exceeds the prototype 12 MB limit. The previous local save is preserved.');
  return json;
}

export function deserializeParkSession(json: string): { city: City; runtime: ParkRuntime } {
  if (json.length > 12_000_000) throw new Error('City save exceeds the prototype limit');
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid city save');
  const { parkRuntime, ...citySave } = parsed;
  if (parkRuntime !== undefined && !((parsed.version === 15 && parsed.rulesVersion === 'chain-10') || (parsed.version === 16 && parsed.rulesVersion === 'chain-11') || (parsed.version === 17 && parsed.rulesVersion === 'chain-12') || (parsed.version === 18 && parsed.rulesVersion === 'chain-13') || (parsed.version === 19 && parsed.rulesVersion === 'chain-14') || (parsed.version === 20 && parsed.rulesVersion === 'chain-15') || (parsed.version === 21 && parsed.rulesVersion === 'chain-16'))) throw new Error('Park runtime requires save v15 through v21 with matching rules');
  const city = deserialize(JSON.stringify(citySave));
  const runtime = parkRuntime === undefined ? createParkRuntime(city) : restoreRuntime(city, parkRuntime);
  return { city, runtime };
}
