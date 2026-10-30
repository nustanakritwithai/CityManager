// Invoked by roads-smoke in its fresh loopback-only browser. All city data is synthetic.
import assert from 'node:assert/strict';
import { bulldoze, deserialize, serialize } from '../src/sim.ts';

// CDP validates maxTouchPoints even when disabled; zero is not an accepted value.
export const selectorTouchEmulation = touch => touch ? { enabled: true, maxTouchPoints: 2 } : { enabled: false };

// Native button activation needs Enter's character event, not only a key name.
// Match Chromium automation: character keys use keyDown + text; others use rawKeyDown.
export function selectorKeyEvents(value) {
  const text = value === 'Enter' ? '\r' : value.length === 1 ? value : '';
  const code = value === ' ' ? 'Space' : value.length === 1 ? `Key${value.toUpperCase()}` : value;
  const windowsVirtualKeyCode = ({ Escape: 27, Enter: 13, ' ': 32 })[value] ?? value.toUpperCase().charCodeAt(0);
  const key = { key: value, code, windowsVirtualKeyCode };
  return [{ ...key, type: text ? 'keyDown' : 'rawKeyDown', text, unmodifiedText: text }, { ...key, type: 'keyUp' }];
}

export async function checkSelectMenu({ evaluate, button, click, send, screenshot, load, close, paints, fixture, cell, setTouch }) {
  const checks = [], layouts = [];
  const state = () => evaluate('window.cityManager.snapshot()');
  const open = () => evaluate('!document.querySelector("#select-submenu").hidden');
  const selected = tool => evaluate(`document.querySelector('[data-tool="${tool}"]').getAttribute('aria-pressed')==='true'`);
  const key = async value => {
    for (const event of selectorKeyEvents(value)) await send('Input.dispatchKeyEvent', event);
    await paints();
  };
  const viewport = async (width, height, touch, screenWidth = width) => {
    await close(); await send('Emulation.setDeviceMetricsOverride', { width, height, screenWidth, screenHeight: height, deviceScaleFactor: 1, mobile: touch });
    await send('Emulation.setTouchEmulationEnabled', selectorTouchEmulation(touch)); setTouch(touch); await paints();
  };
  const geometry = async name => {
    const result = await evaluate(`(()=>{const a=document.querySelector('[data-tool="select"]'),m=document.querySelector('#select-submenu'),b=m.querySelector('button'),r=e=>{const p=e.getBoundingClientRect();return{x:p.x,y:p.y,right:p.right,bottom:p.bottom,w:p.width,h:p.height}},k=Math.min(1,screen.width/innerWidth),br=r(b);return{name:${JSON.stringify(name)},a:r(a),m:r(m),b:br,ratio:k,width:innerWidth,height:innerHeight,hit:b.contains(document.elementFromPoint(br.x+br.w/2,br.y+br.h/2)),count:m.querySelectorAll('button').length}})()`);
    layouts.push(result);
    assert.equal(result.count, 1, 'Only explicit demolition belongs in the selector popup');
    assert.ok(result.m.bottom <= result.a.y && result.m.y >= 0 && result.m.right <= result.width, 'Popup is above the arrow and viewport-contained');
    assert.ok(Math.abs(result.a.w - result.b.w) < 1 && Math.abs(result.a.h - result.b.h) < 1, 'Original toolbar button size is preserved');
    assert.ok(result.b.w * result.ratio >= 43.5 && result.b.h * result.ratio >= 43.5 && result.hit, 'Real reachable >=44px target');
    await screenshot(`selector-${name}.png`);
  };
  const tapCell = async index => {
    await paints(); const p = await evaluate(`window.cityManager.cellScreen(${index})`);
    assert.equal(await evaluate(`document.elementFromPoint(${p.x},${p.y})?.id`), 'city-canvas'); await click(p.x, p.y); await paints();
  };
  await viewport(1440, 1000, false); await load(fixture); await close();
  const baseline = await state(); assert.equal(baseline, fixture);
  assert.equal(await evaluate('document.querySelectorAll(".tool-buttons [data-tool=bulldoze]").length'), 0);
  assert.equal(await evaluate('document.querySelectorAll("[data-tool=bulldoze]").length'), 1);
  await button('[data-tool="select"]'); assert.equal(await open(), true); await geometry('desktop');
  assert.equal(await selected('select'), true); assert.equal(await selected('bulldoze'), false); assert.equal(await state(), baseline);
  await button('[data-tool="select"]'); assert.equal(await open(), false); assert.equal(await state(), baseline);
  await button('[data-tool="select"]'); await tapCell(cell); assert.equal(await open(), false); assert.equal(await state(), baseline); await close();
  await button('[data-tool="select"]'); await button('[data-tool="road"]');
  assert.equal(await open(), false); assert.equal(await evaluate('document.querySelector("#road-submenu").hidden'), false);
  await button('[data-tool="select"]'); assert.equal(await evaluate('document.querySelector("#road-submenu").hidden'), true);
  await key('Escape'); assert.equal(await open(), false); assert.equal(await selected('select'), true);
  await button('[data-tool="select"]'); await button('#cancel-tool'); assert.equal(await open(), false); assert.equal(await selected('select'), true);
  assert.equal(await state(), baseline);
  checks.push('Opening/repeating/outside/cancel/Escape/other-tool menu actions are read-only and menus exclude each other');

  // Keyboard activation uses native Enter, then returns focus on Escape without arming.
  await evaluate(`(()=>{window.__selectorKeys=[];window.__selectorRecord=e=>window.__selectorKeys.push({type:e.type,key:e.key,tool:e.target.dataset?.tool,trusted:e.isTrusted,detail:e.detail});for(const type of ['keydown','keypress','keyup','click'])document.addEventListener(type,window.__selectorRecord,true);document.querySelector('[data-tool=select]').focus()})()`);
  await key('Enter');
  const keyboard = await evaluate(`(()=>{for(const type of ['keydown','keypress','keyup','click'])document.removeEventListener(type,window.__selectorRecord,true);const result={events:window.__selectorKeys,open:!document.querySelector('#select-submenu').hidden,focus:document.activeElement.dataset.tool};delete window.__selectorKeys;delete window.__selectorRecord;return result})()`);
  assert.ok(keyboard.events.some(event => event.type === 'click' && event.tool === 'select' && event.trusted && event.detail === 0), JSON.stringify(keyboard));
  assert.equal(keyboard.open, true, JSON.stringify(keyboard)); assert.equal(keyboard.focus, 'bulldoze', JSON.stringify(keyboard));
  assert.equal(await selected('select'), true); await key('Escape');
  assert.equal(await evaluate('document.activeElement.dataset.tool'), 'select'); assert.equal(await state(), baseline);
  for (const exit of ['Escape', 'v', 'p']) {
    await key('b'); assert.equal(await selected('bulldoze'), true);
    assert.equal(await evaluate('document.querySelector("[data-tool=select]").dataset.demolitionActive'), 'true');
    assert.match(await evaluate('document.querySelector("[data-tool=select]").textContent'), /รื้ออยู่/);
    await key(exit); assert.equal(await selected('select'), true); assert.equal(await state(), baseline);
  }
  await key('b'); await button('[data-tool="select"]'); assert.equal(await selected('select'), true); assert.equal(await open(), true);
  await button('[data-tool="bulldoze"]'); assert.equal(await selected('bulldoze'), true); assert.equal(await open(), false); assert.equal(await state(), baseline);
  await screenshot('selector-desktop-demolition-active.png');
  const expected = deserialize(fixture); assert.equal(bulldoze(expected, cell).ok, true);
  await tapCell(cell); assert.equal(await state(), serialize(expected), 'Explicit demolition executes the unchanged command, including exact cost and ledger');
  await button('[data-tool="select"]'); await key('Escape'); await load(fixture); await close();
  checks.push('B arms; V/P/Escape/arrow cancel; keyboard open is read-only; explicit demolition retains exact simulation/accounting');

  for (const [name, width, height, screenWidth] of [['mobile', 390, 844, 390], ['small', 320, 568, 320], ['landscape', 844, 390, 844], ['touch-desktop-mode', 980, 780, 390]]) {
    await viewport(width, height, true, screenWidth);
    await button('[data-tool="select"]'); await geometry(name); assert.equal(await selected('select'), true); assert.equal(await state(), baseline);
    // While open, a real touch drag must remain pan, never a cell command or inspector tap.
    const start = await evaluate(`window.cityManager.cellScreen(${cell})`), x = width / 2, y = height * .45;
    assert.equal(await evaluate(`document.elementFromPoint(${x},${y})?.id`), 'city-canvas');
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 45, y: y + 12, id: 1 }] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await paints();
    const after = await evaluate(`window.cityManager.cellScreen(${cell})`);
    assert.ok(Math.hypot(after.x - start.x, after.y - start.y) > 2, 'Select drag still pans camera');
    assert.equal(await open(), false); assert.equal(await evaluate('document.querySelector("#inspector").dataset.open'), 'false'); assert.equal(await state(), baseline);
    await button('[data-tool="select"]'); await button('[data-tool="bulldoze"]');
    assert.equal(await selected('bulldoze'), true); assert.equal(await open(), false); assert.equal(await state(), baseline);
    await screenshot(`selector-${name}-demolition-active.png`);
    await button('[data-tool="select"]'); assert.equal(await selected('select'), true); await button('#cancel-tool');
    assert.equal(await open(), false); assert.equal(await state(), baseline);
  }
  checks.push('390px, 320px, landscape and touch desktop-mode retain matching >=44px buttons, unclipped popup, explicit active status and drag-pan');
  return { checks, layouts, note: 'Installed Edge with emulated touch/viewport only; no physical Android validation.' };
}
