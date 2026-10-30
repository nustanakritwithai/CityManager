import { factoryCropCapacity } from './factory-levels.ts';
import { deserialize, isMarket, type City } from './sim.ts';
import { withMarketWriter, type MarketWriterLocks } from './market-writer.ts';
import { SAVE_KEY } from './save-storage.ts';
import { PAGES_MARKET_BASE, PAGES_ORIGIN, pagesSession } from './pages-auth.ts';
import { CROP_STOCK_CAPS, farmStockCapacity, releaseCropCost } from './agriculture.ts';
import { CROPS, PRODUCTS, RECIPE, type CropId, type ProductId } from './goods.ts';

export const MARKET_SAVE_KEY = 'citymanager.market.v10';
export const MARKET_RULES = 'chain-5' as const;
export const MARKET_ITEMS = ['crop:rice', 'crop:vegetables', 'crop:sugarcane', 'product:milled-rice', 'product:canned-food', 'product:sugar'] as const;
export type MarketItem = typeof MARKET_ITEMS[number];
export type MarketOperation = { opId: string; guestId: string; cityId: string; kind: 'deposit' | 'listing' | 'buy' | 'cancel' | 'claim' | 'ack'; payload: Record<string, unknown>; state: 'pending' | 'confirmed' | 'quarantined'; createdAt: string };
export type MarketEscrow = { opId: string; cityId: string; firmId: number; itemId: MarketItem; quantity: number; value?: number; state: 'pending' | 'confirmed' | 'cancelled' };
export type MarketJournal = { version: 10; rulesVersion: typeof MARKET_RULES; guestId: string | null; cityId: string; operations: MarketOperation[]; escrow: MarketEscrow[]; receipts: Record<string, { claimId: string; state: 'claimed' | 'applied' | 'delivered'; firmId?: number; itemId?: MarketItem; quantity?: number }>; seq: string };
export function isPristineMarketJournal(j:NonNullable<City['market']>):boolean {
 return Object.keys(j).sort().join(',')==='cityId,escrow,guestId,operations,receipts,rulesVersion,seq,version'&&j.guestId===null&&j.seq==='0'&&j.operations.length===0&&j.escrow.length===0&&Object.keys(j.receipts).length===0;
}
export type MarketReceipt = { receipt_id: string; item_code: string; quantity: number; state?: string };
export type MarketListing = { id: string; item_code: MarketItem; unit_price: number; quantity: number; status: string; expires_at?: string };

const uuid = () => crypto.randomUUID();
const readCsrf = () => document.cookie.split('; ').find(v => v.startsWith('cm_csrf='))?.slice(8) ?? '';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isCropId = (value: string): value is CropId => CROPS.includes(value as CropId);
const isProductId = (value: string): value is ProductId => PRODUCTS.includes(value as ProductId);
// Retail inventory is a goods stock, not worker capacity: the live engine can
// legitimately hold more goods than its staffing capacity. Keep a separate
// bounded receipt cap so a malformed server quantity still fails closed.
const PRODUCT_STOCK_CAP = 1024;
const safeJournal = (raw: string | null): MarketJournal => {
  if (!raw) return { version: 10, rulesVersion: MARKET_RULES, guestId: null, cityId: uuid(), operations: [], escrow: [], receipts: {}, seq: '0' };
  let v: unknown; try { v = JSON.parse(raw); } catch { throw new Error('Invalid market journal'); }
  if (!v || typeof v !== 'object' || (v as any).version !== 10 || (v as any).rulesVersion !== MARKET_RULES || !UUID.test(String((v as any).cityId)) || !Array.isArray((v as any).operations) || !Array.isArray((v as any).escrow) || typeof (v as any).receipts !== 'object' || !/^\d+$/.test(String((v as any).seq))) throw new Error('Invalid market journal');
  const j = v as MarketJournal;
  if (j.guestId !== null && !UUID.test(j.guestId) || j.operations.some(o => !o || !UUID.test(o.opId) || !UUID.test(o.guestId) || (j.guestId !== null && o.guestId !== j.guestId) || !UUID.test(o.cityId) || o.cityId !== j.cityId || !['deposit', 'listing', 'buy', 'cancel', 'claim', 'ack'].includes(o.kind) || !['pending', 'confirmed', 'quarantined'].includes(o.state) || !o.payload || typeof o.payload !== 'object' || Number.isNaN(Date.parse(o.createdAt)))) throw new Error('Invalid market journal operation');
  if (j.escrow.some(e => !e || !UUID.test(e.opId) || e.cityId !== j.cityId || !Number.isSafeInteger(e.firmId) || !MARKET_ITEMS.includes(e.itemId) || !Number.isSafeInteger(e.quantity) || e.quantity < 1 || (e.value !== undefined && (!Number.isSafeInteger(e.value) || e.value < 0)) || !['pending', 'confirmed', 'cancelled'].includes(e.state))) throw new Error('Invalid market escrow');
  for (const [receiptId, r] of Object.entries(j.receipts)) if (!UUID.test(receiptId) || !r || !UUID.test(r.claimId) || !['claimed', 'applied', 'delivered'].includes(r.state) || (r.firmId !== undefined && !Number.isSafeInteger(r.firmId)) || (r.itemId !== undefined && !MARKET_ITEMS.includes(r.itemId)) || (r.quantity !== undefined && (!Number.isSafeInteger(r.quantity) || r.quantity < 1))) throw new Error('Invalid market journal receipt');
  return j;
};
/** Strict recovery validation: unknown fields remain untouched, never rotated away. */
export function validateRecoveryMarketJournal(value:unknown):void {
 const j=safeJournal(JSON.stringify(value));
 const allowed=(o:object,keys:string[])=>Object.keys(o).every(k=>keys.includes(k));
 if(Object.keys(j).sort().join(',')!=='cityId,escrow,guestId,operations,receipts,rulesVersion,seq,version')throw Error('recovery-market-unknown');
 for(const op of j.operations)if(!allowed(op,['opId','guestId','cityId','kind','payload','state','createdAt']))throw Error('recovery-market-unknown');
 for(const e of j.escrow)if(!allowed(e,['opId','cityId','firmId','itemId','quantity','value','state']))throw Error('recovery-market-unknown');
 for(const r of Object.values(j.receipts))if(!allowed(r,['claimId','state','firmId','itemId','quantity']))throw Error('recovery-market-unknown');
 if(j.guestId===null&&(j.operations.length||j.escrow.length||Object.keys(j.receipts).length))throw Error('recovery-market-identity-missing');
}
const persist = (j: MarketJournal) => localStorage.setItem(MARKET_SAVE_KEY, JSON.stringify(j));

