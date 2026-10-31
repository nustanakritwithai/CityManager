import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installSelectMenu } from '../src/select-menu.ts';
import { installToolMenu } from '../src/tool-menu.ts';
import { createCity, serialize } from '../src/sim.ts';
import { selectorTouchEmulation } from './select-menu-browser.mjs';

test('browser harness omits an invalid zero touch-point count when returning to desktop', () => {
  assert.deepEqual(selectorTouchEmulation(false), { enabled: false });
  assert.deepEqual(selectorTouchEmulation(true), { enabled: true, maxTouchPoints: 2 });
});

// Minimal DOM boundary, not a browser/layout substitute. Exercises the actual menu listeners.
class Element {
  tag: string; id = ''; className = ''; hidden = false; disabled = false; type = ''; title = ''; textContent = ''; innerHTML = ''; scrolled = false;
  dataset: Record<string, string> = {}; attributes = new Map<string, string>(); style: Record<string, string> = {};
  children: Element[] = []; parent: Element | null = null; listeners = new Map<string, ((e: any) => void)[]>();
  rect = { left: 100, right: 144, top: 700, bottom: 744, width: 44, height: 44 };
  constructor(tag = 'div') { this.tag = tag; }
  classList = {
    add: (...names: string[]) => { this.className = [...new Set([...this.className.split(' '), ...names])].join(' '); },
    toggle: (name: string, on: boolean) => { const list = new Set(this.className.split(' ')); on ? list.add(name) : list.delete(name); this.className = [...list].join(' '); },
  };
  append(...items: Element[]) { for (const item of items) { this.children.push(item); item.parent = this; } }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name); }
  getBoundingClientRect() { return this.rect; }
  contains(element: Element): boolean { return this === element || this.children.some(child => child.contains(element)); }
  closest(selector: string): Element | null { return (selector.startsWith('#') ? this.id === selector.slice(1) : this.className.split(' ').includes(selector.slice(1))) ? this : this.parent?.closest(selector) ?? null; }
  querySelectorAll(selector: string): Element[] { return this.children.flatMap(child => [...(child.tag === selector ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector: string) { if (selector === 'span:last-child') return this.children.at(-1); return this.children.find(child => child.className.split(' ').includes(selector.slice(1))); }
  addEventListener(name: string, listener: (e: any) => void) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]); }
  dispatch(name: string, properties: Record<string, unknown> = {}) {
    const event = { target: this, detail: 1, prevented: false, stopped: false, ...properties,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.stopped = true; } };
    for (const listener of this.listeners.get(name) ?? []) { listener(event); if (event.stopped) break; } return event;
  }
  focus() { (globalThis.document as unknown as { activeElement: Element }).activeElement = this; }
  scrollIntoView() { this.scrolled = true; }
}

function environment(run: (document: Element & { body: Element; activeElement?: Element }, window: Element, anchor: Element) => void) {
  const names = ['document', 'window', 'innerWidth', 'innerHeight'] as const, old = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  const document = Object.assign(new Element(), { body: new Element('body'), activeElement: undefined as Element | undefined, createElement: (tag: string) => new Element(tag) });
  const window = new Element(), dock = new Element(), anchor = new Element('button'); dock.className = 'tool-buttons';
  dock.rect = { left: 8, right: 382, top: 698, bottom: 748, width: 374, height: 50 };
  anchor.dataset.tool = 'select'; anchor.append(new Element('span'), new Element('span')); dock.append(anchor); document.body.append(dock);
  for (const [name, value] of Object.entries({ document, window, innerWidth: 390, innerHeight: 844 })) Object.defineProperty(globalThis, name, { configurable: true, value });
  try { run(document, window, anchor); } finally { names.forEach((name, i) => old[i] ? Object.defineProperty(globalThis, name, old[i]!) : Reflect.deleteProperty(globalThis, name)); }
}

