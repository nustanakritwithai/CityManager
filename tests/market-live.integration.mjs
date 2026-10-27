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
function cityFixture(emptyMarket = false, full = false, seed = 61025) { const c = createCity(seed, { starter: true }); for (let i = 0; i < 360 && (full || !c.firms.some(f => isMarket(f) && f.cropInventory > 0)); i++) step(c); const firm = c.firms.find(f => isMarket(f) && f.cropInventory > 0); assert.ok(firm, 'real simulation must produce a stocked market firm'); if (emptyMarket) for (const f of c.firms.filter(isMarket)) assert.equal(writeOffCrops(c, f, {}), true); return c; }
function prepareProduct(c, item) { const key = item.slice(8), recipe = { 'milled-rice': 'rice-mill', 'canned-food': 'cannery', sugar: 'sugar-mill' }[key]; const retail = c.firms.find(f => f.commercialKind === 'retail' && f.products[key] > 0), factory = c.firms.find(f => f.zone === 'I' && f.recipe === recipe); assert.ok(retail && factory, `real engine product fixture for ${item}`); retail.products[key]--; retail.inventory--; factory.products[key]++; factory.inventory++; c.goodsLedger.push({ tick: c.tick, from: retail.wallet, to: factory.wallet, quantity: 1, reason: 'Wholesale stock delivery', product: key }); return factory; }

