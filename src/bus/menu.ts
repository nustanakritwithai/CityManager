import { installToolMenu } from '../tool-menu.ts';
import { iconElement } from '../ui-icons.ts';

const options = [['bus-depot', 'อู่', 'วางอู่รถเมล์'], ['bus-stop', 'ป้าย', 'วางป้ายรถเมล์'], ['bus-line', 'สาย', 'สร้างสายรถเมล์']] as const;
export type BusToolName = 'bus-depot' | 'bus-stop' | 'bus-line';

/** One dock button, opened with a tap. Choices are icon + one-word 44px targets in a row, like the build, service and rail menus. */
export function installBusMenu(anchor: HTMLButtonElement, choose: (tool: BusToolName) => void, openPanel: () => void, enabled: () => boolean) {
  const menu = document.createElement('div');
  menu.id = 'bus-submenu'; menu.className = 'bus-submenu'; menu.setAttribute('aria-label', 'เครื่องมือรถเมล์');
  const popup = installToolMenu(anchor, menu, true, 'row');
  const buttons = new Map<string, HTMLButtonElement>();
  for (const [tool, label, aria] of options) {
    const item = document.createElement('button');
    item.type = 'button'; item.className = 'tool tool-option bus-touch'; item.dataset.tool = tool; item.title = aria;
    item.append(iconElement(tool, 'tool-icon svg-glyph'), Object.assign(document.createElement('span'), { textContent: label }));
    item.setAttribute('aria-label', aria);
    item.addEventListener('click', () => { if (!enabled()) return; popup.close(); choose(tool); anchor.focus({ preventScroll: true }); });
    menu.append(item); buttons.set(tool, item);
  }
  const manage = document.createElement('button');
  manage.type = 'button'; manage.className = 'tool tool-option bus-touch'; manage.dataset.action = 'panel'; manage.title = 'จัดการสายรถเมล์';
  manage.append(iconElement('gear', 'tool-icon svg-glyph'), Object.assign(document.createElement('span'), { textContent: 'จัดการ' }));
  manage.setAttribute('aria-label', 'เปิดแผงจัดการสายรถเมล์');
  manage.addEventListener('click', () => { if (!enabled()) return; popup.close(); openPanel(); anchor.focus({ preventScroll: true }); });
  menu.append(manage);
  const caption = anchor.querySelector('span:last-child');
  const sync = (tool: string) => {
    const active = buttons.has(tool);
    anchor.classList.toggle('active', active); anchor.setAttribute('aria-pressed', String(active)); anchor.dataset.activeTool = active ? tool : '';
    if (caption) caption.textContent = tool === 'bus-depot' ? 'อู่' : tool === 'bus-stop' ? 'ป้าย' : tool === 'bus-line' ? 'สาย' : 'รถเมล์';
    for (const [name, item] of buttons) { const on = name === tool; item.classList.toggle('active', on); item.setAttribute('aria-pressed', String(on)); }
  };
  anchor.addEventListener('click', event => {
    if (!enabled()) return;
    if (popup.isOpen()) popup.close(); else popup.open((event as MouseEvent).detail === 0);
  });
  sync('select');
  return { ...popup, sync };
}
