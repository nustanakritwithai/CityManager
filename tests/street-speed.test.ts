import test from 'node:test';import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';import {readFileSync} from 'node:fs';import ts from 'typescript';import {Entity} from 'playcanvas';
import {populationFixture} from './population-capacity-fixture.ts';import {step,serialize} from '../src/sim.ts';
import {streetRate,minuteASecondSpeed,DAY_SECONDS} from '../src/game-clock.ts';
// Node's strip-only mode cannot parse this existing renderer's parameter property.
registerHooks({load(url,context,next){if(url.endsWith('/scene-traffic.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};return next(url,context);}});
const {SceneTraffic}=await import('../src/scene-traffic.ts');
type Walker={key:string;kind:string;parked:boolean;p:number;dir:number;route:number[]};

/** The street of a town at 08:00, with its walkers set off on the morning commute. */
function street(){
 const view={app:{root:new Entity(),renderNextFrame:false},atmosphere:{hour:5 as number|null,registerGlow(){}},box(){},position(i:number){return{x:(i%24)*2,z:Math.floor(i/24)*2}}};
 const city=populationFixture(32,true);step(city);
 const traffic=new SceneTraffic(view as never);traffic.sync(city);
 view.atmosphere.hour=8;traffic.update(0,true);
 const walkers=()=>[...(traffic as unknown as {actors:Map<string,Walker>}).actors.values()].filter(a=>a.kind==='walker'&&!a.parked);
 return {view,city,traffic,walkers};
}

test('the street keeps real time at 1× and the watch pace, and runs with the game at 3× and 10×',()=>{
 assert.equal(streetRate(1),1);assert.equal(streetRate(minuteASecondSpeed(DAY_SECONDS)),1,'watching the citizens keeps their real walking pace');
 assert.equal(streetRate(3),3);assert.equal(streetRate(10),10);
});

test('at 10× people on the street walk ten times as far in the same real time',()=>{
 const slow=street(),fast=street();
 const before=new Map(slow.walkers().map(a=>[a.key,a.p]));
 assert.ok(before.size>0,'people are walking to work at 08:00');
 const start=new Map(fast.walkers().map(a=>[a.key,a.p]));
 assert.deepEqual([...start],[...before],'both streets start alike');
 const before1=serialize(slow.city);
 // Two 60 fps frames: each walker covers its own pace times the game speed.
 for(let k=0;k<2;k++){slow.traffic.update(1/60,true,streetRate(1));fast.traffic.update(1/60,true,streetRate(10));}
 const moved=(s:ReturnType<typeof street>)=>new Map(s.walkers().filter(a=>start.has(a.key)).map(a=>[a.key,Math.abs(a.p-start.get(a.key)!)]));
 const one=moved(slow),ten=moved(fast);
 let compared=0;
 for(const [key,d1] of one){const d10=ten.get(key);if(d10===undefined||d1<=0)continue;compared++;assert.ok(Math.abs(d10/d1-10)<1e-6,`walker ${key} moved ${d10} at 10× and ${d1} at 1×`);}
 assert.ok(compared>0,'walkers compared');
 assert.equal(serialize(slow.city),before1,'the street only draws: it never changes the city');
 slow.view.app.root.destroy();fast.view.app.root.destroy();
});

test('a slow frame at 10× moves in short steps, never past the end of a route',()=>{
 const s=street();
 s.traffic.update(1,true,streetRate(10));
 for(const a of s.walkers())assert.ok(a.p>=0&&a.p<=Math.max(0,a.route.length-1),`walker ${a.key} at ${a.p} of ${a.route.length}`);
 s.view.app.root.destroy();
});