test('arrow toggles read-only selection; only an explicit demolition choice arms it', () => environment((document, _window, anchor) => {
  const city = createCity(61025), snapshot = serialize(city), chosen: string[] = [];
  let mode = 'bulldoze';
  const selector = installSelectMenu(anchor as unknown as HTMLButtonElement, tool => { mode = tool; chosen.push(tool); selector.close(); selector.sync(tool); });
  const menu = document.body.children.at(-1)!, demolition = menu.children[0];
  assert.equal(menu.id, 'select-submenu'); assert.equal(demolition.dataset.tool, 'bulldoze');
  assert.equal(demolition.parent, menu); assert.equal(menu.parent, document.body);
  assert.equal(selector.isOpen(), false);
  anchor.dispatch('click'); assert.equal(mode, 'select'); assert.equal(selector.isOpen(), true);
  assert.equal(anchor.getAttribute('aria-expanded'), 'true'); assert.equal(demolition.getAttribute('aria-pressed'), 'false');
  assert.equal(menu.style.left, '100px'); assert.equal(menu.style.bottom, '150px');
  assert.equal(demolition.style.width, '44px'); assert.equal(demolition.style.height, '44px');
  anchor.dispatch('click'); assert.equal(mode, 'select'); assert.equal(selector.isOpen(), false);
  anchor.dispatch('click'); demolition.dispatch('click');
  assert.equal(mode, 'bulldoze'); assert.equal(selector.isOpen(), false);
  assert.equal(anchor.dataset.demolitionActive, 'true'); assert.equal(anchor.children[1].textContent, 'รื้ออยู่');
  assert.match(anchor.getAttribute('aria-label')!, /โหมดรื้อถอนกำลังทำงาน/); assert.equal(demolition.getAttribute('aria-pressed'), 'true');
  assert.equal(document.activeElement, anchor);
  anchor.dispatch('click'); assert.equal(mode, 'select'); assert.equal(anchor.dataset.demolitionActive, 'false');
  assert.deepEqual(chosen, ['select', 'select', 'select', 'bulldoze', 'select']);
  assert.equal(serialize(city), snapshot, 'Menu choices never receive a City or execute a map command');
}));

test('outside, focus-away, Escape and cancel dismissal do not choose demolition', () => environment((document, _window, anchor) => {
  const choices: string[] = [];
  const selector = installSelectMenu(anchor as unknown as HTMLButtonElement, tool => choices.push(tool));
  const menu = document.body.children.at(-1)!, demolition = menu.children[0];
  anchor.dispatch('click'); document.dispatch('pointerdown', { target: demolition }); assert.equal(selector.isOpen(), true);
  document.dispatch('pointerdown', { target: anchor }); assert.equal(selector.isOpen(), true);
  document.dispatch('pointerdown', { target: new Element('canvas') }); assert.equal(selector.isOpen(), false);
  anchor.dispatch('click'); document.dispatch('focusin', { target: new Element('button') }); assert.equal(selector.isOpen(), false);
  anchor.dispatch('click'); const cancel = new Element('button'); cancel.id = 'cancel-tool';
  document.dispatch('pointerdown', { target: cancel }); document.dispatch('focusin', { target: cancel }); assert.equal(selector.isOpen(), true, 'Shared Cancel owns popup dismissal'); selector.close();
  anchor.dispatch('click', { detail: 0 }); assert.equal(document.activeElement, demolition);
  const escape = document.dispatch('keydown', { key: 'Escape' });
  assert.equal(escape.prevented, true); assert.equal(escape.stopped, true); assert.equal(selector.isOpen(), false); assert.equal(document.activeElement, anchor);
  anchor.dispatch('click'); selector.close(true); assert.equal(selector.isOpen(), false);
  assert.ok(choices.every(tool => tool === 'select'));
}));

