import assert from 'node:assert/strict';
import test from 'node:test';
import { MarketClient, marketJournalForTest, MARKET_RULES } from '../src/market-client.ts';
import { mergeMarketListings } from '../src/market-panel.ts';
import { createCity, deserialize, serialize } from '../src/sim.ts';

test('market journal starts at v10/chain-5 and has no guest token field', () => {
  const j = marketJournalForTest(null);
  assert.equal(j.version, 10);
  assert.equal(j.rulesVersion, MARKET_RULES);
  assert.equal(j.guestId, null);
  assert.deepEqual(j.operations, []);
});

test('public same-origin test route is opt-in and exact, while arbitrary remote URLs stay disabled', () => {
  const city = createCity(1, { starter: false });
  assert.equal(new MarketClient(() => city, '/citymanager-api/').enabled, true);
  assert.equal(new MarketClient(() => city, '/other-api').enabled, false);
  assert.equal(new MarketClient(() => city, 'https://example.invalid').enabled, false);
});

test('client projection keeps closed owner tombstones for stale-duplicate suppression', async () => {
  const store = new Map<string, string>(); Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } });
  const originalFetch = globalThis.fetch; globalThis.fetch = async () => new Response(JSON.stringify([{ id: 'same', item_code: 'crop:rice', unit_price: 10, quantity: 1, status: 'cancelled' }, { id: 'open', item_code: 'crop:rice', unit_price: 10, quantity: 1, status: 'open' }]), { status: 200, headers: { 'content-type': 'application/json' } });
  try { const client = new MarketClient(() => createCity(1, { starter: false }), 'http://127.0.0.1:4317'); const rows = await client.myListings(); assert.deepEqual(rows.map(row => row.id), ['open']); assert.deepEqual((rows as typeof rows & { allRows: typeof rows }).allRows.map(row => row.id), ['same', 'open']); assert.deepEqual(mergeMarketListings([{ id: 'same', item_code: 'crop:rice', unit_price: 10, quantity: 1, status: 'open' }], rows).map(row => row.id), ['open']); } finally { globalThis.fetch = originalFetch; }
});

test('market journal rejects malformed or unknown operation records', () => {
  assert.throws(() => marketJournalForTest(JSON.stringify({ version: 9, rulesVersion: 'chain-4', operations: [], receipts: {} })));
  assert.throws(() => marketJournalForTest(JSON.stringify({ version: 10, rulesVersion: 'chain-5', cityId: '00000000-0000-4000-8000-000000000001', operations: [{ opId: '00000000-0000-4000-8000-000000000002', guestId: '00000000-0000-4000-8000-000000000003', cityId: '00000000-0000-4000-8000-000000000001', kind: 'unknown', state: 'pending', payload: {}, createdAt: '2026-10-27T00:00:00.000Z' }], receipts: {}, seq: '0' })));
});

test('market journal preserves unrelated fields only through explicit schema', () => {
  const j = marketJournalForTest(JSON.stringify({ version: 10, rulesVersion: 'chain-5', cityId: '00000000-0000-4000-8000-000000000001', guestId: '00000000-0000-4000-8000-000000000003', operations: [{ opId: '00000000-0000-4000-8000-000000000002', guestId: '00000000-0000-4000-8000-000000000003', cityId: '00000000-0000-4000-8000-000000000001', kind: 'buy', payload: { listing_id: 'l', quantity: 1 }, state: 'pending', createdAt: '2026-10-27T00:00:00.000Z' }], escrow: [], receipts: {}, seq: '4' }));
  assert.equal(j.guestId, '00000000-0000-4000-8000-000000000003');
  assert.equal(j.operations[0].state, 'pending');
  assert.equal(j.seq, '4');
});

test('city save v11 envelope round-trips market journal without putting cookies in the city', () => {
  const city = createCity(61025, { starter: false });
  const market = marketJournalForTest(null);
  const raw = serialize(city, market);
  const parsed = JSON.parse(raw);
  assert.equal(parsed.version, 11);
  assert.equal(parsed.rulesVersion, 'chain-6');
  assert.equal(parsed.market.cityId, market.cityId);
  assert.equal('cm_guest' in parsed, false);
  const loaded = deserialize(raw);
  assert.equal(loaded.market?.version, 10);
  assert.equal(loaded.market?.rulesVersion, 'chain-5');
  const offlineResave = deserialize(serialize(loaded, loaded.market));
  assert.deepEqual(offlineResave.market, loaded.market, 'offline save preserves the existing market journal');
});

