/** [save-hotfix-89] One-time automatic cleanup (owner request): keep only the newest
 * CityManager city as the primary slot, drop every other CityManager save copy so the
 * primary write fits in localStorage again. Never touches non-CityManager keys
 * (Strategy-Game shares this origin). The kept city is written + verified first. */
import {SAVE_KEY} from './save-storage.ts';
import {decodeSaveCopy} from './save-copy-codec.ts';
import {deserializeParkSession} from './park-runtime.ts';
import {CITY_SAVE_KEY_PATTERN,CITY_RECOVERY_DB,oldSaveKeys} from './delete-old-saves.ts';
import {listRecoveryCopies} from './recovery-idb.ts';
export const AUTO_CLEANUP_FLAG='citymanager.auto-cleanup.v1';
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'|'key'|'length'>;
type Candidate={source:string;raw:string;tick:number;at:number;valid:boolean};
const tickOf=(raw:string)=>{try{const o=JSON.parse(raw);const t=Number(o?.city?.tick??o?.tick);return Number.isFinite(t)?t:-1;}catch{return -1;}};
const isValid=(raw:string)=>{try{deserializeParkSession(raw);return true;}catch{return false;}};
export const isQuota=(e:unknown)=>{const x=e as {name?:string;code?:number;message?:string}|null;return !!x&&(x.name==='QuotaExceededError'||x.name==='NS_ERROR_DOM_QUOTA_REACHED'||x.code===22||x.code===1014||/quota/i.test(x.message??''));};
/** Remove CityManager backup/checkpoint copies except the primary slot and `except`. */
export function dropOldCopies(storage:Store,except:string[]=[]):string[]{const keys=oldSaveKeys(storage).filter(k=>!except.includes(k));for(const k of keys)storage.removeItem(k);return keys;}
function deleteDb(factory:IDBFactory,name:string):Promise<boolean>{return new Promise(resolve=>{let done=false;const end=(ok:boolean)=>{if(!done){done=true;clearTimeout(t);resolve(ok);}};const t=setTimeout(()=>end(false),8000);try{const r=factory.deleteDatabase(name);r.onsuccess=()=>end(true);r.onerror=()=>end(false);r.onblocked=()=>{/* other tab open: wait for success or timeout */};}catch{end(false);}});}
export async function autoCleanupOnce(storage:Store=localStorage,factory:IDBFactory|undefined=globalThis.indexedDB):Promise<{ran:boolean;kept?:string;tick?:number;removed:string[];reason?:string}>{
 if(storage.getItem(AUTO_CLEANUP_FLAG)!==null)return {ran:false,removed:[],reason:'already-done'};
 const cands:Candidate[]=[];
 for(let i=0;i<storage.length;i++){const k=storage.key(i);if(!k||!CITY_SAVE_KEY_PATTERN.test(k))continue;let raw:string|null;try{raw=decodeSaveCopy(storage.getItem(k));}catch{raw=null;}if(!raw)continue;const tick=tickOf(raw);if(tick<0)continue;cands.push({source:k,raw,tick,at:0,valid:isValid(raw)});}
 let idbOk=true;if(factory){try{for(const item of await listRecoveryCopies(factory))if(item.snapshot)cands.push({source:`idb:${item.snapshot.branchId}:${item.slot}`,raw:item.snapshot.raw,tick:item.snapshot.tick,at:item.snapshot.capturedAt,valid:isValid(item.snapshot.raw)});}catch{idbOk=false;}}
 if(!idbOk)return {ran:false,removed:[],reason:'idb-unreadable'};
 if(!cands.length){try{storage.setItem(AUTO_CLEANUP_FLAG,String(Date.now()));}catch{}return {ran:true,removed:[],reason:'no-city'};}
 const order=(a:Candidate,b:Candidate)=>b.tick-a.tick||b.at-a.at||(a.source===SAVE_KEY?-1:b.source===SAVE_KEY?1:0);
 cands.sort(order);const keep=cands.find(c=>c.valid);
 // Never discard a newer city we cannot load in the current format.
 if(!keep||cands[0].tick>keep.tick)return {ran:false,removed:[],reason:'newest-unreadable'};
 const removed:string[]=[];
 if(storage.getItem(SAVE_KEY)!==keep.raw){
  try{storage.setItem(SAVE_KEY,keep.raw);}catch(e){if(!isQuota(e))throw e;
   // Kept city is still durable in its source (IDB branch or its own key) while we free space.
   removed.push(...dropOldCopies(storage,keep.source.startsWith('idb:')?[]:[keep.source]));storage.setItem(SAVE_KEY,keep.raw);}
  if(storage.getItem(SAVE_KEY)!==keep.raw)throw Error('auto-cleanup-verify-failed');
 }
 removed.push(...dropOldCopies(storage));
 if(factory&&cands.some(c=>c.source.startsWith('idb:'))){if(await deleteDb(factory,CITY_RECOVERY_DB))removed.push(`idb:${CITY_RECOVERY_DB}`);else return {ran:false,kept:keep.source,tick:keep.tick,removed,reason:'idb-delete-blocked'};}
 try{storage.setItem(AUTO_CLEANUP_FLAG,String(Date.now()));}catch{}
 return {ran:true,kept:keep.source,tick:keep.tick,removed};
}
