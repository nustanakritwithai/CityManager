import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCity, step, serialize, deserialize, buildPark, bulldoze, GATEWAY, type City } from '../src/sim.ts';
import { createParkRuntime, advanceParkRuntime, serializeParkSession, deserializeParkSession, type ParkRuntime } from '../src/park-runtime.ts';
import { REAL_SECONDS_PER_DAY, GAME_MINUTES_PER_DAY, NORMAL_GAME_MINUTES_PER_SECOND, CITIZEN_WATCH_GAME_MINUTES_PER_SECOND,
  MAX_FRAME_SECONDS, frameGameMinutes, gameMinutesPerSecond, type ClockMode } from '../src/game-clock.ts';
import { restoreStartupCity } from '../src/startup-save.ts';
import { SAVE_KEY } from '../src/save-storage.ts';
import { createAutosave, installAutosave, AUTOSAVE_INTERVAL_MS } from '../src/autosave.ts';
import { gameHour } from '../src/atmosphere.ts';

/** Controllable clock: drives the same per-frame path as main.ts with fixed dt. */
function play(city: City, rt: ParkRuntime, seconds: number, mode: ClockMode = 'normal', paused = () => false, fps = 60, minutesFor = frameGameMinutes) {
  let days = 0; const frames = Math.round(seconds * fps);
  for (let f = 0; f < frames; f++) {
    const minutes = minutesFor(1 / fps, mode, paused());
    if (minutes) advanceParkRuntime(city, rt, minutes, () => { step(city); days++; });
  }
  return days;
}
function parkCity(): City {
  const c = createCity(61025);
  for (let d = 0; d < 45; d++) step(c);
  for (let i = 0; i < c.cells.length; i++) if (c.cells[i].road && i !== GATEWAY) bulldoze(c, i);
  const home = c.buildings.find(b => b.zone === 'R')!;
  const dist = (i: number) => Math.abs(i % 24 - home.cell % 24) + Math.abs(Math.floor(i / 24) - Math.floor(home.cell / 24));
  assert.ok(c.cells.map((_, i) => i).sort((a, b) => dist(a) - dist(b) || a - b).some(i => buildPark(c, i).ok)); step(c);
  return deserialize(serialize(c));
}
class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } }

test('one central rate: 6 real s per game day = 240 game minutes per real second; citizen watch is 1/s', () => {
  assert.equal(REAL_SECONDS_PER_DAY, 6);
  assert.equal(GAME_MINUTES_PER_DAY, 1440);
  assert.equal(NORMAL_GAME_MINUTES_PER_SECOND, 240);
  assert.equal(gameMinutesPerSecond('normal'), 240);
  assert.equal(gameMinutesPerSecond('citizen-watch'), CITIZEN_WATCH_GAME_MINUTES_PER_SECOND);
  assert.equal(CITIZEN_WATCH_GAME_MINUTES_PER_SECOND, 1);
});

test('controlled clock: 6 s crosses exactly one day boundary, no duplicate day events', () => {
  const c = createCity(61025, { starter: true }), rt = createParkRuntime(c), t0 = c.tick;
  assert.equal(play(c, rt, 5.9), 0); assert.equal(c.tick, t0);
  assert.equal(play(c, rt, 0.1), 1); assert.equal(c.tick, t0 + 1);
  assert.equal(rt.activity.minute, 0); assert.ok(rt.minuteRemainder < 1e-6 || rt.minuteRemainder > 1 - 1e-6);
  const ledgerTicks = c.ledger.filter(e => e.tick === t0 + 1).length;
  assert.equal(play(c, rt, 5.9), 0); assert.equal(c.tick, t0 + 1, 'no second boundary within the next day');
  assert.equal(c.ledger.filter(e => e.tick === t0 + 1).length, ledgerTicks, 'day events not re-applied');
  assert.equal(play(c, rt, 60), 10); assert.equal(c.tick, t0 + 11);
});

test('no speed multiplier: frame minutes ignore everything but dt, mode and pause; clamp and hidden kept', () => {
  assert.equal(frameGameMinutes(1 / 60, 'normal', false), 4);
  assert.equal(frameGameMinutes(10, 'normal', false), MAX_FRAME_SECONDS * 240, 'existing 0.25 s catch-up clamp');
  assert.equal(frameGameMinutes(1, 'normal', false, true), 0, 'hidden tab advances nothing');
  assert.equal(frameGameMinutes(1, 'normal', true), 0);
  assert.equal(frameGameMinutes(1, 'citizen-watch', true), 0);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /data-speed|10×|3×/, 'no speed buttons remain');
  assert.doesNotMatch(readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'), /\bspeed\s*=|data-speed|getSpeed/);
  assert.doesNotMatch(readFileSync(new URL('../src/hud-row.ts', import.meta.url), 'utf8'), /speed-cycle|data-speed/);
});

