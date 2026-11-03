import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createCity, deserialize, expandValidatedCity, serialize, step, adoptSavedEducation, isMarket, isRetail } from '../src/sim.ts';
import { createCity as createV4, step as stepV4, serialize as serializeV4 } from '../src/legacy-v4.ts';
import { createTrafficServerFixture, loadedTrafficSession, trafficNetworkRules } from './traffic-server-entry-fixture.mjs';
import { panelProviderDenials, isPanelProviderRequest } from './panel-network-denies.mjs';

const url = 'http://127.0.0.1:4173/CityManager/';
const request = (method, command) => ({ requestId: randomUUID(), request: { url: 'http://127.0.0.1:4173/citymanager-api/v1/city-save', method, headers: { 'Idempotency-Key': randomUUID() }, ...(command ? { postData: JSON.stringify(command) } : {}) } });
const decode = payload => JSON.parse(Buffer.from(payload.body, 'base64').toString());

for (const [name, makeRaw] of [
  ['submenus empty', () => serialize(createCity(61025))],
  ['submenus historical v1', () => {
    const raw = readFileSync(new URL('./fixtures/legacy-v1-day65.json', import.meta.url), 'utf8');
    assert.equal(createHash('sha256').update(raw).digest('hex'), '4e358e66acdfb55dcfd434aaf67be51ccea99c69fc5a2b9b44343035c16166d0');
    const old = JSON.parse(raw), city = deserialize(raw);
    for (const key of ['accounts','ledger','goodsLedger','goods']) assert.deepEqual(city[key], old[key]);
    for (const key of ['seed','rng','tick','nextId']) assert.equal(city[key], old[key]);
    return serialize(city);
  }],
  ['building cards historical v4 replay', () => {
    const old = createV4(61025); for (let d = 0; d < 29; d++) stepV4(old);
    const city = deserialize(serializeV4(old));
    assert.ok(city.firms.some(isMarket) && city.firms.some(isRetail), 'both historical commercial roles remain testable');
    return serialize(city);
  }],
] ) test(`${name}: real service ACK, revision and reload`, async () => {
  const raw = makeRaw(), server = createTrafficServerFixture(url), ack = await server.seed(raw), sent = [];
  const send = async (_method, payload) => sent.push(payload);
  assert.equal(ack.raw, raw); assert.equal(ack.revision, 1); server.assertDurable(raw, 1);
  await server.intercept(request('GET'), send); assert.deepEqual(decode(sent.at(-1)), ack);
  const loaded = loadedTrafficSession(raw).city, expected = deserialize(raw);
  const expanded = expandValidatedCity(expected); if (!expanded.education) adoptSavedEducation(expanded);
  if (!loaded.education) adoptSavedEducation(loaded);
  assert.deepEqual(loaded, expanded); assert.equal(loaded.cells.length, 672);
  const save = request('POST', { action: 'save', cityId: ack.cityId, expectedRevision: 1, raw, metadata: ack.metadata });
  await server.intercept(save, send); const saved = decode(sent.at(-1));
  assert.equal(saved.revision, 2); assert.equal(saved.raw, raw); server.assertDurable(raw, 2);
  await server.intercept(save, send); assert.equal(server.active.revision, 2, 'idempotent retry cannot create an extra revision');
  await server.intercept(request('GET'), send); assert.deepEqual(decode(sent.at(-1)), server.active, 'reload reads the exact acknowledged head');
  const conflict = request('POST', { action: 'save', cityId: ack.cityId, expectedRevision: 1, raw, metadata: ack.metadata });
  await assert.rejects(server.intercept(conflict, send), /Unexpected rejected traffic save/); server.assertDurable(raw, 2);
  await server.assertNoCityWrites(async expression => expression === 'window.__panelCityWrites' ? [] : null);
});

