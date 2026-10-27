import { MARKET_ITEMS, MarketClient, type MarketItem } from './market-client.ts';
import { RECIPE, type ProductId } from './goods.ts';
import type { City, Firm } from './sim.ts';

const labels: Record<string, string> = {
  'crop:rice': 'ข้าว', 'crop:vegetables': 'ผัก', 'crop:sugarcane': 'อ้อย',
  'product:milled-rice': 'ข้าวสาร', 'product:canned-food': 'อาหารกระป๋อง', 'product:sugar': 'น้ำตาล',
};
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => { const n = document.createElement(tag); n.textContent = text; return n; };
const button = (text: string, action: () => void) => { const b = el('button', text); b.type = 'button'; b.addEventListener('click', action); return b; };
const errorText = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  const thai: Record<string, string> = {
    'insufficient inventory': 'สต็อกตลาดของ Guest ไม่พอ',
    'insufficient wallet': 'เครดิตตลาดไม่พอ',
    'policy-disabled': 'นโยบายฝากของยังปิดอยู่ในการทดสอบนี้',
    'guest-required': 'กรุณาเข้าสู่ Guest ก่อน',
  };
  return thai[message] ?? (message || 'ข้อผิดพลาดที่ไม่ทราบสาเหตุ');
};
const itemKey = (item: MarketItem) => item.slice(item.indexOf(':') + 1);
export const depositSourceStock = (firm: Firm, item: MarketItem) => {
  const key = itemKey(item);
  const value = item.startsWith('crop:')
    ? firm.zone === 'F' ? Number(firm.crops[key as keyof typeof firm.crops] ?? 0) : 0
    : firm.zone === 'I' && firm.recipe && RECIPE[firm.recipe].product === key ? Number(firm.products[key as ProductId] ?? 0) : 0;
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
};
export const eligibleDepositFirms = (city: Pick<City, 'firms'>, item: MarketItem) => city.firms.filter(f => depositSourceStock(f, item) > 0);

