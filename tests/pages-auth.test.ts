import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKET_ORIGIN, PAGES_MARKET_BASE, PAGES_ORIGIN, PagesSession, pagesSession } from '../src/pages-auth.ts';
import { MarketClient, MARKET_SAVE_KEY } from '../src/market-client.ts';
import { createCity } from '../src/sim.ts';

const guest = '00000000-0000-4000-8000-000000000003', other = '00000000-0000-4000-8000-000000000004', code = 'c'.repeat(43), token = 't'.repeat(43);
class Host extends EventTarget {
  location = { origin: PAGES_ORIGIN }; messages: Array<{data: unknown; origin: string}> = []; popup = { closed: false, close() { this.closed = true; }, postMessage: (data: unknown, origin: string) => this.messages.push({data, origin}) }; blocked = false; url = '';
  open(url: string) { this.url = url; return this.blocked ? null : this.popup; }
  message(origin: string, source: unknown, data: unknown) { const event = new Event('message'); Object.defineProperties(event, { origin: { value: origin }, source: { value: source }, data: { value: data } }); this.dispatchEvent(event); }
}
async function harness(run: (host: Host, store: Map<string,string>) => Promise<void>) {
  const names = ['window', 'navigator', 'localStorage', 'document'] as const, previous = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name)), oldFetch = globalThis.fetch; const host = new Host(), store = new Map<string,string>();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: host }); Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (_n: string, _o: unknown, f: (v: object) => Promise<unknown>) => f({}) } } }); Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: '' } }); Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k,v) } });
  try { await run(host, store); } finally { pagesSession.clear(); globalThis.fetch = oldFetch; names.forEach((name, i) => previous[i] ? Object.defineProperty(globalThis, name, previous[i]!) : Reflect.deleteProperty(globalThis, name)); }
}
const send = (host: Host, state: string, source: unknown = host.popup, origin = MARKET_ORIGIN) => host.message(origin, source, { type: 'citymanager-auth-code', state, code });

test('one-click intent is sent only to the exact popup after a matching ready message', async () => {
  for (const expectedGuest of [guest, null]) await harness(async host => {
    const session = new PagesSession(); await session.prepare();
    globalThis.fetch = async () => new Response(JSON.stringify({ access_token: token, token_type: 'Bearer', expires_in: 900, guest_id: guest }), { status: 200 });
    const pending = session.connect(expectedGuest), login = new URL(host.url), state = login.searchParams.get('state')!;
    assert.equal(login.searchParams.get('auto'), '1');
    const ready = (origin: string, source: unknown, value: string) => host.message(origin, source, { type: 'citymanager-auth-ready', state: value });
    ready('https://evil.example', host.popup, state); ready(MARKET_ORIGIN, {}, state); ready(MARKET_ORIGIN, host.popup, 'wrong');
    assert.equal(host.messages.length, 0);
    ready(MARKET_ORIGIN, host.popup, state);
    assert.deepEqual(host.messages, [{ origin: MARKET_ORIGIN, data: { type: 'citymanager-auth-intent', state, expectedGuest } }]);
    send(host, state); assert.equal(await pending, guest);
  });
});

test('popup opens synchronously and accepts only matching origin, source, state and one code', async () => harness(async host => {
  const session = new PagesSession(); await session.prepare(); let calls = 0, verifier = ''; globalThis.fetch = async (url, init) => { calls++; assert.equal(String(url), `${PAGES_MARKET_BASE}/v1/pages/exchange`); assert.equal(init?.credentials, 'omit'); const b = JSON.parse(String(init?.body)); assert.equal(b.code, code); verifier = b.verifier; return new Response(JSON.stringify({ access_token: token, token_type: 'Bearer', expires_in: 900, guest_id: guest }), { status: 200 }); };
  const pending = session.connect(guest); assert.ok(host.url, 'popup must open before connect returns'); const login = new URL(host.url), state = login.searchParams.get('state')!, challenge = login.searchParams.get('challenge')!; assert.equal(login.origin, MARKET_ORIGIN); assert.equal(login.pathname, '/citymanager-api/v1/pages/login'); assert.notEqual(login.searchParams.get('code'), code);
  send(host, state, host.popup, 'https://evil.example'); send(host, state, {}); send(host, 'wrong'); assert.equal(calls, 0); send(host, state); send(host, state); assert.equal(await pending, guest); assert.equal(calls, 1); assert.equal(session.guestId, guest); const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))); const expected = btoa(String.fromCharCode(...digest)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/, ''); assert.equal(challenge, expected);
}));

