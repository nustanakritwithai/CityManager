import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installServicesMenu, installConstructionMenu } from '../src/grouped-tool-menu.ts';
import { installToolMenu } from '../src/tool-menu.ts';

// DOM-boundary tests exercise real listeners; they are not browser/layout evidence.
class Element {
  tag: string; id = ''; className = ''; hidden = false; disabled = false; type = ''; title = ''; textContent = ''; innerHTML = '';
  dataset: Record<string, string> = {}; attributes = new Map<string, string>(); style: Record<string, string> = {};
  children: Element[] = []; parent: Element | null = null; listeners = new Map<string, ((event: any) => void)[]>();
  rect = { left: 100, right: 144, top: 700, bottom: 744, width: 44, height: 44 };
  constructor(tag = 'div') { this.tag = tag; }
  classList = {
    add: (...names: string[]) => { this.className = [...new Set([...this.className.split(' '), ...names])].join(' '); },
    toggle: (name: string, on: boolean) => { const list = new Set(this.className.split(' ')); on ? list.add(name) : list.delete(name); this.className = [...list].join(' '); },
  };
  append(...items: Element[]) { for (const item of items) { if (item.parent) item.parent.children = item.parent.children.filter(child => child !== item); this.children.push(item); item.parent = this; } }
  before(item: Element) { assert.ok(this.parent); item.parent = this.parent; this.parent.children.splice(this.parent.children.indexOf(this), 0, item); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name); }
  getBoundingClientRect() { return this.rect; }
  contains(element: Element): boolean { return this === element || this.children.some(child => child.contains(element)); }
  closest(selector: string): Element | null { return (selector.startsWith('#') ? this.id === selector.slice(1) : this.className.split(' ').includes(selector.slice(1))) ? this : this.parent?.closest(selector) ?? null; }
  querySelectorAll(selector: string): Element[] {
    return this.children.flatMap(child => {
      const match = selector === 'button' ? child.tag === 'button' : selector === '.tool-icon, .zone-icon' ? /\b(?:tool|zone)-icon\b/.test(child.className) : selector.startsWith('.tool-buttons ') ? child.closest('.tool-buttons') && child.dataset.tool === selector.match(/data-tool="([^"]+)"/)?.[1] : false;
      return [...(match ? [child] : []), ...child.querySelectorAll(selector)];
    });
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  addEventListener(name: string, listener: (event: any) => void) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]); }
  dispatch(name: string, properties: Record<string, unknown> = {}) {
    const event = { target: this, detail: 1, prevented: false, stopped: false, ...properties,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.stopped = true; } };
    for (const listener of this.listeners.get(name) ?? []) { listener(event); if (event.stopped) break; } return event;
  }
  focus() { (globalThis.document as unknown as { activeElement: Element }).activeElement = this; }
  scrollIntoView() {}
}
const serviceTools = ['power', 'water', 'park', 'school', 'university'], constructionTools = ['R', 'C', 'I', 'F'];
function environment(run: (document: Element & { body: Element; activeElement?: Element }, dock: Element, originals: Element[]) => void) {
  const names = ['document', 'window', 'innerWidth', 'innerHeight'] as const, old = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  const document = Object.assign(new Element(), { body: new Element('body'), activeElement: undefined as Element | undefined, createElement: (tag: string) => new Element(tag) }); document.append(document.body);
  const dock = new Element(); dock.className = 'tool-buttons'; dock.rect = { left: 8, right: 382, top: 698, bottom: 748, width: 374, height: 50 };
  const originals = [...constructionTools, ...serviceTools].map(tool => {
    const button = new Element('button'); button.dataset.tool = tool; button.className = 'tool'; button.title = `Original ${tool}`;
    const glyph = new Element('span'); glyph.className = 'tool-icon'; glyph.innerHTML = `original-icon-${tool}`;
    const label = new Element('span'); label.textContent = tool; button.append(glyph, label); dock.append(button); return button;
  }); document.body.append(dock);
  for (const [name, value] of Object.entries({ document, window: new Element(), innerWidth: 390, innerHeight: 844 })) Object.defineProperty(globalThis, name, { configurable: true, value });
  try { run(document, dock, originals); } finally { names.forEach((name, i) => old[i] ? Object.defineProperty(globalThis, name, old[i]!) : Reflect.deleteProperty(globalThis, name)); }
}
for (const [id, name, expected, install] of [
  ['services', 'บริการเมือง', serviceTools, installServicesMenu], ['construction', 'สิ่งปลูกสร้าง', constructionTools, installConstructionMenu],
] as const) {
  test(`${id}: original ordered buttons, read-only disclosure and explicit selection`, () => environment((document, dock, originals) => {
    const chosen: string[] = [], controller = install(tool => { chosen.push(tool); controller.sync(tool); });
    const menu = document.body.children.at(-1)!, anchor = dock.children.find(button => button.id === `${id}-tool`)!;
    assert.equal(menu.id, `${id}-submenu`); assert.equal(menu.parent, document.body); assert.deepEqual(menu.children.map(button => button.dataset.tool), expected);
    for (const button of menu.children) { assert.equal(button, originals.find(original => original.dataset.tool === button.dataset.tool)); assert.equal(button.title, `Original ${button.dataset.tool}`); assert.equal(button.getAttribute('aria-label'), button.title); }
    assert.equal(anchor.children[1].textContent, name); assert.equal(anchor.getAttribute('aria-expanded'), 'false');
    anchor.dispatch('click'); assert.equal(controller.isOpen(), true); assert.deepEqual(chosen, []); assert.equal(anchor.getAttribute('aria-expanded'), 'true');
    assert.ok(menu.children.every(button => button.style.width === '44px' && button.style.height === '44px'));
    anchor.dispatch('click'); assert.equal(controller.isOpen(), false); assert.deepEqual(chosen, []);
    for (const option of menu.children) {
      anchor.dispatch('click'); option.dispatch('click'); assert.equal(controller.isOpen(), false); assert.equal(chosen.at(-1), option.dataset.tool);
      assert.equal(anchor.dataset.activeTool, option.dataset.tool); assert.equal(option.getAttribute('aria-pressed'), 'true'); assert.equal(anchor.children[0].innerHTML, option.children[0].innerHTML);
      assert.match(anchor.getAttribute('aria-label')!, /กำลังทำงาน/); assert.equal(document.activeElement, anchor);
      const count = chosen.length; anchor.dispatch('click'); anchor.dispatch('click'); assert.equal(chosen.length, count); assert.equal(anchor.dataset.activeTool, option.dataset.tool);
    }
    controller.sync('road'); assert.equal(anchor.dataset.activeTool, ''); assert.equal(anchor.children[1].textContent, name); assert.ok(menu.children.every(button => button.getAttribute('aria-pressed') === 'false')); assert.deepEqual(chosen, expected);
  }));
  test(`${id}: opening disarms demolition before outside dismissal and cannot re-arm`, () => environment((document, dock) => {
    const chosen: string[] = []; let mode = 'bulldoze';
    const controller = install(tool => { chosen.push(tool); mode = tool; controller.close(); controller.sync(tool); });
    const anchor = dock.children.find(button => button.id === `${id}-tool`)!;
    controller.sync('bulldoze'); anchor.dispatch('click'); assert.equal(mode, 'select'); assert.equal(controller.isOpen(), true); assert.deepEqual(chosen, ['select']);
    document.dispatch('pointerdown', { target: new Element('canvas') }); assert.equal(controller.isOpen(), false); assert.equal(mode, 'select');
    anchor.dispatch('click'); anchor.dispatch('click'); assert.deepEqual(chosen, ['select']);
    controller.sync('bulldoze'); mode = 'bulldoze'; anchor.dispatch('click', { detail: 0 }); assert.equal(mode, 'select');
    document.dispatch('keydown', { key: 'Escape' }); assert.equal(mode, 'select'); assert.equal(controller.isOpen(), false); assert.deepEqual(chosen, ['select', 'select']);
  }));
}
test('services preserve education availability, focus and Escape without changing safe selected tool', () => environment((document, dock, originals) => {
  originals.find(button => button.dataset.tool === 'school')!.hidden = true; originals.find(button => button.dataset.tool === 'university')!.hidden = true;
  const chosen: string[] = [], controller = installServicesMenu(tool => chosen.push(tool)), menu = document.body.children.at(-1)!, anchor = dock.children.find(button => button.id === 'services-tool')!;
  assert.deepEqual(menu.children.filter(button => button.hidden).map(button => button.dataset.tool), ['school', 'university']); menu.children[3].dispatch('click'); assert.deepEqual(chosen, []);
  controller.sync('park'); anchor.dispatch('click'); document.dispatch('pointerdown', { target: new Element('canvas') }); assert.equal(controller.isOpen(), false);
  anchor.dispatch('click'); document.dispatch('focusin', { target: new Element('button') }); assert.equal(controller.isOpen(), false);
  anchor.dispatch('click', { detail: 0 }); assert.equal(document.activeElement, menu.children[0]); menu.dispatch('keydown', { key: 'End' }); assert.equal(document.activeElement, menu.children[2]);
  const event = document.dispatch('keydown', { key: 'Escape' }); assert.equal(event.prevented, true); assert.equal(event.stopped, true); assert.equal(controller.isOpen(), false); assert.equal(document.activeElement, anchor); assert.equal(anchor.dataset.activeTool, 'park'); assert.deepEqual(chosen, []);
}));
test('both groups, road and selector popups exclude each other; Cancel remains available to main', () => environment((document, dock) => {
  const chosen: string[] = [], services = installServicesMenu(tool => chosen.push(tool)), construction = installConstructionMenu(tool => chosen.push(tool));
  const serviceAnchor = dock.children.find(button => button.id === 'services-tool')!, constructionAnchor = dock.children.find(button => button.id === 'construction-tool')!;
  const roadAnchor = new Element('button'), selectAnchor = new Element('button'), roadMenu = new Element(), selectMenu = new Element(); roadMenu.id = 'road-submenu'; selectMenu.id = 'select-submenu'; roadMenu.append(new Element('button')); selectMenu.append(new Element('button')); dock.append(roadAnchor, selectAnchor);
  const road = installToolMenu(roadAnchor as unknown as HTMLButtonElement, roadMenu as unknown as HTMLElement), select = installToolMenu(selectAnchor as unknown as HTMLButtonElement, selectMenu as unknown as HTMLElement, true);
  serviceAnchor.dispatch('click'); assert.equal(services.isOpen(), true); constructionAnchor.dispatch('click'); assert.equal(services.isOpen(), false); assert.equal(construction.isOpen(), true);
  road.open(); assert.equal(construction.isOpen(), false); assert.equal(road.isOpen(), true); select.open(); assert.equal(road.isOpen(), false); assert.equal(select.isOpen(), true); serviceAnchor.dispatch('click'); assert.equal(select.isOpen(), false);
  const cancel = new Element('button'); cancel.id = 'cancel-tool'; document.dispatch('pointerdown', { target: cancel }); document.dispatch('focusin', { target: cancel }); assert.equal(services.isOpen(), true);
  services.close(true); assert.equal(services.isOpen(), false); assert.equal(document.activeElement, serviceAnchor); assert.deepEqual(chosen, []);
}));
test('grouping retains original placement command paths and shortcuts', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  for (const entry of ["'1': 'R'", "'2': 'C'", "'3': 'I'", "'4': 'F'", "'5': 'power'", "'6': 'water'", "'7': 'park'"]) assert.ok(main.includes(entry));
  for (const command of ['zoneCell(city, index, tool as Zone)', 'buildPlant(city, index, tool)', 'buildPark(city, index)', 'buildCampus(city, index, tool)']) assert.ok(main.includes(command));
  assert.doesNotMatch(readFileSync(new URL('../src/grouped-tool-menu.ts', import.meta.url), 'utf8'), /from ['"]\.\/sim\.ts|buildPlant\(|buildPark\(|buildCampus\(|zoneCell\(/);
});

test('grouped browser keys retain native Enter activation and correct numeric/navigation codes', async () => {
  const { groupedKeyEvents, groupedToolFixture } = await import('./grouped-tool-menu-browser.mjs');
  assert.equal(groupedKeyEvents('Enter')[0].text, '\r');
  assert.equal(groupedKeyEvents('5')[0].code, 'Digit5'); assert.equal(groupedKeyEvents('5')[0].windowsVirtualKeyCode, 53);
  assert.equal(groupedKeyEvents('End')[0].windowsVirtualKeyCode, 35); assert.equal(groupedKeyEvents('End')[0].type, 'rawKeyDown');
  assert.ok(groupedToolFixture().length > 0);
});
