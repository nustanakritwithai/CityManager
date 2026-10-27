import type { City } from './sim.ts';

export const MARKET_SAVE_KEY = 'citymanager.market.v10';
export const MARKET_RULES = 'chain-5' as const;
export const MARKET_ITEMS = ['crop:rice', 'crop:vegetables', 'crop:sugarcane', 'product:milled-rice', 'product:canned-food', 'product:sugar'] as const;
export type MarketItem = typeof MARKET_ITEMS[number];
export type MarketOperation = { opId: string; guestId: string; cityFingerprint: string; kind: 'deposit' | 'listing' | 'buy' | 'claim' | 'ack'; payload: Record<string, unknown>; state: 'pending' | 'confirmed' | 'quarantined'; createdAt: string };
export type MarketJournal = { version: 10; rulesVersion: typeof MARKET_RULES; guestId: string | null; operations: MarketOperation[]; receipts: Record<string, { claimId: string; state: 'claimed' | 'applied' | 'delivered' }>; seq: string };

const uuid = () => crypto.randomUUID();
const readCsrf = () => document.cookie.split('; ').find(v => v.startsWith('cm_csrf='))?.slice(8) ?? '';
const safeJournal = (raw: string | null): MarketJournal => {
  if (!raw) return { version: 10, rulesVersion: MARKET_RULES, guestId: null, operations: [], receipts: {}, seq: '0' };
  const v: unknown = JSON.parse(raw);
  if (!v || typeof v !== 'object' || (v as any).version !== 10 || (v as any).rulesVersion !== MARKET_RULES || !Array.isArray((v as any).operations) || typeof (v as any).receipts !== 'object') throw new Error('Invalid market journal');
  const j = v as MarketJournal;
  if (j.operations.some(o => !o || typeof o.opId !== 'string' || typeof o.guestId !== 'string' || !['deposit', 'listing', 'buy', 'claim', 'ack'].includes(o.kind) || !['pending', 'confirmed', 'quarantined'].includes(o.state) || !o.payload || typeof o.payload !== 'object')) throw new Error('Invalid market journal operation');
  return j;
};
const persist = (j: MarketJournal) => localStorage.setItem(MARKET_SAVE_KEY, JSON.stringify(j));
const fingerprint = (city: City) => `${city.seed}:${city.tick}:${city.nextId}`;

export class MarketClient {
  readonly baseUrl: string;
  journal: MarketJournal;
  guestId: string | null = null;
  private readonly city: () => City;
  constructor(city: () => City, baseUrl = '') { this.city = city; this.baseUrl = baseUrl.replace(/\/$/, ''); this.journal = safeJournal(globalThis.localStorage?.getItem(MARKET_SAVE_KEY) ?? null); this.guestId = this.journal.guestId; }
  get enabled() { return Boolean(this.baseUrl); }
  private save() { if (globalThis.localStorage) persist(this.journal); }
  private async request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers); headers.set('Accept', 'application/json');
    if (init.method && init.method !== 'GET') { headers.set('Content-Type', 'application/json'); headers.set('x-csrf-token', readCsrf()); }
    const r = await fetch(`${this.baseUrl}${path}`, { ...init, headers, credentials: 'include' });
    let body: any = null; try { body = await r.json(); } catch { /* empty response */ }
    if (!r.ok) { const e = new Error(body?.error?.code ?? body?.error ?? `HTTP ${r.status}`); (e as any).status = r.status; throw e; }
    return body;
  }
  private op(kind: MarketOperation['kind'], payload: Record<string, unknown>) {
    if (!this.guestId) throw new Error('guest-required');
    const operation: MarketOperation = { opId: uuid(), guestId: this.guestId, cityFingerprint: fingerprint(this.city()), kind, payload, state: 'pending', createdAt: new Date().toISOString() };
    this.journal.operations.push(operation); this.save(); return operation;
  }
  async resume() {
    if (!this.enabled) return null;
    try { const me = await this.request('/v1/me'); if (this.guestId && me.guest_id !== this.guestId) this.quarantine(); this.guestId = me.guest_id; this.journal.guestId = this.guestId; this.journal.seq = String(me.seq); this.save(); return me; }
    catch (e) { if ((e as any).status === 401 && this.journal.operations.some(o => o.state === 'pending')) this.quarantine(); return null; }
  }
  async createGuest() { const me = await this.request('/v1/auth/guest', { method: 'POST', body: '{}' }); this.guestId = me.guest_id; this.journal.guestId = this.guestId; this.save(); return me; }
  quarantine() { for (const o of this.journal.operations) if (o.state === 'pending') o.state = 'quarantined'; this.guestId = null; this.journal.guestId = null; this.save(); }
  async listings() { return this.request('/v1/listings'); }
  async wallet() { return this.request('/v1/wallet'); }
  async inventory() { return this.request('/v1/inventory'); }
  async list(item_code: MarketItem, unit_price: number, quantity: number) { const o = this.op('listing', { item_code, unit_price, quantity }); try { const result = await this.request('/v1/listings', { method: 'POST', headers: { 'Idempotency-Key': o.opId }, body: JSON.stringify({ item_code, unit_price, quantity }) }); o.state = 'confirmed'; this.save(); return result; } catch (e) { throw e; } }
  async buy(listing_id: string, quantity: number) { const o = this.op('buy', { listing_id, quantity }); try { const result = await this.request(`/v1/listings/${encodeURIComponent(listing_id)}/buy`, { method: 'POST', headers: { 'Idempotency-Key': o.opId }, body: JSON.stringify({ quantity }) }); o.state = 'confirmed'; this.save(); return result; } catch (e) { throw e; } }
  async retry(opId: string) { const o = this.journal.operations.find(x => x.opId === opId); if (!o || o.guestId !== this.guestId || o.cityFingerprint !== fingerprint(this.city()) || o.state !== 'pending') { if (o && o.state === 'pending') { o.state = 'quarantined'; this.save(); } throw new Error('operation-not-retryable'); } if (o.kind === 'buy') return this.request(`/v1/listings/${encodeURIComponent(String(o.payload.listing_id))}/buy`, { method: 'POST', headers: { 'Idempotency-Key': o.opId }, body: JSON.stringify({ quantity: o.payload.quantity }) }); if (o.kind === 'listing') return this.request('/v1/listings', { method: 'POST', headers: { 'Idempotency-Key': o.opId }, body: JSON.stringify(o.payload) }); throw new Error('operation-requires-reconciliation'); }
  async cancelListing(id: string) { return this.request(`/v1/listings/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' }); }
  async receipts(state = '') { return this.request(`/v1/receipts${state ? `?state=${encodeURIComponent(state)}` : ''}`); }
  async claim(receiptId: string) { const existing = this.journal.receipts[receiptId]; const claimId = existing?.claimId ?? uuid(); this.journal.receipts[receiptId] = { claimId, state: 'claimed' }; this.save(); return this.request(`/v1/receipts/${encodeURIComponent(receiptId)}/claim`, { method: 'POST', body: JSON.stringify({ claimId }) }); }
  async ack(receiptId: string) { const r = this.journal.receipts[receiptId]; if (!r) throw new Error('claim-required'); const result = await this.request(`/v1/receipts/${encodeURIComponent(receiptId)}/ack`, { method: 'POST', body: JSON.stringify({ claimId: r.claimId }) }); r.state = 'delivered'; this.save(); return result; }
}

export const marketJournalForTest = (raw: string | null) => safeJournal(raw);
