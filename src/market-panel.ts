import { MARKET_ITEMS, MarketClient, type MarketItem } from './market-client.ts';
import type { City } from './sim.ts';

const labels: Record<string, string> = { 'crop:rice': 'ข้าว', 'crop:vegetables': 'ผัก', 'crop:sugarcane': 'อ้อย', 'product:milled-rice': 'ข้าวสาร', 'product:canned-food': 'อาหารกระป๋อง', 'product:sugar': 'น้ำตาล' };
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => { const n = document.createElement(tag); n.textContent = text; return n; };
const button = (text: string, action: () => void) => { const b = el('button', text); b.type = 'button'; b.addEventListener('click', action); return b; };

export function installMarketPanel(city: () => City, onChanged: () => void, saveCity: () => void) {
  const base = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env.VITE_MARKET_URL ?? '';
  const client = new MarketClient(city, base);
  const host = document.querySelector('#game-content .game-menu');
  if (!host || !client.enabled) return { client, render: () => undefined };
  const section = document.createElement('section'); section.className = 'market-game-panel';
  const title = el('h3', 'ตลาดผู้เล่น · SANDBOX'); const note = el('p', 'ตลาดออนไลน์เท่านั้น · เครดิตและสต็อกแยกจากเมือง · ไม่มีการนำเข้าเซฟจริง');
  const status = el('p', 'ยังไม่ได้เข้าสู่ Guest'); status.className = 'market-status';
  const controls = document.createElement('div'); controls.className = 'market-controls';
  const refresh = button('โหลดตลาด', async () => { await render(); });
  const login = button('เข้า Guest / ดำเนินการต่อ', async () => { try { const me = await client.resume() ?? await client.createGuest(); status.textContent = `Guest ${me.guest_id ?? client.guestId} · เครดิต ${me.balance ?? 'พร้อมใช้งาน'}`; await render(); } catch (e) { status.textContent = `เข้าสู่ระบบไม่สำเร็จ: ${e instanceof Error ? e.message : 'ข้อผิดพลาด'}`; } });
  controls.append(login, refresh); section.append(title, note, status, controls);
  const list = document.createElement('div'); list.className = 'market-list'; section.append(list); host.append(section);
  const render = async () => {
    if (!client.guestId) { list.replaceChildren(el('p', 'กดเข้า Guest ก่อนจึงจะเห็นรายการและกระเป๋าตลาด')); return; }
    try {
      const [rows, wallet, receipts] = await Promise.all([client.listings(), client.wallet(), client.receipts()]);
      status.textContent = `Guest ${client.guestId} · เครดิต ${wallet.credits} · seq ${wallet.seq}`;
      list.replaceChildren();
      const heading = el('h4', 'รายการขาย'); list.append(heading);
      for (const row of rows) { const card = document.createElement('article'); card.className = 'market-card'; card.append(el('strong', `${labels[row.item_code] ?? row.item_code} · ${row.unit_price} เครดิต/หน่วย`), el('span', `เหลือ ${row.quantity}`), button('ซื้อ 1', async () => { try { await client.buy(row.id, 1); status.textContent = 'ซื้อสำเร็จ · รอรับของในประวัติใบส่งมอบ'; await render(); onChanged(); } catch (e) { status.textContent = `ซื้อไม่สำเร็จ: ${e instanceof Error ? e.message : 'ข้อผิดพลาด'}`; } })); list.append(card); }
      const receiptTitle = el('h4', 'ใบส่งมอบ'); list.append(receiptTitle);
      for (const r of receipts) { const card = document.createElement('article'); card.className = 'market-card'; card.append(el('span', `${labels[r.item_code] ?? r.item_code} × ${r.quantity} · ${r.state}`)); if (r.state === 'ready' || r.state === 'claimed') card.append(button(r.state === 'ready' ? 'รับของและบันทึกเมือง' : 'ยืนยัน ACK ซ้ำ', async () => { try { if (r.state === 'ready') await client.claim(r.receipt_id); await client.applyAndAck(r, saveCity); status.textContent = 'บันทึกของเข้า firm และ ACK สำเร็จ'; await render(); onChanged(); } catch (e) { status.textContent = `รับของไม่สำเร็จ: ${e instanceof Error ? e.message : 'ต้องตรวจสอบซ้ำ'}`; } })); list.append(card); }
      const listing = document.createElement('form'); listing.className = 'market-listing-form'; const select = document.createElement('select'); for (const item of MARKET_ITEMS) { const o = el('option', labels[item]); o.value = item; select.append(o); } const qty = document.createElement('input'); qty.type = 'number'; qty.min = '1'; qty.value = '1'; const price = document.createElement('input'); price.type = 'number'; price.min = '1'; price.value = '10'; const submit = el('button', 'ลงขายสต็อกตลาด'); submit.type = 'submit'; listing.append(el('label', 'สินค้า'), select, el('label', 'จำนวน'), qty, el('label', 'ราคา/หน่วย'), price, submit); listing.addEventListener('submit', async e => { e.preventDefault(); try { await client.list(select.value as MarketItem, Number(price.value), Number(qty.value)); status.textContent = 'ลงขายสำเร็จ'; await render(); } catch (x) { status.textContent = `ลงขายไม่สำเร็จ: ${x instanceof Error ? x.message : 'ข้อผิดพลาด'}`; } }); list.append(el('h4', 'ลงขาย (ใช้ได้เมื่อ server เปิด deposit policy ในชุดทดสอบเท่านั้น)'), listing);
    } catch (e) { list.replaceChildren(el('p', `ตลาดยังเชื่อมต่อไม่ได้: ${e instanceof Error ? e.message : 'offline'}`)); }
  };
  void client.resume().then(() => render()).catch(() => render());
  return { client, render };
}