export class MarketClient {
  readonly baseUrl: string;
  journal: MarketJournal;
  guestId: string | null = null;
  private readonly city: () => City;
  private readonly recoveryEnabled: boolean;
  private journalUnavailable = false;
  private recoveryReadOnly = false;
  setRecoveryReadOnly(value:boolean) { this.recoveryReadOnly=value; }
  private readDurableCity: (cityId: string) => string | null;
  private revision: string | null = null;
  constructor(city: () => City, baseUrl = '', options: { recoveryEnabled?: boolean; readDurableCity?: (cityId: string) => string | null } = {}) { this.city = city; this.readDurableCity = options.readDurableCity ?? (() => globalThis.localStorage.getItem(SAVE_KEY)); this.recoveryEnabled = options.recoveryEnabled === true; let safeBase = ''; if (/^\/citymanager-api\/?$/.test(baseUrl)) safeBase = '/citymanager-api'; else if (baseUrl.replace(/\/$/, '') === PAGES_MARKET_BASE && typeof window !== 'undefined' && window.location.origin === PAGES_ORIGIN) safeBase = PAGES_MARKET_BASE; else try { const u = new URL(baseUrl); if (u.protocol === 'http:' && u.hostname === '127.0.0.1' && u.port === '4317' && !u.username && !u.password && !u.search && !u.hash) safeBase = u.origin; } catch { /* disabled by default */ } this.baseUrl = safeBase; if (!safeBase) { this.journal = safeJournal(null); return; } let raw: string | null = null; try { if (!globalThis.localStorage) throw new Error('storage unavailable'); raw = globalThis.localStorage.getItem(MARKET_SAVE_KEY); this.revision = raw; this.journal = safeJournal(raw); } catch { this.journalUnavailable = true; this.journal = safeJournal(null); } this.guestId = this.journal.guestId; }
  get enabled() { return Boolean(this.baseUrl); }
  get usesPagesAuth() { return this.baseUrl === PAGES_MARKET_BASE; }
  get pagesAuthenticated() { return this.usesPagesAuth && Boolean(pagesSession.verifiedGuest); }
  preparePagesLogin() { if (!this.usesPagesAuth || this.journalUnavailable) throw new Error('pages-auth-unavailable'); return pagesSession.prepare(); }

