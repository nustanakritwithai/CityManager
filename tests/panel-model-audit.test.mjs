import test from 'node:test';import assert from 'node:assert/strict';
import {createPanelModelAudit} from './panel-model-audit.mjs';
test('fallback counts exactly 41 per document and rejects missing or extra model errors',async()=>{
 const errors=[],visuals={failed:Array(41).fill('blocked'),loaded:[]},audit=createPanelModelAudit({blocked:true,expectedErrors:errors,evaluate:async()=>visuals,sleep:async()=>{}});
 for(let n=0;n<3;n++){const before=audit.begin();errors.push(...Array(41).fill('expected'));await audit.verify(before);}
 audit.assertComplete();assert.equal(audit.documents,3);errors.push('unexpected');assert.throws(()=>audit.assertComplete());
 const bad=[],missing=createPanelModelAudit({blocked:true,expectedErrors:bad,evaluate:async()=>visuals,sleep:async()=>{}});await assert.rejects(missing.verify(0),/exactly 41/);
 const failed=createPanelModelAudit({blocked:true,expectedErrors:Array(41).fill(1),evaluate:async()=>({failed:Array(40),loaded:[]}),sleep:async()=>{}});await assert.rejects(failed.verify(0),/all 41/);
});
test('normal model mode requires all loaded and no failures for each entered document',async()=>{
 const errors=[],audit=createPanelModelAudit({blocked:false,expectedErrors:errors,evaluate:async()=>({loaded:Array(41),failed:[]}),sleep:async()=>{}});
 assert.throws(()=>audit.assertComplete());await audit.verify(audit.begin());audit.assertComplete();
 const missing=createPanelModelAudit({blocked:false,expectedErrors:[],evaluate:async()=>({loaded:Array(40),failed:[]}),sleep:async()=>{}});await assert.rejects(missing.verify(0));
});
