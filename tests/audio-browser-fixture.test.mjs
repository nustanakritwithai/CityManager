import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { createCity, serialize, step } from '../src/sim.ts';
import { audioProbeScript } from './audio-browser-fixture.mjs';
import { createTrafficServerFixture, loadedTrafficSession } from './traffic-server-entry-fixture.mjs';

test('audio probe preserves real constructor and play behavior while counting both', async () => {
  class Context { constructor(value) { this.value = value; } }
  class Media { play(value) { return value; } }
  class Storage { setItem(key, value) { this[key] = value; } removeItem(key) { delete this[key]; } }
  const sandbox = { window: { AudioContext: Context }, HTMLMediaElement: Media, Storage };
  vm.runInNewContext(audioProbeScript, sandbox);
  assert.equal(sandbox.window.__audioProbe.contexts, 0); assert.equal(sandbox.window.__audioProbe.plays, 0); assert.equal(sandbox.window.__audioProbe.preferenceWrites, 0);
  const audio = new sandbox.window.AudioContext(42); assert(audio instanceof Context); assert.equal(audio.value, 42);
  assert.equal(new Media().play('playing'), 'playing');
  assert.equal(sandbox.window.__audioProbe.contexts, 1); assert.equal(sandbox.window.__audioProbe.plays, 1);
  const storage = new Storage(); storage.setItem('other', 'untouched'); storage.setItem('citymanager.audio.v1', 'fixture');
  assert.equal(storage['other'], 'untouched'); assert.equal(storage['citymanager.audio.v1'], 'fixture');
  storage.removeItem('citymanager.audio.v1'); assert.equal(storage['citymanager.audio.v1'], undefined);
  assert.equal(sandbox.window.__audioProbe.preferenceWrites, 2);
});

test('audio city fixture uses exact real service revision and validates legacy expansion', async () => {
  const city = createCity(61025); for (let i = 0; i < 58; i++) step(city);
  const raw = serialize(city), fixture = createTrafficServerFixture('http://127.0.0.1:4173/CityManager/');
  const ack = await fixture.seed(raw); assert.equal(ack.raw, raw); assert.equal(ack.revision, 1);
  const live = loadedTrafficSession(raw).city; assert.equal(city.cells.length, 576); assert.equal(live.cells.length, 672);
  assert.deepEqual(live.cells.slice(0, 576), city.cells); assert.deepEqual(live.resources.fertility.slice(0, 576), city.resources.fertility);
  const response = [];
  const handled = await fixture.intercept({requestId:'save',request:{url:'http://127.0.0.1:4173/citymanager-api/v1/city-save',method:'POST',headers:{'Idempotency-Key':randomUUID()},postData:JSON.stringify({action:'save',cityId:ack.cityId,expectedRevision:1,raw,metadata:ack.metadata})}},async(method,params)=>response.push({method,params}));
  assert.equal(handled,true); assert.equal(response[0].params.responseCode,200); assert.equal(fixture.active.raw,raw); assert.equal(fixture.active.revision,2);
});


test('audio fence denies same-origin providers and external hosts before game entry', async () => {
  const {trafficNetworkRules} = await import('./traffic-server-entry-fixture.mjs');
  const {panelProviderDenials} = await import('./panel-network-denies.mjs');
  const origin = 'http://127.0.0.1:4173', rules = trafficNetworkRules(origin, false, [...panelProviderDenials(origin), origin + '/api/city-advisor/*', origin + '/*/api/city-advisor/*']);
  const decision = url => rules.find(rule => new URLPattern(rule.urlPattern).test(url))?.block;
  for (const path of ['/api/city-advisor/report', '/CityManager/api/city-advisor/report', '/x/y/api/city-advisor/report?q=1', '/api/city-advisor/other', '/x/y/api/city-advisor/other', '/chat/completions', '/CityManager/chat/completions', '/x/y/chat/completions?q=1']) assert.equal(decision(origin + path), true, path);
  assert.equal(decision(origin + '/citymanager-api/v1/city-save'), false);
  assert.equal(decision(origin + '/CityManager/assets/audio/effect.mp3'), false);
  assert.equal(decision('https://example.com/chat/completions'), true);
  const {readFile} = await import('node:fs/promises');
  const source = await readFile(new URL('./audio-smoke.mjs', import.meta.url), 'utf8');
  for (const text of ['installTrafficNetworkFence({', '...panelProviderDenials(origin), origin + \'/api/city-advisor/*\'', 'Network.requestWillBeSent', 'isPanelProviderRequest(requested)', 'Network.loadingFailed', 'assert.deepEqual(externalRequests, []', 'assert.deepEqual(providerRequests, []', 'window.__audioProbe', 'server.assertNoCityWrites(evaluate)']) assert.ok(source.includes(text), text);
  assert(source.indexOf('await installTrafficNetworkFence({') < source.indexOf("await send('Page.addScriptToEvaluateOnNewDocument'"), 'The fence is installed before audio instrumentation and guest entry');
});