test('shared menus exclude one another and keyboard focus skips unavailable options', () => environment((document, _window, anchor) => {
  const first = new Element(), second = new Element(); first.id = 'first'; second.id = 'second';
  first.append(new Element('button')); second.append(new Element('button'), new Element('button'), new Element('button'), new Element('button'));
  second.children[0].hidden = true; second.children[1].disabled = true;
  const a = installToolMenu(anchor as unknown as HTMLButtonElement, first as unknown as HTMLElement);
  const other = new Element('button'), b = installToolMenu(other as unknown as HTMLButtonElement, second as unknown as HTMLElement);
  a.open(); b.open(true); assert.equal(a.isOpen(), false); assert.equal(b.isOpen(), true);
  assert.equal(document.activeElement, second.children[2]); assert.equal(second.children[2].scrolled, true);
  second.dispatch('keydown', { key: 'ArrowDown' }); assert.equal(document.activeElement, second.children[3]);
  second.dispatch('keydown', { key: 'ArrowDown' }); assert.equal(document.activeElement, second.children[2]);
  b.close();
}));

test('shared popup retains anchor size, contains landscape stacks and dismisses scrolled-away anchors', () => environment((document, window, anchor) => {
  const menu = new Element(); menu.id = 'test-menu'; menu.append(new Element('button'), new Element('button'), new Element('button'));
  const popup = installToolMenu(anchor as unknown as HTMLButtonElement, menu as unknown as HTMLElement);
  anchor.rect = { left: 360, right: 404, top: 170, bottom: 214, width: 44, height: 44 };
  popup.open(); assert.equal(menu.style.left, '338px'); assert.equal(menu.style.maxHeight, '156px');
  assert.ok(menu.children.every(button => button.style.height === '44px'));
  menu.children[0].focus(); const key = menu.dispatch('keydown', { key: 'ArrowUp' });
  assert.equal(key.prevented, true); assert.equal(key.stopped, true); assert.equal(document.activeElement, menu.children[2]);
  anchor.rect.left = -50; anchor.rect.right = -6; window.dispatch('scroll'); assert.equal(popup.isOpen(), false);
  anchor.rect.left = 100; anchor.rect.right = 144; anchor.rect.top = 50;
  popup.open(); assert.equal(popup.isOpen(), false, 'Never leave a partial unusable control above a too-low viewport');
}));

test('integration retains shortcuts and command dispatch; demolition has no standalone main-row button', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.equal(html.includes('data-tool="bulldoze"'), false); assert.equal((html.match(/data-tool="select"/g) ?? []).length, 1);
  const shortcuts = readFileSync(new URL('../src/build-toolbar.ts', import.meta.url), 'utf8');
  assert.match(shortcuts, /b: 'bulldoze'/); assert.match(shortcuts, /v: 'select'/); assert.match(shortcuts, /p: 'select'/);
  assert.match(main, /tool === 'bulldoze'/);
  assert.match(main, /bulldozeGuarded\(city, index, busEnabled\(\)/);
  assert.match(main, /resultSound\(bulldoze\(city, cell\), 'ui-bulldoze'\)/);
  assert.match(main, /selectMenu\?\.close\(\); selectMenu\?\.sync\(next\)/);
  assert.match(main, /if \(selectMenu\?\.isOpen\(\)\) \{ selectMenu.close\(true\); return; \}/);
});

test('selector browser input delivers native Enter character activation and unchanged shortcut keys', async () => {
  const { selectorKeyEvents } = await import('./select-menu-browser.mjs');
  assert.deepEqual(selectorKeyEvents('Enter'), [
    { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, type: 'keyDown', text: '\r', unmodifiedText: '\r' },
    { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, type: 'keyUp' },
  ]);
  assert.equal(selectorKeyEvents('Escape')[0].type, 'rawKeyDown');
  assert.deepEqual(selectorKeyEvents('b')[0], { key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66, type: 'keyDown', text: 'b', unmodifiedText: 'b' });
  assert.equal(selectorKeyEvents(' ')[0].code, 'Space');
});
