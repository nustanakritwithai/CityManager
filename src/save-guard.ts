import {deserializeParkSession} from './park-runtime.ts';
/** Existing formats are unchanged. The new checkpoint is independent of old tabs. */
import {readStoredCity,saveStoredCity,SAVE_KEY,AUTOSAVE_CHECKPOINT_KEY,PRE_AUTOSAVE_BACKUP,saveConflictBackupKeys,LATEST_BACKUP_KEY} from './save-storage.ts';
type Store=Pick<Storage,'getItem'|'setItem'>;
export function createSaveGuard(storage:Store){
 let expected:string|null=null,checkpoint:string|null=null,armed=false,replacement=false,generation=0;let pendingArchive:string[]=[];
 try{expected=storage.getItem(SAVE_KEY);checkpoint=storage.getItem(AUTOSAVE_CHECKPOINT_KEY);armed=readStoredCity(storage)===null&&!checkpoint;}catch{/* unavailable storage never authorizes replacing data */}
 const archive=(raw:string|null)=>{
  if(raw===null)return;
  const keys=saveConflictBackupKeys();let key=keys.find(k=>storage.getItem(k)===raw);
  if(!key){key=keys.find(k=>storage.getItem(k)===null);if(!key)throw Error('สำเนากู้คืนเต็ม กรุณาส่งออกไฟล์ก่อน เซฟเดิมยังอยู่');storage.setItem(key,raw);}
  storage.setItem(LATEST_BACKUP_KEY,key);
 };
 const preserveOriginal=()=>{const current=storage.getItem(SAVE_KEY);if(current!==null&&storage.getItem(PRE_AUTOSAVE_BACKUP)===null)storage.setItem(PRE_AUTOSAVE_BACKUP,current);};
 return {
  get armed(){return armed;},get generation(){return generation;},
  acceptLoaded(raw:string,explicit=false){
   const current=storage.getItem(SAVE_KEY),copy=storage.getItem(AUTOSAVE_CHECKPOINT_KEY);
   if(!explicit&&copy!==null&&copy!==raw)throw Error('พบเซฟช่องเดิมกับสำเนาอัตโนมัติต่างกัน กรุณาเลือกโหลดชุดที่ต้องการก่อน');
   pendingArchive=explicit?[...new Set([copy,current].filter((value):value is string=>value!==null&&value!==raw))]:[];
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
   for(const prior of pendingArchive)archive(prior);
   preserveOriginal();
   // Independent newest copy survives a still-open older client writing the old slot.
   storage.setItem(AUTOSAVE_CHECKPOINT_KEY,raw);checkpoint=raw;
   saveStoredCity(storage,raw,legacy);expected=storage.getItem(SAVE_KEY);replacement=false;pendingArchive=[];
  },
 };
}
