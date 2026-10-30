/** Test-only execution plan. Full asset-enabled traffic coverage remains mandatory;
 * its recovery IndexedDB is explicitly synthetic-denied by the browser harness
 * to isolate steady-state traffic from unrelated native-IDB startup stalls.
 * Core/full use explicitly denied recovery IDB; extended retains native IDB; real IDB persistence has separate save CI.
 * The slower blocked-model fallback may use two independent bounded profiles. */
export function trafficGameCase(name,blocked) {
 if(!['full','core','extended'].includes(name))throw Error(`Unknown traffic game case: ${name}`);
 if(!blocked&&name!=='full')throw Error('Only the blocked-model fallback may be split');
 return {name,core:name!=='extended',extended:name!=='core',expectedChecks:name==='full'?(blocked?8:9):name==='core'?6:2,
  output:blocked?(name==='full'?'fallback':`fallback-${name}`):'normal'};
}
