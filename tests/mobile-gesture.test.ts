import { readFileSync } from 'node:fs';
import test from 'node:test';
import { stripTypeScriptTypes } from 'node:module';
import assert from 'node:assert/strict';

// Exercise the installed canvas handlers without a browser or graphics device.
// Browser touch emulation also covers the integrated path in browser-smoke.mjs.
const source = readFileSync(new URL('../src/renderer.ts', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('  input() {') + '  input() {'.length, source.indexOf('  /** Swap every material'));
const install = new Function(stripTypeScriptTypes(body.slice(0, body.lastIndexOf('  }'))));
function harness(mode = 'select') {
  const listeners = new Map();
  const canvas = { addEventListener(type, cb) { listeners.set(type, cb); }, setPointerCapture() {}, hasPointerCapture() { return false; }, releasePointerCapture() {} };
  const calls = { cell: [], road: [], pan: [], hover: [] };
  const view = { canvas, mode, cameraBlocked: false, pointers: new Map(), down: null, dragStart: null, radius: 65, yaw: 0,
    pick: (x, y) => Math.round(x + y), onCell: i => calls.cell.push(i), onRoad: (a,b) => calls.road.push([a,b]),
    onHover: i => calls.hover.push(i), pan: (x,y) => calls.pan.push([x,y]), updateCamera() {} };
  install.call(view);
  function event(type, x, y, opts = {}) { listeners.get(type)({ pointerId: 1, button: 0, altKey: false, clientX: x, clientY: y, preventDefault() {}, ...opts }); }
  return { view, calls, event };
}

test('default short tap inspects; small jitter does not pan', () => {
  const h = harness(); h.event('pointerdown', 10, 10); h.event('pointermove', 13, 12); h.event('pointerup', 13, 12);
  assert.deepEqual(h.calls.cell, [25]); assert.deepEqual(h.calls.pan, []);
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
