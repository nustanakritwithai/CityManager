/** Swaps the HUD's Unicode glyphs (↖ ╋ ⌫ ✥ ▤ ☰ …) for the shared SVG icon set; labels and ids stay. */
import { ICONS } from './ui-icons.ts';

const svg = (name: string) => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${ICONS[name]}</svg>`;
const TOOLS: Record<string, string> = { select: 'cursor', road: 'road', R: 'R', C: 'shop', I: 'I', F: 'F', bulldoze: 'bulldoze', pan: 'move' };
const PAGES: Record<string, string> = { 'toggle-stats': 'chart', 'toggle-inspector': 'overview', 'toggle-help': 'help', 'toggle-game-menu': 'menu' };

export function installHudIcons() {
  for (const button of document.querySelectorAll<HTMLElement>('.tool[data-tool]')) {
    const name = TOOLS[button.dataset.tool!], glyph = button.querySelector<HTMLElement>('.tool-icon, .zone-icon');
    if (name && glyph) { glyph.innerHTML = svg(name); glyph.classList.add('svg-glyph'); }
  }
  for (const [id, name] of Object.entries(PAGES)) {
    const glyph = document.getElementById(id)?.querySelector<HTMLElement>('span[aria-hidden="true"]');
    if (glyph) { glyph.innerHTML = svg(name); glyph.classList.add('svg-glyph'); }
  }
}
