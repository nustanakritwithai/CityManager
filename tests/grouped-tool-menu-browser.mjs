// Runs in the existing roads-smoke fresh loopback-only Edge session. Synthetic city only.
import assert from 'node:assert/strict';
import { createCity, buildRoad, buildPlant, buildPark, buildCampus, zoneCell, deserialize, serialize, GATEWAY, SIZE } from '../src/sim.ts';
import { findCanvasDragStart, selectorKeyEvents, selectorTouchEmulation } from './select-menu-browser.mjs';
import { loadedTrafficSession } from './traffic-server-entry-fixture.mjs';

const groups = [['construction', ['R', 'C', 'I', 'F']], ['services', ['power', 'water', 'park', 'school', 'university']]];
const cell = (x, y) => y * SIZE + x;
export function groupedToolFixture() { const city = createCity(61025, { starter: false }); assert.equal(buildRoad(city, GATEWAY, cell(18, 12)).ok, true); return serialize(city); }
function place(city, tool, index) {
  return ['power', 'water'].includes(tool) ? buildPlant(city, index, tool) : tool === 'park' ? buildPark(city, index) : ['school', 'university'].includes(tool) ? buildCampus(city, index, tool) : zoneCell(city, index, tool);
}
// Preserve #107's native Enter/character events; extend only the group's navigation and numeric keys.
export const groupedKeyEvents = value => selectorKeyEvents(value).map(event => ({ ...event,
  code: /^[0-9]$/.test(value) ? `Digit${value}` : event.code,
  windowsVirtualKeyCode: ({ ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, End: 35, Home: 36 })[value] ?? event.windowsVirtualKeyCode,
}));

function assertLabel(label) {
  assert.ok(label.scroll <= label.width + 1, `Whole label fits without horizontal clipping: ${JSON.stringify(label)}`);
  assert.ok(label.left >= label.buttonLeft - 1 && label.right <= label.buttonRight + 1 && label.top >= label.buttonTop - 1 && label.bottom <= label.buttonBottom + 1, `Whole label stays inside its button: ${JSON.stringify(label)}`);
}

// Shared by native-browser acceptance and deterministic geometry regressions.
export function assertGroupedRowLayout(result, expected) {
  assert.deepEqual(result.buttons.map(button => button.tool), expected);
  assert.equal(result.layout, 'row'); assert.equal(result.direction, 'row');
  assert.equal(result.overflowX, 'auto'); assert.equal(result.overflowY, 'hidden');
  assert.ok(result.m.bottom <= result.a.y && result.m.y >= 0 && result.m.x >= 0 && result.m.right <= result.width && result.m.bottom <= result.height, 'Above-anchor row stays within viewport');
  assert.ok(Math.abs(result.m.h - result.a.h) < 1 && result.scrollY <= result.clientY + 1, 'Row retains original button height without vertical clipping');
  for (const [index, option] of result.buttons.entries()) {
    assertLabel(option.label);
    assert.ok(Math.abs(option.w - result.a.w * 1.2) < 1 && Math.abs(option.h - result.a.h) < 1, 'Row options use the actual 1.2× anchor width and unchanged height');
    assert.ok(option.w * result.ratio >= 43.5 && option.h * result.ratio >= 43.5, 'At least 44 physical CSS px in touch desktop mode');
    assert.ok(Math.abs(option.y - result.m.y) < 1, 'All options remain in one horizontal row');
    if (index) assert.ok(Math.abs(option.x - result.buttons[index - 1].right - 4) < 1, 'Row preserves exact ordered 4px gaps');
    if (option.centerInside) assert.equal(option.hit, true, 'Visible option centre has an actual native hit target');
  }
  assert.ok(result.buttons.some(option => option.centerInside && option.hit), 'The bounded row exposes a reachable option');
  if (result.scroll > result.client + 1) assert.equal(result.overflowX, 'auto', 'Long rows are horizontally scrollable');
}

