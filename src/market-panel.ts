import { MARKET_ITEMS, MarketClient, type MarketItem, type MarketListing } from './market-client.ts';
import { MarketAsync } from './market-async.ts';
import { RECIPE, RECIPE_LABELS, type ProductId } from './goods.ts';
import type { City, Firm } from './sim.ts';

const labels: Record<string, string> = {'crop:rice':'ข้าว','crop:vegetables':'ผัก','crop:sugarcane':'อ้อย','product:milled-rice':'ข้าวสาร','product:canned-food':'อาหารกระป๋อง','product:sugar':'น้ำตาล'};
const recoveryApiEnabled = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_MARKET_RECOVERY_API === 'true';
export const marketUnit = (item: string) => item.startsWith('crop:') ? 'ล็อต' : 'หน่วย';
const stateLabel = (value: string) => ({ open: 'เปิดขาย', sold: 'ขายหมด', sold_out: 'ขายหมด', cancelled: 'ยกเลิกแล้ว', expired: 'หมดอายุ', ready: 'พร้อมรับ', claimed: 'กำลังรับ', 'claim-timeout': 'รอตรวจสอบ', delivered: 'รับแล้ว', applied: 'รับเข้าเมืองแล้ว' } as Record<string, string>)[value] ?? value;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => { const n = document.createElement(tag); n.textContent = text; return n; };
const button = (text: string, action: () => void) => { const b = el('button', text); b.type = 'button'; b.addEventListener('click', action); return b; };
const errorText = (e: unknown) => { const m = e instanceof Error ? e.message : ''; const status=Number((e as {status?:unknown}|null)?.status??0); if(status===401)return 'เซสชัน Guest หมดอายุ กรุณาเข้าสู่ Guest เดิม';if(status>=500)return 'เซิร์ฟเวอร์ไม่พร้อม ผลรายการอาจยังไม่แน่นอน';return ({'insufficient inventory':'สต็อกตลาดของ Guest ไม่พอ','insufficient wallet':'เครดิตตลาดไม่พอ','policy-disabled':'นโยบายฝากของยังปิดอยู่ในการทดสอบนี้','guest-required':'กรุณาเข้าสู่ Guest ก่อน','guest session required':'กรุณาเข้าสู่ Guest ก่อน','csrf check failed':'เซสชันหมดอายุ กรุณาเข้าสู่ Guest เดิม','listing not found':'ไม่พบรายการขายนี้','unknown item':'ไม่มีสินค้านี้ในตลาด','unknown-item':'ไม่มีสินค้านี้ในตลาด'} as Record<string,string>)[m] ?? (m || 'เชื่อมต่อไม่ได้หรือเกิดข้อผิดพลาด'); };
const blocksMutations = (e: unknown) => { const s = Number((e as {status?:unknown} | null)?.status ?? 0); return s === 0 || s === 401 || s >= 500; };
const itemKey = (item: MarketItem) => item.slice(item.indexOf(':') + 1);
export const depositSourceStock = (firm: Firm, item: MarketItem) => { const key = itemKey(item); const v = item.startsWith('crop:') ? firm.zone === 'F' ? Number(firm.crops[key as keyof typeof firm.crops] ?? 0) : 0 : firm.zone === 'I' && firm.recipe && RECIPE[firm.recipe].product === key ? Number(firm.products[key as ProductId] ?? 0) : 0; return Number.isSafeInteger(v) && v > 0 ? v : 0; };
export const eligibleDepositFirms = (city: Pick<City,'firms'>, item: MarketItem) => city.firms.filter(f => depositSourceStock(f, item) > 0);
export const depositSourceLabel = (firm: Firm, item: MarketItem) => `${item.startsWith('crop:') ? `ฟาร์ม${labels[item] ?? ''}` : firm.recipe ? RECIPE_LABELS[firm.recipe] : 'โรงงาน'} #${firm.id} · มี ${depositSourceStock(firm,item)} ${marketUnit(item)}`;
export const canBuyListing = (quantity: unknown, credits: bigint, unitPrice: unknown) => { const q = Number(quantity); const p = Number(unitPrice); if (!Number.isSafeInteger(q) || q <= 0 || !Number.isSafeInteger(p) || p <= 0) return false; try { return credits >= BigInt(p); } catch { return false; } };
export const isOpenMarketListing = (row: { status?: unknown }) => row.status === 'open';
export const activeMarketListings = <T extends { status?: unknown }>(rows: T[]) => rows.filter(isOpenMarketListing);
export const mergeMarketListings = <T extends { id: string; status?: unknown }>(publicRows: T[], ownRows: T[]) => { const allOwnRows = ((ownRows as T[] & { allRows?: T[] }).allRows ?? ownRows); const ownedIds = new Set(allOwnRows.map(row => row.id)); const byId = new Map(activeMarketListings(publicRows).filter(row => !ownedIds.has(row.id)).map(row => [row.id, { ...row, own: false }])); for (const row of activeMarketListings(ownRows)) byId.set(row.id, { ...row, own: true }); return [...byId.values()]; };

