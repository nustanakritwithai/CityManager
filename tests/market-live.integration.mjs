import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createCity, deserialize, isMarket, serialize, step } from '../src/sim.ts';
import { writeOffCrops } from '../src/agriculture-runtime.ts';
import { MarketClient } from '../src/market-client.ts';

const marketRoot = new URL('../../', import.meta.url).pathname.replace(/^\//, '').replaceAll('/', '\\');
const secretPath = `${process.env.TEMP}\\citymanager-market-secrets\\DATABASE_URL`;
const databaseUrl = (await import('node:fs/promises')).readFile(secretPath, 'utf8').then(v => v.trim());
const port = 4317;
const base = 'http://127.0.0.1:4317';
const server = spawn(process.execPath, ['src/server.js'], { cwd: marketRoot, env: { ...process.env, DATABASE_URL: await databaseUrl, PORT: String(port), SANDBOX_FIXTURE_MODE: 'true', MARKET_ALLOW_DEPOSITS: 'true', NODE_ENV: 'integration' }, stdio: 'ignore' });

for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch {} await delay(100); if (i === 39) throw new Error('live market server did not start'); }

class Storage { constructor() { this.map = new Map(); } getItem(k) { return this.map.get(k) ?? null; } setItem(k, v) { this.map.set(k, String(v)); } removeItem(k) { this.map.delete(k); } }
const jars = new WeakMap();
let activeStorage = new Storage();
let dropPath = null;
globalThis.localStorage = activeStorage;
globalThis.document = { get cookie() { return jars.get(activeStorage) ?? ''; }, set cookie(v) { jars.set(activeStorage, v); } };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const jar = jars.get(activeStorage) ?? '';
  const headers = new Headers(init.headers);
  if (jar) headers.set('Cookie', jar);
  const response = await realFetch(url, { ...init, headers });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) {
    const next = new Map((jars.get(activeStorage) ?? '').split('; ').filter(Boolean).map(x => x.split('=')));
    for (const part of setCookie.split(/, (?=[^;,]+=)/)) { const [pair] = part.split(';'); const [k, ...rest] = pair.split('='); if (k) next.set(k, rest.join('=')); }
    jars.set(activeStorage, [...next].map(([k, v]) => `${k}=${v}`).join('; '));
  }
  if (dropPath && String(url).includes(dropPath)) { dropPath = null; await response.arrayBuffer(); throw new Error('test-response-dropped-after-commit'); }
  return response;
};

async function as(storage, fn) { const old = activeStorage; activeStorage = storage; globalThis.localStorage = storage; try { return await fn(); } finally { activeStorage = old; globalThis.localStorage = old; } }
async function fixture(storage) { return as(storage, async () => { const csrf = (jars.get(storage) ?? '').match(/(?:^|; )cm_csrf=([^;]+)/)?.[1] ?? ''; const r = await fetch(`${base}/v1/sandbox/fixture`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ fixture_version: 'fixture-v1' }) }); assert.equal(r.status, 200); return r.json(); }); }
function cityFixture(emptyMarket = false) { const c = createCity(61025, { starter: true }); for (let i = 0; i < 360 && !c.firms.some(f => isMarket(f) && f.cropInventory > 0); i++) step(c); const firm = c.firms.find(f => isMarket(f) && f.cropInventory > 0); assert.ok(firm, 'real simulation must produce a stocked market firm'); if (emptyMarket) for (const f of c.firms.filter(isMarket)) assert.equal(writeOffCrops(c, f, {}), true); return c; }

try {
  const sellerStore = new Storage(), buyerStore = new Storage();
  const sellerCity = cityFixture(), buyerCity = cityFixture(true);
  const seller = new MarketClient(() => sellerCity, base), buyer = new MarketClient(() => buyerCity, base);
  const sellerGuest = await as(sellerStore, () => seller.createGuest());
  const buyerGuest = await as(buyerStore, () => buyer.createGuest());
  assert.notEqual(sellerGuest.guest_id, buyerGuest.guest_id);
  await fixture(sellerStore); await fixture(buyerStore);
  const sellerMarket = sellerCity.firms.find(isMarket); assert.ok(sellerMarket);
  const beforeStock = sellerMarket.crops.rice;
  const saveSeller = () => { const round = deserialize(serialize(sellerCity, seller.exportSave())); assert.equal(round.market?.version, 10); };
  dropPath = '/v1/deposits';
  await assert.rejects(as(sellerStore, () => seller.deposit(sellerMarket.id, 'crop:rice', 1, saveSeller)), /test-response-dropped/);
  const depositOp = seller.exportSave().operations.find(o => o.kind === 'deposit' && o.state === 'pending'); assert.ok(depositOp);
  await as(sellerStore, () => seller.recoverDeposit(depositOp.opId, saveSeller));
  assert.equal(sellerMarket.crops.rice, beforeStock - 1);
  dropPath = '/v1/listings';
  await assert.rejects(as(sellerStore, () => seller.list('crop:rice', 10, 1)), /test-response-dropped/);
  const listingOp = seller.exportSave().operations.find(o => o.kind === 'listing' && o.state === 'pending'); assert.ok(listingOp);
  const listing = await as(sellerStore, () => seller.retry(listingOp.opId)); assert.equal(listing.quantity, 1);
  const rows = await as(buyerStore, () => buyer.listings()); const row = rows.find(x => x.id === listing.id); assert.ok(row);
  dropPath = `/v1/listings/${row.id}/buy`;
  await assert.rejects(as(buyerStore, () => buyer.buy(row.id, 1)), /test-response-dropped/);
  const buyOp = buyer.exportSave().operations.find(o => o.kind === 'buy' && o.state === 'pending'); assert.ok(buyOp);
  const purchase = await as(buyerStore, () => buyer.retry(buyOp.opId)); assert.equal(purchase.quantity, 1);
  const receipt = (await as(buyerStore, () => buyer.receipts())).find(x => x.operation_id === purchase.operation_id); assert.ok(receipt);
  await as(buyerStore, () => buyer.claim(receipt.receipt_id));
  const saveBuyer = () => { const raw = serialize(buyerCity, buyer.exportSave()); const loaded = deserialize(raw); assert.equal(loaded.market?.version, 10); };
  await as(buyerStore, () => buyer.applyAndAck(receipt, saveBuyer));
  const saved = deserialize(serialize(buyerCity, buyer.exportSave())); assert.equal(saved.market?.rulesVersion, 'chain-5');
  console.log(JSON.stringify({ suite: 'market-live-node-e2e', server: 'real-http-postgresql', guests: 2, canonicalItems: 6, flow: ['guest-create', 'typed-deposit', 'deposit-recover-after-response-drop', 'listing-retry-after-response-drop', 'buy-retry-after-response-drop', 'claim', 'typed-apply', 'ack', 'v10-save-reload'], assertions: 'passed', policyFixtureMode: true, productionPolicyDefault: false }));
} finally { server.kill(); }
