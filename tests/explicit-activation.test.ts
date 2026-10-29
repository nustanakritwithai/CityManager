import test from 'node:test';
import assert from 'node:assert/strict';
import {onExplicitActivation} from '../src/explicit-activation.ts';
const dispatch=(node:EventTarget,name:string,props:Record<string,number>={})=>{const e=new Event(name,{cancelable:true,bubbles:true});for(const [k,v]of Object.entries(props))Object.defineProperty(e,k,{value:v});node.dispatchEvent(e);return e;};
test('opening map tap cannot activate a newly mounted household control without its own press',()=>{
 const button=new EventTarget();let calls=0;onExplicitActivation(button as HTMLButtonElement,()=>calls++);
 const click=dispatch(button,'click',{detail:1});assert.equal(calls,0);assert.equal(click.defaultPrevented,true);
 dispatch(button,'pointerdown',{button:0});dispatch(button,'pointerup');dispatch(button,'click',{detail:1});assert.equal(calls,1);
 dispatch(button,'click',{detail:1});assert.equal(calls,1,'A previous valid click cannot authorize the next orphan click');
});
test('fresh touch/mouse, cancellation, keyboard and assistive activation stay distinct',()=>{
 const button=new EventTarget();let calls=0;onExplicitActivation(button as HTMLButtonElement,()=>calls++);
 dispatch(button,'pointerdown',{button:0});dispatch(button,'pointercancel');dispatch(button,'click',{detail:1});assert.equal(calls,0);
 dispatch(button,'pointerdown',{button:2});dispatch(button,'click',{detail:1});assert.equal(calls,0);
 dispatch(button,'click',{detail:0});assert.equal(calls,1);
 for(let i=0;i<3;i++){dispatch(button,'pointerdown',{button:0});dispatch(button,'pointerup');dispatch(button,'click',{detail:1});}
 assert.equal(calls,4);
});
