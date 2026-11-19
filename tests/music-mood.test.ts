import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DUCK_LEVEL, DUCK_SECONDS, TENSE_RUNWAY_DAYS, TRACK_TIME, isTense, nextTrackFor } from '../src/music-mood.ts';
import { TRACKS, SYNTHS, EFFECTS } from '../src/audio-engine.ts';
import { RUNWAY_ALARM_DAYS } from '../src/economy-insights.ts';

test('every track has a time of day, and the next track suits the hour', () => {
  assert.equal(TRACK_TIME.length, TRACKS.length);
  assert.equal(nextTrackFor(0, true), 1); assert.equal(nextTrackFor(1, true), 1, 'the only night track repeats at night');
  assert.equal(nextTrackFor(0, false), 2); assert.equal(nextTrackFor(2, false), 0);
  assert.equal(nextTrackFor(0, true, ['day', 'day']), 1, 'with no track for the hour, simply the next one');
});

test('the music is tense on a fire day or when the treasury runs dry within the alarm window', () => {
  assert.equal(TENSE_RUNWAY_DAYS, RUNWAY_ALARM_DAYS, 'matches the treasury insight');
  assert.equal(isTense(null, false), false); assert.equal(isTense(500, false), false);
  assert.equal(isTense(TENSE_RUNWAY_DAYS - 1, false), true); assert.equal(isTense(TENSE_RUNWAY_DAYS, false), false);
  assert.equal(isTense(null, true), true);
});

test('only real cues duck the music, briefly and not to silence', () => {
  const known = new Set<string>([...SYNTHS, ...EFFECTS]);
  for (const [name, seconds] of Object.entries(DUCK_SECONDS)) { assert.ok(known.has(name), name); assert.ok(seconds > 0 && seconds <= 5); }
  assert.ok(DUCK_LEVEL > 0 && DUCK_LEVEL < 1);
});
