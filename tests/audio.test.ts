import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_DEFAULTS, AUDIO_KEY, busGain, loadAudioSettings, parseAudioSettings, saveAudioSettings } from '../src/audio-settings.ts';
import { CueLimiter, cityCues, cueSnapshot } from '../src/audio-cues.ts';
import { MONTH, createCity, serialize, step } from '../src/sim.ts';
import { keepSupplied } from './plants.ts';

test('sound settings default on at a low level, clamp every volume and survive bad storage', () => {
  assert.deepEqual(parseAudioSettings(null), AUDIO_DEFAULTS);
  assert.equal(AUDIO_DEFAULTS.muted, false); assert.ok(AUDIO_DEFAULTS.master <= .6 && AUDIO_DEFAULTS.music <= .4);
  const parsed = parseAudioSettings({ muted: 'yes', master: 3, ui: -1, events: .333, ambience: 'loud', music: Number.NaN });
  assert.deepEqual(parsed, { ...AUDIO_DEFAULTS, master: 1, ui: 0, events: .33 });
  const store = new Map<string, string>(), storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  saveAudioSettings({ ...AUDIO_DEFAULTS, muted: true, music: .1 }, storage);
  assert.deepEqual(loadAudioSettings(storage), { ...AUDIO_DEFAULTS, muted: true, music: .1 });
  store.set(AUDIO_KEY, '{broken'); assert.deepEqual(loadAudioSettings(storage), AUDIO_DEFAULTS);
  assert.equal(busGain({ ...AUDIO_DEFAULTS, muted: true }, 'ui'), 0);
  assert.equal(busGain(AUDIO_DEFAULTS, 'music'), AUDIO_DEFAULTS.master * AUDIO_DEFAULTS.music);
});

test('city cues follow real changes: new buildings, arrivals, month end, shops and goal levels', () => {
  const c = createCity(61025), heard = new Set<string>();
  for (let d = 1; d <= 400; d++) {
    const before = cueSnapshot(c), bytes = serialize(c); step(c); keepSupplied(c);
    assert.notEqual(serialize(c), bytes);
    const cues = cityCues(before, c);
    for (const cue of cues) heard.add(cue);
    if (d % MONTH === 0) assert.ok(cues.includes('ev-month'), `month end on day ${d}`);
    else assert.ok(!cues.includes('ev-month'));
    assert.equal(new Set(cues).size, cues.length, 'no cue twice in one step');
  }
  for (const cue of ['ev-build-home', 'ev-build-business', 'ev-arrival', 'ev-month', 'ev-shop', 'jingle-level', 'jingle-win']) assert.ok(heard.has(cue), cue);
  const snap = cueSnapshot(c), bytes = serialize(c); cityCues(snap, c); assert.equal(serialize(c), bytes, 'reading cues never changes the city');
});

test('a load or a new city (time going back) plays nothing', () => {
  const c = createCity(61025); for (let d = 0; d < 90; d++) step(c);
  assert.deepEqual(cityCues(cueSnapshot(c), createCity(61025)), []);
  assert.deepEqual(cityCues(cueSnapshot(c), c), [], 'no time passed');
});

test('the limiter keeps 10× speed calm but never drops a jingle or a month coin', () => {
  const limiter = new CueLimiter(3, 900);
  assert.deepEqual(limiter.admit(['ev-build-home', 'ev-month', 'ev-arrival', 'ev-shop'], 0), ['ev-build-home', 'ev-month', 'ev-arrival']);
  assert.deepEqual(limiter.admit(['ev-build-home', 'jingle-level'], 100), ['jingle-level'], 'same cue within the gap and a full second are held back');
  assert.deepEqual(limiter.admit(['ev-build-home'], 1200), ['ev-build-home']);
  assert.deepEqual(limiter.admit(['jingle-win'], 1210), ['jingle-win']);
  const busy = new CueLimiter(3, 900);
  assert.deepEqual(busy.admit(['ev-build-home', 'ev-arrival', 'ev-issue'], 0), ['ev-build-home', 'ev-arrival', 'ev-issue']);
  assert.deepEqual(busy.admit(['ev-month'], 100), ['ev-month'], 'month end still plays when the second is already full');
  assert.deepEqual(busy.admit(['ev-month'], 200), [], 'the same coin still waits out its gap');
  busy.reset();
  assert.deepEqual(busy.admit(['ev-month'], 200), ['ev-month'], 'a loaded city starts with a clear limiter');
});
