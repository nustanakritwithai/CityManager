/** Swaps the HUD's Unicode glyphs (↖ ╋ ⌫ ✥ ▤ ☰ …) for the shared SVG icon set; labels and ids stay. */
import { ICONS } from './ui-icons.ts';

const svg = (name: string) => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${ICONS[name]}</svg>`;
const TOOLS: Record<string, string> = { select: 'cursor', road: 'road', R: 'R', C: 'shop', I: 'I', F: 'F', bulldoze: 'bulldoze', pan: 'move' };
const CAMERA: Record<string, string> = { 'rotate-left': 'rotate-left', 'rotate-right': 'rotate-right', 'zoom-in': 'zoom-in', 'zoom-out': 'zoom-out', reset: 'home', up: 'arrow-up', down: 'arrow-down', left: 'arrow-left', right: 'arrow-right' };
const PAGES: Record<string, string> = { 'toggle-stats': 'chart', 'toggle-network': 'network', 'toggle-inspector': 'overview', 'toggle-help': 'help', 'toggle-game-menu': 'menu' };

export function installHudIcons() {
  for (const button of document.querySelectorAll<HTMLElement>('.tool[data-tool]')) {
    const name = TOOLS[button.dataset.tool!], glyph = button.querySelector<HTMLElement>('.tool-icon, .zone-icon');
    if (name && glyph) { glyph.innerHTML = svg(name); glyph.classList.add('svg-glyph'); }
  }
  for (const button of document.querySelectorAll<HTMLElement>('[data-camera]')) {
    const name = CAMERA[button.dataset.camera!]; if (name) { button.innerHTML = svg(name); button.classList.add('svg-glyph'); }
  }
  for (const [id, name] of [['toggle-camera-pan', 'move'], ['toggle-camera', 'crosshair']] as const) {
    const button = document.getElementById(id); if (button) { button.innerHTML = svg(name); button.classList.add('svg-glyph'); }
  }
  for (const [id, name] of Object.entries(PAGES)) {
    const glyph = document.getElementById(id)?.querySelector<HTMLElement>('span[aria-hidden="true"]');
    if (glyph) { glyph.innerHTML = svg(name); glyph.classList.add('svg-glyph'); }
  }
}