  private expectedPagesGuest() { const raw = globalThis.localStorage?.getItem(SAVE_KEY); let saved: MarketJournal | null = null; if (raw) { const city = JSON.parse(raw); if ((city?.version === 10 || city?.version === 11 || (city?.version === 12 || city?.version === 13 || city?.version === 14 || city?.version === 15 || city?.version === 16 || city?.version === 17 || city?.version === 18 || city?.version === 19 || city?.version === 20 || city?.version === 21 || city?.version === 22 || city?.version === 23) && city.market)) { if (!city.market) throw new Error('saved market identity requires recovery'); saved = safeJournal(JSON.stringify(city.market)); } } const hasState = (j: MarketJournal) => Boolean(j.operations.length || j.escrow.length || Object.keys(j.receipts).length); if ((!this.journal.guestId && hasState(this.journal)) || (saved && !saved.guestId && hasState(saved))) throw new Error('saved market identity requires recovery'); if (saved?.guestId && this.guestId && saved.guestId !== this.guestId) throw new Error('market guest identity mismatch'); return this.guestId ?? saved?.guestId ?? null; }
  connectPages() { if (!this.usesPagesAuth || this.journalUnavailable) throw new Error('pages-auth-unavailable'); const expected = this.expectedPagesGuest(); const exchange = pagesSession.connect(expected); return exchange.then(async guest => { try { const me = await this.request('/v1/me'); if (me?.guest_id !== guest) throw new Error('market guest identity mismatch'); return me; } catch (error) { pagesSession.clear(); throw error; } }); }
  exportSave() { return structuredClone(this.journal); }
  validateSave(value: unknown) { safeJournal(JSON.stringify(value)); }
  async bindLoadedCity(value: unknown, apply: () => void, assertCurrent: () => void = () => {}) { return this.writer(async () => {
    // The lock may be acquired after another Load has already committed. Check
    // before changing either the in-memory identity or its persistent journal.
    assertCurrent();
    const hasState = Boolean(this.guestId || this.journal.operations.length || this.journal.escrow.length || Object.keys(this.journal.receipts).length);
    if (value == null) { if (hasState) throw new Error('saved-market-reconciliation-required'); apply(); return; }
    const imported = safeJournal(JSON.stringify(value));
    if (hasState && JSON.stringify(imported) !== JSON.stringify(this.journal)) {
      // A saved applied receipt necessarily predates creation of its ACK intent.
      // Permit only that exact one-operation lag; never replace the newer journal.
      const pending = this.journal.operations.filter(o => o.state === 'pending'), ack = pending.length === 1 && pending[0].kind === 'ack' ? pending[0] : null;
      const receiptId = typeof ack?.payload.receipt_id === 'string' ? ack.payload.receipt_id : '', receipt = this.journal.receipts[receiptId];
      const withoutAck = { ...this.journal, operations: this.journal.operations.filter(o => o !== ack) };
      if (!ack || !receipt || receipt.state !== 'applied' || ack.payload.claim_id !== receipt.claimId || ack.guestId !== this.guestId || ack.cityId !== this.journal.cityId || JSON.stringify(imported) !== JSON.stringify(withoutAck)) throw new Error('saved-market-reconciliation-required');
      apply(); return;
    }
    const old = this.journal, oldGuest = this.guestId, oldRevision = this.revision;
    this.journal = imported; this.guestId = imported.guestId;
    let persisted = false;
    try { this.save(); persisted = true; apply(); }
    catch (error) {
      const written = this.revision;
      this.journal = old; this.guestId = oldGuest; this.revision = oldRevision;
      if (persisted && globalThis.localStorage) {
        try {
          // Do not roll back over a newer writer that ignored the market lock.
          if (localStorage.getItem(MARKET_SAVE_KEY) !== written) throw new Error('market-state-changed-reload');
          if (oldRevision === null) localStorage.removeItem(MARKET_SAVE_KEY);
          else localStorage.setItem(MARKET_SAVE_KEY, oldRevision);
        } catch (rollbackError) {
          this.journalUnavailable = true;
          throw new Error('market-load-rollback-failed', { cause: rollbackError });
        }
      }
      throw error;
    }
  },true); }
  /** Compare under the existing writer lock, without persisting or changing either journal. */
  async bindLoadedCityReadOnly(value:unknown,apply:()=>void,assertCurrent:()=>void=()=>{}) { return this.writer(async()=>{
    assertCurrent();
    if(value==null){if(!isPristineMarketJournal(this.journal))throw Error('saved-market-reconciliation-required');}
    else {const imported=safeJournal(JSON.stringify(value));const hasState=(j:MarketJournal)=>!isPristineMarketJournal(j);if((hasState(imported)||hasState(this.journal))&&JSON.stringify(imported)!==JSON.stringify(this.journal))throw Error('saved-market-reconciliation-required');}
    assertCurrent();apply();
  },true); }
  async importSave(value: unknown) { return this.bindLoadedCity(value, () => {}); }
  private save() { if (globalThis.localStorage) { persist(this.journal); this.revision = JSON.stringify(this.journal); } }
  async saveLocalCity(write: (journal: MarketJournal) => void | Promise<void>) { return this.writer(async () => { const current = this.city().market; const hasState = Boolean(this.journal.operations.length || this.journal.escrow.length || Object.keys(this.journal.receipts).length); if (hasState && (!current || current.cityId !== this.journal.cityId || current.guestId !== this.guestId)) throw new Error('saved-city-recovery-required'); for (const [id, r] of Object.entries(this.journal.receipts)) if (r.state === 'applied' || r.state === 'delivered') { const saved = current?.receipts[id] as typeof r | undefined; if (!saved || !['applied', 'delivered'].includes(saved.state) || saved.claimId !== r.claimId || saved.firmId !== r.firmId || saved.itemId !== r.itemId || saved.quantity !== r.quantity) throw new Error('saved-city-recovery-required'); } await write(this.exportSave()); },true); }
  private async writer<T>(work: () => Promise<T>, allowRecoveryReadOnly=false): Promise<T> {
    if (this.journalUnavailable) throw new Error('market-journal-unavailable');
    const checked=async()=>{if(this.recoveryReadOnly&&!allowRecoveryReadOnly)throw Error('market-disabled-in-recovery');return work();};
    if (typeof window === 'undefined') return checked(); // Node-only integration harness; browsers must provide Web Locks.
    const locks = globalThis.navigator?.locks as MarketWriterLocks | undefined;
    return withMarketWriter({ locks, expectedJournal: this.revision, readJournal: () => globalThis.localStorage.getItem(MARKET_SAVE_KEY), work:checked });
  }
  private async request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers); headers.set('Accept', 'application/json');
    if (init.method && init.method !== 'GET') headers.set('Content-Type', 'application/json');
    if (this.usesPagesAuth) { const token = pagesSession.bearer(); if (!token || (path !== '/v1/me' && !pagesSession.verifiedGuest)) { const error = new Error('pages-session-required'); (error as Error & { status: number }).status = 401; throw error; } if (this.guestId && pagesSession.guestId !== this.guestId) throw new Error('market guest identity mismatch'); headers.set('Authorization', `Bearer ${token}`); headers.delete('x-csrf-token'); }
    else if (init.method && init.method !== 'GET') headers.set('x-csrf-token', readCsrf());
    const r = await fetch(`${this.baseUrl}${path}`, { ...init, headers, credentials: this.usesPagesAuth ? 'omit' : 'include' });
    let body: any = null; try { body = await r.json(); } catch { /* empty response */ }
    if (!r.ok) { const e = new Error(body?.error?.code ?? body?.error ?? `HTTP ${r.status}`); (e as any).status = r.status; if (r.status === 409 && body && typeof body === 'object') Object.defineProperty(e, 'marketResponse', { value: body }); throw e; }
    return body;
  }
  read(path: string) { if (!path.startsWith('/v1/') || path.includes('://')) throw new Error('invalid-market-path'); return this.request(path); }
  private ensurePagesAccess() { if (this.usesPagesAuth && (!pagesSession.verifiedGuest || pagesSession.verifiedGuest !== this.guestId)) throw new Error('pages-session-required'); }
  private op(kind: MarketOperation['kind'], payload: Record<string, unknown>) {
    this.ensurePagesAccess();
    if (!this.guestId) throw new Error('guest-required');
    if (this.journal.operations.some(o => o.state === 'pending')) throw new Error('operation-requires-reconciliation');
    const validAmount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0 && n <= 1_000_000;
    if (kind === 'listing' && (!MARKET_ITEMS.includes(payload.item_code as MarketItem) || !validAmount(payload.unit_price) || !validAmount(payload.quantity) || BigInt(payload.unit_price) * BigInt(payload.quantity) > 9_000_000_000_000_000n)) throw new Error('invalid-market-listing');
    if (kind === 'buy' && (typeof payload.listing_id !== 'string' || !UUID.test(payload.listing_id) || !validAmount(payload.quantity))) throw new Error('invalid-market-buy');
    if (kind === 'cancel' && (typeof payload.listing_id !== 'string' || !UUID.test(payload.listing_id))) throw new Error('invalid-market-cancel');
    const operation: MarketOperation = { opId: uuid(), guestId: this.guestId, cityId: this.journal.cityId, kind, payload, state: 'pending', createdAt: new Date().toISOString() };
    this.journal.operations.push(operation); try { this.save(); } catch (e) { this.journal.operations.pop(); throw new Error(`market journal unavailable: ${e instanceof Error ? e.message : 'storage failure'}`); } return operation;
  }
  private finish(op: MarketOperation) { op.state = 'confirmed'; try { this.save(); } catch (e) { op.state = 'pending'; throw e; } }
  private finishRejectedTrade(op: MarketOperation, error: unknown) {
    const e = error as Error & { status?: number; marketResponse?: Record<string, unknown>; definitiveTradeRejection?: boolean }, r = e?.marketResponse, p = r?.payload as Record<string, unknown> | undefined;
    if (e?.status !== 409 || !r || r.code !== 'trade_rejected' || r.state !== 'rejected' || r.committed !== false || r.kind !== op.kind || r.key !== op.opId || r.guest_id !== op.guestId || op.guestId !== this.guestId || op.cityId !== this.journal.cityId || op.state !== 'pending' || !p || typeof p !== 'object') return;
    const keys = Object.keys(p).sort().join(','), originalKeys = Object.keys(op.payload).sort().join(',');
    const valid = op.kind === 'buy' ? ['listing unavailable', 'cannot buy own listing', 'insufficient stock', 'insufficient wallet'].includes(String(r.error)) && keys === 'listing_id,quantity' && originalKeys === 'listing_id,quantity' && p.listing_id === op.payload.listing_id && p.quantity === op.payload.quantity : op.kind === 'listing' ? r.error === 'insufficient inventory' && keys === 'expires_at,item_code,quantity,unit_price' && originalKeys === 'item_code,quantity,unit_price' && p.item_code === op.payload.item_code && p.unit_price === op.payload.unit_price && p.quantity === op.payload.quantity && p.expires_at === null : op.kind === 'cancel' ? ['listing not open', 'listing not found'].includes(String(r.error)) && op.payload.key_sent === true && ['key_sent,listing_id', 'key_sent,listing_id,recovery_keyed'].includes(originalKeys) && keys === 'listing_id' && p.listing_id === op.payload.listing_id : false;
    if (!valid) return;
    op.state = 'quarantined'; try { this.save(); } catch (saveError) { op.state = 'pending'; throw saveError; } e.definitiveTradeRejection = true;
  }
  private pendingFor(kind: MarketOperation['kind'], field: string, value: string) { return this.journal.operations.find(o => o.state === 'pending' && o.kind === kind && o.guestId === this.guestId && o.cityId === this.journal.cityId && o.payload[field] === value); }
  async resume() {
    if (!this.enabled) return null;
    try { return await this.reconcileSession(await this.request('/v1/me')); }
    catch (e) { if ((e as any).status === 401 && !(this.guestId || this.journal.operations.length || Object.keys(this.journal.receipts).length || this.journal.escrow.length)) return null; throw e; }
  }
  async checkSession() {
    try { return await this.request('/v1/me'); }
    catch (e) { if ((e as any).status === 401) return null; throw e; }
  }
  async reconcileSession(me: { guest_id: string; seq?: string }) { try { return await this.writer(() => this.reconcileSessionUnlocked(me)); } catch (error) { if (this.usesPagesAuth) pagesSession.clear(); throw error; } }
  private async reconcileSessionUnlocked(me: { guest_id: string; seq?: string }) {
    if (!UUID.test(String(me?.guest_id)) || !/^\d+$/.test(String(me.seq ?? ''))) throw new Error('invalid guest session');
    if (this.guestId && this.guestId !== me.guest_id) throw new Error('market guest identity mismatch');
    const previous = BigInt(this.journal.seq), incoming = BigInt(me.seq!);
    if (incoming < previous) throw new Error('market sequence rollback');
    if (this.guestId && incoming > previous) throw new Error('market sequence gap requires reconciliation');
    this.guestId = me.guest_id; this.journal.guestId = me.guest_id; this.journal.seq = String(me.seq); this.save(); if (this.usesPagesAuth) pagesSession.activate(me.guest_id); return me;
  }
  acceptSession(me: { guest_id: string; seq?: string }) {
    if (!UUID.test(String(me?.guest_id))) throw new Error('invalid guest session');
    if (this.guestId && me.guest_id !== this.guestId) throw new Error('market guest identity mismatch');
    if (this.guestId) return me; // Keep the saved sequence and pending operations for normal reconciliation.
    throw new Error('market-session-reconciliation-required');
  }
  async createGuest() { return this.writer(async () => { const existing = await this.checkSession(); if (existing) return this.reconcileSessionUnlocked(existing); if (this.guestId || this.journal.operations.length || this.journal.escrow.length || Object.keys(this.journal.receipts).length) throw new Error('guest-session-recovery-required'); const me = await this.request('/v1/auth/guest', { method: 'POST', body: '{}' }); if (!UUID.test(String(me?.guest_id))) throw new Error('invalid guest session'); this.guestId = me.guest_id; this.journal.guestId = this.guestId; this.save(); return me; }); }
  async quarantine() { return this.writer(async () => { const old = JSON.stringify(this.journal); if (globalThis.localStorage) globalThis.localStorage.setItem(`${MARKET_SAVE_KEY}.quarantine.${this.journal.cityId}.${Date.now()}`, old); const journal = this.journal, guest = this.guestId; this.journal = safeJournal(null); this.guestId = null; try { this.save(); } catch (e) { this.journal = journal; this.guestId = guest; throw e; } }); }
  async resetCity() { return this.writer(async () => { if (this.guestId || this.journal.operations.length || this.journal.escrow.length || Object.keys(this.journal.receipts).length) throw new Error('market-city-reset-requires-reconciliation'); const old = JSON.stringify(this.journal); if (globalThis.localStorage) globalThis.localStorage.setItem(`${MARKET_SAVE_KEY}.city-${this.journal.cityId}`, old); const journal = this.journal; this.journal = safeJournal(null); try { this.save(); } catch (e) { this.journal = journal; throw e; } }); }
  private stock(firmId: number, itemId: MarketItem) { const product = itemId.startsWith('product:'), key = itemId.slice(itemId.indexOf(':') + 1); if (product ? !isProductId(key) : !isCropId(key)) throw new Error('invalid typed market item'); const f = this.city().firms.find(f => f.id === firmId && (product ? f.zone === 'I' && !!f.recipe && (RECIPE[f.recipe].product === key || !!f.recipeChoices) : f.zone === 'F')); if (!f) throw new Error('typed source firm required'); const bucket = (product ? f.products : f.crops) as Record<string, number>; return { f, bucket, key } as const; }
  async deposit(firmId: number, itemId: MarketItem, quantity: number, saveCity: () => void) { return this.writer(() => this.depositUnlocked(firmId, itemId, quantity, saveCity)); }
  private async depositUnlocked(firmId: number, itemId: MarketItem, quantity: number, saveCity: () => void) {
    if (!MARKET_ITEMS.includes(itemId) || !Number.isSafeInteger(quantity) || quantity < 1) throw new Error('invalid typed deposit');
    const { f, bucket, key } = this.stock(firmId, itemId); const current = bucket[key as keyof typeof bucket]; if (!Number.isSafeInteger(current) || current < quantity) throw new Error('insufficient typed firm stock');
    const o = this.op('deposit', { itemId, qty: quantity, firmId }); const value = itemId.startsWith('crop:') ? releaseCropCost(f.cropInventory, f.cropCost, quantity) : 0; const escrow: MarketEscrow = { opId: o.opId, cityId: this.journal.cityId, firmId, itemId, quantity, value, state: 'pending' }; const old = current; bucket[key as keyof typeof bucket] = old - quantity; this.journal.escrow.push(escrow);
    const crop = key as keyof typeof f.crops; const product = key as ProductId; const isCrop = itemId.startsWith('crop:');
    const event = { tick: this.city().tick, from: f.wallet, to: isCrop ? 'market-server' : 'outside', quantity, reason: `Market escrow deposit #${isCrop ? this.city().cropLedger.length + 1 : this.city().goodsLedger.length + 1}`, ...(isCrop ? { id: this.city().cropLedger.length + 1, kind: 'market-deposit' as const, fromValue: value, toValue: value, cash: 0, workers: 0, batches: 0, outputQuantity: 0, crop } : { product }) };
    if (isCrop) { f.cropInventory -= quantity; f.cropCost -= value; this.city().cropLedger.push(event as any); } else { f.inventory -= quantity; this.city().goods.exported += quantity; this.city().goodsLedger.push(event as any); }
    try { saveCity(); } catch (e) { if (isCrop) { this.city().cropLedger.pop(); f.cropInventory += quantity; f.cropCost += value; } else { this.city().goodsLedger.pop(); f.inventory += quantity; this.city().goods.exported -= quantity; } bucket[isCrop ? crop : product] = old; this.journal.escrow.pop(); this.journal.operations.pop(); try { this.save(); } catch { /* retain in-memory recovery state */ } throw e; }
    const result = await this.request('/v1/deposits', { method: 'POST', body: JSON.stringify({ opId: o.opId, itemId, qty: quantity }) }); const priorSeq = this.journal.seq; escrow.state = 'confirmed'; o.state = 'confirmed'; this.journal.seq = String(result.seq ?? this.journal.seq); try { saveCity(); } catch (e) { escrow.state = 'pending'; o.state = 'pending'; this.journal.seq = priorSeq; throw e; } return result;
  }
  async fenceDeposit(opId: string, saveCity: () => void) { return this.writer(() => this.fenceDepositUnlocked(opId, saveCity)); }
  private async fenceDepositUnlocked(opId: string, saveCity: () => void) { const e = this.journal.escrow.find(x => x.opId === opId); if (!e || e.state !== 'pending') throw new Error('deposit-not-pending'); let status = await this.request(`/v1/op/${encodeURIComponent(opId)}`); if (status.state === 'done') throw new Error('deposit-already-done'); if (status.state === 'unknown') { await this.request(`/v1/op/${encodeURIComponent(opId)}/cancel`, { method: 'POST', body: '{}' }); status = await this.request(`/v1/op/${encodeURIComponent(opId)}`); } if (status.state !== 'cancelled') throw new Error('deposit-not-fenced'); const { f, bucket, key } = this.stock(e.firmId, e.itemId); const isCrop = e.itemId.startsWith('crop:'), product = key as ProductId; if (isCrop) { const farmBuilding = this.city().buildings.find(b => b.id === f.building && b.zone === 'F'); if (!farmBuilding) throw new Error('farm-building-missing'); if (f.cropInventory + e.quantity > farmStockCapacity(farmBuilding.level)) throw new Error('farm-stock-full-for-refund'); } bucket[key as keyof typeof bucket] += e.quantity; if (isCrop) { f.cropInventory += e.quantity; const value = e.value ?? 0; f.cropCost += value; this.city().cropLedger.push({ id: this.city().cropLedger.length + 1, tick: this.city().tick, kind: 'market-refund', from: 'market-server', to: f.wallet, quantity: e.quantity, fromValue: value, toValue: value, cash: 0, workers: 0, batches: 0, outputQuantity: 0, reason: `Market escrow refund #${this.city().cropLedger.length + 1}`, crop: key as keyof typeof f.crops }); } else { f.inventory += e.quantity; this.city().goods.imported += e.quantity; this.city().goodsLedger.push({ tick: this.city().tick, from: 'outside', to: f.wallet, quantity: e.quantity, reason: `Market escrow refund #${this.city().goodsLedger.length + 1}`, product }); } e.state = 'cancelled'; const o = this.journal.operations.find(x => x.opId === opId), priorState = o?.state; if (o) o.state = 'confirmed'; try { saveCity(); } catch (error) { bucket[key as keyof typeof bucket] -= e.quantity; if (isCrop) { f.cropInventory -= e.quantity; f.cropCost -= e.value ?? 0; this.city().cropLedger.pop(); } else { f.inventory -= e.quantity; this.city().goods.imported -= e.quantity; this.city().goodsLedger.pop(); } e.state = 'pending'; if (o && priorState) o.state = priorState; throw error; } return status; }
  async recoverDeposit(opId: string, saveCity: () => void) { return this.writer(() => this.recoverDepositUnlocked(opId, saveCity)); }
  private async recoverDepositUnlocked(opId: string, saveCity: () => void) { const e = this.journal.escrow.find(x => x.opId === opId), o = this.journal.operations.find(x => x.opId === opId); if (!e || e.state !== 'pending' || !o || o.state !== 'pending' || o.cityId !== this.journal.cityId || o.guestId !== this.guestId || o.kind !== 'deposit' || o.payload.firmId !== e.firmId || o.payload.itemId !== e.itemId || o.payload.qty !== e.quantity) throw new Error('deposit-reconciliation-required'); const status = await this.request(`/v1/op/${encodeURIComponent(opId)}`); if (status.state === 'done') { const priorSeq = this.journal.seq; e.state = 'confirmed'; o.state = 'confirmed'; this.journal.seq = String(status.seq ?? this.journal.seq); try { saveCity(); } catch (error) { e.state = 'pending'; o.state = 'pending'; this.journal.seq = priorSeq; throw error; } return status; } if (status.state === 'cancelled') return this.fenceDepositUnlocked(opId, saveCity); throw new Error('deposit-reconciliation-required'); }
  async listings() { return this.request('/v1/listings'); }
  async myListings(): Promise<MarketListing[]> { const rows = await this.request('/v1/my/listings') as MarketListing[]; const visible = rows.filter(row => row.status === 'open'); Object.defineProperty(visible, 'allRows', { value: rows }); return visible; }
  async wallet() { return this.request('/v1/wallet'); }
  async inventory() { return this.request('/v1/inventory'); }
  async list(item_code: MarketItem, unit_price: number, quantity: number) { return this.writer(() => this.listUnlocked(item_code, unit_price, quantity)); }
  private async listUnlocked(item_code: MarketItem, unit_price: number, quantity: number) { const o = this.op('listing', { item_code, unit_price, quantity }); try { const result = await this.request('/v1/listings', { method: 'POST', headers: { 'Idempotency-Key': o.opId }, body: JSON.stringify({ item_code, unit_price, quantity }) }); this.finish(o); return result; } catch (error) { this.finishRejectedTrade(o, error); throw error; } }
  async buy(listing_id: string, quantity: number) { return this.writer(() => this.buyUnlocked(listing_id, quantity)); }
  private async buyUnlocked(listing_id: string, quantity: number) { const o = this.op('buy', { listing_id, quantity }); try { const result = await this.request(`/v1/listings/${encodeURIComponent(listing_id)}/buy`, { method: 'POST', headers: { 'Idempotency-Key': o.opId }, body: JSON.stringify({ quantity }) }); this.finish(o); return result; } catch (error) { this.finishRejectedTrade(o, error); throw error; } }
  /** Explicit candidate recovery only; routes are not yet public. Unknown never releases a pending intent. */
  async reconcileOperation(opId: string, action: 'status' | 'fence') { return this.writer(async () => {
    if (action !== 'status' && action !== 'fence') throw new Error('invalid-recovery-action');
    if (!this.recoveryEnabled) throw new Error('market-recovery-disabled'); const o = this.journal.operations.find(x => x.opId === opId); if (!o || o.state !== 'pending' || o.guestId !== this.guestId || o.cityId !== this.journal.cityId || !['buy', 'listing', 'cancel'].includes(o.kind) || !UUID.test(o.opId)) throw new Error('operation-not-recoverable');
    const p = o.payload, positive = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
    let payload: Record<string, unknown>;
    if (o.kind === 'buy') { if (Object.keys(p).length !== 2 || typeof p.listing_id !== 'string' || !UUID.test(p.listing_id) || !positive(p.quantity)) throw new Error('invalid-recovery-payload'); payload = { listing_id: p.listing_id, quantity: p.quantity }; }
    else if (o.kind === 'listing') { if (Object.keys(p).length !== 3 || typeof p.item_code !== 'string' || !MARKET_ITEMS.includes(p.item_code as MarketItem) || !positive(p.unit_price) || !positive(p.quantity)) throw new Error('invalid-recovery-payload'); payload = { item_code: p.item_code, unit_price: p.unit_price, quantity: p.quantity, expires_at: null }; }
    else { if (Object.keys(p).length !== 3 || p.key_sent !== true || p.recovery_keyed !== true || typeof p.listing_id !== 'string' || !UUID.test(p.listing_id)) throw new Error('legacy-cancel-reconciliation-required'); payload = { listing_id: p.listing_id }; }
    const result = await this.request(`/v1/recovery/${action}`, { method: 'POST', body: JSON.stringify({ kind: o.kind, key: o.opId, payload }) });
    if (result?.state === 'unknown' || result?.state === 'reconciliation_required') return result;
    if (result?.state === 'fenced' && result.kind === o.kind && result.committed === false) { const prior = o.state; o.state = 'quarantined'; try { this.save(); } catch (e) { o.state = prior; throw e; } return result; }
    if (result?.state === 'done' && result.kind === o.kind && result.http_status === (o.kind === 'cancel' ? 200 : 201) && result.response && typeof result.response === 'object') { const r = result.response; const valid = o.kind === 'buy' ? r.listing_id === p.listing_id && r.quantity === p.quantity && UUID.test(String(r.operation_id)) : o.kind === 'listing' ? r.item_code === p.item_code && r.quantity === p.quantity && r.unit_price === p.unit_price && UUID.test(String(r.id)) : r.id === p.listing_id && r.status === 'cancelled'; if (!valid) throw new Error('invalid-recovery-result'); if (o.kind !== 'buy') this.finish(o); return result; }
    throw new Error('invalid-recovery-result');
  }); }
  async retry(opId: string, saveCity?: () => void) { return this.writer(() => this.retryUnlocked(opId, saveCity)); }
  private async retryUnlocked(opId: string, saveCity?: () => void) { const o = this.journal.operations.find(x => x.opId === opId); if (!o || o.guestId !== this.guestId || o.cityId !== this.journal.cityId || o.state !== 'pending') throw new Error('operation-not-retryable'); let result; try { if (o.kind === 'buy') result = await this.request(`/v1/listings/${encodeURIComponent(String(o.payload.listing_id))}/buy`, { method: 'POST', headers: { 'Idempotency-Key': o.opId }, body: JSON.stringify({ quantity: o.payload.quantity }) }); else if (o.kind === 'listing') result = await this.request('/v1/listings', { method: 'POST', headers: { 'Idempotency-Key': o.opId }, body: JSON.stringify(o.payload) }); else if (o.kind === 'cancel') result = await this.request(`/v1/listings/${encodeURIComponent(String(o.payload.listing_id))}/cancel`, { method: 'POST', headers: o.payload.key_sent === true ? { 'Idempotency-Key': o.opId } : undefined, body: '{}' }); else if (o.kind === 'claim') return this.claimUnlocked(String(o.payload.receipt_id)); else if (o.kind === 'ack' && saveCity) return this.recoverReceiptUnlocked(String(o.payload.receipt_id), saveCity); else if (o.kind === 'deposit' && saveCity) return this.recoverDepositUnlocked(o.opId, saveCity); else throw new Error('operation-requires-reconciliation'); } catch (error) { this.finishRejectedTrade(o, error); throw error; } this.finish(o); return result; }
  async cancelListing(id: string) { return this.writer(() => this.cancelListingUnlocked(id)); }
  private async cancelListingUnlocked(id: string) { const o = this.pendingFor('cancel', 'listing_id', id) ?? this.op('cancel', { listing_id: id, key_sent: true, recovery_keyed: this.recoveryEnabled }); const headers = o.payload.key_sent === true ? { 'Idempotency-Key': o.opId } : undefined; try { const result = await this.request(`/v1/listings/${encodeURIComponent(id)}/cancel`, { method: 'POST', headers, body: '{}' }); this.finish(o); return result; } catch (error) { this.finishRejectedTrade(o, error); throw error; } }
  async receipts(state = '') { const rows = await this.request(`/v1/receipts${state ? `?state=${encodeURIComponent(state)}` : ''}`); return rows.map((r: MarketReceipt) => { const quantity = Number(r.quantity); if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error('invalid typed market receipt'); return { ...r, quantity }; }); }
  async claim(receiptId: string) { return this.writer(() => this.claimUnlocked(receiptId)); }
  private async claimUnlocked(receiptId: string) { this.ensurePagesAccess(); const existing = this.journal.receipts[receiptId]; if (existing?.state === 'applied' || existing?.state === 'delivered') return { state: existing.state, idempotent: true }; const claimId = existing?.claimId ?? uuid(); const pending = this.pendingFor('claim', 'receipt_id', receiptId); if (!pending && this.journal.operations.some(o => o.state === 'pending')) throw new Error('operation-requires-reconciliation'); if (!existing) { this.journal.receipts[receiptId] = { claimId, state: 'claimed' }; try { this.save(); } catch (e) { delete this.journal.receipts[receiptId]; throw e; } } const o = pending ?? this.op('claim', { receipt_id: receiptId, claim_id: claimId }); if (o.payload.claim_id !== claimId) throw new Error('claim-reconciliation-required'); const result = await this.request(`/v1/receipts/${encodeURIComponent(receiptId)}/claim`, { method: 'POST', body: JSON.stringify({ claimId }) }); this.finish(o); return result; }
  private assertAppliedReceiptDurable(receiptId: string) {
    const receipt = this.journal.receipts[receiptId]; if (!receipt || !['applied', 'delivered'].includes(receipt.state) || !Number.isSafeInteger(receipt.firmId) || !receipt.itemId || !MARKET_ITEMS.includes(receipt.itemId) || !Number.isSafeInteger(receipt.quantity) || receipt.quantity! < 1) throw new Error('saved-city-recovery-required');
    try {
      const raw = this.readDurableCity(this.journal.cityId); if (!raw) throw new Error('missing save'); const savedCity = deserialize(raw); const market = savedCity.market ? safeJournal(JSON.stringify(savedCity.market)) : null; const saved = market?.receipts[receiptId];
      const { market: _currentMarket, ...currentCity } = this.city(); const { market: _savedMarket, ...durableCity } = savedCity;
      if (!market || market.cityId !== this.journal.cityId || market.guestId !== this.guestId || !saved || !['applied', 'delivered'].includes(saved.state) || saved.claimId !== receipt.claimId || saved.firmId !== receipt.firmId || saved.itemId !== receipt.itemId || saved.quantity !== receipt.quantity || JSON.stringify(currentCity) !== JSON.stringify(durableCity)) throw new Error('mismatch');
    } catch { throw new Error('saved-city-recovery-required'); }
  }
  async ack(receiptId: string) { return this.writer(() => this.ackUnlocked(receiptId)); }
  private async ackUnlocked(receiptId: string) { const r = this.journal.receipts[receiptId]; if (!r || (r.state !== 'applied' && r.state !== 'delivered')) throw new Error('receipt-not-applied'); this.assertAppliedReceiptDurable(receiptId); const o = this.pendingFor('ack', 'receipt_id', receiptId) ?? this.op('ack', { receipt_id: receiptId, claim_id: r.claimId }); if (o.payload.claim_id !== r.claimId) throw new Error('claim-reconciliation-required'); const result = await this.request(`/v1/receipts/${encodeURIComponent(receiptId)}/ack`, { method: 'POST', body: JSON.stringify({ claimId: r.claimId }) }); const previous = r.state; r.state = 'delivered'; try { this.finish(o); } catch (e) { r.state = previous; throw e; } return result; }
  async recoverReceipt(receiptId: string, saveCity: () => void) { return this.writer(() => this.recoverReceiptUnlocked(receiptId, saveCity)); }
  private async recoverReceiptUnlocked(receiptId: string, saveCity: () => void) { const r = this.journal.receipts[receiptId]; if (!r || (r.state !== 'applied' && r.state !== 'delivered')) throw new Error('receipt-not-recoverable'); const market = this.city().market; const saved = market?.receipts[receiptId] as typeof r | undefined; if (!market || market.cityId !== this.journal.cityId || market.guestId !== this.guestId || !saved || !['applied', 'delivered'].includes(saved.state) || saved.claimId !== r.claimId || saved.firmId !== r.firmId || saved.itemId !== r.itemId || saved.quantity !== r.quantity) throw new Error('saved-city-recovery-required'); const result = await this.ackUnlocked(receiptId); saveCity(); return result; }
  receiptDestinations(receipt: MarketReceipt) {
    if (!MARKET_ITEMS.includes(receipt.item_code as MarketItem) || !Number.isSafeInteger(receipt.quantity) || receipt.quantity < 1) throw new Error('invalid typed market receipt');
    const product = receipt.item_code.startsWith('product:'), cropKey = receipt.item_code.slice(5);
    return this.city().firms.filter(f => product ? f.commercialKind === 'retail' : isMarket(f) || (f.zone === 'I' && f.recipe !== undefined && RECIPE[f.recipe].crop === cropKey)).map(f => {
      const building = this.city().buildings.find(b => b.id === f.building); const holdings = [...Object.values(f.crops), ...Object.values(f.products)];
      // Keep the historical receipt rule at levels 1–3. Expanded factories
      // measure crop storage independently of their finished-goods inventory.
      const total = !product && f.zone === 'I' && building && building.level > 3 ? Object.values(f.crops).reduce((a, n) => a + n, 0) : holdings.reduce((a, n) => a + n, 0); const capacity = product ? PRODUCT_STOCK_CAP : isMarket(f) ? CROP_STOCK_CAPS.T : building ? factoryCropCapacity(building.level) : CROP_STOCK_CAPS.I;
      return { firmId: f.id, kind: product ? 'retail' : isMarket(f) ? 'market' : 'factory', available: capacity - total, eligible: Boolean(building) && holdings.every(n => Number.isSafeInteger(n) && n >= 0) && Number.isSafeInteger(total) && total + receipt.quantity <= capacity };
    }).filter(x => x.eligible).map(({ firmId, kind, available }) => ({ firmId, kind, available }));
  }
  /** Apply a canonical item to an eligible city firm, persist the city, then ACK the claim. */
  async applyAndAck(receipt: MarketReceipt, saveCity: () => void, firmId?: number) { return this.writer(() => this.applyAndAckUnlocked(receipt, saveCity, firmId)); }
  private async applyAndAckUnlocked(receipt: MarketReceipt, saveCity: () => void, firmId?: number) {
    this.ensurePagesAccess();
    const record = this.journal.receipts[receipt.receipt_id]; if (!record) throw new Error('claim-required');
    if (this.pendingFor('claim', 'receipt_id', receipt.receipt_id)) throw new Error('claim-reconciliation-required');
    if (record.state === 'claimed' && !this.journal.operations.some(o => o.kind === 'claim' && o.state === 'confirmed' && o.guestId === this.guestId && o.cityId === this.journal.cityId && o.payload.receipt_id === receipt.receipt_id && o.payload.claim_id === record.claimId)) throw new Error('claim-reconciliation-required');
    if (firmId !== undefined && (!Number.isSafeInteger(firmId) || (record.firmId !== undefined && record.firmId !== firmId))) throw new Error('receipt-destination-mismatch');
    if (record.state === 'applied') { if (record.itemId !== receipt.item_code || record.quantity !== receipt.quantity) throw new Error('receipt-payload-mismatch'); return this.recoverReceiptUnlocked(receipt.receipt_id, saveCity); }
    if (record.state === 'delivered') return { state: 'delivered', idempotent: true };
    if (!MARKET_ITEMS.includes(receipt.item_code as MarketItem) || !Number.isSafeInteger(receipt.quantity) || receipt.quantity < 1) throw new Error('invalid typed market receipt');
    const item = receipt.item_code as MarketItem, wantsProduct = item.startsWith('product:');
    const eligible = this.receiptDestinations(receipt).sort((a, b) => !wantsProduct ? Number(a.kind === 'market') - Number(b.kind === 'market') : 0);
    const selected = firmId === undefined ? eligible[0] : eligible.find(x => x.firmId === firmId);
    const selectedFirm = selected && this.city().firms.find(f => f.id === selected.firmId);
    if (!selectedFirm) throw new Error('no typed market firm capacity');
    const firm = { f: selectedFirm };
    const oldCrops = { ...firm.f.crops }, oldProducts = { ...firm.f.products }, oldCropInventory = firm.f.cropInventory, oldCropCost = firm.f.cropCost;
    if (item.startsWith('crop:')) firm.f.crops[item.slice(5) as keyof typeof firm.f.crops] += receipt.quantity;
    else firm.f.products[item.slice(8) as keyof typeof firm.f.products] += receipt.quantity;
    if (item.startsWith('crop:')) { firm.f.cropInventory += receipt.quantity; this.city().cropLedger.push({ id: this.city().cropLedger.length + 1, tick: this.city().tick, kind: 'market-receipt', from: 'market-server', to: firm.f.wallet, quantity: receipt.quantity, fromValue: 0, toValue: 0, cash: 0, workers: 0, batches: 0, outputQuantity: 0, reason: `Market receipt #${this.city().cropLedger.length + 1}`, crop: item.slice(5) as keyof typeof firm.f.crops }); } else { firm.f.inventory += receipt.quantity; this.city().goods.imported += receipt.quantity; this.city().goodsLedger.push({ tick: this.city().tick, from: 'outside', to: firm.f.wallet, quantity: receipt.quantity, reason: `Market receipt #${this.city().goodsLedger.length + 1}`, product: item.slice(8) as keyof typeof firm.f.products }); }
    const oldRecord = { ...record }; record.state = 'applied'; record.firmId = firm.f.id; record.itemId = item; record.quantity = receipt.quantity;
    try { saveCity(); } catch (e) { if (item.startsWith('crop:')) this.city().cropLedger.pop(); else { this.city().goodsLedger.pop(); this.city().goods.imported -= receipt.quantity; } firm.f.crops = oldCrops; firm.f.products = oldProducts; firm.f.cropInventory = oldCropInventory; firm.f.cropCost = oldCropCost; firm.f.inventory = Object.values(oldProducts).reduce((a, n) => a + n, 0); Object.assign(record, oldRecord); try { this.save(); } catch { /* preserve in-memory recovery state */ } throw e; }
    try { const result = await this.ackUnlocked(receipt.receipt_id); saveCity(); return result; } catch (e) { throw e; }
  }
}

export const marketJournalForTest = (raw: string | null) => safeJournal(raw);