test('deposit reserves typed firm stock before the request and confirms server escrow before saving', async () => {
  const city = createCity(61025, { starter: false });
  city.buildings.push({ id: 1, cell: 0, zone: 'F', level: 1, age: 0 });
  city.firms.push({ id: 2, building: 1, zone: 'F', crops: { rice: 4, vegetables: 0, sugarcane: 0 }, products: { 'milled-rice': 0, 'canned-food': 0, sugar: 0 }, wallet: 'firm:2', workDays: {}, inventory: 0, cropInventory: 4, cropCost: 0, productionTick: 0, owner: null, profit: 0, lastMonthProfit: 0, monthlyRevenue: 0, monthlyExpense: 0 });
  const store = new Map<string, string>(); Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } }); Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: 'cm_csrf=test' } });
  const originalFetch = globalThis.fetch; globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => { if (String(input).endsWith('/v1/me')) return new Response('{}', { status: 401 }); if (String(input).endsWith('/v1/auth/guest')) return new Response(JSON.stringify({ guest_id: '00000000-0000-4000-8000-000000000003' }), { status: 201, headers: { 'content-type': 'application/json' } }); assert.equal(JSON.parse(String(init?.body)).itemId, 'crop:rice'); return new Response(JSON.stringify({ state: 'done', seq: '1' }), { status: 201, headers: { 'content-type': 'application/json' } }); };
  try { const client = new MarketClient(() => city, 'http://127.0.0.1:4317'); await client.createGuest(); let saves = 0; await client.deposit(2, 'crop:rice', 2, () => { saves++; const raw = serialize(city, client.exportSave()); assert.equal(JSON.parse(raw).version, 11); }); assert.equal(city.firms[0].crops.rice, 2); assert.equal(client.journal.escrow[0].state, 'confirmed'); assert.ok(saves >= 2); } finally { globalThis.fetch = originalFetch; }
});

test('committed deposit response loss reconciles done without subtracting stock twice', async () => {
  const city = createCity(61025, { starter: false }); city.buildings.push({ id: 1, cell: 0, zone: 'F', level: 1, age: 0 }); city.firms.push({ id: 2, building: 1, zone: 'F', crops: { rice: 4, vegetables: 0, sugarcane: 0 }, products: { 'milled-rice': 0, 'canned-food': 0, sugar: 0 }, wallet: 'firm:2', workDays: {}, inventory: 0, cropInventory: 4, cropCost: 0, productionTick: 0, owner: null, profit: 0, lastMonthProfit: 0, monthlyRevenue: 0, monthlyExpense: 0 });
  const store = new Map<string, string>(); Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } }); Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: 'cm_csrf=test' } });
  const originalFetch = globalThis.fetch; let op = ''; let first = true; globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => { const url = String(input); if (url.endsWith('/v1/me')) return new Response('{}', { status: 401 }); if (url.endsWith('/v1/auth/guest')) return new Response(JSON.stringify({ guest_id: '00000000-0000-4000-8000-000000000003' }), { status: 201 }); if (url.endsWith('/v1/deposits')) { op = JSON.parse(String(init?.body)).opId; if (first) { first = false; throw new Error('response dropped after commit'); } return new Response(JSON.stringify({ state: 'done', seq: '1' }), { status: 201 }); } if (url.includes('/v1/op/')) return new Response(JSON.stringify({ state: 'done', opId: op, seq: '1' }), { status: 200 }); throw new Error('unexpected request'); };
  try { const client = new MarketClient(() => city, 'http://127.0.0.1:4317'); await client.createGuest(); await assert.rejects(client.deposit(2, 'crop:rice', 2, () => undefined)); assert.equal(city.firms[0].crops.rice, 2); await client.recoverDeposit(op, () => undefined); assert.equal(city.firms[0].crops.rice, 2); assert.equal(client.journal.escrow[0].state, 'confirmed'); } finally { globalThis.fetch = originalFetch; }
});