test('migrated panel scripts keep native UI coverage without local city seed or Load', () => {
  const submenu = readFileSync(new URL('./submenus-smoke.mjs', import.meta.url), 'utf8');
  const cards = readFileSync(new URL('./building-cards-smoke.mjs', import.meta.url), 'utf8');
  for (const source of [submenu, cards]) {
    assert.match(source, /startTrafficHttpFixture/); assert.match(source, /installTrafficNetworkFence/); assert.doesNotMatch(source, /Fetch\.enable|Fetch\.requestPaused/); assert.match(source, /server\.seed\(raw\)/); assert.match(source, /server\.enter\(\{\s*evaluate,\s*button\s*\}\)/);
    assert.match(source, /server\.assertDurable/); assert.match(source, /server\.assertNoCityWrites/);
    assert.doesNotMatch(source, /localStorage\.setItem|button\(['"]#load['"]\)/);
    assert.match(source, /window\.cityManager\.snapshot\(\)/); assert.match(source, /elementFromPoint/);
  }
  assert.match(submenu, /expectedErrors:expected/); assert.match(submenu, /const before=modelAudit\.begin\(\)/); assert.match(submenu, /await modelAudit\.verify\(before\)/);
  assert.match(cards, /createPanelModelAudit\(\{blocked,expectedErrors,evaluate,sleep\}\)/);
  for (const source of [submenu,cards]) { assert.match(source, /additionalBlocked:panelProviderDenials\(new URL\(url\)\.origin\)/, 'The tested deny rules are wired to each real fence'); assert.match(source, /isPanelProviderRequest\(u\)/); assert.match(source, /providerRequests/); }
  for (const text of ['phone-goods-empty.png', 'phone-${kind}.png', 'phone-wallets.png', 'phone-guide.png', 'phone-assumptions.png', 'desktop-money.png']) assert.ok(submenu.includes(text), text);
  for (const text of ['cards-household.png', 'cards-phone-market.png', 'cards-phone-household.png', 'data-factory-recipe-picker', 'data-farm-crop-picker', 'data-owner-action']) assert.ok(cards.includes(text), text);
});

// Check first-match ordered CDP decisions for both root and nested app paths.
test('panel fence rejects same-origin provider calls before its origin allow rule', () => {
 const origin = new URL(url).origin, rules = trafficNetworkRules(origin, false, panelProviderDenials(origin));
 const decision = target => rules.find(rule => new URLPattern(rule.urlPattern).test(target))?.block;
 for (const path of ['/api/city-advisor/report','/CityManager/api/city-advisor/report','/x/y/api/city-advisor/report?q=1','/api/city-advisor/other','/CityManager/api/city-advisor/other','/x/y/api/city-advisor/other?q=1','/chat/completions','/CityManager/chat/completions','/x/y/chat/completions?q=1']) assert.equal(decision(origin + path), true, path);
 for(const path of ['/api/city-advisor/report','/api/city-advisor/other','/CityManager/api/city-advisor/other','/x/y/api/city-advisor/other?q=1','/chat/completions','/CityManager/chat/completions']) assert.equal(isPanelProviderRequest(origin+path),true,path);
 assert.equal(isPanelProviderRequest(origin+'/CityManager/assets/game.js?q=/api/city-advisor/other'),false);
 assert.equal(decision(origin + '/citymanager-api/v1/city-save'), false);
 assert.equal(decision(origin + '/CityManager/assets/game.js'), false);
 assert.equal(decision('https://example.com/chat/completions'), true);
});

test('road and building QA fences deny and report provider attempts without relaxing their save contracts', () => {
 for (const name of ['roads-smoke.mjs','building-progression-smoke.mjs','building-issues-smoke.mjs']) {
  const source=readFileSync(new URL('./'+name,import.meta.url),'utf8');
  assert.match(source,/installTrafficNetworkFence\(/,name);
  assert.match(source,/additionalBlocked:panelProviderDenials\((?:allowed|origin)\.origin\)/,name);
  assert.match(source,/Network\.requestWillBeSent/,name);
  assert.match(source,/Network\.loadingFailed/,name);
  assert.match(source,/isPanelProviderRequest\(u\)/,name);
  assert.match(source,/providerRequests\.push\(u\)/,name);
  assert.match(source,/assert\.deepEqual\(providerRequests,\s*\[\]/,name);
  assert.match(source,/assertNoCityWrites\(evaluate\)/,name);
  assert.match(source,/ack\.raw\s*,\s*raw/,name);
  assert.match(source,/ack\.revision\s*,\s*1/,name);
 }
 const issues=readFileSync(new URL('./building-issues-smoke.mjs',import.meta.url),'utf8');
 assert.match(issues,/Fetch\.failRequest/,'Legacy interception has an additional provider fail-closed check');
 assert.match(issues,/panelServer\.active\.revision,\s*ack\.revision/,'Read-only issue UI cannot create saves');
});
