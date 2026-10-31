/** Explicit recovery promotion. Never treats a recovery copy as primary durability. */
import {deserializeParkSession} from './park-runtime.ts';
import {decodeSaveCopy} from './save-copy-codec.ts';
import {SAVE_KEY,AUTOSAVE_CHECKPOINT_KEY} from './save-storage.ts';
import type {createSaveGuard} from './save-guard.ts';
type Store=Pick<Storage,'getItem'>;
export const primaryFence=(storage:Store)=>({primary:storage.getItem(SAVE_KEY),checkpoint:storage.getItem(AUTOSAVE_CHECKPOINT_KEY)});
export async function promoteRecoverySave(options:{raw:string;storage:Store;guard:ReturnType<typeof createSaveGuard>;expected:ReturnType<typeof primaryFence>;generation:number;isCurrent:()=>boolean;validateSnapshot?:()=>void;preserve:()=>Promise<unknown>}) {
 const {raw,storage,guard,expected}=options;let ownedGeneration=options.generation;
 const current=()=>options.isCurrent()&&guard.generation===ownedGeneration;
 const check=()=>{if(!current())throw Error('เมืองเปลี่ยนระหว่างยืนยัน ยกเลิกการแทนที่');options.validateSnapshot?.();const now=primaryFence(storage);if(now.primary!==expected.primary||now.checkpoint!==expected.checkpoint)throw Error('เซฟเปลี่ยนจากอีกแท็บ กรุณาตรวจใหม่ก่อนยืนยัน');};
 try {
  check();deserializeParkSession(raw);
  await options.preserve();check();
  // acceptLoaded alone is NOT success. write archives both divergent slots first.
  guard.acceptLoaded(raw,true);ownedGeneration=guard.generation;
  guard.write(raw,null,ownedGeneration);
  if(!current()||storage.getItem(SAVE_KEY)!==raw||(storage.getItem(AUTOSAVE_CHECKPOINT_KEY)!==null&&decodeSaveCopy(storage.getItem(AUTOSAVE_CHECKPOINT_KEY))!==raw))throw Error('ยังยืนยันเซฟหลักที่อ่านกลับไม่ได้');
  return {ok:true as const,generation:ownedGeneration};
 } catch(error) {
  const owned=current();if(owned){guard.block();ownedGeneration=guard.generation;}
  return {ok:false as const,error,owned,generation:ownedGeneration};
 }
}
