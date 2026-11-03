import type {ServerCitySaveClient,ServerCityMetadata} from './server-city-save.ts';

/** Retry an uncertain command first, then capture the current session. Explicit
 * Save remains a fresh CAS write; automatic clean-state checks are read-only. */
export async function persistServerCity(client:ServerCitySaveClient,capture:()=>{raw:string;metadata:ServerCityMetadata},explicit=false){
 if(client.pending){const retried=await client.retry();if('deleted' in retried)throw Error('เมืองถูกลบแล้ว กรุณาโหลดหน้าใหม่');}
 const snapshot=capture();
 const operation=!explicit&&client.matchesConfirmed(snapshot.raw,snapshot.metadata)?'verified':'saved';
 const acknowledged=await(explicit?client.save(snapshot.raw,snapshot.metadata):client.saveOrVerify(snapshot.raw,snapshot.metadata));
 return {acknowledged,operation} as const;
}

/** Pending includes synchronously queued lifecycle work, not just an HTTP POST. */
export function shouldWarnBeforeUnload(state:{running:boolean;failed:boolean;busy:boolean;pending:boolean;conflict:boolean;raw:string;confirmedRaw:string|undefined}){
 return state.running||state.failed||state.busy||state.pending||state.conflict||state.raw!==state.confirmedRaw;
}

/** Completion describes the acknowledged snapshot, never edits made in flight. */
export function describeServerAcknowledgement(operation:'saved'|'verified',acknowledgedRaw:string,currentRaw:string){
 const current=acknowledgedRaw===currentRaw;
 return {current,label:!current?'ยืนยันเซฟก่อนหน้าแล้ว · มีการเปลี่ยนแปลงใหม่ที่ยังไม่บันทึก':operation==='verified'?'ตรวจสอบแล้วว่าเซฟบนเซิร์ฟเวอร์ตรงกัน':'บันทึกบนเซิร์ฟเวอร์แล้ว'};
}