export function groupedRowSwipe(layout) {
  const direction = layout.scrollLeft > (layout.scroll - layout.client) / 2 ? 1 : -1;
  return { x: layout.m.x + layout.m.w / 2, y: layout.m.y + layout.m.h / 2, deltaX: direction * Math.min(80, layout.m.w / 3) };
}

export async function checkGroupedToolMenus({ evaluate, button, click, send, screenshot, load, close, paints, setTouch }) {
  const checks = [], layouts = [], raw = groupedToolFixture(), fixture = serialize(loadedTrafficSession(raw).city);
  const state = () => evaluate('window.cityManager.snapshot()');
  const open = id => evaluate(`!document.querySelector('#${id}-submenu').hidden`);
  const selected = tool => evaluate(`document.querySelector('[data-tool="${tool}"]').getAttribute('aria-pressed')==='true'`);
  const key = async value => { for (const event of groupedKeyEvents(value)) await send('Input.dispatchKeyEvent', event); await paints(); };
  const viewport = async (width, height, touch, screenWidth = width) => {
    await close(); await key('Escape');
    await send('Emulation.setDeviceMetricsOverride', { width, height, screenWidth, screenHeight: height, deviceScaleFactor: 1, mobile: touch });
    await send('Emulation.setTouchEmulationEnabled', selectorTouchEmulation(touch)); setTouch(touch); await paints();
  };
  const labelGeometry = `b=>{const e=b.querySelector('span:last-child'),r=e.getBoundingClientRect(),a=b.getBoundingClientRect();return{text:e.textContent,width:e.clientWidth,scroll:e.scrollWidth,left:r.left,right:r.right,top:r.top,bottom:r.bottom,buttonLeft:a.left,buttonRight:a.right,buttonTop:a.top,buttonBottom:a.bottom}}`;
  const assertAnchorLabel = async id => assertLabel(await evaluate(`(${labelGeometry})(document.querySelector('#${id}-tool'))`));
  const geometry = async (id, name, expected) => {
    const result = await evaluate(`(()=>{const a=document.querySelector('#${id}-tool'),m=document.querySelector('#${id}-submenu'),r=e=>{const p=e.getBoundingClientRect();return{x:p.x,y:p.y,right:p.right,bottom:p.bottom,w:p.width,h:p.height}},mr=r(m),style=getComputedStyle(m);return{name:${JSON.stringify(name)},id:${JSON.stringify(id)},a:r(a),m:mr,ratio:Math.min(1,screen.width/innerWidth),width:innerWidth,height:innerHeight,layout:m.dataset.layout,direction:style.flexDirection,overflowX:style.overflowX,overflowY:style.overflowY,client:m.clientWidth,scroll:m.scrollWidth,scrollLeft:m.scrollLeft,clientY:m.clientHeight,scrollY:m.scrollHeight,buttons:[...m.querySelectorAll('button')].filter(b=>!b.hidden).map(b=>{const p=r(b),x=p.x+p.w/2,y=p.y+p.h/2;return{tool:b.dataset.tool,label:(${labelGeometry})(b),...p,centerInside:x>=mr.x&&x<mr.right&&y>=mr.y&&y<mr.bottom,hit:b.contains(document.elementFromPoint(x,y))}})}})()`);
    layouts.push(result); assertGroupedRowLayout(result, expected);
    await assertAnchorLabel(id); await screenshot(`${id}-${name}.png`); return result;
  };
  const tapCell = async index => { await paints(); const p = await evaluate(`window.cityManager.cellScreen(${index})`); assert.equal(await evaluate(`document.elementFromPoint(${p.x},${p.y})?.id`), 'city-canvas'); await click(p.x, p.y); await paints(); };
  await viewport(1440, 1000, false); await load(raw); await close(); assert.equal(await state(), fixture);
  for (const [id, tools] of groups) {
    for (const tool of tools) { assert.equal(await evaluate(`document.querySelectorAll('[data-tool="${tool}"]').length`), 1); assert.equal(await evaluate(`document.querySelector('.tool-buttons [data-tool="${tool}"]')===null`), true); }
    await button(`#${id}-tool`); assert.equal(await open(id), true); await geometry(id, 'desktop', tools); assert.equal(await selected('select'), true); assert.equal(await state(), fixture);
    await button(`#${id}-tool`); assert.equal(await open(id), false); assert.equal(await state(), fixture);
    await button(`#${id}-tool`); await key('Escape'); assert.equal(await open(id), false); assert.equal(await selected('select'), true);
    await button(`#${id}-tool`); await button('#cancel-tool'); assert.equal(await open(id), false); assert.equal(await state(), fixture);
  }
  for (const [selector, id] of [['#services-tool', 'services'], ['#construction-tool', 'construction'], ['[data-tool="road"]', 'road'], ['[data-tool="select"]', 'select'], ['#services-tool', 'services']]) {
    await button(selector); assert.deepEqual(await evaluate('[...document.querySelectorAll(".tool-submenu")].filter(m=>!m.hidden).map(m=>m.id)'), [`${id}-submenu`]); assert.equal(await state(), fixture);
  }
  await key('Escape'); await key('v');
  checks.push('Exactly nine original controls move into two ordered groups; read-only toggles and all four tool menus exclude one another');

  // A dismissal tap must not inherit demolition armed before opening a group.
  for (const [id] of groups) {
    await key('b'); assert.equal(await selected('bulldoze'), true); await button(`#${id}-tool`); assert.equal(await open(id), true);
    assert.equal(await selected('select'), true); assert.equal(await selected('bulldoze'), false);
    assert.equal(await evaluate('document.querySelector("[data-tool=select]").dataset.demolitionActive'), 'false');
    assert.doesNotMatch(await evaluate('document.querySelector("[data-tool=select]").textContent'), /รื้ออยู่/);
    assert.equal(await state(), fixture, 'Opening cancels the dangerous mode without a simulation mutation');
    await tapCell(cell(10, 12)); assert.equal(await open(id), false); assert.equal(await state(), fixture, 'Outside road tap inspects; it never demolishes or deducts money');
    assert.equal(await selected('select'), true); await close(); await button(`#${id}-tool`); await key('Escape'); assert.equal(await selected('bulldoze'), false);
    await button('[data-tool="select"]'); await button('[data-tool="bulldoze"]'); assert.equal(await selected('bulldoze'), true, 'Only the explicit demolition option re-arms demolition'); assert.equal(await state(), fixture); await key('v');
  }
  checks.push('Opening either group while demolition is armed selects safe inspect/pan; outside map taps remain read-only and only explicit demolition re-arms');

  for (const [shortcut, tool, id] of [['1','R','construction'],['2','C','construction'],['3','I','construction'],['4','F','construction'],['5','power','services'],['6','water','services'],['7','park','services']]) {
    await key(shortcut); assert.equal(await selected(tool), true); assert.equal(await evaluate(`document.querySelector('#${id}-tool').dataset.activeTool`), tool);
    await button(`#${id}-tool`); assert.equal(await selected(tool), true); await key('Escape'); assert.equal(await selected(tool), true);
    await button(`#${id}-tool`); await button('#cancel-tool'); assert.equal(await selected(tool), true, 'Cancel dismisses an open group before cancelling its existing placement mode'); assert.equal(await state(), fixture);
  }
  await key('v');
  const expected = deserialize(fixture); let index = 5;
  for (const [id, tools] of groups) for (const tool of tools) {
    const before = await state(), at = cell(index++, 13); await button(`[data-tool="${tool}"]`); assert.equal(await open(id), false); assert.equal(await selected(tool), true); assert.equal(await state(), before); await assertAnchorLabel(id);
    assert.equal(await evaluate(`document.querySelector('#${id}-tool').dataset.activeTool`), tool); assert.match(await evaluate(`document.querySelector('#${id}-tool').getAttribute('aria-label')`), /กำลังทำงาน/);
    assert.equal(place(expected, tool, at).ok, true); await tapCell(at); assert.equal(await state(), serialize(expected), `Unchanged ${tool} placement, accounting and constraints`);
  }
  await load(raw); await close(); await key('v');
  checks.push('Shortcuts1–7, active anchor icon/name and all nine original placement commands retain exact city snapshots and accounting');

  for (const [name, width, height, screenWidth] of [['mobile',390,844,390], ['small',320,568,320], ['landscape',844,390,844], ['short-landscape',640,240,640], ['touch-desktop-mode',980,780,390]]) {
    await viewport(width, height, true, screenWidth); await key('v');
    for (const [id, tools] of groups) {
      await button(`#${id}-tool`); assert.equal(await open(id), true); const layout = await geometry(id, name, tools); assert.equal(await state(), fixture);
      if (layout.scroll > layout.client + 1) {
        const {x,y,deltaX}=groupedRowSwipe(layout);
        await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
        for (let step=1;step<=5;step++) await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+deltaX*step/5,y,id:1}]});
        await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await paints();
        const scrollLeft=await evaluate(`document.querySelector('#${id}-submenu').scrollLeft`);
        assert.ok((scrollLeft-layout.scrollLeft)*deltaX<0, 'Native horizontal swipe scrolls the bounded row in its intended direction');
        assert.equal(await evaluate(`document.querySelector('#${id}-submenu').scrollTop`),0,'Horizontal swipe never scrolls vertically'); assert.equal(await selected('select'),true,'Menu scroll never arms an item'); assert.equal(await state(),fixture);
      }
      // The helper scrolls the actual last option and verifies elementFromPoint before its native tap.
      await button(`[data-tool="${tools.at(-1)}"]`); assert.equal(await open(id), false); assert.equal(await selected(tools.at(-1)), true); assert.equal(await state(), fixture); await assertAnchorLabel(id); await key('v');
    }
    await button('#services-tool'); const start=await evaluate(`window.cityManager.cellScreen(${cell(10,12)})`);
    // The guide can cover fixed coordinates on short landscape viewports.
    const point=await evaluate(`(${findCanvasDragStart.toString()})(innerWidth,innerHeight,(x,y)=>document.elementFromPoint(x,y)?.id==='city-canvas')`);
    assert.ok(point,'An unobstructed canvas drag path with touch clearance is available'); const {x,y}=point;
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]}); await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+45,y:y+12,id:1}]}); await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await paints();
    const after=await evaluate(`window.cityManager.cellScreen(${cell(10,12)})`); assert.ok(Math.hypot(after.x-start.x,after.y-start.y)>2,'Opening a group leaves select-drag panning unchanged');
    assert.equal(await open('services'),false); assert.equal(await evaluate('document.querySelector("#inspector").dataset.open'),'false'); assert.equal(await state(),fixture);
  }
  await viewport(640,240,false); await evaluate('document.querySelector("#services-tool").focus()'); await key('Enter'); await key('End');
  assert.equal(await evaluate('document.activeElement.dataset.tool'), 'university');
  assert.equal(await evaluate('(()=>{const e=document.activeElement,r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()'), true);
  await key('ArrowLeft'); assert.equal(await evaluate('document.activeElement.dataset.tool'), 'school');
  await key('ArrowRight'); assert.equal(await evaluate('document.activeElement.dataset.tool'), 'university');
  await key('Home'); assert.equal(await evaluate('document.activeElement.dataset.tool'), 'power');
  assert.equal(await evaluate('(()=>{const e=document.activeElement,r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()'), true);
  await key('Escape'); assert.equal(await evaluate('document.activeElement.id'), 'services-tool'); assert.equal(await state(), fixture);
  await viewport(1440,1000,false); await load(raw); await close(); await key('v');
  checks.push('Portrait320/390, landscape, bounded horizontal row scroll and touch desktop-mode retain 1.2× widths, original heights and >=44px targets; whole labels fit, and swipe/tap, pan and keyboard overflow focus stay explicit');
  return { checks, layouts, note: 'Installed Edge with emulated touch/viewport only; not physical Android validation.' };
}
