import { iconElement } from './ui-icons.ts';
import { installToolMenu } from './tool-menu.ts';

const services = [
  ['power', 'ไฟฟ้า'], ['water', 'ประปา'], ['park', 'สวน'],
  ['school', 'โรงเรียน'], ['university', 'มหาวิทยาลัย'],
] as const;

const construction = [['R', 'บ้าน'], ['C', 'พาณิชย์'], ['I', 'โรงงาน'], ['F', 'ฟาร์ม']] as const;

export const installServicesMenu = (choose: (tool: string) => void) => installGroupedToolMenu('services', 'บริการเมือง', services, choose);
export const installConstructionMenu = (choose: (tool: string) => void) => installGroupedToolMenu('construction', 'สิ่งปลูกสร้าง', construction, choose);

/** Move the existing controls, not their commands, into a disclosure that never arms placement or demolition. */
function installGroupedToolMenu(id: string, name: string, tools: readonly (readonly [string, string])[], choose: (tool: string) => void) {
  const options = tools.map(([tool, label]) => ({
    tool, label, button: document.querySelector<HTMLButtonElement>(`.tool-buttons [data-tool="${tool}"]`)!,
  }));
  const anchor = document.createElement('button'); anchor.id = `${id}-tool`; anchor.type = 'button';
  anchor.className = 'tool grouped-tool-anchor';
  const icon = iconElement(id === 'construction' ? 'R' : 'overview', 'tool-icon svg-glyph'), label = document.createElement('span');
  const defaultIcon = icon.innerHTML;
  anchor.append(icon, label); options[0].button.before(anchor);
  const menu = document.createElement('div'); menu.id = `${id}-submenu`; menu.className = 'grouped-tool-submenu';
  const names = tools.map(([, label]) => label).join(' ');
  menu.setAttribute('aria-label', `${name}: ${names}`);
  for (const option of options) {
    option.button.classList.add('tool-option');
    option.button.setAttribute('aria-label', option.button.title);
    menu.append(option.button);
  }
  const popup = installToolMenu(anchor, menu, true);
  let currentTool = 'select';
  const sync = (tool: string) => {
    currentTool = tool;
    const selected = options.find(option => option.tool === tool);
    anchor.classList.toggle('active', !!selected); anchor.dataset.activeTool = selected?.tool ?? '';
    label.textContent = selected?.label ?? name;
    anchor.title = selected ? `${name} · ${selected.label}กำลังทำงาน · ${selected.button.title} · แตะเพื่อเลือกเครื่องมือ` : `${name} · ${names}`;
    anchor.setAttribute('aria-label', anchor.title);
    anchor.setAttribute('aria-pressed', String(!!selected));
    const glyph = selected?.button.querySelector<HTMLElement>('.tool-icon, .zone-icon');
    if (glyph) { icon.innerHTML = glyph.innerHTML; icon.className = glyph.className.replace('zone-icon', 'tool-icon'); }
    else { icon.innerHTML = defaultIcon; icon.className = 'tool-icon svg-glyph'; }
    for (const option of options) {
      const active = option.tool === tool;
      option.button.classList.toggle('active', active); option.button.setAttribute('aria-pressed', String(active));
    }
  };
  anchor.addEventListener('click', event => {
    if (popup.isOpen()) popup.close();
    else {
      // A tap dismissing this non-destructive picker must never inherit armed demolition.
      // Keep every other current mode unchanged; only an explicit demolition choice can re-arm it.
      if (currentTool === 'bulldoze') choose('select');
      popup.open(event.detail === 0);
    }
  });
  for (const option of options) option.button.addEventListener('click', () => {
    if (option.button.hidden || option.button.disabled) return;
    popup.close(); choose(option.tool); anchor.focus({ preventScroll: true });
  });
  sync('select');
  return { ...popup, sync };
}
