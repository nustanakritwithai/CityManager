import { panelProviderDenials, isPanelProviderRequest } from './panel-network-denies.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { deserialize, serialize, adoptSavedEducation, expandValidatedCity } from '../src/sim.ts';
import { loadedTrafficSession, trafficNetworkRules } from './traffic-server-entry-fixture.mjs';
import { createFeedbackServerFixture } from './player-feedback-server-fixture.mjs';
import { readStoredCity, saveStoredCity, SAVE_KEY, LEGACY_SAVE_KEY, HOUSEHOLD_SAVE_KEY, HOUSEHOLD_BACKUP_KEY } from '../src/save-storage.ts';
const v1 = await readFile(new URL('./fixtures/legacy-v1-day65.json', import.meta.url), 'utf8');
const v2 = await readFile(new URL('./fixtures/legacy-v2-day65.json', import.meta.url), 'utf8');
const url = 'http://127.0.0.1:4173/CityManager/';
const request = body => ({ requestId: randomUUID(), request: { url: 'http://127.0.0.1:4173/citymanager-api/v1/city-save', method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, postData: JSON.stringify(body) } });

test('frozen worker saves survive exact server ACK and full session expansion', async () => {
  for (const raw of [v1, v2]) {
    const source = deserialize(raw); adoptSavedEducation(source); const expected = expandValidatedCity(source);
    const loaded = loadedTrafficSession(raw).city; adoptSavedEducation(loaded); assert.deepEqual(loaded, expected);
    // v1's old household shape lacks members; fixture metadata requires the validated migrated form.
    const serverRaw = raw === v1 ? serialize(expected) : raw;
    const service = createFeedbackServerFixture(url), ack = await service.core.seed(serverRaw);
    assert.equal(ack.raw, serverRaw); assert.equal(ack.revision, 1); assert.equal(service.active.raw, serverRaw);
    service.setFault(true); const messages = [];
    const command = { action: 'save', cityId: ack.cityId, expectedRevision: 1, raw: serverRaw, metadata: ack.metadata };
    await service.intercept(request(command), async (method, params) => messages.push({method,params}));
    assert.equal(messages[0].params.responseCode, 503); assert.deepEqual(service.active, ack);
    service.setFault(false);
    const success = []; await service.intercept(request(command), async (method, params) => success.push({method,params}));
    assert.equal(success[0].params.responseCode, 200); const saved = service.active; assert.equal(saved.revision, 2);
    const conflicts = []; await assert.rejects(service.core.intercept(request(command), async (method, params) => conflicts.push({method,params})), /Unexpected rejected traffic save/);
    assert.equal(conflicts[0].params.responseCode, 409); assert.equal(JSON.parse(Buffer.from(conflicts[0].params.body, 'base64')).error, 'save-conflict');
    assert.deepEqual(service.active, saved, 'Stale positive revision never changes the acknowledged head');
  }
});

test('historical local-backup codec retains frozen originals, deduplicates and refuses quota or corrupt-primary fallback', () => {
  const data = new Map([[LEGACY_SAVE_KEY, v1], [HOUSEHOLD_SAVE_KEY, v2], [SAVE_KEY, 'previous']]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const migrated = JSON.stringify({ ...deserialize(v2), version: 9, rulesVersion: 'chain-4' });
  const blocked = { getItem: storage.getItem, setItem: (key, value) => { if (key === HOUSEHOLD_BACKUP_KEY) throw Error('quota'); storage.setItem(key, value); } };
  assert.throws(() => saveStoredCity(blocked, migrated, v2), /quota/); assert.equal(data.get(SAVE_KEY), 'previous');
  saveStoredCity(storage, migrated, v2); assert.equal(data.get(LEGACY_SAVE_KEY), v1); assert.equal(data.get(HOUSEHOLD_SAVE_KEY), v2); assert.equal(data.get(HOUSEHOLD_BACKUP_KEY), v2);
  const count = data.size; saveStoredCity(storage, migrated, v2); assert.equal(data.size, count);
  data.set(SAVE_KEY, '{broken'); assert.equal(readStoredCity(storage).raw, '{broken'); assert.equal(readStoredCity(storage, 'backup').raw, v2);
});


test('worker runner uses a strict fence, per-document audit and observed save/reload chain', async () => {
  const source = await readFile(new URL('./worker-smoke.mjs', import.meta.url), 'utf8');
  for (const text of ['installTrafficNetworkFence', 'modelAudit.begin()', 'modelAudit.verify(modelBefore)', 'modelAudit.assertComplete()', 'assertNavigationSaveChain', 'chain.lifecycleSaves > 0', 'core.navigationEvidence.at(-1).beforeRevision', 'server.active.cityId, saved.cityId', 'assert.deepEqual(externalRequests, [])', 'isPanelProviderRequest(requested)', 'providerRequests.push(requested)', 'assert.deepEqual(providerRequests, [],', '...panelProviderDenials(origin)']) assert.ok(source.includes(text), text);
  assert.doesNotMatch(source, /Fetch\.enable|Fetch\.requestPaused/);
  const origin = new URL(url).origin, deny = [...panelProviderDenials(origin), origin + '/api/city-advisor/*', origin + '/*/api/city-advisor/*'];
  const rules = trafficNetworkRules(origin, false, deny), decision = target => rules.find(rule => new URLPattern(rule.urlPattern).test(target))?.block;
  for (const path of ['/api/city-advisor/report', '/CityManager/api/city-advisor/report', '/chat/completions', '/x/chat/completions']) assert.equal(decision(origin + path), true);
  for (const path of ['/api/city-advisor/report', '/CityManager/api/city-advisor/report', '/chat/completions', '/x/chat/completions', '/api/city-advisor/other']) assert.equal(isPanelProviderRequest(origin + path), true, path);
  assert.equal(isPanelProviderRequest('https://provider.example/chat/completions'), true); assert.equal(isPanelProviderRequest(origin + '/citymanager-api/v1/city-save'), false);
  assert.equal(decision(origin + '/citymanager-api/v1/city-save'), false); assert.equal(decision('https://example.com/'), true);
});
