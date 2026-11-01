/** Full asset-enabled and blocked-model traffic cases remain mandatory.
 * Every case uses an isolated real server ACK and visible authenticated entry.
 * Browser city persistence is forbidden; server lifecycle failures retain their
 * separate mandatory Save smoke coverage. No storage-denial startup shortcut.
 * The slower blocked-model fallback keeps two independent bounded profiles. */
export function trafficGameCase(name,blocked) {
 if(!['full','core','extended'].includes(name))throw Error(`Unknown traffic game case: ${name}`);
 if(!blocked&&name!=='full')throw Error('Only the blocked-model fallback may be split');
 return {name,core:name!=='extended',extended:name!=='core',expectedChecks:name==='full'?(blocked?8:9):name==='core'?6:2,
  output:blocked?(name==='full'?'fallback':`fallback-${name}`):'normal'};
}
