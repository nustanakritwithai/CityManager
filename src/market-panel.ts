import { MARKET_ITEMS, MarketClient, type MarketItem, type MarketListing } from './market-client.ts';
import { marketBaseUrl } from './market-flag.ts';
import { MarketAsync } from './market-async.ts';
import { RECIPE, RECIPE_LABELS, type ProductId } from './goods.ts';
import type { City, Firm } from './sim.ts';

const labels: Record<string, string> = {'crop:rice':'ข้าว','crop:vegetables':'ผัก','crop:sugarcane':'อ้อย','product:milled-rice':'ข้าวสาร','product:canned-food':'อาหารกระป๋อง','product:sugar':'น้ำตาล'};
const recoveryApiEnabled = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_MARKET_RECOVERY_API === 'true';
export const marketUnit = (item: string) => item.startsWith('crop:') ? 'ล็อต' : 'หน่วย';
const stateLabel = (value: string) => ({ open: 'เปิดขาย', sold: 'ขายหมด', sold_out: 'ขายหมด', cancelled: 'ยกเลิกแล้ว', expired: 'หมดอายุ', ready: 'พร้อมรับ', claimed: 'กำลังรับ', 'claim-timeout': 'รอตรวจสอบ', delivered: 'รับแล้ว', applied: 'รับเข้าเมืองแล้ว' } as Record<string, string>)[value] ?? value;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => { const n = document.createElement(tag); n.textContent = text; return n; };
const button = (text: string, action: () => void) => { const b = el('button', text); b.type = 'button'; b.addEventListener('click', action); return b; };
// Illustrations identify the six supported goods without inventing market data.
// Filled, shaded artwork in the market's gold-on-dark style; each icon has its own gradient ids.
const productArtwork: Record<string, string> = {
  'crop:rice': `<defs><linearGradient id="mk-rice" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff1b0"/><stop offset="1" stop-color="#d39a2a"/></linearGradient></defs>
    <path d="M31 60c0-17-2-29-9-44M33 60c0-17 3-29 11-42M32 60c0-16 0-30 1-46" fill="none" stroke="#9bb446" stroke-width="2.6" stroke-linecap="round"/>
    <g fill="url(#mk-rice)" stroke="#8a5d14" stroke-width="1">
      <ellipse cx="21" cy="14" rx="2.8" ry="5" transform="rotate(-30 21 14)"/><ellipse cx="17" cy="22" rx="2.8" ry="5" transform="rotate(-62 17 22)"/><ellipse cx="25" cy="22" rx="2.8" ry="5" transform="rotate(8 25 22)"/><ellipse cx="20" cy="30" rx="2.8" ry="5" transform="rotate(-55 20 30)"/>
      <ellipse cx="45" cy="16" rx="2.8" ry="5" transform="rotate(32 45 16)"/><ellipse cx="49" cy="24" rx="2.8" ry="5" transform="rotate(62 49 24)"/><ellipse cx="41" cy="24" rx="2.8" ry="5" transform="rotate(-8 41 24)"/><ellipse cx="46" cy="32" rx="2.8" ry="5" transform="rotate(55 46 32)"/>
      <ellipse cx="33" cy="10" rx="2.8" ry="5"/><ellipse cx="29" cy="18" rx="2.6" ry="4.6" transform="rotate(-35 29 18)"/><ellipse cx="37" cy="18" rx="2.6" ry="4.6" transform="rotate(35 37 18)"/>
    </g><path d="M26 50c4 2 8 2 12 0" stroke="#c9a35a" stroke-width="3" stroke-linecap="round" fill="none"/>`,
  'crop:vegetables': `<defs><radialGradient id="mk-veg" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#c8f08a"/><stop offset=".6" stop-color="#4fa83c"/><stop offset="1" stop-color="#245e22"/></radialGradient></defs>
    <path d="M32 58c-14 0-22-9-22-20 0-9 6-16 12-17 3-6 17-6 20 0 6 1 12 8 12 17 0 11-8 20-22 20Z" fill="url(#mk-veg)" stroke="#1d4a1b" stroke-width="1.5"/>
    <path d="M32 56V30M32 40c-6-2-10-6-12-12M32 44c6-2 10-6 13-12M32 30c-3-3-4-7-3-11M32 30c3-3 5-6 5-10" fill="none" stroke="#e8f8c4" stroke-width="1.8" stroke-linecap="round" opacity=".8"/>
    <path d="M24 12c3 4 4 7 3 10M40 12c-3 4-4 7-3 10" stroke="#3d8a30" stroke-width="3" stroke-linecap="round"/>`,
  'crop:sugarcane': `<defs><linearGradient id="mk-cane" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7fae3c"/><stop offset=".5" stop-color="#d7e88a"/><stop offset="1" stop-color="#6b9a32"/></linearGradient></defs>
    <g stroke="#3f5e1d" stroke-width="1.2" fill="url(#mk-cane)"><rect x="17" y="16" width="7" height="44" rx="3" transform="rotate(-10 20 38)"/><rect x="29" y="10" width="7" height="50" rx="3"/><rect x="41" y="16" width="7" height="44" rx="3" transform="rotate(10 44 38)"/></g>
    <g stroke="#3f5e1d" stroke-width="2"><path d="M18 30h8M17 44h8M29 24h8M29 38h8M29 50h8M40 30h8M41 44h8"/></g>
    <path d="M32 11c-6-8-14-8-19-5 6 0 11 2 15 7M33 11c5-8 13-9 19-6-6 0-11 2-15 7" fill="#5f9a2c" stroke="#2f5216" stroke-width="1"/>`,
  'product:milled-rice': `<defs><linearGradient id="mk-sack" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9d4a6"/><stop offset="1" stop-color="#a7834c"/></linearGradient><radialGradient id="mk-grain" cx=".5" cy=".3" r=".7"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d9d2c0"/></radialGradient></defs>
    <path d="M16 26c0-5 4-8 16-8s16 3 16 8l3 24c0 6-8 9-19 9s-19-3-19-9l3-24Z" fill="url(#mk-sack)" stroke="#6b4f26" stroke-width="1.5"/>
    <path d="M18 24c4-10 24-10 28 0-4 5-24 5-28 0Z" fill="url(#mk-grain)" stroke="#9c927c" stroke-width="1"/>
    <g fill="#fff" opacity=".9"><ellipse cx="26" cy="20" rx="1.4" ry="2.4" transform="rotate(30 26 20)"/><ellipse cx="33" cy="17" rx="1.4" ry="2.4"/><ellipse cx="39" cy="20" rx="1.4" ry="2.4" transform="rotate(-30 39 20)"/></g>
    <path d="M18 30c8 3 20 3 28 0" fill="none" stroke="#6b4f26" stroke-width="2"/><path d="M27 40h10l-1 8h-8Z" fill="#c9a35a" stroke="#6b4f26"/>`,
  'product:canned-food': `<defs><linearGradient id="mk-tin" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8f969c"/><stop offset=".45" stop-color="#eef1f3"/><stop offset="1" stop-color="#7d848a"/></linearGradient><linearGradient id="mk-label" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8e2a1f"/><stop offset=".45" stop-color="#df5a3c"/><stop offset="1" stop-color="#7d241a"/></linearGradient></defs>
    <path d="M16 14h32v38c0 4-7 7-16 7s-16-3-16-7Z" fill="url(#mk-tin)" stroke="#4b5156" stroke-width="1.2"/>
    <ellipse cx="32" cy="14" rx="16" ry="5" fill="#d7dbde" stroke="#4b5156" stroke-width="1.2"/><ellipse cx="32" cy="14" rx="11" ry="3" fill="none" stroke="#9aa1a6"/>
    <path d="M16 24c0 3 7 6 16 6s16-3 16-6v20c0 3-7 6-16 6s-16-3-16-6Z" fill="url(#mk-label)"/>
    <path d="M27 37c0-5 2-8 5-9 3 1 5 4 5 9-1 4-9 4-10 0Z" fill="#f6d36b" stroke="#7a4b10" stroke-width="1"/><path d="M32 28v-3" stroke="#4e8a2a" stroke-width="2"/>`,
  'product:sugar': `<defs><linearGradient id="mk-cube" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cfd6de"/></linearGradient></defs>
    <g stroke="#8b97a4" stroke-width="1.2" stroke-linejoin="round">
      <path d="M12 40l12-6 12 6-12 6Z" fill="#fff"/><path d="M12 40v12l12 6V46Z" fill="url(#mk-cube)"/><path d="M36 40v12l-12 6V46Z" fill="#b9c3cd"/>
      <path d="M28 40l12-6 12 6-12 6Z" fill="#fff"/><path d="M28 40v12l12 6V46Z" fill="url(#mk-cube)"/><path d="M52 40v12l-12 6V46Z" fill="#b9c3cd"/>
      <path d="M20 26l12-6 12 6-12 6Z" fill="#fff"/><path d="M20 26v12l12 6V32Z" fill="url(#mk-cube)"/><path d="M44 26v12l-12 6V32Z" fill="#b9c3cd"/>
    </g><path d="M47 10l1.5 4 4 1.5-4 1.5L47 21l-1.5-4-4-1.5 4-1.5Z" fill="#f6dd8f"/>`
};
const productIcon = (id: string, size: 'sm' | 'lg' = 'sm') => {
  const icon = el('span'); icon.className = `market-product-icon market-icon-${size}`; icon.dataset.item = id; icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = `<svg viewBox="0 0 64 64">${productArtwork[id] ?? ''}</svg>`;
  return icon;
};
/** A gold coin glyph before a credit amount. */
const coin = () => { const c = el('i'); c.className = 'market-coin'; c.setAttribute('aria-hidden', 'true'); return c; };
const credit = (amount: unknown, suffix = '') => { const s = el('span'); s.className = 'market-credit'; s.append(coin(), el('b', String(amount)), ...(suffix ? [el('small', suffix)] : [])); return s; };
const categoryLabel = (id: string) => id.startsWith('crop:') ? 'พืชผล' : 'สินค้าแปรรูป';
const shortId = (id: string) => `#${id.slice(-6)}`;
const when = (value: unknown) => { const d = new Date(String(value ?? '')); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }); };
const errorText = (e: unknown) => { const m = e instanceof Error ? e.message : ''; const status=Number((e as {status?:unknown}|null)?.status??0); if(status===401)return 'เซสชัน Guest หมดอายุ กรุณาเข้าสู่ Guest เดิม';if(status>=500)return 'เซิร์ฟเวอร์ไม่พร้อม ผลรายการอาจยังไม่แน่นอน';return ({'insufficient inventory':'สต็อกตลาดของ Guest ไม่พอ','insufficient wallet':'เครดิตตลาดไม่พอ','policy-disabled':'นโยบายฝากของยังปิดอยู่ในการทดสอบนี้','guest-required':'กรุณาเข้าสู่ Guest ก่อน','guest session required':'กรุณาเข้าสู่ Guest ก่อน','csrf check failed':'เซสชันหมดอายุ กรุณาเข้าสู่ Guest เดิม','listing not found':'ไม่พบรายการขายนี้','unknown item':'ไม่มีสินค้านี้ในตลาด','unknown-item':'ไม่มีสินค้านี้ในตลาด'} as Record<string,string>)[m] ?? (m || 'เชื่อมต่อไม่ได้หรือเกิดข้อผิดพลาด'); };
const blocksMutations = (e: unknown) => { const s = Number((e as {status?:unknown} | null)?.status ?? 0); return s === 0 || s === 401 || s >= 500; };
const itemKey = (item: MarketItem) => item.slice(item.indexOf(':') + 1);
export const depositSourceStock = (firm: Firm, item: MarketItem) => { const key = itemKey(item); const v = item.startsWith('crop:') ? firm.zone === 'F' ? Number(firm.crops[key as keyof typeof firm.crops] ?? 0) : 0 : firm.zone === 'I' && firm.recipe && (RECIPE[firm.recipe].product === key || firm.recipeChoices) ? Number(firm.products[key as ProductId] ?? 0) : 0; return Number.isSafeInteger(v) && v > 0 ? v : 0; };
export const eligibleDepositFirms = (city: Pick<City,'firms'>, item: MarketItem) => city.firms.filter(f => depositSourceStock(f, item) > 0);
export const depositSourceLabel = (firm: Firm, item: MarketItem) => `${item.startsWith('crop:') ? `ฟาร์ม${labels[item] ?? ''}` : firm.recipe && RECIPE[firm.recipe].product === itemKey(item) ? RECIPE_LABELS[firm.recipe] : 'โรงงาน'} #${firm.id} · มี ${depositSourceStock(firm,item)} ${marketUnit(item)}`;
export const canBuyListing = (quantity: unknown, credits: bigint, unitPrice: unknown) => { const q = Number(quantity); const p = Number(unitPrice); if (!Number.isSafeInteger(q) || q <= 0 || !Number.isSafeInteger(p) || p <= 0) return false; try { return credits >= BigInt(p); } catch { return false; } };
export const isOpenMarketListing = (row: { status?: unknown }) => row.status === 'open';
export const activeMarketListings = <T extends { status?: unknown }>(rows: T[]) => rows.filter(isOpenMarketListing);
export const mergeMarketListings = <T extends { id: string; status?: unknown }>(publicRows: T[], ownRows: T[]) => { const allOwnRows = ((ownRows as T[] & { allRows?: T[] }).allRows ?? ownRows); const ownedIds = new Set(allOwnRows.map(row => row.id)); const byId = new Map(activeMarketListings(publicRows).filter(row => !ownedIds.has(row.id)).map(row => [row.id, { ...row, own: false }])); for (const row of activeMarketListings(ownRows)) byId.set(row.id, { ...row, own: true }); return [...byId.values()]; };