export function installMarketPanel(city: () => City, onChanged: () => void, saveCity: () => void) {
  void import('./market-panel.css');
  const base = (import.meta as ImportMeta & {env: Record<string,string|undefined>}).env.VITE_MARKET_URL ?? '';
  const client = new MarketClient(city, base, { recoveryEnabled: recoveryApiEnabled });
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
  if (client.usesPagesAuth) {
    const prepareConnect = () => { void Promise.resolve().then(() => client.preparePagesLogin()).then(() => { connect.disabled = false; }).catch(() => { setNotice('ยังเตรียมการเชื่อมต่อตลาดไม่ได้'); }); };
    const connect = button('เชื่อมบัญชี Guest', () => { if (connect.disabled) return; connect.disabled = true; try { void client.connectPages().then(me => client.reconcileSession(me)).then(() => { setNotice('เชื่อมบัญชีตลาดแล้ว'); void render(); }).catch(() => { setNotice('เชื่อมบัญชีไม่ได้ ตรวจสอบหน้าต่างเข้าสู่ระบบและลองอีกครั้ง ข้อมูลเดิมยังอยู่'); }).finally(prepareConnect); } catch { setNotice('เปิดหน้าต่างเข้าสู่ระบบไม่ได้ โปรดอนุญาต popup แล้วลองอีกครั้ง'); prepareConnect(); } });
    connect.disabled = true; back.before(connect); prepareConnect();
  }
  let tab: 'buy'|'sell'|'orders'|'history' = 'buy';
  let category = '', query = '', sort = '', cursor = '', offerCursor = '', minPrice = '', maxPrice = '', minQuantity = '';
  let historyRole: 'buyer'|'seller' = 'buyer';
  let selected = '', selectedOffer = '', view: 'grid'|'list' = matchMedia('(max-width: 650px)').matches ? 'list' : 'grid';
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
  const listCard = (title: string, description: string) => { const card = el('article'); card.className = 'market-row'; card.append(el('strong', title), el('span', description)); return card; };
  const filters = () => { const params = new URLSearchParams({limit:'25'}); if(minPrice)params.set('min_price',minPrice);if(maxPrice)params.set('max_price',maxPrice);if(minQuantity)params.set('min_quantity',minQuantity);return params; };
  const productPath = () => { const params = filters(); if(query)params.set('q',query); if(category)params.set('category',category); if(sort)params.set('sort',sort); if(cursor)params.set('cursor',cursor); return '/v1/market/products?' + params; };
  const drawBuy = (data: any) => {
    const layout = el('div'); layout.className = 'market-layout';
    const aside = el('aside'); aside.className = 'market-categories'; aside.append(el('h3','หมวดสินค้า'));
    aside.append(el('small','จำนวนประเภทสินค้าในแต่ละหมวดยังไม่พร้อมใช้งาน'));
    for (const [value, name] of [['','ทั้งหมด'],['crop','พืชผล'],['product','สินค้าแปรรูป']]) {
      const b = button(name, () => { category = value; cursor = ''; selected = ''; void render(); }); b.className = category === value ? 'is-active' : ''; aside.append(b);
    }
    const center = el('section'); center.className = 'market-products';
    const tools = el('div'); tools.className = 'market-filters';
    const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'ค้นหาชื่อหรือรหัสสินค้า'; search.value = query; search.setAttribute('aria-label','ค้นหาสินค้า');
    search.addEventListener('input', () => { query = search.value; cursor = ''; gate.invalidate(); clearTimeout(timer); timer = setTimeout(() => void render(), 300); });
    const categorySelect = document.createElement('select'); categorySelect.setAttribute('aria-label','หมวดสินค้า');
    for (const [value, name] of [['','ทุกหมวด'],['crop','พืชผล'],['product','สินค้าแปรรูป']]) { const o=el('option',name);o.value=value;categorySelect.append(o); } categorySelect.value=category;
    categorySelect.addEventListener('change',()=>{category=categorySelect.value;cursor='';selected='';void render();});
    const sortSelect=document.createElement('select');sortSelect.setAttribute('aria-label','เรียงสินค้า');
    for(const [value,name] of [['','เรียงเริ่มต้น'],['price_asc','ราคาต่ำสุด'],['price_desc','ราคาสูงสุด']]) {const o=el('option',name);o.value=value;sortSelect.append(o);} sortSelect.value=sort;
    sortSelect.addEventListener('change',()=>{sort=sortSelect.value;cursor='';void render()});
    const toggle=button(view==='grid'?'☰ รายการ':'▦ ตาราง',()=>{view=view==='grid'?'list':'grid';void render()});
    const range=el('div');range.className='market-range';
    for(const [name,value,set] of [['ราคาต่ำสุด',minPrice,(v:string)=>minPrice=v],['ราคาสูงสุด',maxPrice,(v:string)=>maxPrice=v],['จำนวนอย่างน้อย',minQuantity,(v:string)=>minQuantity=v]] as Array<[string,string,(v:string)=>void]>){const input=numberInput(value);input.placeholder=name;input.setAttribute('aria-label',name);input.addEventListener('change',()=>{set(input.value);cursor='';offerCursor='';void render()});range.append(input);}
    tools.append(search,categorySelect,sortSelect,toggle); center.append(el('h3','เลือกสินค้า'),tools,range);
    const chips=el('div');chips.className='market-filter-chips';
    for(const [label,value,clear] of [['ค้นหา',query,()=>query=''],['หมวด',category,()=>category=''],['ราคาขั้นต่ำ',minPrice,()=>minPrice=''],['ราคาสูงสุด',maxPrice,()=>maxPrice=''],['จำนวนขั้นต่ำ',minQuantity,()=>minQuantity='']] as Array<[string,string,()=>void]>){if(value)chips.append(button(`${label}: ${value} ×`,()=>{clear();cursor='';offerCursor='';selected='';void render()}));}
    if(chips.childElementCount){chips.append(button('ล้างตัวกรองทั้งหมด',()=>{query='';category='';minPrice='';maxPrice='';minQuantity='';cursor='';selected='';void render()}));center.append(chips);}
    const grid=el('div');grid.className='market-product-grid '+view;
    const products = data.products?.items;
    if (!Array.isArray(products)) throw new Error('รูปแบบข้อมูลสินค้าไม่รองรับ');
    for(const product of products) {
      const id=String(product.item_id ?? ''); if (!id) continue;
      const tile=button('',()=>{selected=id;selectedOffer='';offerCursor='';void render()});tile.className='market-product '+(selected===id?'is-selected':'');
      const symbol=el('span',id.startsWith('crop:')?'🌾':'📦'); symbol.className='market-product-icon';
      tile.append(symbol,el('strong',labels[id]??product.name??id),el('small',product.min_price == null?'ยังไม่มีผู้ขาย':`เริ่มต้น ${product.min_price} เครดิต`),el('small',`มี ${product.total_quantity ?? '0'} · ${product.offer_count ?? '0'} รายการ`)); grid.append(tile);
    }
    if (!products.length) {const empty=el('div');empty.append(el('p','ไม่พบสินค้าตามเงื่อนไข'),button('ล้างตัวกรอง',()=>{query='';category='';sort='';minPrice='';maxPrice='';minQuantity='';cursor='';selected='';void render()}));grid.append(empty);} center.append(grid);
    const next=data.products?.next_cursor; if(next)center.append(button('หน้าถัดไป →',()=>{cursor=String(next);selected='';void render()}));if(data.products?.pagination_truncated)center.append(el('p','ผลลัพธ์เกินขอบเขตการแบ่งหน้า · โปรดจำกัดคำค้นหาหรือตัวกรอง'));
    if(cursor)center.append(button('← หน้าแรก',()=>{cursor='';void render()}));
    const detail=el('aside');detail.className='market-detail'+(selected?' has-selection':'');detail.append(el('h3',selected?(labels[selected]??selected):'รายละเอียดสินค้า'));
    if(!selected) detail.append(el('p','เลือกสินค้าเพื่อดูข้อเสนอจากผู้ขาย'));
    else {
      const stats=data.stats;
      detail.append(el('p',selected),el('small',stats?.weighted_average_price==null?'ราคาอ้างอิงจากการซื้อขายจริง: ยังไม่มีข้อมูลเพียงพอ':`ซื้อขายจริง 30 วัน · เฉลี่ยถ่วงน้ำหนัก ${stats.weighted_average_price} · ต่ำสุด ${stats.min_price} · สูงสุด ${stats.max_price} เครดิต · ${stats.trade_count} รายการ`));
      detail.append(button('ปิดรายละเอียด',()=>{selected='';selectedOffer='';void render()}));
      const offers=data.offers?.items;
      if (!Array.isArray(offers)) throw new Error('รูปแบบข้อมูลข้อเสนอไม่รองรับ');
      if(!offers.length)detail.append(el('p','ยังไม่มีข้อเสนอที่เปิดขาย'));
      for(const offer of offers) {
        const id=String(offer.listing_id ?? ''), own=offer.is_mine === true;
        const row=el('div');row.className='market-offer';const choose=button(own?'ของฉัน':`เลือก · ${offer.unit_price} เครดิต`,()=>{selectedOffer=id;void render()});
        choose.disabled=own;choose.className=id===selectedOffer?'is-active':'';
        row.append(choose,el('small',`รายการ ${id} · เหลือ ${offer.quantity} ${marketUnit(selected)}`));detail.append(row);
        if(id===selectedOffer&&!own) {
          const amount=numberInput('1'); amount.setAttribute('aria-label','จำนวนที่ซื้อ');
          let max=0n; try { const price=BigInt(offer.unit_price), available=BigInt(offer.quantity); if(price>0n) max=available<credits/price?available:credits/price; } catch { /* invalid offer remains disabled */ }
          max=max<BigInt(Number.MAX_SAFE_INTEGER)?max:BigInt(Number.MAX_SAFE_INTEGER);
          amount.max=String(max);
          const total=el('p');const buy=actionButton('ตรวจสอบและซื้อ',()=>{const n=Number(amount.value);if(Number.isSafeInteger(n)&&n>0&&BigInt(n)<=max){const cost=BigInt(n)*BigInt(offer.unit_price);const review=`สินค้า: ${labels[selected]??selected}\nรายการผู้ขาย: ${id}\nจำนวน: ${n} ${marketUnit(selected)}\nราคา: ${offer.unit_price} เครดิต/${marketUnit(selected)}\nรวม: ${cost} เครดิต · ค่าธรรมเนียม: 0\nเครดิตคงเหลือ: ${credits-cost}\nการซื้อสร้างใบส่งมอบ คุณต้องกดรับสินค้าเพื่อส่งเข้าเมือง\n\nยืนยันซื้อรายการนี้?`;if(window.confirm(review))void mutate(()=>client.buy(id,n),'ซื้อสำเร็จ · ตรวจสอบใบส่งมอบ');}});
          const update=()=>{const n=Number(amount.value);let valid=Number.isSafeInteger(n)&&n>0&&BigInt(n)<=max;buy.disabled=unsafe()||!valid;total.textContent=valid?`รวม ${BigInt(n)*BigInt(offer.unit_price)} เครดิต`:`ซื้อได้สูงสุด ${max} ${marketUnit(selected)}`;}; amount.addEventListener('input',update);update();
          const maxButton=button('สูงสุด',()=>{amount.value=String(max);update()});detail.append(labeled('จำนวน',amount),maxButton,total,buy);
        }
      }
      if(data.offers?.next_cursor)detail.append(button('ข้อเสนอถัดไป →',()=>{offerCursor=String(data.offers.next_cursor);selectedOffer='';void render()}));if(data.offers?.pagination_truncated)detail.append(el('p','ข้อเสนอเกินขอบเขตการแบ่งหน้า · โปรดใช้ตัวกรอง'));
      if(offerCursor)detail.append(button('← ข้อเสนอหน้าแรก',()=>{offerCursor='';void render()}));
    }
    layout.append(aside,center,detail);content.replaceChildren(layout);
  };
  const drawSell = (data: any) => {
    const wrap=el('div');wrap.className='market-workspace'; const mine=activeMarketListings<MarketListing>(data.mine);
    wrap.append(el('h3',`ร้านของฉัน · ${mine.length} รายการเปิดขาย`));
    if(!mine.length)wrap.append(el('p','ยังไม่มีรายการขายที่เปิดอยู่'));
    for(const row of mine){const card=listCard(labels[row.item_code]??row.item_code,`${row.quantity} ${marketUnit(row.item_code)} · ${row.unit_price} เครดิต/${marketUnit(row.item_code)}`);card.append(actionButton('ยกเลิกและคืนสต็อก',()=>void mutate(()=>client.cancelListing(row.id),'ยกเลิกรายการแล้ว')));wrap.append(card)}
    const stock=new Map<string,number>(data.inventory.items.filter((x:{item_code:string})=>(MARKET_ITEMS as readonly string[]).includes(x.item_code)).map((x:{item_code:string;quantity:number})=>[x.item_code,Number(x.quantity)]));
    const form=el('form');form.className='market-form';const item=selectItems(),qty=numberInput('1'),price=numberInput('10');const available=el('small');const submit=el('button','ลงขาย');submit.type='submit';submit.dataset.mutation='true';
    const update=()=>{const have=stock.get(item.value)??0,n=Number(qty.value),p=Number(price.value);available.textContent=`สต็อกในคลังตลาด ${have} ${marketUnit(item.value)}`;submit.disabled=unsafe()||!Number.isSafeInteger(n)||n<1||n>have||!Number.isSafeInteger(p)||p<1;};item.addEventListener('change',update);qty.addEventListener('input',update);price.addEventListener('input',update);update();
    form.append(labeled('สินค้า',item),labeled('จำนวน',qty),labeled('ราคาต่อล็อตหรือหน่วย',price),available,submit);form.addEventListener('submit',e=>{e.preventDefault();if(!submit.disabled)void mutate(()=>client.list(item.value as MarketItem,Number(price.value),Number(qty.value)),'ลงขายสำเร็จ')});wrap.append(el('h3','ลงขายจากคลังตลาด'),form);
    const deposit=el('form');deposit.className='market-form';const dItem=selectItems(),firm=document.createElement('select'),dQty=numberInput('1'),send=el('button','ฝากเข้าคลังตลาด');send.type='submit';send.dataset.mutation='true';
    const updateSources=()=>{const firms=eligibleDepositFirms(city(),dItem.value as MarketItem);const prior=firm.value;firm.replaceChildren(...firms.map(f=>{const o=el('option',depositSourceLabel(f,dItem.value as MarketItem));o.value=String(f.id);return o}));if(firms.some(f=>String(f.id)===prior))firm.value=prior;const chosen=firms.find(f=>String(f.id)===firm.value);const have=chosen?depositSourceStock(chosen,dItem.value as MarketItem):0;const n=Number(dQty.value);send.disabled=unsafe()||!data.inventory.imports_enabled||!Number.isSafeInteger(n)||n<1||n>have;};dItem.addEventListener('change',updateSources);firm.addEventListener('change',updateSources);dQty.addEventListener('input',updateSources);updateSources();
    deposit.append(labeled('สินค้า',dItem),labeled('แหล่งผลิต',firm),labeled('จำนวน',dQty),send);deposit.addEventListener('submit',e=>{e.preventDefault();if(!send.disabled)void mutate(()=>client.deposit(Number(firm.value),dItem.value as MarketItem,Number(dQty.value),saveCity),'ฝากสต็อกสำเร็จ')});wrap.append(el('h3','ฝากสต็อกจากเมือง'),el('p',data.inventory.imports_enabled?'เลือกแหล่งผลิตที่มีสินค้าตรงชนิด':'การฝากสต็อกปิดตามนโยบายทดสอบ'),deposit);content.replaceChildren(wrap);
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
          catch(e){setNotice(`ยังตรวจสอบรายการไม่ได้: ${errorText(e)} · ไม่ได้สร้างรายการใหม่`);}
          finally{busy=false;if(dialog.open)void render();}
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
      const card=listCard(labels[r.item_code]??r.item_code,`${r.quantity} ${marketUnit(r.item_code)} · ${stateLabel(r.state)}`);
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
      }else {const receive=actionButton('รับของและบันทึกเมือง',()=>void mutate(apply,'รับของแล้ว',r.receipt_id),!canReceive());const update=()=>{receive.disabled=unsafe()||!canReceive()};destination.addEventListener('change',update);update();card.append(receive);}
      if(r.state!=='ready'&&!record)card.append(el('small','ไม่พบข้อมูลการรับของเดิมในเมืองนี้ ต้องกู้คืนข้อมูลก่อน'));
      wrap.append(card)
    }content.replaceChildren(wrap);
  };
  const drawHistory = (data: any) => { const wrap=el('div');wrap.className='market-workspace';wrap.append(el('h3','ประวัติการซื้อขายจริง'));for(const [role,label] of [['buyer','ซื้อ'],['seller','ขาย']] as const){const b=button(label,()=>{historyRole=role;cursor='';void render()});b.className=historyRole===role?'is-active':'';wrap.append(b);}const rows=data.history?.items??[];if(!rows.length)wrap.append(el('p','ไม่มีรายการในหน้านี้'));for(const r of rows)wrap.append(listCard(labels[r.item_id]??r.item_id??'สินค้า',`${r.quantity} ${marketUnit(String(r.item_id ?? ''))} · ${r.unit_price} เครดิต · ${r.created_at??''}`));if(data.history?.next_cursor)wrap.append(button('หน้าถัดไป →',()=>{cursor=String(data.history.next_cursor);void render()}));if(data.history?.pagination_truncated)wrap.append(el('p','ประวัติเกินขอบเขตการแบ่งหน้า'));if(cursor)wrap.append(button('← หน้าแรก',()=>{cursor='';void render()}));content.replaceChildren(wrap); };
  const render = async () => {
    if(!dialog.open) return;
    drawTabs();
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
    }, data=>{loading=false;content.setAttribute('aria-busy','false');try {credits=BigInt(data.wallet.credits);account.textContent=`เครดิต ${credits.toLocaleString('th-TH')}`;if(tab==='buy')drawBuy(data);else if(tab==='sell')drawSell(data);else if(tab==='orders')drawOrders(data);else drawHistory(data);content.scrollTop=scrollTop;if(searchFocused){const search=content.querySelector<HTMLInputElement>('input[type=search]');search?.focus();search?.setSelectionRange(search.value.length,search.value.length);}}catch(e){content.replaceChildren(el('p',`ข้อมูลตลาดไม่พร้อม: ${errorText(e)}`));}}, e=>{loading=false;content.setAttribute('aria-busy','false');content.replaceChildren(el('p',`โหลดข้อมูลตลาดไม่ได้: ${errorText(e)} · โปรดลองใหม่`),button('ลองอีกครั้ง',()=>void render()));});
  };
  return {client,render};
}
