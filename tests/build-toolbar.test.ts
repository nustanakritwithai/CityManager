import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUILD_DETAILS, BUILD_SHORTCUTS, blocksGameShortcuts, installBuildToolbar } from '../src/build-toolbar.ts';
import { BUILD_ICONS } from '../src/ui-icons.ts';
import { ROAD_COST } from '../src/sim.ts';
import { PARK } from '../src/parks.ts';
import { PLANTS } from '../src/utilities.ts';

class Stub {
  style: Record<string,string> = {}; className = ''; textContent = ''; innerHTML = ''; title = '';
  dataset: Record<string,string> = {}; attrs: Record<string,string> = {}; children: Stub[] = [];
  classList = { remove: (name: string) => { this.className = this.className.replace(name,''); }, add: (name: string) => { this.className += ` ${name}`; } };
  editable: boolean; constructor(editable = false) { this.editable = editable; }
  closest() { return this.editable ? this : null; }
  setAttribute(key: string, value: string) { this.attrs[key] = value; }
  append(child: Stub) { this.children.push(child); }
  querySelector(selector: string) { return this.children.find(c => selector === '.build-price' ? c.className === 'build-price' : c.className.includes('tool-icon')) ?? null; }
}
test('actual controls gain fixed multitone icons, accessible costs and true shortcuts without replacing listeners', () => {
  const old = Object.getOwnPropertyDescriptor(globalThis,'document');
  const dock = new Stub(), buttons = [...Object.keys(BUILD_DETAILS),'taxi','rail','bus'].map(tool => {
    const b = new Stub(); b.dataset.tool = tool; const glyph = new Stub(); glyph.className = tool === 'road' ? 'tool-icon road-asset-icon' : 'tool-icon';
    if (tool === 'road') { glyph.style.maskImage = 'url(old-road.svg)'; glyph.style.width = glyph.style.height = '24px'; }
    b.append(glyph); return b;
  });
  const doc = { querySelector: () => dock, querySelectorAll: () => buttons, createElement: () => new Stub() };
  Object.defineProperty(globalThis,'document',{configurable:true,value:doc});
  try {
    installBuildToolbar(); installBuildToolbar();
    assert.match(dock.className,/build-toolbar/);
    for (const b of buttons) {
      const detail = BUILD_DETAILS[b.dataset.tool];
      if (!detail) { assert.equal(b.children.length,1); continue; }
      assert.equal(b.children.length,2); assert.equal(b.children[1].textContent,detail.price);
      assert.ok(b.attrs['aria-label'].includes(detail.label)); assert.ok(b.title.includes(detail.price));
      if (detail.key) assert.equal(BUILD_SHORTCUTS[detail.key.toLowerCase()], b.dataset.tool);
      if (BUILD_ICONS[b.dataset.tool]) assert.match(b.children[0].innerHTML,/aria-hidden="true"/);
      if (b.dataset.tool === 'road') { assert.equal(b.children[0].style.maskImage,'none'); assert.equal(b.children[0].style.width,''); assert.doesNotMatch(b.children[0].className,/road-asset-icon/); }
    }
  } finally { if(old) Object.defineProperty(globalThis,'document',old); else Reflect.deleteProperty(globalThis,'document'); }
});
test('prices use construction constants, zoning is free rather than invented building prices', () => {
  for(const [tool,cost] of [['road',ROAD_COST],['park',PARK.cost],['power',PLANTS.power.cost],['water',PLANTS.water.cost]] as const)
    assert.ok(BUILD_DETAILS[tool].price.includes((cost / 100).toLocaleString('en-US')));
  for(const tool of ['R','C','I','F']) assert.equal(BUILD_DETAILS[tool].price,'วางโซนฟรี');
  // Demolition has no exported cost constant; guard the existing 2,000-satang/empty-free rule.
  const sim = readFileSync(new URL('../src/sim.ts',import.meta.url),'utf8');
  assert.ok(sim.includes('const cost = b || cell.road || plant || park || campus ? 2_000 : 0;'));
  assert.equal(BUILD_DETAILS.bulldoze.price,'0–20 เครดิต/ช่อง');
  assert.equal(BUILD_SHORTCUTS['8'],undefined); assert.equal(BUILD_SHORTCUTS.b,'bulldoze');
});
test('keyboard guard preserves editing, IME and browser shortcuts', () => {
  const old = Object.getOwnPropertyDescriptor(globalThis,'Element'); Object.defineProperty(globalThis,'Element',{configurable:true,value:Stub});
  try {
    const event = { target:new Stub(), defaultPrevented:false,isComposing:false,ctrlKey:false,altKey:false,metaKey:false };
    assert.equal(blocksGameShortcuts(event as unknown as KeyboardEvent),false);
    for(const property of ['defaultPrevented','isComposing','ctrlKey','altKey','metaKey']) assert.equal(blocksGameShortcuts({...event,[property]:true} as unknown as KeyboardEvent),true);
    assert.equal(blocksGameShortcuts({...event,target:new Stub(true)} as unknown as KeyboardEvent),true);
  } finally { if(old) Object.defineProperty(globalThis,'Element',old); else Reflect.deleteProperty(globalThis,'Element'); }
});
test('artwork is local fixed SVG and dock has scoped touch, focus, scroll and reduced-motion rules', () => {
  for(const tool of ['select','road','R','C','I','F','park','bulldoze']) {
    assert.ok(BUILD_ICONS[tool]); assert.doesNotMatch(BUILD_ICONS[tool], /<script|href=|url\(|\bid=/);
    assert.ok(new Set(BUILD_ICONS[tool].match(/#[0-9a-f]{6}/g)).size >= 2);
  }
  const css = readFileSync(new URL('../src/build-toolbar.css',import.meta.url),'utf8');
  for(const token of ['min-width:44px','min-height:70px','overflow-x:auto','prefers-reduced-motion','focus-visible','backdrop-filter','calc(44 * var(--reader-unit,1px))','calc(70 * var(--reader-unit,1px))']) assert.ok(css.includes(token));
  const main = readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
  assert.ok(main.includes('installHudIcons(); installKeycaps(); installBuildToolbar();'));
  assert.ok(main.includes('blocksGameShortcuts(e)')); assert.ok(main.includes('const shortcuts = BUILD_SHORTCUTS'));
});
