import { BUILD_ICONS, iconElement } from './ui-icons.ts';
import { installToolMenu } from './tool-menu.ts';

/** The arrow always selects/pans first. Only the explicit demolition option arms demolition. */
export function installSelectMenu(anchor: HTMLButtonElement, choose: (tool: string) => void) {
  const menu = document.createElement('div'); menu.id = 'select-submenu'; menu.className = 'select-submenu';
  menu.setAttribute('aria-label', 'เครื่องมือเลือก เลื่อน และรื้อถอน');
  const demolition = document.createElement('button'); demolition.type = 'button';
  demolition.className = 'tool tool-option'; demolition.dataset.tool = 'bulldoze';
  demolition.title = 'รื้อถอน (B)'; demolition.setAttribute('aria-label', 'เปิดโหมดรื้อถอน (B)'); demolition.setAttribute('aria-pressed', 'false');
  const label = document.createElement('span'); label.textContent = 'รื้อ';
  demolition.append(iconElement('bulldoze', 'tool-icon svg-glyph'), label); menu.append(demolition);
  const popup = installToolMenu(anchor, menu, true), anchorLabel = anchor.querySelector<HTMLElement>('span:last-child')!;
  anchor.classList.add('select-menu-anchor');
  const sync = (tool: string) => {
    const active = tool === 'bulldoze';
    anchor.dataset.demolitionActive = String(active);
    anchorLabel.textContent = active ? 'รื้ออยู่' : 'เลือก';
    const glyph = anchor.querySelector<HTMLElement>('.tool-icon');
    if (glyph) glyph.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${BUILD_ICONS[active ? 'bulldoze' : 'select']}</svg>`;
    const price = anchor.querySelector<HTMLElement>('.build-price');
    if (price) price.textContent = active ? '0–20 เครดิต/ช่อง' : 'ไม่เสียค่าใช้จ่าย';
    anchor.title = active ? 'โหมดรื้อถอนกำลังทำงาน · 0–20 เครดิต/ช่อง · แตะเพื่อกลับไปเลือก/เลื่อน (V)' : 'เลือก/เลื่อน · ไม่เสียค่าใช้จ่าย · เปิดเมนูรื้อถอน (V)';
    anchor.setAttribute('aria-label', anchor.title);
    demolition.classList.toggle('active', active); demolition.setAttribute('aria-pressed', String(active));
  };
  anchor.addEventListener('click', event => {
    const reopen = !popup.isOpen(); popup.close();
    choose(anchor.dataset.tool!);
    if (reopen) popup.open(event.detail === 0);
  });
  demolition.addEventListener('click', () => {
    popup.close(); choose(demolition.dataset.tool!); anchor.focus({ preventScroll: true });
  });
  sync('select');
  return { ...popup, sync };
}
