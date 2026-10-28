import { MARKET_SAVE_KEY, marketJournalForTest, type MarketClient } from './market-client.ts';
import { SAVE_KEY } from './save-storage.ts';

export const entryDecision = (hasLocalGuest: boolean, session: 'valid' | 'unauthenticated' | 'transient') => session === 'valid' ? 'resume' : session === 'unauthenticated' && !hasLocalGuest ? 'create' : 'retry';

export async function requireGuestEntry(client: MarketClient, onAuthenticated: () => Promise<void> | void) {
  if (!client.enabled) return;
  const blockedElements = Array.from(document.body.children).filter((node): node is HTMLElement => node instanceof HTMLElement).map(node => ({ node, inert: node.inert }));
  for (const { node } of blockedElements) node.inert = true;
  const overlay = document.createElement('section'); overlay.className = 'guest-entry-gate'; overlay.setAttribute('aria-labelledby', 'guest-entry-title');
  const card = document.createElement('div'); card.className = 'guest-entry-card';
  const title = document.createElement('h1'); title.id = 'guest-entry-title'; title.textContent = 'CityManager';
  const subtitle = document.createElement('p'); subtitle.textContent = 'เล่นเมืองออฟไลน์ หรือเชื่อมบัญชี Guest เพื่อใช้ตลาด';
  const note = document.createElement('p'); note.className = 'guest-entry-note'; note.textContent = 'ตลาดออนไลน์เป็น sandbox แยก ใช้เครดิตและสต็อกตลาดทดสอบเท่านั้น';
  const button = document.createElement('button'); button.type = 'button'; button.textContent = 'เข้าสู่ระบบแบบแขก';
  const offline = document.createElement('button'); offline.type = 'button'; offline.textContent = 'เล่นออฟไลน์';
  const status = document.createElement('p'); status.className = 'guest-entry-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  card.append(title, subtitle, note, button, offline, status); overlay.append(card); document.body.append(overlay);
  const show = (message: string, busy = false) => { status.textContent = message; button.disabled = busy; offline.disabled = busy; button.setAttribute('aria-busy', String(busy)); };
  const prepare = async () => { if (!client.usesPagesAuth) return; button.disabled = true; try { await client.preparePagesLogin(); if (document.body.contains(overlay)) button.disabled = false; } catch { show('ยังเตรียมการเชื่อมต่อตลาดไม่ได้ คุณยังเล่นออฟไลน์ได้'); button.disabled = true; } };
  void prepare();
  let busy = false;
  const login = async () => {
    if (busy) return;
    busy = true;
    show('กำลังตรวจสอบ Guest…', true);
    try {
      const savedJournal = globalThis.localStorage?.getItem(MARKET_SAVE_KEY);
      if (savedJournal) marketJournalForTest(savedJournal); // Never replace an unreadable journal during login.
      const savedCity = globalThis.localStorage?.getItem(SAVE_KEY);
      const cityData = savedCity ? JSON.parse(savedCity) : null;
      if ((cityData?.version === 10 || cityData?.version === 11) && !cityData.market) throw new Error('saved market identity requires recovery');
      const savedMarket = (cityData?.version === 10 || cityData?.version === 11 || (cityData?.version === 12 || cityData?.version === 13) && cityData.market) ? marketJournalForTest(JSON.stringify(cityData.market)) : null;
      const priorState = Boolean(client.guestId || client.journal.operations.length || client.journal.escrow.length || Object.keys(client.journal.receipts).length || savedMarket?.guestId || savedMarket?.operations.length || savedMarket?.escrow.length || Object.keys(savedMarket?.receipts ?? {}).length);
      const session = client.usesPagesAuth ? await client.connectPages() : await client.checkSession();
      if (session) {
        if (savedMarket?.guestId && savedMarket.guestId !== session.guest_id) throw new Error('saved city belongs to a different market guest');
        if (!client.guestId && priorState) throw new Error('saved market identity requires recovery');
        await client.reconcileSession(session);
      } else {
        if (entryDecision(priorState, 'unauthenticated') !== 'create') { show('Guest เดิมหมดอายุหรือไม่พร้อมใช้งาน ข้อมูลเดิมยังถูกเก็บไว้ โปรดลองเชื่อมต่อใหม่'); return; }
        const created = await client.createGuest(); client.acceptSession(created);
      }
      overlay.remove(); for (const { node, inert } of blockedElements) node.inert = inert; await onAuthenticated();
    } catch (error) { show(error instanceof Error ? `เข้าสู่ระบบไม่สำเร็จ: ${error.message} · โปรดลองอีกครั้ง` : 'เชื่อมต่อ server ไม่สำเร็จ · โปรดลองอีกครั้ง'); }
    finally { busy = false; if (document.body.contains(overlay)) { button.disabled = false; offline.disabled = false; button.setAttribute('aria-busy', 'false'); if (client.usesPagesAuth) void prepare(); } }
  };
  button.addEventListener('click', () => { if (!button.disabled) void login(); });
  offline.addEventListener('click', () => { if (busy || offline.disabled) return; overlay.remove(); for (const { node, inert } of blockedElements) node.inert = inert; void onAuthenticated(); });
  button.focus();
}