test('ACK recovery persists delivered state without reapplying city stock', async () => {
  const city = createCity(61025, { starter: false }); const store = new Map<string, string>(); Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } }); Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: 'cm_csrf=test' } });
  const originalFetch = globalThis.fetch; globalThis.fetch = async () => new Response(JSON.stringify({ state: 'delivered' }), { status: 200 });
  try { const client = new MarketClient(() => city, 'http://127.0.0.1:4317'); client.guestId = '00000000-0000-4000-8000-000000000003'; client.journal.guestId = client.guestId; const receipt = '00000000-0000-4000-8000-000000000004'; client.journal.receipts[receipt] = { claimId: '00000000-0000-4000-8000-000000000005', state: 'applied', firmId: 2, itemId: 'crop:rice', quantity: 1 }; await assert.rejects(client.recoverReceipt(receipt, () => undefined), /saved-city-recovery-required/); city.market = client.exportSave(); store.set('citymanager.save.v7', serialize(city, city.market)); await client.recoverReceipt(receipt, () => undefined); assert.equal(client.journal.receipts[receipt].state, 'delivered'); } finally { globalThis.fetch = originalFetch; }
});

test('claim, ACK and cancellation recover the original operation after a lost response and reload', async () => {
  const store = new Map<string, string>(); Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } }); Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: 'cm_csrf=test' } });
  const originalFetch = globalThis.fetch; const bodies = new Map<string, string[]>(); const first = new Set<string>();
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => { const url = String(input), body = String(init?.body ?? ''); const seen = bodies.get(url) ?? []; seen.push(body); bodies.set(url, seen); if (!first.has(url)) { first.add(url); throw new Error('response lost after commit'); } return new Response(JSON.stringify({ state: 'done' }), { status: 200 }); };
  try {
    const city = createCity(1, { starter: false }); const make = () => new MarketClient(() => city, 'http://127.0.0.1:4317'); let client = make(); client.guestId = '00000000-0000-4000-8000-000000000003'; client.journal.guestId = client.guestId;
    const receipt = '00000000-0000-4000-8000-000000000004', listing = '00000000-0000-4000-8000-000000000006';
    await assert.rejects(client.claim(receipt)); let op = client.journal.operations.find(o => o.kind === 'claim' && o.state === 'pending')!; const claimId = client.journal.receipts[receipt].claimId; await assert.rejects(client.buy(listing, 1), /operation-requires-reconciliation/); client = make(); assert.equal(client.journal.receipts[receipt].claimId, claimId); await assert.rejects(client.cancelListing(listing), /operation-requires-reconciliation/); await client.retry(op.opId); assert.equal(client.journal.operations.find(o => o.opId === op.opId)?.state, 'confirmed');
    Object.assign(client.journal.receipts[receipt], { state: 'applied', firmId: 2, itemId: 'crop:rice', quantity: 1 }); city.market = client.exportSave(); store.set('citymanager.save.v7', serialize(city, city.market)); await assert.rejects(client.ack(receipt)); op = client.journal.operations.find(o => o.kind === 'ack' && o.state === 'pending')!; client = make(); let saves = 0; await client.retry(op.opId, () => { saves++; }); assert.equal(saves, 1); assert.equal(client.journal.receipts[receipt].state, 'delivered');
    await assert.rejects(client.cancelListing(listing)); op = client.journal.operations.find(o => o.kind === 'cancel' && o.state === 'pending')!; client = make(); await client.retry(op.opId); assert.equal(client.journal.operations.find(o => o.opId === op.opId)?.state, 'confirmed');
    for (const seen of bodies.values()) { assert.equal(seen.length, 2); assert.equal(seen[0], seen[1]); }
  } finally { globalThis.fetch = originalFetch; }
});