test('blocked or cancelled popup and wrong Guest fail closed without keeping a token', async () => harness(async host => {
  const session = new PagesSession(); await session.prepare(); host.blocked = true; assert.throws(() => session.connect(guest), /pages-popup-blocked/); assert.equal(session.bearer(), null); host.blocked = false;
  await session.prepare(); const cancelled = session.connect(guest); host.popup.closed = true; await assert.rejects(cancelled, /pages-popup-closed/); assert.equal(session.bearer(), null); host.popup.closed = false;
  await session.prepare(); globalThis.fetch = async () => new Response(JSON.stringify({ access_token: token, token_type: 'Bearer', expires_in: 900, guest_id: other }), { status: 200 }); const mismatch = session.connect(guest), state = new URL(host.url).searchParams.get('state')!; send(host, state); await assert.rejects(mismatch, /identity-mismatch/); assert.equal(session.bearer(), null);
}));

test('Pages client sends memory-only bearer without cookies and preserves guest identity', async () => harness(async (host, store) => {
  const client = new MarketClient(() => createCity(1, { starter: false }), PAGES_MARKET_BASE); assert.equal(client.usesPagesAuth, true); let exchange = 0, reads = 0; globalThis.fetch = async (url, init) => { if (String(url).endsWith('/v1/pages/exchange')) { exchange++; return new Response(JSON.stringify({ access_token: token, token_type: 'Bearer', expires_in: 900, guest_id: guest }), { status: 200 }); } reads++; assert.equal(init?.credentials, 'omit'); const headers = new Headers(init?.headers); assert.equal(headers.get('Authorization'), `Bearer ${token}`); assert.equal(headers.get('x-csrf-token'), null); return new Response(JSON.stringify({ guest_id: guest, seq: '0' }), { status: 200 }); };
  await client.preparePagesLogin(); const connecting = client.connectPages(), state = new URL(host.url).searchParams.get('state')!; send(host, state); const me = await connecting; await client.reconcileSession(me); await client.read('/v1/wallet'); assert.equal(exchange, 1); assert.equal(reads, 2); assert.equal(client.guestId, guest); assert.equal([...store.values()].some(v => v.includes(token) || v.includes(code)), false); assert.ok(store.has(MARKET_SAVE_KEY));
}));

test('Pages recovery stays opt-in and an ordinary 409 is resolved only by a durable matching fence', async () => harness(async host => {
  const listing = '00000000-0000-4000-8000-000000000008';
  const client = new MarketClient(() => createCity(1, { starter: false }), PAGES_MARKET_BASE, { recoveryEnabled: true });
  let requestKey = '', recoveryCalls = 0, lostFence = true;
  globalThis.fetch = async (url, init) => {
    const path = String(url), headers = new Headers(init?.headers);
    if (path.endsWith('/v1/pages/exchange')) return new Response(JSON.stringify({ access_token: token, token_type: 'Bearer', expires_in: 900, guest_id: guest }), { status: 200 });
    assert.equal(init?.credentials, 'omit'); assert.equal(headers.get('Authorization'), `Bearer ${token}`);
    if (path.endsWith('/v1/me')) return new Response(JSON.stringify({ guest_id: guest, seq: '0' }), { status: 200 });
    if (path.endsWith('/buy')) { requestKey = headers.get('Idempotency-Key')!; return new Response(JSON.stringify({ error: 'insufficient stock' }), { status: 409 }); }
    if (path.includes('/v1/recovery/')) {
      recoveryCalls++; assert.deepEqual(JSON.parse(String(init?.body)), { kind: 'buy', key: requestKey, payload: { listing_id: listing, quantity: 1 } });
      if (path.endsWith('/fence') && lostFence) { lostFence = false; throw new Error('fence response lost'); }
      return new Response(JSON.stringify(path.endsWith('/status') ? { state: 'unknown' } : { state: 'fenced', kind: 'buy', committed: false }), { status: 200 });
    }
    throw new Error('unexpected request');
  };
  await client.preparePagesLogin(); const pending = client.connectPages(); send(host, new URL(host.url).searchParams.get('state')!); await client.reconcileSession(await pending);
  await assert.rejects(client.buy(listing, 1), /insufficient stock/); const op = client.journal.operations[0]; assert.equal(op.state, 'pending'); assert.equal(op.opId, requestKey);
  assert.equal((await client.reconcileOperation(op.opId, 'status')).state, 'unknown'); assert.equal(op.state, 'pending');
  await assert.rejects(client.list('crop:rice', 10, 1), /operation-requires-reconciliation/);
  await assert.rejects(client.reconcileOperation(op.opId, 'fence'), /fence response lost/); assert.equal(op.state, 'pending');
  assert.equal((await client.reconcileOperation(op.opId, 'fence')).state, 'fenced'); assert.equal(op.state, 'quarantined'); assert.equal(recoveryCalls, 3);
}));

