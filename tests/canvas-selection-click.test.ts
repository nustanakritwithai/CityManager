import test from 'node:test';
import assert from 'node:assert/strict';
import {CanvasSelectionClickGuard} from '../src/canvas-selection-click.ts';

test('a canvas touch cannot activate an overlay newly under that same finger',()=>{
  const guard=new CanvasSelectionClickGuard();guard.arm(49,39663.8);
  assert.equal(guard.blocks({isTrusted:true,pointerId:49,timeStamp:39707.8},false),true);
  assert.equal(guard.blocks({isTrusted:true,pointerId:49,timeStamp:39708},false),false,'consume only one compatibility click');
});

test('normal canvas, unrelated, keyboard and later interactions still work',()=>{
  const guard=new CanvasSelectionClickGuard();guard.arm(4,100);
  assert.equal(guard.blocks({isTrusted:true,pointerId:5,timeStamp:110},false),false);
  assert.equal(guard.blocks({isTrusted:false,pointerId:4,timeStamp:110},false),false);
  assert.equal(guard.blocks({isTrusted:true,timeStamp:110},false),false);
  assert.equal(guard.blocks({isTrusted:true,pointerId:4,timeStamp:120},true),false,'click that stayed on canvas is not blocked');
  guard.arm(4,200);guard.clear(4);
  assert.equal(guard.blocks({isTrusted:true,pointerId:4,timeStamp:210},false),false,'a fresh pointerdown disarms an old gesture');
  guard.arm(4,300);assert.equal(guard.blocks({isTrusted:true,pointerId:4,timeStamp:1301},false),false,'an old gesture cannot suppress a later click');
});
