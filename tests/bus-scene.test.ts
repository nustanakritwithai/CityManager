import test from 'node:test';import assert from 'node:assert/strict';
import {depotFacing} from '../src/bus/overlay.ts';
import {BUS_LINE_COLORS} from '../src/bus/geometry.ts';
const grid=(roads:number[])=>({cells:Array.from({length:576},(_,i)=>({road:roads.includes(i)}))});
test('depot door faces its road, preferring south, east, north then west, east when isolated',()=>{
 assert.deepEqual(depotFacing(313,grid([289])),{x:0,z:-1},'Road to the north');
 assert.deepEqual(depotFacing(313,grid([314,337])),{x:0,z:1},'South wins over east');
 assert.deepEqual(depotFacing(313,grid([312])),{x:-1,z:0});
 assert.deepEqual(depotFacing(24,grid([23])),{x:1,z:0},'No wrap across the west edge to the previous row');
 assert.deepEqual(depotFacing(313,grid([])),{x:1,z:0});
});
test('line colours avoid road-paint yellow and gate orange',()=>{
 const hue=(hex:string)=>{const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;if(!d)return -1;const h=max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4;return (h*60+360)%360;};
 for(const color of BUS_LINE_COLORS){const h=hue(color);assert.ok(h<0||h<20||h>70,`${color} hue ${h.toFixed(0)} is in the yellow/orange band`);}
});
