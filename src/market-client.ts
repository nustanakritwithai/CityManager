import { firmCapacity, isMarket, type City } from './sim.ts';
import { CROP_STOCK_CAPS, releaseCropCost } from './agriculture.ts';

export const MARKET_SAVE_KEY = 'citymanager.market.v10';
export const MARKET_RULES = 'chain-5' as const;
export const MARKET_ITEMS = ['crop:rice', 'crop:vegetables', 'crop:sugarcane', 'product:milled-rice', 'product:canned-food', 'product:sugar'] as const;
export type MarketItem = typeof MARKET_ITEMS[number];
export type MarketOperation = { opId: string; guestId: string; cityId: string; kind: 'deposit' | 'listing' | 'buy' | 'claim' | 'ack'; payload: Record<string, unknown>; state: 'pending' | 'confirmed' | 'quarantined'; createdAt: string };
export type MarketEscrow = { opId: string; cityId: string; firmId: number; itemId: MarketItem; quantity: number; value?: number; state: 'pending' | 'confirmed' | 'cancelled' };
export type MarketJournal = { version: 10; rulesVersion: typeof MARKET_RULES; guestId: string | null; cityId: string; operations: MarketOperation[]; escrow: MarketEscrow[]; receipts: Record<string, { claimId: string; state: 'claimed' | 'applied' | 'delivered'; firmId?: number; itemId?: MarketItem; quantity?: number }>; seq: string };
export type MarketReceipt = { receipt_id: string; item_code: string; quantity: number; state?: string };

const uuid = () => crypto.randomUUID();
const readCsrf = () => document.cookie.split('; ').find(v => v.startsWith('cm_csrf='))?.slice(8) ?? '';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeJournal = (raw: string | null): MarketJournal => {
  if (!raw) return { version: 10, rulesVersion: MARKET_RULES, guestId: null, cityId: uuid(), operations: [], escrow: [], receipts: {}, seq: '0' };
  let v: unknown; try { v = JSON.parse(raw); } catch { throw new Error('Invalid market journal'); }
  if (!v || typeof v !== 'object' || (v as any).version !== 10 || (v as any).rulesVersion !== MARKET_RULES || !UUID.test(String((v as any).cityId)) || !Array.isArray((v as any).operations) || !Array.isArray((v as any).escrow) || typeof (v as any).receipts !== 'object' || !/^\d+$/.test(String((v as any).seq))) throw new Error('Invalid market journal');
  const j = v as MarketJournal;
  if (j.guestId !== null && !UUID.test(j.guestId) || j.operations.some(o => !o || !UUID.test(o.opId) || !UUID.test(o.guestId) || (j.guestId !== null && o.guestId !== j.guestId) || !UUID.test(o.cityId) || o.cityId !== j.cityId || !['deposit', 'listing', 'buy', 'claim', 'ack'].includes(o.kind) || !['pending', 'confirmed', 'quarantined'].includes(o.state) || !o.payload || typeof o.payload !== 'object' || Number.isNaN(Date.parse(o.createdAt)))) throw new Error('Invalid market journal operation');
  if (j.escrow.some(e => !e || !UUID.test(e.opId) || e.cityId !== j.cityId || !Number.isSafeInteger(e.firmId) || !MARKET_ITEMS.includes(e.itemId) || !Number.isSafeInteger(e.quantity) || e.quantity < 1 || (e.value !== undefined && (!Number.isSafeInteger(e.value) || e.value < 0)) || !['pending', 'confirmed', 'cancelled'].includes(e.state))) throw new Error('Invalid market escrow');
  for (const [receiptId, r] of Object.entries(j.receipts)) if (!UUID.test(receiptId) || !r || !UUID.test(r.claimId) || !['claimed', 'applied', 'delivered'].includes(r.state) || (r.firmId !== undefined && !Number.isSafeInteger(r.firmId)) || (r.itemId !== undefined && !MARKET_ITEMS.includes(r.itemId)) || (r.quantity !== undefined && (!Number.isSafeInteger(r.quantity) || r.quantity < 1))) throw new Error('Invalid market journal receipt');
  return j;
};
const persist = (j: MarketJournal) => localStorage.setItem(MARKET_SAVE_KEY, JSON.stringify(j));

