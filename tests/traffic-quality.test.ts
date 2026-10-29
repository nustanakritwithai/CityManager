import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
registerHooks({load(url,context,next){if(url.endsWith('/atmosphere-controls.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};return next(url,context);}});
const {AtmosphereController}=await import('../src/atmosphere-controls.ts');

test('automatic and explicit low quality never disable user-enabled traffic',()=>{
 const calls:boolean[]=[];
 const sync=(AtmosphereController.prototype as unknown as {syncTraffic(this:unknown):void}).syncTraffic;
 const subject={settings:{traffic:true},quality:'high',host:{view:{traffic:{setEnabled:(v:boolean)=>calls.push(v)}}}};
 for(const q of ['high','medium','low','low','medium','high']){subject.quality=q;sync.call(subject);}
 assert.deepEqual(calls,[true,true,true,true,true,true]);
 subject.settings.traffic=false;sync.call(subject);assert.equal(calls.at(-1),false,'Explicit user toggle still works');
 subject.settings.traffic=true;subject.quality='low';sync.call(subject);assert.equal(calls.at(-1),true);
});
