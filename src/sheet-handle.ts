/**
 * Touch layouts: a grab handle on the inspector. Drag up/down (or tap to cycle) between
 * peek, the default height and full screen. Only the panel height changes.
 */
type Sheet = 'peek' | 'half' | 'full';
const ORDER: Sheet[] = ['peek', 'half', 'full'];
const LABEL: Record<Sheet, string> = { peek: 'แผงข้อมูลย่อ แตะหรือลากขึ้นเพื่อขยาย', half: 'แผงข้อมูลครึ่งจอ ลากขึ้นหรือลง', full: 'แผงข้อมูลเต็มจอ แตะหรือลากลงเพื่อย่อ' };

export function installSheetHandle(inspector: HTMLElement) {
  const handle = document.createElement('button'); handle.type = 'button'; handle.id = 'sheet-handle'; handle.className = 'sheet-handle';
  let state: Sheet = 'half';
  const set = (next: Sheet) => { state = next; if (next === 'half') delete inspector.dataset.sheet; else inspector.dataset.sheet = next; handle.setAttribute('aria-label', LABEL[next]); handle.title = LABEL[next]; };
  set('half');
  let startY = 0, moved = false;
  handle.addEventListener('pointerdown', e => { startY = e.clientY; moved = false; handle.setPointerCapture(e.pointerId); });
  handle.addEventListener('pointermove', e => { if (Math.abs(e.clientY - startY) > 12) moved = true; });
  handle.addEventListener('pointerup', e => {
    const dy = e.clientY - startY, i = ORDER.indexOf(state);
    if (moved) set(ORDER[Math.max(0, Math.min(2, i + (dy < 0 ? 1 : -1)))]);
  });
  handle.addEventListener('click', () => { if (!moved) set(state === 'full' ? 'peek' : ORDER[ORDER.indexOf(state) + 1]); moved = false; });
  inspector.prepend(handle);
}
