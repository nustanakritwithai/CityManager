import test from 'node:test';import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';import {readFileSync} from 'node:fs';import ts from 'typescript';import {Entity} from 'playcanvas';
import {populationFixture} from './population-capacity-fixture.ts';import {serialize,step} from '../src/sim.ts';import {withCommuterVehicles} from './commuter-vehicles.ts';
// Node's strip-only mode cannot parse this existing renderer's parameter property.
registerHooks({load(url,context,next){if(url.endsWith('/scene-traffic.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};return next(url,context);}});
const {SceneTraffic}=await import('../src/scene-traffic.ts');
test('commuters initialized at home before the rush stay parked while paused and set off when time runs',()=>{
 // 05:00: every commuter is still at home.
 const view={app:{root:new Entity(),renderNextFrame:false},atmosphere:{hour:5 as number|null,registerGlow(){}},box(){},position(i:number){return{x:(i%24)*2,z:Math.floor(i/24)*2}}};
 const city=populationFixture(32,true);step(city);
 // Only a household's own vehicle drives: long-walking households own motorcycles, as their savings would buy.
 withCommuterVehicles(city);assert.ok(city.vehicles?.fleet.length,'the fixture has someone walking a long way to work');
 const before=serialize(city),traffic=new SceneTraffic(view as never);traffic.sync(city);
 assert.equal(traffic.diagnostics.cars,0);assert.ok(traffic.diagnostics.parked>0);
 view.atmosphere.hour=12.5;traffic.update(.1,false);assert.equal(traffic.diagnostics.cars,0,'paused decorative traffic does not unpark');
 traffic.update(.1,true);assert.ok(traffic.diagnostics.cars>0,'the motorcycle sets off to work once time runs');assert.equal(serialize(city),before,'visual updates do not mutate the city');
 view.app.root.destroy();
});
