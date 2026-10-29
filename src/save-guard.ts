import {deserializeParkSession} from './park-runtime.ts';
/** Existing formats are unchanged. The new checkpoint is independent of old tabs. */
import {readStoredCity,saveStoredCity,SAVE_KEY,AUTOSAVE_CHECKPOINT_KEY,PRE_AUTOSAVE_BACKUP,saveConflictBackupKeys,LATEST_BACKUP_KEY} from './save-storage.ts';
type Store=Pick<Storage,'getItem'|'setItem'>;
export function createSaveGuard(storage:Store){
 let expected:string|null=null,checkpoint:string|null=null,armed=false,replacement=false,generation=0;let pendingArchive:string[]=[];
 try{expected=storage.getItem(SAVE_KEY);checkpoint=storage.getItem(AUTOSAVE_CHECKPOINT_KEY);armed=readStoredCity(storage)===null&&!checkpoint;}catch{/* unavailable storage never authorizes replacing data */}
 const archive=(raw:string|null,publishPointer=true)=>{
  if(raw===null)return;
  const keys=saveConflictBackupKeys();let key=keys.find(k=>storage.getItem(k)===raw);
  if(!key){key=keys.find(k=>storage.getItem(k)===null);if(!key)throw Error('สำเนากู้คืนเต็ม กรุณาส่งออกไฟล์ก่อน เซฟเดิมยังอยู่');storage.setItem(key,raw);}
  let valid=true;try{deserializeParkSession(raw);}catch{valid=false;}
  if(valid&&publishPointer)storage.setItem(LATEST_BACKUP_KEY,key);return valid?key:undefined;
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
   // Validate and plan the existing migration writes first. Required legacy backup
   // failures must occur before publishing any new recovery pointer/checkpoint.
   const staged=new Map<string,string>();
   const migration=saveStoredCity({getItem:key=>staged.get(key)??storage.getItem(key),setItem:(key,value)=>{staged.set(key,value);}},raw,legacy);
   for(const [key,value] of staged)if(key!==SAVE_KEY&&key!==LATEST_BACKUP_KEY)storage.setItem(key,value);
   let pointer:string|undefined;
   for(const prior of pendingArchive)pointer=archive(prior,false)??pointer;
   preserveOriginal();
   if(storage.getItem(SAVE_KEY)!==expected||storage.getItem(AUTOSAVE_CHECKPOINT_KEY)!==checkpoint){armed=false;archive(raw);throw Error('เซฟถูกเปลี่ยนจากอีกแท็บ เก็บสำเนาเมืองนี้แล้ว');}
   storage.setItem(AUTOSAVE_CHECKPOINT_KEY,raw);checkpoint=raw;
   const latest=staged.get(LATEST_BACKUP_KEY)??migration.backup;if(latest)storage.setItem(LATEST_BACKUP_KEY,latest);
   storage.setItem(SAVE_KEY,staged.get(SAVE_KEY)!);expected=storage.getItem(SAVE_KEY);replacement=false;pendingArchive=[];
   // Supplemental pointer publication is not the commit point. Its raw backup
   // already exists; a metadata quota cannot undo a successful primary write.
   if(!latest&&pointer)try{storage.setItem(LATEST_BACKUP_KEY,pointer);}catch{/* primary and immutable copy remain durable */}
  },
 };
}
