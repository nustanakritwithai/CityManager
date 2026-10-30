import {encodeSaveCopy,decodeSaveCopy} from './save-copy-codec.ts';
import {deserializeParkSession} from './park-runtime.ts';
const DB='citymanager.emergency-recovery-v1', STORE='branches', VERSION=1, TIMEOUT=10_000;
export const MAX_RECOVERY_BRANCHES=16;
type Entry={copy:string;capturedAt:number;tick:number;version:number;revision:string};
type Branch={baseline:Entry;previous:Entry|null;current:Entry};
export type RecoveryToken={branchId:string;revision:string};
export type RecoverySnapshot=RecoveryToken&{raw:string;capturedAt:number;tick:number;version:number;slot:'baseline'|'previous'|'current'};
export type RecoveryListing={branchId:string;slot:'baseline'|'previous'|'current';snapshot:RecoverySnapshot|null};
function open(factory:IDBFactory,create:boolean):Promise<IDBDatabase|null>{return new Promise((resolve,reject)=>{
 let settled=false,absent=false;const request=factory.open(DB,VERSION);const timer=setTimeout(()=>{if(!settled){settled=true;reject(Error('recovery-open-timeout'));}},TIMEOUT);
 request.onupgradeneeded=()=>{if(!create){absent=true;request.transaction?.abort();return;}if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE);};
 request.onblocked=()=>{if(!settled){settled=true;clearTimeout(timer);reject(Error('recovery-open-blocked'));}};
 request.onerror=()=>{if(!settled){settled=true;clearTimeout(timer);if(absent)resolve(null);else reject(request.error??Error('recovery-open-failed'));}};
 request.onsuccess=()=>{if(settled){request.result.close();return;}settled=true;clearTimeout(timer);resolve(request.result);};
});}
function transaction<T>(db:IDBDatabase,mode:IDBTransactionMode,work:(store:IDBObjectStore,set:(x:T)=>void,abort:(reason:unknown)=>void)=>void):Promise<T>{return new Promise((resolve,reject)=>{
 const tx=db.transaction(STORE,mode);let result:T,reason:unknown;const timer=setTimeout(()=>{reason=Error('recovery-transaction-timeout');try{tx.abort();}catch{}},TIMEOUT);
 const fail=(error:unknown)=>{reason=error;try{tx.abort();}catch{}};
 tx.oncomplete=()=>{clearTimeout(timer);resolve(result);};tx.onabort=()=>{clearTimeout(timer);reject(reason??tx.error??Error('recovery-transaction-aborted'));};tx.onerror=()=>{};
 try{work(tx.objectStore(STORE),value=>{result=value;},fail);}catch(error){fail(error);}
});}
function check(raw:string){const {city}=deserializeParkSession(raw);return {tick:city.tick,version:JSON.parse(raw).version};}
function valid(branchId:string,slot:'baseline'|'previous'|'current',entry:Entry):RecoverySnapshot{
 const raw=decodeSaveCopy(entry.copy);if(raw===null)throw Error('recovery-copy-invalid');const info=check(raw);
 if(info.tick!==entry.tick||info.version!==entry.version||typeof entry.revision!=='string')throw Error('recovery-copy-invalid');
 return {branchId,slot,revision:entry.revision,raw,capturedAt:entry.capturedAt,...info};
}
function financialIdentity(raw:string):string{
 const market=JSON.parse(raw).market;if(!market)return 'no-market';
 return JSON.stringify([market.cityId??null,market.guestId??null]);
}
function knownBranch(id:string,branch:Branch):boolean{
 try{
  if(!branch||typeof branch!=='object'||Object.keys(branch).sort().join(',')!=='baseline,current,previous')return false;
  const identity=financialIdentity(valid(id,'current',branch.current).raw);
  for(const slot of ['baseline','previous','current'] as const){const entry=branch[slot];if(slot==='previous'&&entry===null)continue;if(!entry||typeof entry!=='object'||Object.keys(entry).sort().join(',')!=='capturedAt,copy,revision,tick,version'||!Number.isFinite(entry.capturedAt))return false;if(financialIdentity(valid(id,slot,entry).raw)!==identity)return false;}
  return true;
 }catch{return false;}
}
/** Isolated session lineage; baseline immutable, current/previous atomic rotation. */
export async function saveRecoveryCopy(raw:string,token:RecoveryToken|null,factory:IDBFactory=indexedDB):Promise<RecoverySnapshot>{
 const info=check(raw),copy=encodeSaveCopy(raw),branchId=token?.branchId??crypto.randomUUID(),revision=crypto.randomUUID(),db=await open(factory,true);
 if(!db)throw Error('recovery-open-failed');
 try{
  const entry=await transaction<Entry>(db,'readwrite',(store,set,abort)=>{
   const get=store.get(branchId);get.onsuccess=()=>{const branch=get.result as Branch|undefined;
    if(token){if(!branch||!knownBranch(branchId,branch)){abort(Error('recovery-branch-invalid'));return;}if(branch.current.revision!==token.revision){abort(Error('recovery-conflict'));return;}
     if(financialIdentity(valid(branchId,'current',branch.current).raw)!==financialIdentity(raw)){abort(Error('recovery-identity-changed'));return;}
     if(branch.current.copy===copy){set(branch.current);return;}
     const next={copy,capturedAt:Date.now(),...info,revision};store.put({baseline:branch.baseline,previous:branch.current,current:next} satisfies Branch,branchId);set(next);return;
    }
    if(branch){abort(Error('recovery-branch-collision'));return;}
    const count=store.count();count.onsuccess=()=>{if(count.result>=MAX_RECOVERY_BRANCHES){abort(Error('recovery-capacity-reached'));return;}const next={copy,capturedAt:Date.now(),...info,revision};store.add({baseline:next,previous:null,current:next} satisfies Branch,branchId);set(next);};
   };
  });
  const branch=await transaction<Branch|undefined>(db,'readonly',(store,set)=>{const get=store.get(branchId);get.onsuccess=()=>set(get.result as Branch|undefined);});
  if(!branch||branch.current.revision!==entry.revision||decodeSaveCopy(branch.current.copy)!==raw)throw Error('recovery-verification-failed');
  return valid(branchId,'current',branch.current);
 }finally{db.close();}
}
/** Return every branch/slot; invalid records are shown, never dropped or auto-selected. */
export async function listRecoveryCopies(factory:IDBFactory=indexedDB):Promise<RecoveryListing[]>{
 const db=await open(factory,false);if(!db)return [];try{return await transaction<RecoveryListing[]>(db,'readonly',(store,set)=>{
  const all:RecoveryListing[]=[];const cursor=store.openCursor();cursor.onsuccess=()=>{const c=cursor.result;if(!c){set(all);return;}const id=String(c.primaryKey),branch=c.value as Branch;if(!knownBranch(id,branch))all.push({branchId:id,slot:'current',snapshot:null});
   for(const slot of ['baseline','previous','current'] as const){const entry=branch?.[slot];if(!entry)continue;try{all.push({branchId:id,slot,snapshot:valid(id,slot,entry)});}catch{all.push({branchId:id,slot,snapshot:null});}}
   c.continue();};
 });}finally{db.close();}
}
