import { ROAD_COST } from './sim.ts';
import { PLANTS } from './utilities.ts';
import { PARK } from './parks.ts';
import { EDUCATION_COST } from './education.ts';
import { BUILD_ICONS } from './ui-icons.ts';

/** Match the established keyboard layout, not the visual order of grouped controls. */
export const BUILD_SHORTCUTS: Readonly<Record<string, string>> = Object.freeze({
  v: 'select', r: 'road', '1': 'R', '2': 'C', '3': 'I', '4': 'F',
  '5': 'power', '6': 'water', '7': 'park', b: 'bulldoze', p: 'select',
});
const credits = (satang: number) => `${(satang / 100).toLocaleString('en-US')} เครดิต`;
export const BUILD_DETAILS: Readonly<Record<string, { label: string; price: string; key?: string }>> = {
  select: { label: 'เลือก/ตรวจสอบ', price: 'ไม่เสียค่าใช้จ่าย', key: 'V' },
  road: { label: 'ถนน', price: `${credits(ROAD_COST)}/ช่องใหม่`, key: 'R' },
  R: { label: 'โซนบ้าน', price: 'วางโซนฟรี', key: '1' },
  C: { label: 'โซนพาณิชย์', price: 'วางโซนฟรี', key: '2' },
  I: { label: 'โซนโรงงาน', price: 'วางโซนฟรี', key: '3' },
  F: { label: 'โซนฟาร์ม', price: 'วางโซนฟรี', key: '4' },
  power: { label: 'โรงไฟฟ้า', price: credits(PLANTS.power.cost), key: '5' },
  water: { label: 'โรงสูบน้ำ', price: credits(PLANTS.water.cost), key: '6' },
  park: { label: 'สวนสาธารณะ', price: credits(PARK.cost), key: '7' },
  school: { label: 'โรงเรียน', price: credits(EDUCATION_COST.school.build) },
  university: { label: 'มหาวิทยาลัย', price: credits(EDUCATION_COST.university.build) },
  bulldoze: { label: 'รื้อถอน', price: '0–20 เครดิต/ช่อง', key: 'B' },
};

export function blocksGameShortcuts(event: KeyboardEvent): boolean {
  return event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey ||
    !!(event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable], [role="textbox"]'));
}

/** Decorate the real controls after HUD setup; never clone commands or move feature-gated tools. */
export function installBuildToolbar() {
  const dock = document.querySelector<HTMLElement>('.tool-dock');
  dock?.classList.add('build-toolbar');
  for (const button of document.querySelectorAll<HTMLButtonElement>('.tool[data-tool]')) {
    const tool = button.dataset.tool!, detail = BUILD_DETAILS[tool];
    if (!detail || button.querySelector('.build-price')) continue;
    button.dataset.buildTool = tool;
    const glyph = button.querySelector<HTMLElement>('.tool-icon, .zone-icon');
    if (glyph && BUILD_ICONS[tool]) {
      glyph.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${BUILD_ICONS[tool]}</svg>`;
      glyph.classList.add('svg-glyph');
      // The previous road painter uses a CSS mask; remove it before displaying multitone SVG.
      glyph.classList.remove('road-asset-icon'); glyph.style.maskImage = 'none'; glyph.style.width = ''; glyph.style.height = '';
    }
    // Keep the label as the last span: select/group menus deliberately update it in sync().
    const price = document.createElement('small'); price.className = 'build-price'; price.textContent = detail.price;
    price.setAttribute('aria-hidden', 'true'); button.append(price);
    const description = `${detail.label} · ${detail.price}${detail.key ? ` (${detail.key})` : ''}`;
    button.title = description; button.setAttribute('aria-label', description);
    if (detail.key) button.setAttribute('aria-keyshortcuts', detail.key);
  }
}
