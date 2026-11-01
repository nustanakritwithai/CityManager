import { readFileSync } from 'node:fs';
import test from 'node:test';
import { stripTypeScriptTypes } from 'node:module';
import assert from 'node:assert/strict';
import {CanvasSelectionClickGuard} from '../src/canvas-selection-click.ts';

// Exercise the installed canvas handlers without a browser or graphics device.
// Browser touch emulation also covers the integrated path in browser-smoke.mjs.
const source = readFileSync(new URL('../src/renderer.ts', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('  input() {') + '  input() {'.length, source.indexOf('  /** Swap every material'));
const install = new Function('CanvasSelectionClickGuard', 'document', stripTypeScriptTypes(body.slice(0, body.lastIndexOf('  }'))));
function harness(mode = 'select') {
  const listeners = new Map(), documentListeners = new Map();
  const canvas = { addEventListener(type, cb) { listeners.set(type, cb); }, setPointerCapture() {}, hasPointerCapture() { return false; }, releasePointerCapture() {} };
  const document = { addEventListener(type, cb) { documentListeners.set(type, cb); } };
  const calls = { cell: [], road: [], pan: [], hover: [] };
  const view = { canvas, mode, cameraBlocked: false, pointers: new Map(), down: null, dragStart: null, radius: 65, yaw: 0,
    pick: (x, y) => Math.round(x + y), onCell: i => calls.cell.push(i), onRoad: (a,b) => calls.road.push([a,b]),
    onHover: i => calls.hover.push(i), pan: (x,y) => calls.pan.push([x,y]), updateCamera() {} };
  install.call(view, CanvasSelectionClickGuard, document);
  function event(type, x, y, opts = {}) { const e={ pointerId: 1, button: 0, altKey: false, clientX: x, clientY: y, preventDefault() {}, ...opts };documentListeners.get(type)?.(e);listeners.get(type)(e); }
  function click(target, opts = {}) { let blocked=false;const e={isTrusted:true,pointerId:1,timeStamp:110,target,preventDefault(){},stopImmediatePropagation(){blocked=true;},...opts};documentListeners.get('click')?.(e);return blocked; }
  return { view, calls, event, click, canvas };
}

test('default short tap inspects; small jitter does not pan', () => {
  const h = harness(); h.event('pointerdown', 10, 10); h.event('pointermove', 13, 12); h.event('pointerup', 13, 12);
  assert.deepEqual(h.calls.cell, [25]); assert.deepEqual(h.calls.pan, []);
});

test('touch selection blocks its retargeted click but not a later deliberate gesture', () => {
  const h=harness();h.event('pointerdown',10,10,{isTrusted:true,pointerType:'touch',timeStamp:90});
  h.event('pointerup',10,10,{isTrusted:true,pointerType:'touch',timeStamp:100});assert.deepEqual(h.calls.cell,[20]);
  assert.equal(h.click({id:'recipe'}),true,'compatibility click on newly opened overlay is blocked');
  assert.equal(h.click({id:'recipe'},{pointerId:2,timeStamp:200}),false,'new touch can activate the control');
  assert.equal(h.click({id:'close'},{pointerId:-1,timeStamp:210}),false,'keyboard click stays available');
});
test('default drag pans and never inspects, even if it returns to its start', () => {
  const h = harness(); h.event('pointerdown', 10, 10); h.event('pointermove', 30, 10); h.event('pointermove', 10, 10); h.event('pointerup', 10, 10);
  assert.ok(h.calls.pan.length); assert.deepEqual(h.calls.cell, []);
});
test('movement seen only at release cannot inspect or place', () => {
  for (const mode of ['select', 'R', 'bulldoze']) {
    const h = harness(mode); h.event('pointerdown', 10, 10); h.event('pointerup', 30, 10); assert.deepEqual(h.calls.cell, [], mode);
  }
});
test('multi-touch and cancellation never activate, including after one finger lifts', () => {
  for (const mode of ['select', 'road', 'R', 'bulldoze']) {
    const h = harness(mode); h.event('pointerdown', 10, 10); h.event('pointerdown', 20, 10, {pointerId: 2}); h.event('pointermove', 35, 10, {pointerId: 2}); h.event('pointerup', 35, 10, {pointerId: 2}); h.event('pointerup', 10, 10);
    assert.deepEqual(h.calls.cell, [], mode); assert.deepEqual(h.calls.road, [], mode); assert.notEqual(h.view.radius, 65);
    const c = harness(mode); c.event('pointerdown', 10, 10); c.event('pointercancel', 10, 10); c.event('pointerup', 10, 10); assert.deepEqual(c.calls.cell, []); assert.deepEqual(c.calls.road, []);
  }
});
test('intentional placement and road drag remain available; mouse middle pans and right rotates', () => {
  const p = harness('R'); p.event('pointerdown', 10, 10); p.event('pointerup', 10, 10); assert.deepEqual(p.calls.cell, [20]);
  const r = harness('road'); r.event('pointerdown', 10, 10); r.event('pointermove', 30, 10); r.event('pointerup', 30, 10); assert.deepEqual(r.calls.road, [[20,40]]);
  const m = harness(); m.event('pointerdown', 10, 10, {button: 1}); m.event('pointermove', 30, 10, {button: -1}); m.event('pointerup', 30, 10, {button: 1}); assert.ok(m.calls.pan.length); assert.deepEqual(m.calls.cell, []);
  const q = harness(); q.event('pointerdown', 10, 10, {button: 2}); q.event('pointermove', 30, 10, {button: -1}); q.event('pointerup', 30, 10, {button: 2}); assert.notEqual(q.view.yaw, 0); assert.deepEqual(q.calls.cell, []);
});

test('open inspector blocks camera movement but allows selection on exposed map', () => {
  const tap = harness(); tap.view.cameraBlocked = true; tap.event('pointerdown', 10, 10); tap.event('pointerup', 10, 10); assert.deepEqual(tap.calls.cell, [20]);
  const drag = harness(); drag.view.cameraBlocked = true; drag.event('pointerdown', 10, 10); drag.event('pointermove', 30, 10); drag.event('pointerup', 30, 10); assert.deepEqual(drag.calls.pan, []); assert.deepEqual(drag.calls.cell, []);
});

test('untracked releases and cancels cannot activate or disrupt a tracked gesture', () => {
  for (const mode of ['select', 'R', 'bulldoze', 'road']) {
    const h = harness(mode);
    h.event('pointerdown', 10, 10);
    if (mode === 'road') h.event('pointermove', 30, 10);
    h.event('pointerup', mode === 'road' ? 30 : 10, 10, {pointerId: 99});
    h.event('pointercancel', 30, 10, {pointerId: 99});
    assert.deepEqual(h.calls.cell, [], mode + ' ignores stray release');
    assert.deepEqual(h.calls.road, [], mode + ' ignores stray release');
    h.event('pointerup', mode === 'road' ? 30 : 10, 10);
    assert.deepEqual(h.calls.cell, mode === 'road' ? [] : [20], mode + ' retains tracked tap');
    assert.deepEqual(h.calls.road, mode === 'road' ? [[20,40]] : [], mode + ' retains tracked road drag');
  }
});
