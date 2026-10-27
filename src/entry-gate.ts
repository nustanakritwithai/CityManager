import type { MarketClient } from './market-client.ts';

export const entryDecision = (hasLocalGuest: boolean, session: 'valid' | 'unauthenticated' | 'transient') => session === 'valid' ? 'resume' : session === 'unauthenticated' && !hasLocalGuest ? 'create' : 'retry';

export async function requireGuestEntry(client: MarketClient, onAuthenticated: () => Promise<void> | void) {
  if (!client.enabled) return;
  const overlay = document.createElement('section'); overlay.className = 'guest-entry-gate'; overlay.setAttribute('aria-labelledby', 'guest-entry-title');
  const card = document.createElement('div'); card.className = 'guest-entry-card';
  const title = document.createElement('h1'); title.id = 'guest-entry-title'; title.textContent = 'CityManager';
  const subtitle = document.createElement('p'); subtitle.textContent = 'เข้าสู่เมืองของคุณผ่านบัญชี Guest ก่อนเริ่มเล่น';
  const note = document.createElement('p'); note.className = 'guest-entry-note'; note.textContent = 'ตลาดออนไลน์เป็น sandbox แยก ใช้เครดิตและสต็อกตลาดทดสอบเท่านั้น';
  const button = document.createElement('button'); button.type = 'button'; button.textContent = 'เข้าสู่ระบบแบบแขก';
  const status = document.createElement('p'); status.className = 'guest-entry-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  card.append(title, subtitle, note, button, status); overlay.append(card); document.body.append(overlay);
  const show = (message: string, busy = false) => { status.textContent = message; button.disabled = busy; button.setAttribute('aria-busy', String(busy)); };
  const login = async () => {
    show('กำลังตรวจสอบ Guest…', true);
    try {
      const session = await client.checkSession();
      if (session) { client.acceptSession(session); overlay.remove(); await onAuthenticated(); return; }
      if (entryDecision(Boolean(client.guestId), 'unauthenticated') !== 'create') { show('Guest เดิมหมดอายุหรือไม่พร้อมใช้งาน ข้อมูลเดิมยังถูกเก็บไว้ โปรดลองเชื่อมต่อใหม่'); return; }
      const created = await client.createGuest(); client.acceptSession(created); overlay.remove(); await onAuthenticated();
    } catch (error) { show(error instanceof Error ? `เข้าสู่ระบบไม่สำเร็จ: ${error.message} · โปรดลองอีกครั้ง` : 'เชื่อมต่อ server ไม่สำเร็จ · โปรดลองอีกครั้ง'); }
    finally { if (document.body.contains(overlay) && button.disabled) button.disabled = false; }
  };
  button.addEventListener('click', () => { if (!button.disabled) void login(); });
  button.focus();
}