export class MarketClient {
  readonly baseUrl: string;
  journal: MarketJournal;
  guestId: string | null = null;
  private readonly city: () => City;
  constructor(city: () => City, baseUrl = '') { this.city = city; let safeBase = ''; try { const u = new URL(baseUrl); if (u.protocol === 'http:' && u.hostname === '127.0.0.1' && u.port === '4317' && !u.username && !u.password && !u.search && !u.hash) safeBase = u.origin; } catch { /* disabled by default */ } this.baseUrl = safeBase; const raw = globalThis.localStorage?.getItem(MARKET_SAVE_KEY) ?? null; try { this.journal = safeJournal(raw); } catch { if (raw && globalThis.localStorage) globalThis.localStorage.setItem(`${MARKET_SAVE_KEY}.quarantine`, raw); this.journal = safeJournal(null); } this.guestId = this.journal.guestId; }
  get enabled() { return Boolean(this.baseUrl); }
  exportSave() { return structuredClone(this.journal); }
  validateSave(value: unknown) { safeJournal(JSON.stringify(value)); }
  importSave(value: unknown) { const imported = safeJournal(JSON.stringify(value)); this.journal = imported; this.guestId = imported.guestId; this.save(); }
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
    const operation: MarketOperation = { opId: uuid(), guestId: this.guestId, cityId: this.journal.cityId, kind, payload, state: 'pending', createdAt: new Date().toISOString() };
    this.journal.operations.push(operation); try { this.save(); } catch (e) { this.journal.operations.pop(); throw new Error(`market journal unavailable: ${e instanceof Error ? e.message : 'storage failure'}`); } return operation;
  }
  async resume() {
    if (!this.enabled) return null;
    try { const me = await this.request('/v1/me'); const previous = BigInt(this.journal.seq), incoming = BigInt(me.seq); if (this.guestId && me.guest_id !== this.guestId) this.quarantine(); const attributable = this.journal.operations.some(o => o.state === 'pending' && (o.kind === 'deposit' || o.kind === 'buy')); if (incoming < previous) throw new Error('market sequence rollback'); if (incoming > previous && this.guestId && !attributable) throw new Error('market sequence gap requires reconciliation'); this.guestId = me.guest_id; this.journal.guestId = this.guestId; this.journal.seq = String(me.seq); this.save(); return me; }
    catch (e) { if ((e as any).status === 401) { if (this.guestId || this.journal.operations.length || Object.keys(this.journal.receipts).length || this.journal.escrow.length) this.quarantine(); return null; } throw e; }
  }
  async createGuest() { const me = await this.request('/v1/auth/guest', { method: 'POST', body: '{}' }); this.guestId = me.guest_id; this.journal.guestId = this.guestId; this.save(); return me; }
  quarantine() { const old = JSON.stringify(this.journal); if (globalThis.localStorage) globalThis.localStorage.setItem(`${MARKET_SAVE_KEY}.quarantine.${this.journal.cityId}.${Date.now()}`, old); this.journal = safeJournal(null); this.guestId = null; this.save(); }
  resetCity() { const old = JSON.stringify(this.journal); if (globalThis.localStorage) globalThis.localStorage.setItem(`${MARKET_SAVE_KEY}.city-${this.journal.cityId}`, old); this.journal = safeJournal(null); this.guestId = null; this.save(); }
  private stock(firmId: number, itemId: MarketItem) { const product = itemId.startsWith('product:'); const f = this.city().firms.find(f => f.id === firmId && (isMarket(f) || product && (f.zone === 'I' || f.commercialKind === 'retail'))); if (!f) throw new Error('typed destination firm required'); const bucket = (product ? f.products : f.crops) as Record<string, number>; return { f, bucket, key: itemId.slice(itemId.indexOf(':') + 1) } as const; }
  async deposit(firmId: number, itemId: MarketItem, quantity: number, saveCity: () => void) {
    if (!MARKET_ITEMS.includes(itemId) || !Number.isSafeInteger(quantity) || quantity < 1) throw new Error('invalid typed deposit');
    const { f, bucket, key } = this.stock(firmId, itemId); const current = bucket[key as keyof typeof bucket]; if (!Number.isSafeInteger(current) || current < quantity) throw new Error('insufficient typed firm stock');
    const o = this.op('deposit', { itemId, qty: quantity, firmId }); const value = itemId.startsWith('crop:') ? releaseCropCost(f.cropInventory, f.cropCost, quantity) : 0; const escrow: MarketEscrow = { opId: o.opId, cityId: this.journal.cityId, firmId, itemId, quantity, value, state: 'pending' }; const old = current; bucket[key as keyof typeof bucket] = old - quantity; this.journal.escrow.push(escrow);
    const crop = key as keyof typeof f.crops; const product = key as keyof typeof f.products; const isCrop = itemId.startsWith('crop:');
    const event = { tick: this.city().tick, from: f.wallet, to: isCrop ? 'market-server' : 'outside', quantity, reason: `Market escrow deposit #${isCrop ? this.city().cropLedger.length + 1 : this.city().goodsLedger.length + 1}`, ...(isCrop ? { id: this.city().cropLedger.length + 1, kind: 'market-deposit' as const, fromValue: value, toValue: value, cash: 0, workers: 0, batches: 0, outputQuantity: 0, crop } : { product }) };
    if (isCrop) { f.cropInventory -= quantity; f.cropCost -= value; this.city().cropLedger.push(event as any); } else { f.inventory -= quantity; this.city().goods.exported += quantity; this.city().goodsLedger.push(event as any); }
    try { saveCity(); } catch (e) { if (isCrop) { this.city().cropLedger.pop(); f.cropInventory += quantity; f.cropCost += value; } else { this.city().goodsLedger.pop(); f.inventory += quantity; this.city().goods.exported -= quantity; } bucket[isCrop ? crop : product] = old; this.journal.escrow.pop(); this.journal.operations.pop(); try { this.save(); } catch { /* retain in-memory recovery state */ } throw e; }
    try { const result = await this.request('/v1/deposits', { method: 'POST', body: JSON.stringify({ opId: o.opId, itemId, qty: quantity }) }); escrow.state = 'confirmed'; o.state = 'confirmed'; this.journal.seq = String(result.seq ?? this.journal.seq); saveCity(); return result; } catch (e) { throw e; }
  }
  async fenceDeposit(opId: string, saveCity: () => void) { const e = this.journal.escrow.find(x => x.opId === opId); if (!e || e.state !== 'pending') throw new Error('deposit-not-pending'); let status = await this.request(`/v1/op/${encodeURIComponent(opId)}`); if (status.state === 'done') throw new Error('deposit-already-done'); if (status.state === 'unknown') { await this.request(`/v1/op/${encodeURIComponent(opId)}/cancel`, { method: 'POST', body: '{}' }); status = await this.request(`/v1/op/${encodeURIComponent(opId)}`); } if (status.state !== 'cancelled') throw new Error('deposit-not-fenced'); const { f, bucket, key } = this.stock(e.firmId, e.itemId); const isCrop = e.itemId.startsWith('crop:'); bucket[key as keyof typeof bucket] += e.quantity; if (isCrop) { f.cropInventory += e.quantity; const value = e.value ?? 0; f.cropCost += value; this.city().cropLedger.push({ id: this.city().cropLedger.length + 1, tick: this.city().tick, kind: 'market-refund', from: 'market-server', to: f.wallet, quantity: e.quantity, fromValue: value, toValue: value, cash: 0, workers: 0, batches: 0, outputQuantity: 0, reason: `Market escrow refund #${this.city().cropLedger.length + 1}`, crop: key as keyof typeof f.crops }); } else { f.inventory += e.quantity; this.city().goods.imported += e.quantity; this.city().goodsLedger.push({ tick: this.city().tick, from: 'outside', to: f.wallet, quantity: e.quantity, reason: `Market escrow refund #${this.city().goodsLedger.length + 1}`, product: key }); } e.state = 'cancelled'; const o = this.journal.operations.find(x => x.opId === opId); if (o) o.state = 'confirmed'; saveCity(); return status; }
  async recoverDeposit(opId: string, saveCity: () => void) { const e = this.journal.escrow.find(x => x.opId === opId), o = this.journal.operations.find(x => x.opId === opId); if (!e || e.state !== 'pending' || !o || o.state !== 'pending' || o.cityId !== this.journal.cityId || o.guestId !== this.guestId || o.kind !== 'deposit' || o.payload.firmId !== e.firmId || o.payload.itemId !== e.itemId || o.payload.qty !== e.quantity) throw new Error('deposit-reconciliation-required'); const status = await this.request(`/v1/op/${encodeURIComponent(opId)}`); if (status.state === 'done') { e.state = 'confirmed'; o.state = 'confirmed'; this.journal.seq = String(status.seq ?? this.journal.seq); saveCity(); return status; } if (status.state === 'cancelled') return this.fenceDeposit(opId, saveCity); throw new Error('deposit-reconciliation-required'); }
  async listings() { return this.request('/v1/listings'); }
  async wallet() { return this.request('/v1/wallet'); }
  async inventory() { return this.request('/v1/inventory'); }
  async list(item_code: MarketItem, unit_price: number, quantity: number) { const o = this.op('listing', { item_code, unit_price, quantity }); try { const result = await this.request('/v1/listings', { method: 'POST', headers: { 'Idempotency-Key': o.opId }, body: JSON.stringify({ item_code, unit_price, quantity }) }); o.state = 'confirmed'; this.save(); return result; } catch (e) { throw e; } }
  async buy(listing_id: string, quantity: number) { const o = this.op('buy', { listing_id, quantity }); try { const result = await this.request(`/v1/listings/${encodeURIComponent(listing_id)}/buy`, { method: 'POST', headers: { 'Idempotency-Key': o.opId }, body: JSON.stringify({ quantity }) }); o.state = 'confirmed'; this.save(); return result; } catch (e) { throw e; } }
  async retry(opId: string) { const o = this.journal.operations.find(x => x.opId === opId); if (!o || o.guestId !== this.guestId || o.cityId !== this.journal.cityId || o.state !== 'pending') { if (o && o.state === 'pending') { o.state = 'quarantined'; this.save(); } throw new Error('operation-not-retryable'); } let result; if (o.kind === 'buy') result = await this.request(`/v1/listings/${encodeURIComponent(String(o.payload.listing_id))}/buy`, { method: 'POST', headers: { 'Idempotency-Key': o.opId }, body: JSON.stringify({ quantity: o.payload.quantity }) }); else if (o.kind === 'listing') result = await this.request('/v1/listings', { method: 'POST', headers: { 'Idempotency-Key': o.opId }, body: JSON.stringify(o.payload) }); else throw new Error('operation-requires-reconciliation'); o.state = 'confirmed'; this.save(); return result; }
  async cancelListing(id: string) { return this.request(`/v1/listings/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' }); }
  async receipts(state = '') { const rows = await this.request(`/v1/receipts${state ? `?state=${encodeURIComponent(state)}` : ''}`); return rows.map((r: MarketReceipt) => { const quantity = Number(r.quantity); if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error('invalid typed market receipt'); return { ...r, quantity }; }); }
  async claim(receiptId: string) { const existing = this.journal.receipts[receiptId]; const claimId = existing?.claimId ?? uuid(); this.journal.receipts[receiptId] = { claimId, state: 'claimed' }; this.save(); return this.request(`/v1/receipts/${encodeURIComponent(receiptId)}/claim`, { method: 'POST', body: JSON.stringify({ claimId }) }); }
  async ack(receiptId: string) { const r = this.journal.receipts[receiptId]; if (!r) throw new Error('claim-required'); const result = await this.request(`/v1/receipts/${encodeURIComponent(receiptId)}/ack`, { method: 'POST', body: JSON.stringify({ claimId: r.claimId }) }); r.state = 'delivered'; this.save(); return result; }
  async recoverReceipt(receiptId: string, saveCity: () => void) { const r = this.journal.receipts[receiptId]; if (!r || (r.state !== 'applied' && r.state !== 'delivered')) throw new Error('receipt-not-recoverable'); const result = await this.request(`/v1/receipts/${encodeURIComponent(receiptId)}/ack`, { method: 'POST', body: JSON.stringify({ claimId: r.claimId }) }); r.state = 'delivered'; this.save(); saveCity(); return result; }
  /** Apply only a canonical item to a real level-one market, save the city, then ACK the same claim. */
  async applyAndAck(receipt: MarketReceipt, saveCity: () => void) {
    const record = this.journal.receipts[receipt.receipt_id]; if (!record) throw new Error('claim-required');
    if (record.state === 'applied') return this.recoverReceipt(receipt.receipt_id, saveCity);
    if (record.state === 'delivered') return { state: 'delivered', idempotent: true };
    if (!MARKET_ITEMS.includes(receipt.item_code as MarketItem) || !Number.isSafeInteger(receipt.quantity) || receipt.quantity < 1) throw new Error('invalid typed market receipt');
    const wantsProduct = receipt.item_code.startsWith('product:'); const firm = this.city().firms.filter(f => wantsProduct ? (f.zone === 'I' || f.commercialKind === 'retail') : isMarket(f)).map(f => ({ f, b: this.city().buildings.find(b => b.id === f.building) })).find(({ f, b }) => {
      if (!b) return false; const total = Object.values(f.crops).reduce((a, n) => a + n, 0) + Object.values(f.products).reduce((a, n) => a + n, 0); return total + receipt.quantity <= (wantsProduct ? firmCapacity(b) : CROP_STOCK_CAPS.T);
    });
    if (!firm) throw new Error('no typed market firm capacity');
    const oldCrops = { ...firm.f.crops }, oldProducts = { ...firm.f.products }, oldCropInventory = firm.f.cropInventory, oldCropCost = firm.f.cropCost;
    const item = receipt.item_code as MarketItem;
    if (item.startsWith('crop:')) firm.f.crops[item.slice(5) as keyof typeof firm.f.crops] += receipt.quantity;
    else firm.f.products[item.slice(8) as keyof typeof firm.f.products] += receipt.quantity;
    if (item.startsWith('crop:')) { firm.f.cropInventory += receipt.quantity; this.city().cropLedger.push({ id: this.city().cropLedger.length + 1, tick: this.city().tick, kind: 'market-receipt', from: 'market-server', to: firm.f.wallet, quantity: receipt.quantity, fromValue: 0, toValue: 0, cash: 0, workers: 0, batches: 0, outputQuantity: 0, reason: `Market receipt #${this.city().cropLedger.length + 1}`, crop: item.slice(5) as keyof typeof firm.f.crops }); } else { firm.f.inventory += receipt.quantity; this.city().goods.imported += receipt.quantity; this.city().goodsLedger.push({ tick: this.city().tick, from: 'outside', to: firm.f.wallet, quantity: receipt.quantity, reason: `Market receipt #${this.city().goodsLedger.length + 1}`, product: item.slice(8) as keyof typeof firm.f.products }); }
    const oldRecord = { ...record }; record.state = 'applied'; record.firmId = firm.f.id; record.itemId = item; record.quantity = receipt.quantity;
    try { saveCity(); } catch (e) { if (item.startsWith('crop:')) this.city().cropLedger.pop(); else { this.city().goodsLedger.pop(); this.city().goods.imported -= receipt.quantity; } firm.f.crops = oldCrops; firm.f.products = oldProducts; firm.f.cropInventory = oldCropInventory; firm.f.cropCost = oldCropCost; firm.f.inventory = Object.values(oldProducts).reduce((a, n) => a + n, 0); Object.assign(record, oldRecord); try { this.save(); } catch { /* preserve in-memory recovery state */ } throw e; }
    try { const result = await this.ack(receipt.receipt_id); saveCity(); return result; } catch (e) { throw e; }
  }
}

export const marketJournalForTest = (raw: string | null) => safeJournal(raw);
