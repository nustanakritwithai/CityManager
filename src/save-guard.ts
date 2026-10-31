import {encodeSaveCopy,decodeSaveCopy} from './save-copy-codec.ts';
import {deserializeParkSession} from './park-runtime.ts';
import {equivalentStoredSessions} from './save-equivalence.ts';
/** Existing formats are unchanged. The new checkpoint is independent of old tabs. */
import {readStoredCity,saveStoredCity,SAVE_KEY,AUTOSAVE_CHECKPOINT_KEY,PRE_AUTOSAVE_BACKUP,saveConflictBackupKeys,LATEST_BACKUP_KEY,SAVE_CONFLICT_LATEST_KEY,SAVE_CONFLICT_INDEX_KEY} from './save-storage.ts';
import {isQuotaError} from './autosave.ts';
type Store=Pick<Storage,'getItem'|'setItem'>&Partial<Pick<Storage,'removeItem'|'key'>>&{readonly length?:number};
const COPY_PREFIX='cm-copy-lz1:';
/** Explicit v1-v6 import backups keep their original contract: raw bytes, written before the primary, failure aborts. */
const LEGACY_BACKUP=/^citymanager\.backup\.v[0-9]/;
/** CityManager-only keys. Strategy-Game shares the origin: never read-modify-delete anything else. */
const ownKeys=(s:Store)=>{const out:string[]=[];if(typeof s.key!=='function'||typeof s.length!=='number')return out;for(let i=0;i<s.length;i++){const k=s.key(i);if(k&&k.startsWith('citymanager.'))out.push(k);}return out;};
/** #153 (live 13:01-13:49, reverted) wrote a raw full-size taxi migration copy. Only that raw form is an orphan; compressed copies (#161) are kept. */
export const isOrphanTaxiBackup=(key:string,value:string|null)=>/^citymanager\.backup\.before-taxi(?:\.[0-9])?$/.test(key)&&value!==null&&!value.startsWith(COPY_PREFIX)&&value.length>=64000;
/** Frees space without losing data: drops raw #153 taxi orphans and losslessly recompresses raw backup copies. Never touches the primary save. */
export function freeSaveSpace(s:Store):number{
 let freed=0;
 for(const key of ownKeys(s)){
  if(key===SAVE_KEY||!key.startsWith('citymanager.backup.')||LEGACY_BACKUP.test(key))continue;
  const value=s.getItem(key);if(value===null)continue;
  try{
   if(isOrphanTaxiBackup(key,value)&&s.removeItem){s.removeItem(key);freed+=value.length;continue;}
   if(value.startsWith(COPY_PREFIX)||value.length<64000)continue;
   const packed=encodeSaveCopy(value);if(packed.length<value.length&&decodeSaveCopy(packed)===value){s.setItem(key,packed);freed+=value.length-packed.length;}
  }catch{/* best effort: a failed rewrite keeps the old bytes */}
 }
 return freed;
}
/** Startup: remove only the raw #153 orphan before the first save can hit quota. */
export function removeOrphanSaveKeys(s:Store):number{let n=0;for(const key of ownKeys(s)){const v=s.getItem(key);if(isOrphanTaxiBackup(key,v)&&s.removeItem){s.removeItem(key);n++;}}return n;}
export function createSaveGuard(backing:Store){
 try{removeOrphanSaveKeys(backing);}catch{/* unavailable storage */}
 const isCopy=(key:string)=>key===AUTOSAVE_CHECKPOINT_KEY||key===PRE_AUTOSAVE_BACKUP||/^citymanager\.backup\.(?!latest$|save-conflict\.index$|v[0-9])/.test(key);
 const storage:Store={getItem:key=>isCopy(key)?decodeSaveCopy(backing.getItem(key)):backing.getItem(key),setItem:(key,value)=>backing.setItem(key,isCopy(key)?encodeSaveCopy(value):value)};
 let expected:string|null=null,checkpoint:string|null=null,armed=false,replacement=false,generation=0;let pendingArchive:string[]=[];
 try{expected=storage.getItem(SAVE_KEY);checkpoint=storage.getItem(AUTOSAVE_CHECKPOINT_KEY);armed=readStoredCity(storage)===null&&!checkpoint;}catch{/* unavailable storage never authorizes replacing data */}
 const archive=(raw:string|null,publishPointer=true)=>{
  if(raw===null)return;
  const keys=saveConflictBackupKeys(storage);let key=keys.find(k=>storage.getItem(k)===raw);
  if(!key){key=keys.find(k=>storage.getItem(k)===null);if(!key){let n=keys.length;do{key=`citymanager.backup.save-conflict.${n++}`;}while(storage.getItem(key)!==null);storage.setItem(SAVE_CONFLICT_INDEX_KEY,JSON.stringify([...keys,key]));}storage.setItem(key,raw);}
  let valid=true;try{deserializeParkSession(raw);}catch{valid=false;}
  if(valid&&publishPointer)storage.setItem(SAVE_CONFLICT_LATEST_KEY,key);return valid?key:undefined;
 };
 const preserveOriginal=()=>{const current=storage.getItem(SAVE_KEY);if(current!==null&&backing.getItem(PRE_AUTOSAVE_BACKUP)===null)storage.setItem(PRE_AUTOSAVE_BACKUP,current);};
 return {
  get armed(){return armed;},get generation(){return generation;},
  acceptLoaded(raw:string,explicit=false){
   const current=storage.getItem(SAVE_KEY),copy=storage.getItem(AUTOSAVE_CHECKPOINT_KEY);
   if(!explicit&&copy!==null&&copy!==raw&&!equivalentStoredSessions(raw,copy))throw Error('พบเซฟช่องเดิมกับสำเนาอัตโนมัติต่างกัน กรุณาเลือกโหลดชุดที่ต้องการก่อน');
   // Formatting-only resume still retains alternate original bytes before any later write.
   pendingArchive=explicit?[...new Set([copy,current].filter((value):value is string=>value!==null&&value!==raw))]:copy!==null&&copy!==raw?[copy]:[];
   expected=current;checkpoint=copy;armed=true;replacement=explicit;generation++;
  },
  block(){armed=false;generation++;},
  preserveNew(raw:string){archive(storage.getItem(SAVE_KEY));archive(storage.getItem(AUTOSAVE_CHECKPOINT_KEY));archive(raw);},
  authorizeNew(raw:string){archive(storage.getItem(SAVE_KEY));archive(storage.getItem(AUTOSAVE_CHECKPOINT_KEY));archive(raw);expected=storage.getItem(SAVE_KEY);checkpoint=storage.getItem(AUTOSAVE_CHECKPOINT_KEY);armed=true;replacement=true;generation++;},
  write(raw:string,legacy:string|null,expectedGeneration=generation){
   if(expectedGeneration!==generation)throw Error('เมืองเปลี่ยนระหว่างบันทึก ยกเลิกคำขอเก่าโดยไม่เขียนทับ');
   if(!armed)throw Error('ยังไม่ได้โหลดเซฟเดิม หยุดการบันทึกเพื่อป้องกันข้อมูลถูกทับ');
   deserializeParkSession(raw);
   if(storage.getItem(SAVE_KEY)!==expected||storage.getItem(AUTOSAVE_CHECKPOINT_KEY)!==checkpoint){armed=false;archive(raw);throw Error('เซฟถูกเปลี่ยนจากอีกแท็บ เก็บสำเนาเมืองนี้แล้ว กรุณาโหลดล่าสุดหรือกู้คืนสำเนา');}
   const next=JSON.parse(raw);let previous:{version:number}|null=null;
   try{previous=expected===null?null:JSON.parse(expected);}catch{if(!replacement)throw Error('เซฟเดิมอ่านไม่ได้ หยุดการเขียนทับ');}
   if(!replacement&&previous&&Number(previous.version)>Number(next.version))throw Error('ไม่เขียนเซฟเวอร์ชันเก่าทับเวอร์ชันใหม่');
   // Validate and plan the existing migration writes first. Required legacy backup
   // failures must occur before publishing any new recovery pointer/checkpoint.
   const staged=new Map<string,string>();
   const migration=saveStoredCity({getItem:key=>staged.get(key)??storage.getItem(key),setItem:(key,value)=>{staged.set(key,value);}},raw,legacy);
   // The primary save is written FIRST and wins: copies are kept in memory and published afterwards,
   // best effort. On quota, free CityManager-only space (lossless) and retry the primary once.
   const primary=staged.get(SAVE_KEY)!;
   if(storage.getItem(SAVE_KEY)!==expected||storage.getItem(AUTOSAVE_CHECKPOINT_KEY)!==checkpoint){armed=false;archive(raw);throw Error('เซฟถูกเปลี่ยนจากอีกแท็บ เก็บสำเนาเมืองนี้แล้ว');}
   const original=expected;
   for(const [key,value] of staged)if(LEGACY_BACKUP.test(key))storage.setItem(key,value);
   // The checkpoint must never disagree with the new primary: clear it before the primary changes, rewrite after.
   const dropCheckpoint=()=>{if(backing.removeItem&&backing.getItem(AUTOSAVE_CHECKPOINT_KEY)!==null){backing.removeItem(AUTOSAVE_CHECKPOINT_KEY);}};
   const writePrimary=()=>backing.setItem(SAVE_KEY,primary);
   try{writePrimary();}catch(error){if(!isQuotaError(error))throw error;freeSaveSpace(backing);try{writePrimary();}catch(again){if(!isQuotaError(again)||!backing.removeItem)throw again;const keep=backing.getItem(AUTOSAVE_CHECKPOINT_KEY);dropCheckpoint();try{writePrimary();}catch(last){if(keep!==null)try{backing.setItem(AUTOSAVE_CHECKPOINT_KEY,keep);}catch{/* freed space is still free */}throw last;}}}
   expected=storage.getItem(SAVE_KEY);replacement=false;
   const best=(fn:()=>void)=>{try{fn();}catch(error){if(!isQuotaError(error))throw error;try{freeSaveSpace(backing);fn();}catch{/* copy skipped: primary already durable */}}};
   let checkpointOk=false;best(()=>{storage.setItem(AUTOSAVE_CHECKPOINT_KEY,raw);checkpointOk=true;});
   if(checkpointOk)checkpoint=raw;else{try{dropCheckpoint();}catch{/* ignore */}checkpoint=storage.getItem(AUTOSAVE_CHECKPOINT_KEY);}
   for(const [key,value] of staged)if(key!==SAVE_KEY&&key!==LATEST_BACKUP_KEY&&!LEGACY_BACKUP.test(key))best(()=>storage.setItem(key,value));
   let pointer:string|undefined;
   for(const prior of pendingArchive)best(()=>{pointer=archive(prior,false)??pointer;});
   pendingArchive=[];
   if(original!==null&&backing.getItem(PRE_AUTOSAVE_BACKUP)===null)best(()=>storage.setItem(PRE_AUTOSAVE_BACKUP,original));
   const latest=staged.get(LATEST_BACKUP_KEY)??migration.backup;if(latest)best(()=>storage.setItem(LATEST_BACKUP_KEY,latest));
   if(pointer)try{storage.setItem(SAVE_CONFLICT_LATEST_KEY,pointer);}catch{/* primary and immutable copy remain durable */}
  },
 };
}
