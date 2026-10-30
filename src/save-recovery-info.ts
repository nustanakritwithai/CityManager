/** Read-only summaries. Never select a city, mutate storage, or expose Guest/save contents. */
import {readStoredCity} from './save-storage.ts';
import {deserializeParkSession} from './park-runtime.ts';
export function recoverySummary(storage:Pick<Storage,'getItem'>):string {
 const describe=(source:'current'|'checkpoint',label:string)=>{
  try {
   const saved=readStoredCity(storage,source);if(!saved)return `${label}: ไม่พบเซฟ`;
   const {city}=deserializeParkSession(saved.raw);const version=JSON.parse(saved.raw).version;
   return `${label}: วันที่ ${city.tick} · v${version} · อ่านได้`;
  }catch{return `${label}: อ่านหรือตรวจสอบไม่ได้ (ข้อมูลเดิมยังอยู่)`;}
 };
 return `${describe('current','เซฟหลัก (ปุ่มโหลด)')}\n${describe('checkpoint','สำเนาอัตโนมัติ')}\nยังไม่เลือกแทนให้คุณ · กดโหลดชุดที่ต้องการเพื่อตรวจเมืองก่อนกดบันทึก`;
}
export function loadFailureMessage(error:unknown):string {
 const key=error instanceof Error?error.message:'';
 const reasons:Record<string,string>={
  'market guest identity mismatch':'Guest ของเมืองกับข้อมูลตลาดในเบราว์เซอร์ไม่ตรงกัน',
  'saved-market-reconciliation-required':'ข้อมูลเมืองกับรายการตลาดต้องตรวจสอบร่วมกันก่อน',
  'market-journal-unavailable':'ยังอ่านรายการตลาดเดิมไม่ได้',
  'market-writer-lock-unavailable':'เบราว์เซอร์นี้ยังล็อกการเขียนรายการตลาดอย่างปลอดภัยไม่ได้',
  'market-writer-busy':'รายการตลาดกำลังถูกใช้งานจากอีกหน้าต่าง',
  'market-state-changed-reload':'รายการตลาดเปลี่ยนระหว่างโหลด',
  'Recovery copy could not be decoded; original save preserved':'อ่านสำเนากู้คืนไม่ได้',
 };
 const reason=Object.hasOwn(reasons,key)?reasons[key]:error instanceof Error&&error.name==='QuotaExceededError'?'พื้นที่สำหรับการกู้คืนไม่เพียงพอ':error instanceof Error&&error.name==='SecurityError'?'เบราว์เซอร์ไม่อนุญาตให้อ่านหรือเขียนข้อมูลในขณะนี้':'ยังอ่านหรือตรวจสอบชุดที่เลือกไม่ผ่าน';
 return `โหลดไม่สำเร็จ: ${reason} · ยังไม่บันทึกทับเซฟเมืองเดิม · ห้ามล้างข้อมูลเว็บไซต์หรือสร้าง Guest ใหม่เพื่อแก้ปัญหานี้`;
}
