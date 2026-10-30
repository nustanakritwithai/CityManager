/** Test-only execution plan. A full normal run remains mandatory; the slower
 * blocked-model fallback may be split into two independent bounded profiles. */
export function trafficGameCase(name,blocked) {
 if(!['full','core','extended'].includes(name))throw Error(`Unknown traffic game case: ${name}`);
 if(!blocked&&name!=='full')throw Error('Only the blocked-model fallback may be split');
 return {name,core:name!=='extended',extended:name!=='core',expectedChecks:name==='full'?(blocked?8:9):name==='core'?6:2,
  output:blocked?(name==='full'?'fallback':`fallback-${name}`):'normal'};
}
