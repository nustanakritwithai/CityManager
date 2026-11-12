import assert from 'node:assert/strict';
/** Verify the original 41-model contract separately for every entered document. */
export function createPanelModelAudit({blocked,expectedErrors,evaluate,sleep}){
 let documents=0;
 return {
  begin:()=>expectedErrors.length,
  async verify(before){
   const visuals=await evaluate('window.cityManager.visuals()');
   if(blocked){
    for(let n=0;n<100&&expectedErrors.length<before+41;n++)await sleep(50);
    assert.equal(visuals.failed.length,41,'Each entered document reports all 41 blocked models');
    assert.equal(expectedErrors.length-before,41,'Each entered document emits exactly 41 expected model errors');
   }else{
    assert.equal(visuals.loaded.length,41);assert.equal(visuals.failed.length,0);assert.equal(expectedErrors.length,before);
   }
   documents++;
  },
  assertComplete(){assert.ok(documents>0,'At least one entered document was checked');assert.equal(expectedErrors.length,blocked?41*documents:0,'All and only expected per-document model errors were observed');},
  get documents(){return documents;}
 };
}
