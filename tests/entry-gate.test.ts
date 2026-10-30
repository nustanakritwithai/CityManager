import assert from 'node:assert/strict';
import test from 'node:test';
import { entryDecision, requireGuestEntry } from '../src/entry-gate.ts';
import { MarketClient, marketJournalForTest } from '../src/market-client.ts';
import { createCity } from '../src/sim.ts';

test('entry gate resumes a valid returning Guest without creating another identity', () => {
  assert.equal(entryDecision(true, 'valid'), 'resume');
});

test('entry gate creates only for a fresh unauthenticated visitor', () => {
  assert.equal(entryDecision(false, 'unauthenticated'), 'create');
  assert.equal(entryDecision(true, 'unauthenticated'), 'retry');
});

test('entry gate fails closed on transient or unknown authentication state', () => {
  assert.equal(entryDecision(false, 'transient'), 'retry');
  assert.equal(entryDecision(true, 'transient'), 'retry');
});

test('returning session preserves saved sequence, operations and receipt', () => {
  const city = createCity(1, { starter: false }); const client = new MarketClient(() => city, 'http://127.0.0.1:4317');
  client.guestId = '00000000-0000-4000-8000-000000000003'; client.journal.guestId = client.guestId; client.journal.seq = '4';
  client.journal.receipts['00000000-0000-4000-8000-000000000004'] = { claimId: '00000000-0000-4000-8000-000000000005', state: 'applied' };
  const before = JSON.stringify(client.journal); client.acceptSession({ guest_id: client.guestId, seq: '8' }); assert.equal(JSON.stringify(client.journal), before);
  assert.throws(() => client.acceptSession({ guest_id: '00000000-0000-4000-8000-000000000006', seq: '8' }), /mismatch/); assert.equal(JSON.stringify(client.journal), before);
});

test('entry reconciliation rejects rollback and unexplained sequence advance without changing journal', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), store = new Map<string, string>(); Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) } });
  try { const client = new MarketClient(() => createCity(1, { starter: false }), 'http://127.0.0.1:4317'); client.guestId = '00000000-0000-4000-8000-000000000003'; client.journal.guestId = client.guestId; client.journal.seq = '4';
    const before = JSON.stringify(client.journal); await assert.rejects(client.reconcileSession({ guest_id: client.guestId, seq: '3' }), /rollback/); await assert.rejects(client.reconcileSession({ guest_id: client.guestId, seq: '5' }), /gap/); assert.equal(JSON.stringify(client.journal), before);
  } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage'); }
});

test('entry gate waits for auth, blocks double click and leaves existing state on error', async () => {
  class Element { children: Element[] = []; inert = false; disabled = false; textContent = ''; className = ''; type = ''; id = ''; handler?: () => void; parent?: Element;
    setAttribute() {} append(...nodes: Element[]) { for (const n of nodes) { n.parent = this; this.children.push(n); } } focus() {} addEventListener(_name: string, f: () => void) { this.handler = f; } remove() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); } contains(n: Element): boolean { return this.children.includes(n); } }
  const oldDocument = globalThis.document, oldHTMLElement = globalThis.HTMLElement; const body = new Element(), game = new Element(); body.append(game);
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: Element }); Object.defineProperty(globalThis, 'document', { configurable: true, value: { body, createElement: () => new Element() } });
  let release!: (v: unknown) => void, calls = 0, started = 0; const pending = new Promise(resolve => { release = resolve; });
  const journal = marketJournalForTest(null); journal.guestId = '00000000-0000-4000-8000-000000000003'; journal.seq = '4';
  const client = { enabled: true, guestId: journal.guestId, journal, checkSession: () => { calls++; return pending; }, reconcileSession: async () => {}, acceptSession: () => {}, createGuest: () => { throw new Error('must not create'); } } as unknown as MarketClient;
  try { await requireGuestEntry(client, () => { started++; }); assert.equal(game.inert, true); const overlay = body.children[1], button = overlay.children[0].children[3]; button.handler!(); button.handler!(); assert.equal(calls, 1); assert.equal(started, 0); release(null); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(started, 0); assert.equal(game.inert, true); assert.equal(journal.seq, '4'); assert.equal(button.disabled, false);
    client.checkSession = async () => { throw new Error('network unavailable'); }; button.handler!(); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(started, 0); assert.equal(game.inert, true); assert.equal(journal.seq, '4');
    client.checkSession = async () => ({ guest_id: journal.guestId, seq: '4' }); button.handler!(); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(started, 1); assert.equal(game.inert, false); assert.equal(journal.seq, '4');
    const citySave = JSON.stringify({ version: 10, market: journal }); const oldStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => key === 'citymanager.save.v7' ? citySave : null } });
    try { let creations = 0; const fresh = { ...client, guestId: null, journal: marketJournalForTest(null), checkSession: async () => null, createGuest: async () => { creations++; throw new Error('unexpected creation'); } } as unknown as MarketClient; await requireGuestEntry(fresh, () => { started++; }); const second = body.children[1].children[0].children[3]; second.handler!(); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(creations, 0); assert.equal(started, 1); assert.equal(game.inert, true); assert.equal(globalThis.localStorage.getItem('citymanager.save.v7'), citySave); const offline = body.children[1].children[0].children[4]; offline.handler!(); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(started, 2); assert.equal(game.inert, false); assert.equal(creations, 0); assert.equal(globalThis.localStorage.getItem('citymanager.save.v7'), citySave); }
    finally { Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: oldStorage }); } }
  finally { Object.defineProperty(globalThis, 'document', { configurable: true, value: oldDocument }); Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: oldHTMLElement }); }
});

test('v23 saved Guest blocks creating a replacement identity when authentication is missing', async () => {
  class Element {
    children: Element[] = []; inert = false; disabled = false; textContent = ''; className = ''; type = ''; id = ''; handler?: () => void; parent?: Element;
    setAttribute() {} append(...nodes: Element[]) { for (const n of nodes) { n.parent = this; this.children.push(n); } } focus() {} addEventListener(_name: string, f: () => void) { this.handler = f; } remove() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); } contains(n: Element): boolean { return this.children.includes(n); }
  }
  const names = ['document', 'HTMLElement', 'localStorage'] as const, old = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  const { businessFixture } = await import('./business-capacity-fixture.ts'), { serialize } = await import('../src/sim.ts');
  const city = businessFixture(65), journal = marketJournalForTest(null); journal.guestId = '00000000-0000-4000-8000-000000000003'; city.market = journal; const raw = serialize(city);
  const body = new Element(), game = new Element(); body.append(game);
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: Element }); Object.defineProperty(globalThis, 'document', { configurable: true, value: { body, createElement: () => new Element() } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => key === 'citymanager.save.v7' ? raw : null } });
  let created = 0, started = 0;
  const client = { enabled: true, guestId: null, journal: marketJournalForTest(null), checkSession: async () => null, createGuest: async () => { created++; throw Error('Must not replace saved Guest'); } } as unknown as MarketClient;
  try {
    await requireGuestEntry(client, () => { started++; }); const card = body.children[1].children[0]; card.children[3].handler!(); await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(created, 0); assert.equal(started, 0); assert.equal(game.inert, true); assert.equal(globalThis.localStorage.getItem('citymanager.save.v7'), raw);
    card.children[4].handler!(); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(started, 1); assert.equal(created, 0); assert.equal(game.inert, false);
  } finally { names.forEach((name, i) => old[i] ? Object.defineProperty(globalThis, name, old[i]!) : Reflect.deleteProperty(globalThis, name)); }
});