export function installMarketPanel(city: () => City, onChanged: () => void, saveCity: () => void) {
  const base = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env.VITE_MARKET_URL ?? '';
  const client = new MarketClient(city, base);
  const host = document.querySelector('#game-content .game-menu');
  if (!host || !client.enabled) return { client, render: () => undefined };
  const section = document.createElement('section'); section.className = 'market-game-panel';
  const title = el('h3', 'ตลาดผู้เล่น · SANDBOX');
  const note = el('p', 'ตลาดออนไลน์แยกจากเมือง ใช้เครดิตและสต็อกของตลาดเท่านั้น ไม่เชื่อมเซฟจริงหรือเงินจริง');
  const status = el('p', 'ยังไม่ได้เข้าสู่ Guest'); status.className = 'market-status';
  const controls = document.createElement('div'); controls.className = 'market-controls';
  const refresh = button('โหลดตลาด', async () => { await render(); });
  const login = button('เข้า Guest / เริ่มเซสชัน', async () => {
    try { const me = await client.resume() ?? await client.createGuest(); status.textContent = `Guest ${me.guest_id ?? client.guestId} · เครดิต ${me.balance ?? 'ไม่ทราบ'}`; await render(); }
    catch (e) { status.textContent = `เชื่อมต่อตลาดไม่ได้: ${errorText(e)}`; }
  });
  controls.append(login, refresh); section.append(title, note, status, controls);
  const list = document.createElement('div'); list.className = 'market-list'; section.append(list); host.append(section);

  const render = async () => {
    if (!client.guestId) { list.replaceChildren(el('p', 'เข้าสู่ Guest ก่อนจึงจะดูรายการและทำรายการตลาดได้')); return; }
    try {
      const [rows, wallet, receipts, inventory] = await Promise.all([client.listings(), client.wallet(), client.receipts(), client.inventory()]);
      const serverStock = new Map<string, number>(inventory.items.map((x: { item_code: string; quantity: number }) => [x.item_code, Number(x.quantity)]));
      const credits = BigInt(wallet.credits);
      status.textContent = `Guest ${client.guestId} · เครดิต ${wallet.credits} · seq ${wallet.seq}`;
      list.replaceChildren();
      list.append(el('h4', 'รายการซื้อขาย'));
      if (!rows.length) list.append(el('p', 'ยังไม่มีรายการขายจากผู้เล่น'));
      for (const row of rows) {
        const card = document.createElement('article'); card.className = 'market-card';
        const buy = button('ซื้อ 1', async () => { try { await client.buy(row.id, 1); status.textContent = 'ซื้อสำเร็จ · รอรับของในประวัติใบส่งมอบ'; await render(); onChanged(); } catch (e) { status.textContent = `ซื้อไม่สำเร็จ: ${errorText(e)}`; } });
        const affordable = credits >= BigInt(row.unit_price); buy.disabled = !affordable; if (!affordable) buy.title = 'เครดิตตลาดไม่พอ';
        card.append(el('strong', `${labels[row.item_code] ?? row.item_code} · ${row.unit_price} เครดิต/หน่วย`), el('span', `เหลือ ${row.quantity}`), buy);
        if (!affordable) card.append(el('small', 'เครดิตตลาดไม่พอสำหรับรายการนี้'));
        list.append(card);
      }

      list.append(el('h4', 'ใบส่งมอบ'));
      if (!receipts.length) list.append(el('p', 'ยังไม่มีใบส่งมอบค้างอยู่'));
      for (const r of receipts) {
        const card = document.createElement('article'); card.className = 'market-card'; card.append(el('span', `${labels[r.item_code] ?? r.item_code} × ${r.quantity} · ${r.state}`));
        if (r.state === 'ready' || r.state === 'claimed') card.append(button(r.state === 'ready' ? 'รับของและบันทึกเมือง' : 'ยืนยัน ACK ซ้ำ', async () => {
          try { if (r.state === 'ready') await client.claim(r.receipt_id); await client.applyAndAck(r, saveCity); status.textContent = 'บันทึกของเข้า firm และ ACK สำเร็จ'; await render(); onChanged(); }
          catch (e) { status.textContent = `รับของไม่สำเร็จ: ${errorText(e)}`; }
        }));
        list.append(card);
      }

      const deposit = document.createElement('form'); deposit.className = 'market-listing-form';
      const firm = document.createElement('select');
      const depositItem = document.createElement('select'); for (const item of MARKET_ITEMS) { const o = el('option', labels[item]); o.value = item; depositItem.append(o); }
      const depositQty = document.createElement('input'); depositQty.type = 'number'; depositQty.min = '1'; depositQty.value = '1';
      const depositSubmit = el('button', inventory.imports_enabled ? 'ฝากสต็อกเข้า escrow' : 'ฝากสต็อกปิดอยู่'); depositSubmit.type = 'submit';
      const refreshDepositSources = () => {
        const item = depositItem.value as MarketItem, firms = eligibleDepositFirms(city(), item);
        firm.replaceChildren(...firms.map(f => { const o = el('option', `firm:${f.id}`); o.value = String(f.id); return o; }));
        const stock = firms.length ? depositSourceStock(firms[0], item) : 0; depositQty.max = String(Math.max(0, stock));
        const wanted = Number(depositQty.value), enabled = inventory.imports_enabled && firms.length > 0 && Number.isSafeInteger(wanted) && wanted > 0 && wanted <= stock;
        [firm, depositItem, depositQty, depositSubmit].forEach(x => { x.disabled = !enabled && x !== depositItem && x !== firm ? true : (!inventory.imports_enabled || firms.length === 0); });
        depositSubmit.disabled = !enabled || !inventory.imports_enabled;
      };
      depositItem.addEventListener('change', refreshDepositSources); depositQty.addEventListener('input', refreshDepositSources);
      refreshDepositSources();
      deposit.append(el('label', 'firm'), firm, el('label', 'สินค้า'), depositItem, el('label', 'จำนวน'), depositQty, depositSubmit);
      deposit.addEventListener('submit', async e => { e.preventDefault(); if (depositSubmit.disabled) return; try { await client.deposit(Number(firm.value), depositItem.value as MarketItem, Number(depositQty.value), saveCity); status.textContent = 'ฝากสต็อกสำเร็จ · escrow อยู่ภายใต้ server'; await render(); onChanged(); } catch (x) { status.textContent = `ฝากไม่สำเร็จ: ${errorText(x)}`; } });
      list.append(el('h4', 'ฝากสต็อกจาก firm'), deposit, el('p', inventory.imports_enabled ? 'เลือกฟาร์มสำหรับพืชผล หรือโรงงานสูตรตรงกันสำหรับสินค้าแปรรูป' : 'ฝากของถูกปิดตามนโยบายทดสอบ จึงยังไม่ส่งข้อมูลเมืองเข้า server'));

      const listing = document.createElement('form'); listing.className = 'market-listing-form';
      const select = document.createElement('select'); for (const item of MARKET_ITEMS) { const o = el('option', labels[item]); o.value = item; select.append(o); }
      const qty = document.createElement('input'); qty.type = 'number'; qty.min = '1'; qty.value = '1';
      const price = document.createElement('input'); price.type = 'number'; price.min = '1'; price.value = '10';
      const available = el('small'); const submit = el('button', 'ลงขายสต็อกตลาด'); submit.type = 'submit';
      const updateListingAvailability = () => { const have = serverStock.get(select.value) ?? 0; const wanted = Number(qty.value); const ok = Number.isSafeInteger(wanted) && wanted > 0 && wanted <= have; available.textContent = `สต็อกตลาดของ Guest: ${have} หน่วย`; submit.disabled = !ok; submit.title = ok ? '' : 'สต็อกตลาดของ Guest ไม่พอ'; };
      select.addEventListener('change', updateListingAvailability); qty.addEventListener('input', updateListingAvailability);
      listing.append(el('label', 'สินค้า'), select, el('label', 'จำนวน'), qty, el('label', 'ราคา/หน่วย'), price, available, submit); updateListingAvailability();
      listing.addEventListener('submit', async e => { e.preventDefault(); if (submit.disabled) return; try { await client.list(select.value as MarketItem, Number(price.value), Number(qty.value)); status.textContent = 'ลงขายสำเร็จ'; await render(); } catch (x) { status.textContent = `ลงขายไม่สำเร็จ: ${errorText(x)}`; } });
      list.append(el('h4', 'ลงขายจากสต็อกตลาดของ Guest'), listing);
    } catch (e) { list.replaceChildren(el('p', `เชื่อมต่อตลาดไม่ได้: ${errorText(e)}`)); }
  };
  void client.resume().then(() => render()).catch(() => render());
  return { client, render };
}
