/** Deterministic coverage partitions; every pair stays in one profile/job.
 * Full/extended remain supported for explicit runs; CI uses disjoint bounded
 * lifecycle, economy, bypass, dense OFF/ON and (normal only) fixed three-pair peak cases. */
export function trafficGameCase(name,blocked) {
 if(!['full','core','extended','bypass','dense','peak','lifecycle','economy'].includes(name))throw Error(`Unknown traffic game case: ${name}`);
 if(blocked&&name==='peak')throw Error('Peak protocol requires normal assets');
 const lifecycle=['full','core','lifecycle'].includes(name),economy=['full','core','economy'].includes(name),core=lifecycle||economy,bypass=['full','extended','bypass'].includes(name),dense=['full','extended','dense'].includes(name),peak=!blocked&&['full','extended','peak'].includes(name);
 return {name,core,lifecycle,economy,bypass,dense,peak,extended:bypass||dense||peak,expectedChecks:(lifecycle?4:0)+(economy?2:0)+(bypass?1:0)+(dense?1:0)+(peak?1:0),
  output:`${blocked?'fallback':'normal'}${name==='full'?'':`-${name}`}`};
}
