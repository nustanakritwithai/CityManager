import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_SECONDS, daySeconds, frameMinutes, minuteASecondSpeed, clockLabel, skyFollowsClock, paceAt, paceLabel, paceTitle } from '../src/game-clock.ts';
import { createCity, step } from '../src/sim.ts';
import { createParkRuntime, advanceParkRuntime, deserializeParkSession } from '../src/park-runtime.ts';
import { freshServerCityRaw, FRESH_CITY_START_MINUTE } from '../src/fresh-server-city.ts';

/** Real seconds of play at `speed` until one game hour has passed, in quarter-second frames. */
const secondsPerHour = (speed: number, seconds = DAY_SECONDS) => { let minutes = 0, t = 0; while (minutes < 60 - 1e-9) { minutes += frameMinutes(.25, speed, seconds); t += .25; } return t; };

test('a game day lasts six real minutes at 1×: an hour is 15 seconds, 5 at 3× and 1.5 at 10×', () => {
  assert.equal(DAY_SECONDS, 360);
  assert.equal(4 * frameMinutes(.25, 1, DAY_SECONDS), 4, 'four game minutes each real second');
  assert.deepEqual([1, 3, 10].map(speed => secondsPerHour(speed)), [15, 5, 1.5]);
  // A frame longer than a quarter second counts as a quarter, so a tab coming back does not jump hours ahead.
  assert.equal(frameMinutes(5, 1, DAY_SECONDS), 1);
  assert.equal(frameMinutes(-1, 1, DAY_SECONDS), 0);
  // "Watch the citizens" is one game minute each real second: a day takes 24 minutes.
  assert.equal(minuteASecondSpeed(DAY_SECONDS), .25);
  assert.equal(4 * frameMinutes(.25, minuteASecondSpeed(DAY_SECONDS), DAY_SECONDS), 1);
});

test('the economy settles once each game day: one day after 360 seconds of play at 1×, 36 at 10×', () => {
  for (const [speed, seconds] of [[1, 360], [10, 36]] as const) {
    const c = createCity(61025), runtime = createParkRuntime(c);
    let frames = 0;
    while (c.tick === 0) { advanceParkRuntime(c, runtime, frameMinutes(.25, speed, DAY_SECONDS), () => step(c)); frames++; }
    assert.equal(frames * .25, seconds, `${speed}×`);
    assert.equal(runtime.activity.minute, 0);
  }
});

test('browser checks can shorten the day before the page loads; anything else keeps six minutes', () => {
  assert.equal(daySeconds({}), 360);
  assert.equal(daySeconds({ __CITYMANAGER_DAY_SECONDS__: 1 }), 1);
  assert.equal(daySeconds({ __CITYMANAGER_DAY_SECONDS__: '2.5' }), 2.5);
  assert.equal(daySeconds({ location: { search: '?starter=1&day-seconds=30' } }), 30);
  for (const bad of [0, -1, Infinity, NaN, 100_000, 'soon', '', null, true]) assert.equal(daySeconds({ __CITYMANAGER_DAY_SECONDS__: bad }), 360, String(bad));
  assert.equal(daySeconds({ location: { search: '?day-seconds=0' } }), 360);
  assert.equal(minuteASecondSpeed(1), 1 / 1440, 'browser checks keep their one-minute-a-second citizen view');
});

test('the sky follows the game clock at every speed button, but not on a day shorter than half a minute', () => {
  for (const speed of [1, 3, 10, minuteASecondSpeed(DAY_SECONDS)]) assert.equal(skyFollowsClock(DAY_SECONDS, speed), true, `${speed}×`);
  assert.equal(skyFollowsClock(DAY_SECONDS, 0), false);
  assert.equal(skyFollowsClock(1, 1), false, 'a one-second test day keeps the slow sky');
});

test('clock and pace labels', () => {
  assert.deepEqual([0, 450, 1439, 1440, -1, 59.9].map(clockLabel), ['00:00', '07:30', '23:59', '00:00', '23:59', '00:59']);
  assert.equal(paceLabel(DAY_SECONDS), '1 วัน = 6 นาที');
  assert.equal(paceLabel(1), '1 วัน = 1 วินาที');
  assert.equal(paceAt(DAY_SECONDS, 10), '1 ชม. = 1.5 วินาที · 1 วัน = 36 วินาที');
  assert.equal(paceTitle(DAY_SECONDS), '1×: 1 ชม. = 15 วินาที · 1 วัน = 6 นาที\n3×: 1 ชม. = 5 วินาที · 1 วัน = 2 นาที\n10×: 1 ชม. = 1.5 วินาที · 1 วัน = 36 วินาที');
});

test('a new city opens at seven in the morning, so its first hours are in daylight', () => {
  const session = deserializeParkSession(freshServerCityRaw('11111111-1111-4111-8111-111111111111'));
  assert.equal(FRESH_CITY_START_MINUTE, 7 * 60);
  assert.equal(session.runtime.activity.minute, FRESH_CITY_START_MINUTE);
  assert.equal(session.runtime.activity.day, session.city.tick);
});