test('repeated claim never downgrades an applied receipt or reapplies it', async () => {
  const store = new Map<string, string>(); Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } }); Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: 'cm_csrf=test' } });
  const originalFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('claim must not be sent after local apply'); };
  try { const client = new MarketClient(() => createCity(1, { starter: false }), 'http://127.0.0.1:4317'); const receipt = '00000000-0000-4000-8000-000000000006'; client.journal.receipts[receipt] = { claimId: '00000000-0000-4000-8000-000000000007', state: 'applied', firmId: 2, itemId: 'crop:rice', quantity: 1 }; const result = await client.claim(receipt); assert.deepEqual(result, { state: 'applied', idempotent: true }); assert.equal(client.journal.receipts[receipt].state, 'applied'); } finally { globalThis.fetch = originalFetch; }
});

test('receipt destinations enforce item type, capacity and explicit destination', async () => {
  const city = createCity(1, { starter: false });
  const emptyCrops = () => ({ rice: 0, vegetables: 0, sugarcane: 0 }); const emptyProducts = () => ({ 'milled-rice': 0, 'canned-food': 0, sugar: 0 });
  for (const [id, zone, commercialKind, recipe] of [[1, 'C', 'market', undefined], [2, 'I', undefined, 'rice-mill'], [3, 'I', undefined, 'sugar-mill'], [4, 'C', 'retail', undefined]] as const) { city.buildings.push({ id, cell: 0, zone, level: 1, age: 0 } as any); city.firms.push({ id, building: id, zone, commercialKind, recipe, crops: emptyCrops(), products: emptyProducts(), cropInventory: 0, cropCost: 0, inventory: 0, wallet: `firm:${id}` } as any); }
  const client = new MarketClient(() => city, 'http://127.0.0.1:4317'); client.guestId = '00000000-0000-4000-8000-000000000003'; client.journal.guestId = client.guestId;
  const receipt = { receipt_id: '00000000-0000-4000-8000-000000000004', item_code: 'crop:rice', quantity: 1 };
  assert.deepEqual(client.receiptDestinations(receipt).map(x => x.firmId), [1, 2]);
  assert.deepEqual(client.receiptDestinations({ ...receipt, item_code: 'product:sugar' }).map(x => x.firmId), [4]);
  city.firms[0].crops.rice = 48; assert.deepEqual(client.receiptDestinations(receipt).map(x => x.firmId), [2]);
  const claimId = '00000000-0000-4000-8000-000000000005'; client.journal.receipts[receipt.receipt_id] = { claimId, state: 'claimed' }; client.journal.operations.push({ opId: '00000000-0000-4000-8000-000000000006', guestId: client.guestId, cityId: client.journal.cityId, kind: 'claim', payload: { receipt_id: receipt.receipt_id, claim_id: claimId }, state: 'confirmed', createdAt: '2026-10-27T00:00:00.000Z' });
  const before = JSON.stringify(city); await assert.rejects(client.applyAndAck(receipt, () => undefined, 3), /no typed market firm capacity/); assert.equal(JSON.stringify(city), before);
});

test('resume rejects an unexplained server sequence jump even with an unrelated pending operation', async () => {
  const store = new Map<string, string>(); Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } }); Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: 'cm_csrf=test' } });
  const originalFetch = globalThis.fetch; globalThis.fetch = async (input: RequestInfo | URL) => String(input).endsWith('/v1/me') ? new Response(JSON.stringify({ guest_id: '00000000-0000-4000-8000-000000000003', seq: '5' }), { status: 200 }) : new Response(JSON.stringify({ state: 'done', seq: '2' }), { status: 200 });
  try { const client = new MarketClient(() => createCity(1, { starter: false }), 'http://127.0.0.1:4317'); client.guestId = '00000000-0000-4000-8000-000000000003'; client.journal.guestId = client.guestId; client.journal.seq = '1'; client.journal.operations.push({ opId: '00000000-0000-4000-8000-000000000008', guestId: client.guestId, cityId: client.journal.cityId, kind: 'buy', payload: { listing_id: 'l', quantity: 1 }, state: 'pending', createdAt: '2026-10-27T00:00:00.000Z' }); await assert.rejects(client.resume(), /sequence gap requires reconciliation/); assert.equal(client.journal.seq, '1'); } finally { globalThis.fetch = originalFetch; }
});