test('pause stops time and events; resume continues from the same minute; citizen watch is 1 game minute/s', () => {
  const c = parkCity(), rt = createParkRuntime(c);
  play(c, rt, 2); const before = serializeParkSession(c, rt);
  assert.equal(play(c, rt, 120, 'normal', () => true), 0);
  assert.equal(serializeParkSession(c, rt), before, 'paused: no clock, activity, ledger or RNG change');
  const m0 = rt.activity.minute; play(c, rt, 1); assert.equal(rt.activity.minute, m0 + 240);
  const m1 = rt.activity.minute, t1 = c.tick; play(c, rt, 30, 'citizen-watch');
  assert.equal(rt.activity.minute, m1 + 30); assert.equal(c.tick, t1);
  assert.equal(play(c, rt, 30, 'citizen-watch', () => true), 0); assert.equal(rt.activity.minute, m1 + 30);
});

test('same city+seed and same number of days: economy identical to the old 1-day-per-second pacing', () => {
  const oldPace = (dt: number, _m: ClockMode, paused: boolean) => paused ? 0 : Math.min(dt, 0.25) * 1 * 1440;
  for (const make of [() => createCity(61025, { starter: true, education: true }), parkCity]) {
    const a = make(), b = deserialize(serialize(a)), ra = createParkRuntime(a), rb = createParkRuntime(b), ref = deserialize(serialize(a));
    const daysOld = play(a, ra, 40, 'normal', () => false, 60, oldPace);   // 40 days at the old rate
    const daysNew = play(b, rb, 240);                                     // 40 days at 6 s/day
    assert.equal(daysOld, 40); assert.equal(daysNew, 40);
    assert.equal(serialize(b), serialize(a), 'money, goods, ledger, population, education identical');
    for (let d = 0; d < 40; d++) step(ref);
    assert.equal(serialize(b), serialize(ref));
  }
});

test('old and mid-day saves load as-is: game time preserved, reopening does not advance or double-produce', () => {
  const c = parkCity(), rt = createParkRuntime(c); play(c, rt, 2.7);
  assert.ok(rt.activity.minute > 0 && rt.minuteRemainder >= 0);
  const raw = serializeParkSession(c, rt), store = new Mem(); store.setItem(SAVE_KEY, raw);
  const s = restoreStartupCity(store, () => createCity(1));
  assert.equal(s.restored, true); assert.equal(serializeParkSession(s.city, s.runtime), raw, 'day and fraction reused without scaling');
  assert.equal(s.runtime.activity.minute, rt.activity.minute); assert.equal(s.runtime.minuteRemainder, rt.minuteRemainder);
  assert.equal(store.getItem(SAVE_KEY), raw, 'load writes nothing');
  // main.ts starts paused after a restore: frames advance nothing until Play.
  assert.equal(play(s.city, s.runtime, 30, 'normal', () => true), 0);
  assert.equal(serializeParkSession(s.city, s.runtime), raw);
  const old = readFileSync(new URL('./fixtures/factory-v17-park-session.json', import.meta.url), 'utf8');
  const os = new Mem(); os.setItem(SAVE_KEY, old); const o = restoreStartupCity(os, () => createCity(1));
  assert.equal(o.error, null); assert.equal(o.restored, true);
  const direct = deserializeParkSession(old);
  assert.equal(o.city.tick, direct.city.tick); assert.equal(o.runtime.activity.minute, direct.runtime.activity.minute); assert.equal(o.runtime.minuteRemainder, direct.runtime.minuteRemainder);
  const snap = serializeParkSession(o.city, o.runtime);
  assert.equal(play(o.city, o.runtime, 10, 'normal', () => true), 0); assert.equal(serializeParkSession(o.city, o.runtime), snap);
});

test('autosave stays real-time (60 s interval, independent of game days) — fake timer', async () => {
  let interval = 0, fire = () => {}; const saves: number[] = [];
  const c = createCity(61025, { starter: true }), rt = createParkRuntime(c);
  const auto = createAutosave({ save: () => { saves.push(c.tick); }, tick: () => c.tick, onResult: () => {} });
  installAutosave({ addEventListener() {} }, { addEventListener() {}, setInterval: (f: () => void, ms: number) => { fire = f; interval = ms; return 0; } }, auto, () => false);
  assert.equal(AUTOSAVE_INTERVAL_MS, 60_000); assert.equal(interval, 60_000);
  play(c, rt, 30); assert.equal(saves.length, 0, 'five game days pass without an autosave');
  fire(); await new Promise(r => setImmediate(r)); assert.deepEqual(saves, [c.tick]);
});

test('day-night sky hour is the game clock', () => {
  assert.equal(gameHour(0), 0); assert.equal(gameHour(480), 8); assert.equal(gameHour(1439), 1439 / 60);
});