test('Pages recovery is disabled by default and does not send recovery requests', async () => harness(async (host, store) => {
  const seed = new MarketClient(() => createCity(1, { starter: false }), PAGES_MARKET_BASE); seed.journal.guestId = guest;
  seed.journal.operations.push({ opId: '00000000-0000-4000-8000-000000000009', guestId: guest, cityId: seed.journal.cityId, kind: 'buy', payload: { listing_id: '00000000-0000-4000-8000-000000000008', quantity: 1 }, state: 'pending', createdAt: '2026-10-27T00:00:00.000Z' });
  store.set(MARKET_SAVE_KEY, JSON.stringify(seed.journal)); const client = new MarketClient(() => createCity(1, { starter: false }), PAGES_MARKET_BASE); let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('unexpected request'); };
  await assert.rejects(client.reconcileOperation(seed.journal.operations[0].opId, 'fence'), /market-recovery-disabled/); assert.equal(calls, 0); assert.equal(client.journal.operations[0].state, 'pending');
}));

test('Pages session rejects a saved Guest mismatch and never silently creates a replacement', async () => harness(async (host, store) => {
  const saved = new MarketClient(() => createCity(1, { starter: false }), PAGES_MARKET_BASE); saved.journal.guestId = guest; store.set(MARKET_SAVE_KEY, JSON.stringify(saved.journal)); const client = new MarketClient(() => createCity(1, { starter: false }), PAGES_MARKET_BASE), before = store.get(MARKET_SAVE_KEY); globalThis.fetch = async () => new Response(JSON.stringify({ access_token: token, token_type: 'Bearer', expires_in: 900, guest_id: other }), { status: 200 });
  await client.preparePagesLogin(); const pending = client.connectPages(); send(host, new URL(host.url).searchParams.get('state')!); await assert.rejects(pending, /identity-mismatch/); assert.equal(store.get(MARKET_SAVE_KEY), before); assert.equal(client.guestId, guest); assert.equal(client.pagesAuthenticated, false);
}));

test('an unexplained sequence gap revokes usable Pages access before any market mutation', async () => harness(async (host, store) => {
  const seed = new MarketClient(() => createCity(1, { starter: false }), PAGES_MARKET_BASE); seed.journal.guestId = guest; seed.journal.seq = '4'; store.set(MARKET_SAVE_KEY, JSON.stringify(seed.journal)); const client = new MarketClient(() => createCity(1, { starter: false }), PAGES_MARKET_BASE), before = store.get(MARKET_SAVE_KEY); let requests = 0;
  globalThis.fetch = async url => { requests++; return String(url).endsWith('/v1/pages/exchange') ? new Response(JSON.stringify({ access_token: token, token_type: 'Bearer', expires_in: 900, guest_id: guest }), { status: 200 }) : new Response(JSON.stringify({ guest_id: guest, seq: '5' }), { status: 200 }); };
  await client.preparePagesLogin(); const pending = client.connectPages(); send(host, new URL(host.url).searchParams.get('state')!); const me = await pending; await assert.rejects(client.reconcileSession(me), /sequence gap/); await assert.rejects(client.buy('listing', 1), /pages-session-required/); await assert.rejects(client.claim('receipt'), /pages-session-required/); assert.equal(requests, 2); assert.equal(store.get(MARKET_SAVE_KEY), before); assert.equal(client.pagesAuthenticated, false);
}));

test('expired access requires reauthentication; exchange failure does not retry or persist credentials', async () => harness(async host => {
  const session = new PagesSession(), now = Date.now; let time = now(); Date.now = () => time;
  try { await session.prepare(); globalThis.fetch = async () => new Response(JSON.stringify({ access_token: token, token_type: 'Bearer', expires_in: 1, guest_id: guest }), { status: 200 }); const p = session.connect(guest); send(host, new URL(host.url).searchParams.get('state')!); await p; assert.equal(session.guestId, guest); time += 1001; assert.equal(session.bearer(), null); assert.equal(session.guestId, null);
    host.popup.closed = false; await session.prepare(); let requests = 0; globalThis.fetch = async () => { requests++; throw new Error('network'); }; const failed = session.connect(guest); send(host, new URL(host.url).searchParams.get('state')!); await assert.rejects(failed, /network/); assert.equal(requests, 1); assert.equal(session.bearer(), null);
  } finally { Date.now = now; }
}));