test('unknown deposit is fenced and restores exact stock once; done deposit never refunds', async () => {
  const city = createCity(61025, { starter: false }); city.buildings.push({ id: 1, cell: 0, zone: 'F', level: 1, age: 0 }); city.firms.push({ id: 2, building: 1, zone: 'F', crops: { rice: 4, vegetables: 0, sugarcane: 0 }, products: { 'milled-rice': 0, 'canned-food': 0, sugar: 0 }, wallet: 'firm:2', workDays: {}, inventory: 0, cropInventory: 4, cropCost: 0, productionTick: 0, owner: null, profit: 0, lastMonthProfit: 0, monthlyRevenue: 0, monthlyExpense: 0 });
  const store = new Map<string, string>(); Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } }); Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: 'cm_csrf=test' } });
  const originalFetch = globalThis.fetch; let op = ''; let cancelled = false; globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => { const url = String(input); if (url.endsWith('/v1/me')) return new Response('{}', { status: 401 }); if (url.endsWith('/v1/auth/guest')) return new Response(JSON.stringify({ guest_id: '00000000-0000-4000-8000-000000000003' }), { status: 201 }); if (url.endsWith('/v1/deposits')) { op = JSON.parse(String(init?.body)).opId; throw new Error('unknown response'); } if (url.endsWith(`/v1/op/${op}/cancel`)) { cancelled = true; return new Response(JSON.stringify({ state: 'cancelled', opId: op }), { status: 200 }); } if (url.endsWith(`/v1/op/${op}`)) return new Response(JSON.stringify({ state: cancelled ? 'cancelled' : 'unknown', opId: op }), { status: 200 }); throw new Error('unexpected request'); };
  try { const client = new MarketClient(() => city, 'http://127.0.0.1:4317'); await client.createGuest(); await assert.rejects(client.deposit(2, 'crop:rice', 2, () => undefined)); assert.equal(city.firms[0].crops.rice, 2); await assert.rejects(client.fenceDeposit(op, () => { throw new Error('save failed'); }), /save failed/); assert.equal(city.firms[0].crops.rice, 2); assert.equal(client.journal.escrow[0].state, 'pending'); await client.fenceDeposit(op, () => { const parsed = JSON.parse(serialize(city, client.exportSave())); assert.equal(parsed.version, 11); }); assert.equal(city.firms[0].crops.rice, 4); await assert.rejects(client.fenceDeposit(op)); } finally { globalThis.fetch = originalFetch; }
});

test('expired guest preserves its journal and receipts across a panel resume and retry', async () => {
  const store = new Map<string, string>(); Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } }); Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: 'cm_csrf=test' } });
  const originalFetch = globalThis.fetch; let expired = false, creates = 0; globalThis.fetch = async (input: RequestInfo | URL) => { if (String(input).endsWith('/v1/me')) return new Response(JSON.stringify(expired ? { error: 'expired' } : { guest_id: '00000000-0000-4000-8000-000000000003', seq: '0' }), { status: expired ? 401 : 200 }); creates++; throw new Error('unexpected guest creation'); };
  try { const client = new MarketClient(() => createCity(1, { starter: false }), 'http://127.0.0.1:4317'); const old = client.journal; old.guestId = '00000000-0000-4000-8000-000000000003'; old.operations.push({ opId: '00000000-0000-4000-8000-000000000002', guestId: old.guestId, cityId: old.cityId, kind: 'buy', payload: { listing_id: 'l', quantity: 1 }, state: 'confirmed', createdAt: '2026-10-27T00:00:00.000Z' }); old.receipts['00000000-0000-4000-8000-000000000004'] = { claimId: '00000000-0000-4000-8000-000000000005', state: 'applied', firmId: 2, itemId: 'crop:rice', quantity: 1 }; client.guestId = old.guestId; store.set('citymanager.market.v10', JSON.stringify(old)); await client.reconcileSession(await client.checkSession()); const before = store.get('citymanager.market.v10'); expired = true; await assert.rejects(client.resume(), (error: any) => error.status === 401); assert.equal(store.get('citymanager.market.v10'), before); assert.equal(client.guestId, old.guestId); assert.equal(client.journal.receipts['00000000-0000-4000-8000-000000000004'].state, 'applied'); expired = false; await client.resume(); assert.equal(store.get('citymanager.market.v10'), before); assert.equal(creates, 0); } finally { globalThis.fetch = originalFetch; }
});