export function installMarketPanel(city: () => City, onChanged: () => void, saveCity: () => void, readCurrentSession?: () => string) {
  const base = marketBaseUrl((import.meta as ImportMeta & {env: Record<string,string|undefined>}).env.VITE_MARKET_URL);
  const client = new MarketClient(city, base, { recoveryEnabled: recoveryApiEnabled, readCurrentSession });
  const host = document.querySelector<HTMLElement>('.page-buttons');
  if (!host || !client.enabled) return {client, render: () => undefined};
  const gate = new MarketAsync();
  const launch = button('ตลาดซื้อขาย', () => open());
  launch.className = 'inspector-toggle panel market-launch';
  launch.replaceChildren(el('span','◈'),el('span','ตลาดซื้อขาย'));
  launch.setAttribute('aria-label','ตลาดซื้อขาย');
  launch.setAttribute('aria-haspopup', 'dialog');
  host.append(launch);
  const dialog = document.createElement('dialog');
  dialog.className = 'market-dialog';
  dialog.setAttribute('aria-labelledby', 'market-title');
  dialog.innerHTML = '<div class="market-shell"><header class="market-header"><div><small> CITYMANAGER / ONLINE MARKET </small><h2 id="market-title">ตลาดซื้อขาย</h2></div><div class="market-account"></div><button type="button" class="market-back">← กลับเข้าเกม</button></header><nav class="market-tabs" aria-label="เมนูตลาด"></nav><p class="market-notice" role="status" aria-live="polite"></p><main class="market-content"></main></div>';
  document.body.append(dialog);
  const content = dialog.querySelector<HTMLElement>('.market-content')!;
  const account = dialog.querySelector<HTMLElement>('.market-account')!;
  const notice = dialog.querySelector<HTMLElement>('.market-notice')!;
  const tabs = dialog.querySelector<HTMLElement>('.market-tabs')!;
  const back = dialog.querySelector<HTMLButtonElement>('.market-back')!;
  let connectButton: HTMLButtonElement | undefined;
  if (client.usesPagesAuth) {
    const prepareConnect = () => { void Promise.resolve().then(() => client.preparePagesLogin()).then(() => { connect.disabled = false; }).catch(() => { setNotice('ยังเตรียมการเชื่อมต่อตลาดไม่ได้'); }); };
    const connect = button('เชื่อมบัญชี Guest', () => { if (connect.disabled) return; connect.disabled = true; try { void client.connectPages().then(me => client.reconcileSession(me)).then(() => { setNotice('เชื่อมบัญชีตลาดแล้ว'); void render(); }).catch(() => { setNotice('เชื่อมบัญชีไม่ได้ ตรวจสอบหน้าต่างเข้าสู่ระบบและลองอีกครั้ง ข้อมูลเดิมยังอยู่'); }).finally(prepareConnect); } catch { setNotice('เปิดหน้าต่างเข้าสู่ระบบไม่ได้ โปรดอนุญาต popup แล้วลองอีกครั้ง'); prepareConnect(); } });
    connect.disabled = true; connect.classList.add('market-connect'); back.before(connect); connectButton = connect; prepareConnect();
  }
  let tab: 'buy'|'sell'|'orders'|'history' = 'buy';
  let category = '', query = '', sort = '', cursor = '', offerCursor = '', minPrice = '', maxPrice = '', minQuantity = '';
  let historyRole: 'buyer'|'seller' = 'buyer';
  const compactViewport = () => {
    const touch = matchMedia('(any-pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    return innerWidth <= 650 || (touch && ((screen.width > 0 && Math.min(screen.width, innerWidth) <= 650) || (innerWidth < innerHeight && innerWidth <= 1200)));
  };
  const updateLayout = () => {
    const compact = compactViewport();
    const touch = matchMedia('(any-pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    const screenWidth = innerWidth > innerHeight ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
    const scale = compact && touch && innerWidth > 700 && screenWidth > 0 ? Math.min(2.75, Math.max(1, innerWidth / Math.max(320, Math.min(screenWidth, innerWidth)))) : 1;
    dialog.dataset.compact = String(compact);
    dialog.style.setProperty('--market-unit', `${scale}px`);
    const shell = dialog.querySelector<HTMLElement>('.market-shell')!;
    const header = dialog.querySelector<HTMLElement>('.market-header')!;
    if (!compact && innerWidth > 1100) header.insertBefore(tabs, account);
    else shell.insertBefore(tabs, notice);
  };
  updateLayout(); window.addEventListener('resize', updateLayout); window.visualViewport?.addEventListener('resize', updateLayout);
  let selected = '', selectedOffer = '', view: 'grid'|'list' = compactViewport() ? 'list' : 'grid';
  let busy = false, loading = false, uncertainReceiptId: string | null = null;
  let credits = 0n;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tabNames = {buy:'ซื้อสินค้า', sell:'ร้านของฉัน', orders:'ใบส่งมอบ', history:'ประวัติ'};
  const pending = () => client.journal.operations.some(o => o.state === 'pending') || client.journal.escrow.some(o => o.state === 'pending');
  const unsafe = () => busy || loading || !gate.canMutate || pending();
  const setNotice = (text: string) => { notice.textContent = text; };
  const api = (path: string) => client.read(path);
  const open = () => { if (dialog.open) return; dialog.showModal(); back.focus(); void render(); };
  back.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { gate.invalidate(); clearTimeout(timer); launch.focus(); });
  const drawTabs = () => {
    tabs.replaceChildren(...(Object.keys(tabNames) as Array<keyof typeof tabNames>).map(key => {
      const b = button(tabNames[key], () => { tab = key; selected = ''; selectedOffer = ''; cursor = ''; offerCursor = ''; void render(); });
      b.className = key === tab ? 'is-active' : ''; b.setAttribute('aria-current', key === tab ? 'page' : 'false'); return b;
    }));
  };
  const mutate = async (action: () => Promise<unknown>, success: string, receiptId?: string) => {
    if (unsafe()) return;
    busy = true;
    content.querySelectorAll<HTMLButtonElement>('[data-mutation]').forEach(b => b.disabled = true);
    try {
      await gate.mutate(action, () => pending() || receiptId !== undefined);
      setNotice(success); onChanged();
    } catch (e) {
      uncertainReceiptId=receiptId??null;
      setNotice(gate.needsReconciliation||pending()?`ทำรายการไม่สำเร็จหรือผลยังไม่แน่นอน: ${errorText(e)} · กรุณาตรวจสอบรายการก่อนทำรายการใหม่`:`ทำรายการไม่สำเร็จ: ${errorText(e)}`);
    } finally {
      busy = false;
      if (dialog.open) void render();
    }
  };
  const actionButton = (label: string, action: () => void, disabled = false) => {
    const b = button(label, action); b.dataset.mutation = 'true'; b.disabled = unsafe() || disabled; return b;
  };
  const labeled = (label: string, input: HTMLElement) => { const wrap = el('label'); wrap.append(el('span', label), input); return wrap; };
  const selectItems = () => { const s = document.createElement('select'); for (const x of MARKET_ITEMS) { const o = el('option', labels[x]); o.value = x; s.append(o); } return s; };
  const numberInput = (value: string) => { const i = document.createElement('input'); i.type = 'number'; i.min = '1'; i.step = '1'; i.value = value; return i; };
  const listCard = (title: string, description: string, item?: string) => { const card = el('article'); card.className = 'market-row'; const text = el('div'); text.className = 'market-row-text'; text.append(el('strong', title), el('span', description)); card.append(...(item ? [productIcon(item)] : []), text); return card; };
  const badge = (text: string, tone = '') => { const b = el('span', text); b.className = `market-badge ${tone}`.trim(); return b; };
  const filters = () => { const params = new URLSearchParams({limit:'25'}); if(minPrice)params.set('min_price',minPrice);if(maxPrice)params.set('max_price',maxPrice);if(minQuantity)params.set('min_quantity',minQuantity);return params; };
  const productPath = () => { const params = filters(); if(query)params.set('q',query); if(category)params.set('category',category); if(sort)params.set('sort',sort); if(cursor)params.set('cursor',cursor); return '/v1/market/products?' + params; };
  const drawBuy = (data: any) => {
    const layout = el('div'); layout.className = 'market-layout';
    const categories: Array<[string, string]> = [['','ทั้งหมด'],['crop','พืชผล'],['product','สินค้าแปรรูป']];
    const chooseCategory = (value: string) => { category = value; cursor = ''; selected = ''; void render(); };
    const aside = el('aside'); aside.className = 'market-categories'; aside.append(el('h3','หมวดหมู่'));
    for (const [value, name] of categories) { const b = button(name, () => chooseCategory(value)); b.className = category === value ? 'is-active' : ''; aside.append(b); }
    aside.append(el('small','จำนวนประเภทสินค้าในแต่ละหมวดยังไม่พร้อมใช้งาน'));
    const center = el('section'); center.className = 'market-products';
    const tools = el('div'); tools.className = 'market-filters';
    const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'ค้นหาชื่อหรือรหัสสินค้า'; search.value = query; search.setAttribute('aria-label','ค้นหาสินค้า');
    search.addEventListener('input', () => { query = search.value; cursor = ''; gate.invalidate(); clearTimeout(timer); timer = setTimeout(() => void render(), 300); });
    const sortSelect=document.createElement('select');sortSelect.setAttribute('aria-label','เรียงสินค้า');
    for(const [value,name] of [['','เรียงเริ่มต้น'],['price_asc','ราคาต่ำ–สูง'],['price_desc','ราคาสูง–ต่ำ']]) {const o=el('option',name);o.value=value;sortSelect.append(o);} sortSelect.value=sort;
    sortSelect.addEventListener('change',()=>{sort=sortSelect.value;cursor='';void render()});
    // The view toggle is the only button in this row (tests and keyboard users rely on it).
    const toggle=button(view==='grid'?'☰':'▦',()=>{view=view==='grid'?'list':'grid';void render()});
    toggle.className='market-view-toggle'; toggle.setAttribute('aria-label',view==='grid'?'แสดงแบบรายการ':'แสดงแบบตาราง'); toggle.title=toggle.getAttribute('aria-label')!;
    tools.append(search,sortSelect,toggle);
    // Phones get the categories as chips under the search row (the sidebar is hidden there).
    const chipsRow = el('div'); chipsRow.className = 'market-category-chips';
    for (const [value, name] of categories) { const b = button(name, () => chooseCategory(value)); b.className = category === value ? 'is-active' : ''; b.setAttribute('aria-pressed', String(category === value)); chipsRow.append(b); }
    const range=el('div');range.className='market-range';
    for(const [name,value,set] of [['ราคาต่ำสุด',minPrice,(v:string)=>minPrice=v],['ราคาสูงสุด',maxPrice,(v:string)=>maxPrice=v],['จำนวนอย่างน้อย',minQuantity,(v:string)=>minQuantity=v]] as Array<[string,string,(v:string)=>void]>){const input=numberInput(value);input.placeholder=name;input.setAttribute('aria-label',name);input.addEventListener('change',()=>{set(input.value);cursor='';offerCursor='';void render()});range.append(labeled(name,input));}
    const advanced = el('details'); advanced.className = 'market-advanced'; if (minPrice||maxPrice||minQuantity) advanced.open = true;
    const activeFilters = [minPrice, maxPrice, minQuantity].filter(Boolean).length;
    advanced.append(el('summary', activeFilters ? `ตัวกรองราคาและจำนวน · ${activeFilters}` : 'ตัวกรองราคาและจำนวน'), range);
    const title = el('div'); title.className = 'market-section-title'; title.append(el('h3','เลือกสินค้า'));
    center.append(title,tools,chipsRow,advanced);
    const chips=el('div');chips.className='market-filter-chips';
    for(const [label,value,clear] of [['ค้นหา',query,()=>query=''],['ราคาขั้นต่ำ',minPrice,()=>minPrice=''],['ราคาสูงสุด',maxPrice,()=>maxPrice=''],['จำนวนขั้นต่ำ',minQuantity,()=>minQuantity='']] as Array<[string,string,()=>void]>){if(value)chips.append(button(`${label}: ${value} ×`,()=>{clear();cursor='';offerCursor='';selected='';void render()}));}
    if(chips.childElementCount){chips.append(button('ล้างตัวกรองทั้งหมด',()=>{query='';category='';minPrice='';maxPrice='';minQuantity='';cursor='';selected='';void render()}));center.append(chips);}
    const grid=el('div');grid.className='market-product-grid '+view;
    const products = data.products?.items;
    if (!Array.isArray(products)) throw new Error('รูปแบบข้อมูลสินค้าไม่รองรับ');
    // With the default order, goods nobody is selling move after the ones on offer (within this page).
    const ordered = sort ? products : [...products].sort((a, b) => Number(a.min_price == null) - Number(b.min_price == null));
    for(const product of ordered) {
      const id=String(product.item_id ?? ''); if (!id) continue;
      const empty = product.min_price == null;
      const tile=button('',()=>{selected=id;selectedOffer='';offerCursor='';void render()});
      tile.className='market-product'+(selected===id?' is-selected':'')+(empty?' is-empty':''); tile.setAttribute('aria-pressed', String(selected===id));
      const body = el('span'); body.className = 'market-product-body';
      const price = empty ? el('span','ยังไม่มีผู้ขาย') : credit(product.min_price, `/${marketUnit(id)}`); price.classList.add('market-price');
      body.append(el('strong',labels[id]??product.name??id), price, el('small', empty ? 'หมด' : `มี ${product.total_quantity ?? '—'} ${marketUnit(id)} · ${product.offer_count ?? '—'} ผู้ขาย`));
      const action = el('span', empty ? 'หมด' : 'ซื้อ'); action.className = empty ? 'market-soldout' : 'market-buy-chip'; action.setAttribute('aria-hidden','true');
      tile.append(productIcon(id), body, action); grid.append(tile);
    }
    if (!products.length) {const emptyState=el('div');emptyState.className='market-empty';emptyState.append(el('p','ไม่พบสินค้าตามเงื่อนไข'),button('ล้างตัวกรอง',()=>{query='';category='';sort='';minPrice='';maxPrice='';minQuantity='';cursor='';selected='';void render()}));grid.append(emptyState);} center.append(grid);
    const pager = el('div'); pager.className = 'market-pager';
    if(cursor)pager.append(button('← หน้าแรก',()=>{cursor='';void render()}));
    const next=data.products?.next_cursor; if(next)pager.append(button('หน้าถัดไป →',()=>{cursor=String(next);selected='';void render()}));
    if(pager.childElementCount)center.append(pager);
    if(data.products?.pagination_truncated)center.append(el('p','ผลลัพธ์เกินขอบเขตการแบ่งหน้า · โปรดจำกัดคำค้นหาหรือตัวกรอง'));
    const detail=el('aside');detail.className='market-detail'+(selected?' has-selection':'');
    if(!selected) { detail.append(el('h3','รายละเอียดสินค้า'), el('p','เลือกสินค้าเพื่อดูราคาและข้อเสนอจากผู้ขาย')); }
    else {
      // The close control stays the first button in the detail panel.
      const close=button('✕',()=>{selected='';selectedOffer='';void render()}); close.className='market-detail-close'; close.setAttribute('aria-label','ปิดรายละเอียด'); close.title='ปิดรายละเอียด';
      const product = products.find((p: { item_id?: unknown }) => String(p.item_id ?? '') === selected);
      const head = el('div'); head.className = 'market-detail-head'; const naming = el('div'); naming.append(el('h3', labels[selected] ?? selected), badge(categoryLabel(selected)), el('small', selected));
      head.append(productIcon(selected, 'lg'), naming);
      detail.append(close, head);
      const stats=data.stats, unit=marketUnit(selected);
      const tiles = el('div'); tiles.className = 'market-stats';
      const tile = (label: string, value: HTMLElement | string) => { const t = el('div'); t.append(el('small', label)); t.append(typeof value === 'string' ? el('b', value) : value); return t; };
      tiles.append(tile('ราคาต่ำสุดในตลาด', product?.min_price == null ? 'ยังไม่มี' : credit(product.min_price)), tile('มีในตลาด', product ? `${product.total_quantity ?? '—'} ${unit}` : '—'),
        tile('ราคาเฉลี่ย 30 วัน', stats?.weighted_average_price == null ? 'ไม่มีข้อมูล' : credit(stats.weighted_average_price)), tile('ซื้อขายล่าสุด', stats?.last_price == null ? 'ไม่มีข้อมูล' : credit(stats.last_price)));
      detail.append(tiles, el('small', stats?.weighted_average_price==null ? 'ราคาอ้างอิงจากการซื้อขายจริง: ยังไม่มีข้อมูลเพียงพอ' : `ซื้อขายจริง 30 วัน · ${stats.trade_count} รายการ · ต่ำสุด ${stats.min_price} · สูงสุด ${stats.max_price} เครดิต`));
      detail.append(el('h4','ประกาศขาย · ราคาถูกก่อน'));
      const offers=data.offers?.items;
      if (!Array.isArray(offers)) throw new Error('รูปแบบข้อมูลข้อเสนอไม่รองรับ');
      if(!offers.length)detail.append(el('p','ยังไม่มีข้อเสนอที่เปิดขาย'));
      for(const offer of offers) {
        const id=String(offer.listing_id ?? ''), own=offer.is_mine === true;
        const row=el('div');row.className='market-offer'+(id===selectedOffer?' is-selected':'');
        const choose=button(own?'ของฉัน':`เลือก · ${offer.unit_price} เครดิต`,()=>{selectedOffer=id;void render()});
        choose.disabled=own;choose.className=id===selectedOffer?'is-active':'';
        const info = el('div'); info.className = 'market-offer-info'; info.append(credit(offer.unit_price, `/${unit}`), el('small',`เหลือ ${offer.quantity} ${unit} · ประกาศ ${shortId(id)}`));
        row.append(choose,info);detail.append(row);
        if(id===selectedOffer&&!own) {
          const box = el('div'); box.className = 'market-buy-box';
          const amount=numberInput('1'); amount.setAttribute('aria-label','จำนวนที่ซื้อ');
          let max=0n; try { const price=BigInt(offer.unit_price), available=BigInt(offer.quantity); if(price>0n) max=available<credits/price?available:credits/price; } catch { /* invalid offer remains disabled */ }
          max=max<BigInt(Number.MAX_SAFE_INTEGER)?max:BigInt(Number.MAX_SAFE_INTEGER);
          amount.max=String(max);
          const total=el('p');total.className='market-total';const buy=actionButton('ตรวจสอบและซื้อ',()=>{const n=Number(amount.value);if(Number.isSafeInteger(n)&&n>0&&BigInt(n)<=max){const cost=BigInt(n)*BigInt(offer.unit_price);const review=`สินค้า: ${labels[selected]??selected}\nรายการผู้ขาย: ${id}\nจำนวน: ${n} ${marketUnit(selected)}\nราคา: ${offer.unit_price} เครดิต/${marketUnit(selected)}\nรวม: ${cost} เครดิต · ค่าธรรมเนียม: 0\nเครดิตคงเหลือ: ${credits-cost}\nการซื้อสร้างใบส่งมอบ คุณต้องกดรับสินค้าเพื่อส่งเข้าเมือง\n\nยืนยันซื้อรายการนี้?`;if(window.confirm(review))void mutate(()=>client.buy(id,n),'ซื้อสำเร็จ · ตรวจสอบใบส่งมอบ');}});
          buy.classList.add('is-primary');
          const update=()=>{const n=Number(amount.value);let valid=Number.isSafeInteger(n)&&n>0&&BigInt(n)<=max;buy.disabled=unsafe()||!valid;total.replaceChildren(...(valid?[el('span','ราคารวม'),credit(BigInt(n)*BigInt(offer.unit_price))]:[el('span',`ซื้อได้สูงสุด ${max} ${marketUnit(selected)}`)]));}; amount.addEventListener('input',update);update();
          const step=(delta:number)=>{const n=Number(amount.value)||0;const next=Math.max(1,Math.min(Number(max)||1,n+delta));amount.value=String(next);update()};
          const minus=button('−',()=>step(-1)),plus=button('+',()=>step(1)),maxButton=button('สูงสุด',()=>{amount.value=String(max);update()});
          minus.setAttribute('aria-label','ลดจำนวน');plus.setAttribute('aria-label','เพิ่มจำนวน');
          const stepper=el('div');stepper.className='market-stepper';stepper.append(minus,amount,plus,maxButton);
          box.append(el('small','จำนวนที่ต้องการซื้อ'),stepper,total,buy);detail.append(box);
        }
      }
      const offerPager = el('div'); offerPager.className = 'market-pager';
      if(offerCursor)offerPager.append(button('← ข้อเสนอหน้าแรก',()=>{offerCursor='';void render()}));
      if(data.offers?.next_cursor)offerPager.append(button('ข้อเสนอถัดไป →',()=>{offerCursor=String(data.offers.next_cursor);selectedOffer='';void render()}));
      if(offerPager.childElementCount)detail.append(offerPager);
      if(data.offers?.pagination_truncated)detail.append(el('p','ข้อเสนอเกินขอบเขตการแบ่งหน้า · โปรดใช้ตัวกรอง'));
    }
    const quickSell = button('ขายสินค้าของฉัน', () => { tab = 'sell'; selected = ''; void render(); }); quickSell.className = 'market-quick-sell';
    center.append(quickSell);
    layout.append(aside,center,detail);content.replaceChildren(layout);
  };
  const drawSell = (data: any) => {
    const wrap=el('div');wrap.className='market-workspace'; const mine=activeMarketListings<MarketListing>(data.mine);
    wrap.append(el('h3',`ร้านของฉัน · ${mine.length} รายการเปิดขาย`));
    if(!mine.length)wrap.append(el('p','ยังไม่มีรายการขายที่เปิดอยู่'));
    for(const row of mine){const card=listCard(labels[row.item_code]??row.item_code,`${row.quantity} ${marketUnit(row.item_code)} · ${row.unit_price} เครดิต/${marketUnit(row.item_code)}`,row.item_code);card.append(badge(stateLabel(String(row.status ?? 'open')),'good'),actionButton('ยกเลิกและคืนสต็อก',()=>void mutate(()=>client.cancelListing(row.id),'ยกเลิกรายการแล้ว')));wrap.append(card)}
    const stock=new Map<string,number>(data.inventory.items.filter((x:{item_code:string})=>(MARKET_ITEMS as readonly string[]).includes(x.item_code)).map((x:{item_code:string;quantity:number})=>[x.item_code,Number(x.quantity)]));
    const totalStock=[...stock.values()].reduce((n,v)=>n+(Number.isFinite(v)?v:0),0);
    const stockList=el('div');stockList.className='market-stock';
    for(const x of MARKET_ITEMS){const have=stock.get(x)??0;const chip=el('span');chip.className='market-stock-item'+(have>0?'':' is-zero');chip.append(productIcon(x),el('b',String(have)),el('small',`${labels[x]} · ${marketUnit(x)}`));stockList.append(chip);}
    const form=el('form');form.className='market-form';const item=selectItems(),qty=numberInput('1'),price=numberInput('10');const available=el('small');const submit=el('button','ลงประกาศขาย');submit.type='submit';submit.dataset.mutation='true';submit.classList.add('is-primary');
    qty.max='1000000'; price.max='1000000';
    const update=()=>{const have=stock.get(item.value)??0,n=Number(qty.value),p=Number(price.value);const quantityValid=Number.isSafeInteger(n)&&n>=1&&n<=1_000_000&&n<=have, priceValid=Number.isSafeInteger(p)&&p>=1&&p<=1_000_000;available.textContent=`สต็อกในคลังตลาด ${have} ${marketUnit(item.value)} · จำนวนและราคาต่อหน่วยต้องเป็นจำนวนเต็ม 1–1,000,000`;submit.disabled=unsafe()||!quantityValid||!priceValid;};item.addEventListener('change',update);qty.addEventListener('input',update);price.addEventListener('input',update);update();
    form.append(labeled('สินค้า',item),labeled('จำนวน',qty),labeled('ราคาต่อล็อตหรือหน่วย',price),available,submit);form.addEventListener('submit',e=>{e.preventDefault();if(!submit.disabled)void mutate(()=>client.list(item.value as MarketItem,Number(price.value),Number(qty.value)),'ลงขายสำเร็จ')});const listingTitle=el('h3','ลงขายจากคลังตลาด');wrap.append(listingTitle,stockList);
    if(!totalStock){const note=el('p','คลังตลาดของคุณยังว่าง ของจะเข้าคลังเมื่อฝากจากเมือง หรือเมื่อยกเลิกประกาศที่ยังขายไม่หมด');note.className='market-callout';wrap.append(note);}
    wrap.append(form);
    const deposit=el('form');deposit.className='market-form';const dItem=selectItems(),firm=document.createElement('select'),dQty=numberInput('1'),send=el('button','ฝากเข้าคลังตลาด');send.type='submit';send.dataset.mutation='true';
    const updateSources=()=>{const firms=eligibleDepositFirms(city(),dItem.value as MarketItem);const prior=firm.value;firm.replaceChildren(...firms.map(f=>{const o=el('option',depositSourceLabel(f,dItem.value as MarketItem));o.value=String(f.id);return o}));if(firms.some(f=>String(f.id)===prior))firm.value=prior;const chosen=firms.find(f=>String(f.id)===firm.value);const have=chosen?depositSourceStock(chosen,dItem.value as MarketItem):0;const n=Number(dQty.value);send.disabled=unsafe()||!data.inventory.imports_enabled||!Number.isSafeInteger(n)||n<1||n>have;};dItem.addEventListener('change',updateSources);firm.addEventListener('change',updateSources);dQty.addEventListener('input',updateSources);updateSources();
    deposit.append(labeled('สินค้า',dItem),labeled('แหล่งผลิต',firm),labeled('จำนวน',dQty),send);deposit.addEventListener('submit',e=>{e.preventDefault();if(!send.disabled)void mutate(()=>client.deposit(Number(firm.value),dItem.value as MarketItem,Number(dQty.value),saveCity),'ฝากสต็อกสำเร็จ')});if(data.inventory.imports_enabled)wrap.append(el('h3','ฝากสต็อกจากเมือง'),el('p','เลือกแหล่งผลิตที่มีสินค้าตรงชนิด'),deposit);
    else{const closed=el('details');closed.className='market-closed';closed.append(el('summary','ฝากสต็อกจากเมือง · ยังปิดอยู่'),el('p','การฝากสต็อกปิดตามนโยบายทดสอบ เมื่อเปิดแล้วจะเลือกฟาร์มหรือโรงงานที่มีสินค้าตรงชนิดได้ที่นี่'),deposit);wrap.append(closed);}
    content.replaceChildren(wrap);
  };
  const drawOrders = (data: any) => {
    const wrap=el('div');wrap.className='market-workspace';wrap.append(el('h3','ใบส่งมอบ'));
    const unresolved=client.journal.operations.filter(o=>o.state==='pending');
    for(const op of unresolved){
      const row=listCard('รายการรอตรวจสอบ',`${op.kind} · ${op.opId}`);
      if(['buy','listing','cancel','claim','ack'].includes(op.kind)) {
        const retry=button('ตรวจสอบรายการเดิม',async()=>{
          if(busy||loading)return;busy=true;retry.disabled=true;
          try{await client.retry(op.opId,saveCity);if(!pending())gate.reconciled();setNotice('ตรวจสอบรายการเดิมสำเร็จ');onChanged();}
          catch(e){if((e as {definitiveTradeRejection?:boolean})?.definitiveTradeRejection){setNotice('ตลาดยืนยันว่ารายการนี้ไม่สำเร็จ คุณสามารถทำรายการใหม่ได้');onChanged();}else setNotice(`ยังตรวจสอบรายการไม่ได้: ${errorText(e)} · ไม่ได้สร้างรายการใหม่`);}
          finally{if(['buy','listing','cancel'].includes(op.kind)&&op.state==='quarantined'&&!pending())gate.reconciled();busy=false;if(dialog.open)void render();}
        });row.append(retry);
        if(recoveryApiEnabled && (op.kind==='buy'||op.kind==='listing'||(op.kind==='cancel'&&op.payload.recovery_keyed===true))) {
          const check=button('ตรวจสอบผลกับเซิร์ฟเวอร์',async()=>{if(busy||loading)return;busy=true;check.disabled=true;try{const result=await client.reconcileOperation(op.opId,'status');if(!pending())gate.reconciled();setNotice(result.state==='done'&&pending()?'ตลาดยืนยันการซื้อแล้ว แต่บัญชียังต้องตรวจสอบเพิ่มเติม':result.state==='unknown'?'ยังไม่ทราบผล รายการเดิมยังค้างอยู่':result.state==='reconciliation_required'?'ต้องตรวจสอบเพิ่มเติม รายการเดิมยังค้างอยู่':'ตรวจสอบรายการเดิมแล้ว');onChanged();}catch(e){setNotice(`ยังตรวจสอบผลไม่ได้: ${errorText(e)} · เก็บรายการเดิมไว้`)}finally{busy=false;if(dialog.open)void render()}});
          const fence=button('ยืนยันปิดรายการที่ไม่สำเร็จ',async()=>{if(busy||loading||!window.confirm('ตรวจสอบกับเซิร์ฟเวอร์และปิดรายการเดิมถ้ายังไม่สำเร็จ? หากสำเร็จไปแล้วจะไม่ยกเลิกรายการนั้น'))return;busy=true;fence.disabled=true;try{const result=await client.reconcileOperation(op.opId,'fence');if(!pending())gate.reconciled();setNotice(result.state==='done'&&pending()?'ตลาดยืนยันการซื้อแล้ว แต่บัญชียังต้องตรวจสอบเพิ่มเติม':result.state==='unknown'||result.state==='reconciliation_required'?'ยังไม่ยืนยันผล รายการเดิมยังค้างอยู่':'ตรวจสอบรายการเดิมแล้ว');onChanged();}catch(e){setNotice(`ยังยืนยันผลไม่ได้: ${errorText(e)} · เก็บรายการเดิมไว้`)}finally{busy=false;if(dialog.open)void render()}});row.append(check,fence);
        }
      } else if(op.kind==='deposit') {
        const verify=button('ตรวจสอบผลฝากเดิม',async()=>{
          if(busy||loading)return;busy=true;verify.disabled=true;
          try {const status=await api(`/v1/op/${encodeURIComponent(op.opId)}`);if(status.state!=='done')throw new Error('ผลฝากยังไม่ยืนยัน ต้องรอการตรวจสอบที่ปลอดภัย');await client.recoverDeposit(op.opId,saveCity);if(!pending())gate.reconciled();setNotice('ยืนยันผลฝากเดิมแล้ว');onChanged();}
          catch(e){setNotice(`ยังตรวจสอบรายการฝากไม่ได้: ${errorText(e)} · เก็บเมืองและบัญชี Guest นี้ไว้`);}
          finally{busy=false;if(dialog.open)void render();}
        });row.append(verify,el('small','คืนสต็อกจากผลที่ยังไม่ยืนยันไม่ได้จนกว่าระบบกู้คืนจะพร้อม'));
      }
      else row.append(el('small','ต้องตรวจสอบรายการนี้ก่อนทำรายการใหม่'));
      wrap.append(row);
    }
    const rows=data.receipts.filter((r:{state?:string})=>r.state==='ready'||r.state==='claimed'||r.state==='claim-timeout');
    if(!rows.length)wrap.append(el('p','ไม่มีใบส่งมอบที่รอรับ'));
    for(const r of rows){
      const card=listCard(labels[r.item_code]??r.item_code,`${r.quantity} ${marketUnit(r.item_code)} · ${stateLabel(r.state)}`,r.item_code);card.append(badge(stateLabel(r.state),r.state==='ready'?'good':'warn'));
      const record=client.journal.receipts[r.receipt_id];
      const fixed=record?.state==='applied'||record?.state==='delivered';
      const destination=document.createElement('select');destination.setAttribute('aria-label','เลือกสถานที่รับสินค้า');
      const placeholder=el('option','เลือกสถานที่รับสินค้า');placeholder.value='';destination.append(placeholder);
      if(fixed&&record?.firmId!==undefined){const option=el('option',`สถานที่ #${record.firmId} · บันทึกแล้ว`);option.value=String(record.firmId);destination.append(option);destination.value=option.value;destination.disabled=true;}
      else for(const d of client.receiptDestinations(r)){const name=({market:'ตลาด',factory:'โรงงาน',retail:'ร้านค้า'} as Record<string,string>)[d.kind]??'สถานที่';const option=el('option',`${name} #${d.firmId} · ว่าง ${d.available} ${marketUnit(r.item_code)}`);option.value=String(d.firmId);destination.append(option);}
      card.append(labeled('ปลายทางในเมือง',destination));
      if(destination.options.length===1)card.append(el('small','ไม่มีสถานที่ที่รองรับและมีพื้นที่เพียงพอ'));
      const canReceive=()=>Boolean(destination.value)&&!(r.state!=='ready'&&!record);
      const apply=async()=>{if(!canReceive())throw new Error('กรุณาเลือกปลายทาง');await client.claim(r.receipt_id);await client.applyAndAck(r,saveCity,Number(destination.value))};
      if(gate.needsReconciliation&&uncertainReceiptId===r.receipt_id&&record&&!pending()){
        const resume=button('ตรวจสอบใบส่งมอบเดิม',async()=>{if(busy||loading||pending())return;busy=true;resume.disabled=true;try{await apply();if(!pending()){gate.reconciled();uncertainReceiptId=null;}setNotice('ตรวจสอบใบส่งมอบเดิมสำเร็จ');onChanged();}catch(e){setNotice(`ยังตรวจสอบไม่ได้: ${errorText(e)} · ใช้ใบส่งมอบเดิม`)}finally{busy=false;if(dialog.open)void render()}});
        const update=()=>{resume.disabled=busy||loading||pending()||!canReceive()};destination.addEventListener('change',update);update();card.append(resume);
      }else {const receive=actionButton('รับของและบันทึกเมือง',()=>void mutate(apply,'รับของแล้ว',r.receipt_id),!canReceive());receive.classList.add('is-primary');const update=()=>{receive.disabled=unsafe()||!canReceive()};destination.addEventListener('change',update);update();card.append(receive);}
      if(r.state!=='ready'&&!record)card.append(el('small','ไม่พบข้อมูลการรับของเดิมในเมืองนี้ ต้องกู้คืนข้อมูลก่อน'));
      wrap.append(card)
    }content.replaceChildren(wrap);
  };
  const drawHistory = (data: any) => { const wrap=el('div');wrap.className='market-workspace';wrap.append(el('h3','ประวัติการซื้อขายจริง'));for(const [role,label] of [['buyer','ซื้อ'],['seller','ขาย']] as const){const b=button(label,()=>{historyRole=role;cursor='';void render()});b.className=historyRole===role?'is-active':'';wrap.append(b);}const rows=data.history?.items??[];if(!rows.length)wrap.append(el('p','ไม่มีรายการในหน้านี้'));for(const r of rows){const id=String(r.item_id ?? '');const card=listCard(labels[id]??(id||'สินค้า'),`${r.quantity} ${marketUnit(id)} · ${r.unit_price} เครดิต/${marketUnit(id)} · ${when(r.created_at)}`,id||undefined);card.append(credit(r.total ?? '—'),badge(historyRole==='buyer'?'ซื้อ':'ขาย',historyRole==='buyer'?'warn':'good'));wrap.append(card);}if(data.history?.next_cursor)wrap.append(button('หน้าถัดไป →',()=>{cursor=String(data.history.next_cursor);void render()}));if(data.history?.pagination_truncated)wrap.append(el('p','ประวัติเกินขอบเขตการแบ่งหน้า'));if(cursor)wrap.append(button('← หน้าแรก',()=>{cursor='';void render()}));content.replaceChildren(wrap); };
  const render = async () => {
    if(!dialog.open) return;
    drawTabs();
    // Connected players keep a small reconnect control; the full call to action is only for signing in.
    if(connectButton){connectButton.textContent=client.guestId?'↻ เชื่อมใหม่':'เชื่อมบัญชี Guest';connectButton.classList.toggle('is-primary',!client.guestId);connectButton.classList.toggle('is-quiet',!!client.guestId);}
    if(!client.guestId){content.replaceChildren(el('p','กรุณาเข้าสู่ Guest ก่อนใช้ตลาด'));return;}
    if(pending()||gate.needsReconciliation) setNotice('มีรายการที่รอตรวจสอบผล · ปิดการทำรายการใหม่จนกว่าจะตรวจสอบได้');
    const scrollTop=content.scrollTop; loading=true;content.setAttribute('aria-busy','true');content.querySelectorAll<HTMLButtonElement>('[data-mutation]').forEach(b=>b.disabled=true);
    const searchFocused=document.activeElement instanceof HTMLInputElement && document.activeElement.type==='search';
    await gate.read(async()=>{
      const wallet=await client.wallet();
      if(tab==='buy') { const params=filters();if(offerCursor)params.set('cursor',offerCursor);const [products,offers,stats]=await Promise.all([api(productPath()),selected?api(`/v1/market/products/${encodeURIComponent(selected)}/offers?`+params):null,selected?api(`/v1/market/products/${encodeURIComponent(selected)}/stats`):null]);return {wallet,products,offers,stats}; }
      if(tab==='sell') {const [mine,inventory]=await Promise.all([client.myListings(),client.inventory()]);return {wallet,mine,inventory};}
      if(tab==='orders')return {wallet,receipts:await client.receipts()};
      return {wallet,history:await api('/v1/market/history?role='+historyRole+'&limit=25'+(cursor?'&cursor='+encodeURIComponent(cursor):''))};
    }, data=>{loading=false;content.setAttribute('aria-busy','false');try {credits=BigInt(data.wallet.credits);account.replaceChildren(credit(credits.toLocaleString('th-TH'),'เครดิต'));if(tab==='buy')drawBuy(data);else if(tab==='sell')drawSell(data);else if(tab==='orders')drawOrders(data);else drawHistory(data);content.scrollTop=scrollTop;if(searchFocused){const search=content.querySelector<HTMLInputElement>('input[type=search]');search?.focus();search?.setSelectionRange(search.value.length,search.value.length);}}catch(e){content.replaceChildren(el('p',`ข้อมูลตลาดไม่พร้อม: ${errorText(e)}`));}}, e=>{loading=false;content.setAttribute('aria-busy','false');content.replaceChildren(el('p',`โหลดข้อมูลตลาดไม่ได้: ${errorText(e)} · โปรดลองใหม่`),button('ลองอีกครั้ง',()=>void render()));});
  };
  return {client,render};
}
