/** Deterministic coverage partitions; every pair stays in one profile/job.
 * Full/extended remain supported for explicit runs; CI uses disjoint bounded
 * core, bypass, dense OFF/ON and (normal only) fixed three-pair peak cases. */
export function trafficGameCase(name,blocked) {
 if(!['full','core','extended','bypass','dense','peak'].includes(name))throw Error(`Unknown traffic game case: ${name}`);
 if(blocked&&name==='peak')throw Error('Peak protocol requires normal assets');
 const core=name==='full'||name==='core',bypass=['full','extended','bypass'].includes(name),dense=['full','extended','dense'].includes(name),peak=!blocked&&['full','extended','peak'].includes(name);
 return {name,core,bypass,dense,peak,extended:bypass||dense||peak,expectedChecks:(core?6:0)+(bypass?1:0)+(dense?1:0)+(peak?1:0),
  output:`${blocked?'fallback':'normal'}${name==='full'?'':`-${name}`}`};
}
