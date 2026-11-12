import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {entryTouchScale,installEntryScale} from '../src/entry-scale.ts';

test('entry scale preserves touch size in ordinary, wide-layout and landscape views without desktop scaling',()=>{
 for(const [touch,layout,screen] of [[true,360,360],[true,980,390],[true,844,844],[true,1440,320]] as const){
  const s=entryTouchScale(touch,layout,screen); assert.ok(48*s*Math.min(1,screen/layout)>=48-1e-9);assert.ok(15*s*Math.min(1,screen/layout)>=15-1e-9);
 }
 assert.equal(entryTouchScale(false,980,390),1);assert.equal(entryTouchScale(true,980,0),1);assert.equal(entryTouchScale(true,NaN,390),1);
});
test('entry sizing follows resize and pointer changes, and removes every listener',()=>{
 const events=new Map<string,Set<()=>void>>(),mediaEvents=new Set<()=>void>(),visualEvents=new Set<()=>void>();let unit='';
 const media={matches:true,addEventListener:(_name:string,cb:()=>void)=>mediaEvents.add(cb),removeEventListener:(_name:string,cb:()=>void)=>mediaEvents.delete(cb)};
 const env:any={innerWidth:980,screen:{width:390},navigator:{maxTouchPoints:1},matchMedia:()=>media,addEventListener:(name:string,cb:()=>void)=>{const set=events.get(name)??new Set;set.add(cb);events.set(name,set);},removeEventListener:(name:string,cb:()=>void)=>events.get(name)?.delete(cb),visualViewport:{addEventListener:(_name:string,cb:()=>void)=>visualEvents.add(cb),removeEventListener:(_name:string,cb:()=>void)=>visualEvents.delete(cb)}};
 const stop=installEntryScale({style:{setProperty:(_key:string,v:string)=>{unit=v;}}} as any,env);assert.equal(parseFloat(unit),980/390);
 env.innerWidth=360;env.screen.width=360;events.get('resize')!.forEach(fn=>fn());assert.equal(unit,'1px');
 env.innerWidth=980;env.navigator.maxTouchPoints=0;media.matches=false;mediaEvents.forEach(fn=>fn());assert.equal(unit,'1px');
 stop();assert.equal(events.get('resize')!.size,0);assert.equal(mediaEvents.size,0);assert.equal(visualEvents.size,0);
});
test('entry gate installs scale before auth, releases on confirmed load, and scales button and reading card',()=>{
 const entry=readFileSync(new URL('../src/server-city-entry.ts',import.meta.url),'utf8'),css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8'),polish=readFileSync(new URL('../src/panel-polish.css',import.meta.url),'utf8'),smoke=readFileSync(new URL('./population-smoke.mjs',import.meta.url),'utf8');
 assert.ok(entry.indexOf('installEntryScale(overlay,window)')<entry.indexOf('await auth.prepare()'));
 assert.match(entry,/deserializeParkSession\(raw\);stopEntryScale\(\);overlay.remove\(\)/);
 assert.match(css,/\.guest-entry-card button \{[^}]*min-height:calc\(48 \* var\(--entry-unit\)\)/);
 assert.match(css,/\.guest-entry-card \{[^}]*calc\(420 \* var\(--entry-unit\)\)/);
 assert.match(polish,/\.guest-entry-card p \{ font-size: calc\(15 \* var\(--entry-unit\)\)/);
 assert.match(smoke,/44px physical touch target/);assert.match(smoke,/Readable contained guest entry/);
});