try {
  const sellerStore = new Storage(), buyerStore = new Storage(), productBuyerStore = new Storage();
  const sellerCity = cityFixture(false, true), buyerCity = cityFixture(false, false), productBuyerCity = cityFixture(false, true);
  const seller = new MarketClient(() => sellerCity, base), buyer = new MarketClient(() => buyerCity, base), productBuyer = new MarketClient(() => productBuyerCity, base);
  const sellerGuest = await as(sellerStore, () => seller.createGuest());
  const buyerGuest = await as(buyerStore, () => buyer.createGuest());
  const productBuyerGuest = await as(productBuyerStore, () => productBuyer.createGuest());
  assert.notEqual(sellerGuest.guest_id, buyerGuest.guest_id); assert.notEqual(buyerGuest.guest_id, productBuyerGuest.guest_id);
  await fixture(sellerStore); await fixture(buyerStore); await fixture(productBuyerStore);
  const sellerMarket = sellerCity.firms.find(isMarket); const sellerFarm = sellerCity.firms.find(f => f.zone === 'F' && f.crops.rice > 0); assert.ok(sellerMarket && sellerFarm);
  const beforeStock = sellerFarm.crops.rice;
  const saveSeller = () => { const round = deserialize(serialize(sellerCity, seller.exportSave())); assert.equal(round.market?.version, 10); };
  dropPath = '/v1/deposits';
  await assert.rejects(as(sellerStore, () => seller.deposit(sellerFarm.id, 'crop:rice', 1, saveSeller)), /test-response-dropped/);
  const depositOp = seller.exportSave().operations.find(o => o.kind === 'deposit' && o.state === 'pending'); assert.ok(depositOp);
  await as(sellerStore, () => seller.recoverDeposit(depositOp.opId, saveSeller));
  assert.equal(sellerFarm.crops.rice, beforeStock - 1);
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
  const productSource = prepareProduct(sellerCity, 'product:milled-rice'); prepareProduct(productBuyerCity, 'product:milled-rice');
  await as(sellerStore, () => seller.deposit(productSource.id, 'product:milled-rice', 1, saveSeller));
  const productListing = await as(sellerStore, () => seller.list('product:milled-rice', 11, 1));
  const saveProductBuyer = () => { const raw = serialize(productBuyerCity, productBuyer.exportSave()); const loaded = deserialize(raw); assert.equal(loaded.market?.version, 10); };
  const productRow = (await as(productBuyerStore, () => productBuyer.listings())).find(x => x.id === productListing.id); assert.ok(productRow);
  const productPurchase = await as(productBuyerStore, () => productBuyer.buy(productRow.id, 1));
  const productReceipt = (await as(productBuyerStore, () => productBuyer.receipts())).find(x => x.operation_id === productPurchase.operation_id); assert.ok(productReceipt);
  await as(productBuyerStore, () => productBuyer.claim(productReceipt.receipt_id));
  await as(productBuyerStore, () => productBuyer.applyAndAck(productReceipt, saveProductBuyer));
  const saved = deserialize(serialize(productBuyerCity, productBuyer.exportSave())); assert.equal(saved.market?.rulesVersion, 'chain-5');
  const matrix = [{ item: 'crop:vegetables', seed: 17 }, { item: 'crop:sugarcane', seed: 206 }, { item: 'product:canned-food', seed: 17 }, { item: 'product:sugar', seed: 206 }];
  const seller17Store = new Storage(), seller206Store = new Storage(), product17Store = new Storage(), product206Store = new Storage(), seller17City = cityFixture(false, true, 17), seller206City = cityFixture(false, true, 206), product17City = cityFixture(false, true, 17), product206City = cityFixture(false, true, 206);
  const seller17 = new MarketClient(() => seller17City, base), seller206 = new MarketClient(() => seller206City, base), product17 = new MarketClient(() => product17City, base), product206 = new MarketClient(() => product206City, base);
  await as(seller17Store, () => seller17.createGuest()); await as(seller206Store, () => seller206.createGuest()); await as(product17Store, () => product17.createGuest()); await as(product206Store, () => product206.createGuest()); await fixture(seller17Store); await fixture(seller206Store); await fixture(product17Store); await fixture(product206Store);
  const testedItems = ['crop:rice', 'product:milled-rice'];
  for (const { item } of matrix) {
    const buyer2 = item === 'crop:vegetables' || item.includes('canned-food') ? product17 : item === 'crop:sugarcane' || item.includes('product:sugar') ? product206 : buyer, buyerStore2 = item === 'crop:vegetables' || item.includes('canned-food') ? product17Store : item === 'crop:sugarcane' || item.includes('product:sugar') ? product206Store : buyerStore, buyerCity2 = item === 'crop:vegetables' || item.includes('canned-food') ? product17City : item === 'crop:sugarcane' || item.includes('product:sugar') ? product206City : buyerCity;
    const seller2 = item.includes('vegetables') || item.includes('canned-food') ? seller17 : seller206, sellerStore2 = item.includes('vegetables') || item.includes('canned-food') ? seller17Store : seller206Store, sellerCity2 = item.includes('vegetables') || item.includes('canned-food') ? seller17City : seller206City;
    const key = item.slice(item.indexOf(':') + 1), source = item.startsWith('crop:') ? sellerCity2.firms.find(f => f.zone === 'F' && f.crops[key] > 0) : prepareProduct(sellerCity2, item); assert.ok(source, `real simulation source for ${item}`);
    if (item.startsWith('product:')) prepareProduct(buyerCity2, item);
    const saveBuyer2 = () => deserialize(serialize(buyerCity2, buyer2.exportSave()));
    const saveSeller2 = () => deserialize(serialize(sellerCity2, seller2.exportSave()));
    await as(sellerStore2, () => seller2.deposit(source.id, item, 1, saveSeller2)); const listed = await as(sellerStore2, () => seller2.list(item, 13, 1)); const visible = (await as(buyerStore2, () => buyer2.listings())).find(x => x.id === listed.id); assert.ok(visible);
    const bought = await as(buyerStore2, () => buyer2.buy(visible.id, 1)); const delivered = (await as(buyerStore2, () => buyer2.receipts())).find(x => x.operation_id === bought.operation_id); assert.ok(delivered); await as(buyerStore2, () => buyer2.claim(delivered.receipt_id)); console.log('matrix-item', item); await as(buyerStore2, () => buyer2.applyAndAck(delivered, saveBuyer2));
    if (item.startsWith('crop:') && item !== 'crop:rice') { const appliedFirm = buyerCity2.firms.find(f => f.id === buyer2.journal.receipts[delivered.receipt_id].firmId); assert.equal(appliedFirm?.zone, 'I', `matching factory receipt destination for ${item}`); }
    assert.equal(deserialize(serialize(buyerCity2, buyer2.exportSave())).market?.version, 10); testedItems.push(item);
  }
  console.log(JSON.stringify({ suite: 'market-live-node-e2e', server: 'real-http-postgresql', guests: 7, canonicalItems: 6, testedItems, flow: ['guest-create', 'typed-deposit', 'deposit-recover-after-response-drop', 'listing-retry-after-response-drop', 'buy-retry-after-response-drop', 'claim', 'typed-apply', 'ack', 'v10-save-reload'], assertions: 'passed', policyFixtureMode: true, productionPolicyDefault: false }));
} finally { server.kill(); }
