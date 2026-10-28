import './hud-row.css';
import { ICONS } from './ui-icons.ts';

const svg = (name: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

/**
 * Touch layout keeps the top of the screen to one row: level, city summary, pause,
 * one speed button and a menu. The page buttons, the day and the atmosphere toggle
 * move into that menu. Desktop is unchanged (these extra controls are hidden there).
 */
export function installHudRow() {
  const top = document.querySelector<HTMLElement>('.top-hud')!, nav = document.querySelector<HTMLElement>('.page-buttons')!;
  nav.id ||= 'page-buttons';

  const day = document.createElement('p'); day.className = 'hud-row-only hud-more-day';
  const source = document.querySelector<HTMLElement>('#day')!;
  // "วันที่ 338 · เดือน 12" as two short lines so the day fits one menu cell.
  const syncDay = () => { day.textContent = (source.textContent ?? '').replace('วันที่', 'วัน').replace(' · ', '\n'); };
  new MutationObserver(syncDay).observe(source, { childList: true, characterData: true, subtree: true }); syncDay();
  nav.prepend(day);

  // The atmosphere menu keeps its own toggle (and its outside-click handling); this item only presses it.
  const sky = document.createElement('button'); sky.type = 'button'; sky.className = 'inspector-toggle panel hud-row-only hud-more-sky';
  sky.setAttribute('aria-label', 'บรรยากาศเมือง');
  sky.innerHTML = `<span aria-hidden="true" class="svg-glyph">${svg('sun')}</span><span>บรรยากาศ</span>`;
  sky.addEventListener('click', () => document.querySelector<HTMLButtonElement>('#atmosphere-toggle')?.click());
  nav.append(sky);

  const more = document.createElement('button'); more.type = 'button'; more.id = 'hud-more'; more.className = 'panel hud-row-only';
  more.setAttribute('aria-controls', nav.id); more.setAttribute('aria-label', 'เมนู');
  more.innerHTML = `<span aria-hidden="true" class="svg-glyph">${svg('menu')}</span><span>เมนู</span>`;
  const open = (value: boolean) => { top.dataset.more = String(value); more.setAttribute('aria-expanded', String(value)); };
  more.addEventListener('click', () => open(top.dataset.more !== 'true'));
  // Any choice in the menu closes it; the page or panel it opens takes over.
  nav.addEventListener('click', e => { if ((e.target as Element).closest('button')) open(false); });
  document.addEventListener('pointerdown', e => { if (top.dataset.more === 'true' && !nav.contains(e.target as Node) && !more.contains(e.target as Node)) open(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && top.dataset.more === 'true') { open(false); more.focus(); } });
  top.append(more); open(false);

  // One speed button that steps 1× → 3× → 10×; the three original buttons keep their handlers.
  const speeds = [...document.querySelectorAll<HTMLButtonElement>('.time-buttons [data-speed]')];
  const cycle = document.createElement('button'); cycle.type = 'button'; cycle.id = 'speed-cycle'; cycle.className = 'hud-row-only';
  const current = () => speeds.findIndex(b => b.getAttribute('aria-pressed') === 'true');
  const syncSpeed = () => { const b = speeds[current()]; cycle.textContent = b?.textContent ?? 'ชม'; cycle.setAttribute('aria-label', b ? `ความเร็ว ${b.textContent} · แตะเพื่อเปลี่ยน` : 'ดูชีวิตประชาชน 1 นาทีเกมต่อวินาที · แตะเพื่อกลับ 1×'); };
  cycle.addEventListener('click', () => speeds[(current() + 1) % speeds.length]?.click());
  const watch = new MutationObserver(syncSpeed); for (const b of document.querySelectorAll('[data-speed]')) watch.observe(b, { attributes: true, attributeFilter: ['aria-pressed'] });
  speeds.at(-1)?.after(cycle); syncSpeed();
}
