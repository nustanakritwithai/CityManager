/** One menu entry. All durability lives in injected server operations, never browser storage. */
export function saveManagementError(error:unknown):string{
 const message=error instanceof Error?error.message:'เชื่อมต่อไม่ได้';
 return ({
  'market-reconciliation-required':'ยังลบเมืองไม่ได้ มีรายการตลาดหรือเงิน/สินค้าค้างยืนยัน ต้องตรวจรายการเดิมก่อน โดยบัญชีและเครดิตยังอยู่ครบ',
  'market-contract-unverified':'ยังลบเมืองไม่ได้ เซิร์ฟเวอร์ยังตรวจข้อมูลรายการตลาดเดิมไม่ครบ กรุณาให้ผู้ดูแลตรวจระบบก่อน',
  'city-lifecycle-changed':'สถานะเมืองบนเซิร์ฟเวอร์เปลี่ยนแล้ว ต้องตรวจเมืองหลักก่อน ไม่ใช้คำขอเก่ากับเมืองใหม่',
  'server-save-conflict':'คำขอก่อนหน้าถูกปฏิเสธและยังไม่ได้ตรวจสถานะล่าสุด ไม่ได้ส่งคำขอลบซ้ำ กรุณากลับไปตรวจเซฟหลัก',
  'save-conflict':'เมืองบนเซิร์ฟเวอร์เปลี่ยนแล้ว ไม่ได้ลบหรือเขียนทับเมืองใหม่ กรุณาตรวจเซฟล่าสุดก่อน',
  'fresh-city-market-required':'ยังสร้างเมืองใหม่ไม่ได้ ข้อมูลตัวตนเมืองใหม่ไม่ถูกต้อง โดยข้อมูลบัญชีเดิมยังอยู่',
  'owner-save-capacity':'พื้นที่สำเนาบนเซิร์ฟเวอร์ไม่พอ จึงยังไม่ลบเมืองเดิม กรุณาให้ผู้ดูแลตรวจพื้นที่ก่อน'
 } as Record<string,string>)[message]??message;
}
export type SaveManagementActions={
 canOpen:()=>boolean;
 begin:()=>{tick:number;cityId:string};
 remove:()=>Promise<void>;
 createFresh:()=>Promise<void>;
 uncertain:()=>boolean;
 rejected?:()=>boolean;
 canReload?:()=>boolean;
 reload?:()=>void;
 cancel:()=>void;
 complete:()=>void;
 status:(message:string)=>void;
};
export function installSaveManagement(button:HTMLButtonElement,actions:SaveManagementActions){
 let dialog:HTMLDialogElement|null=null;
 button.textContent='จัดการเซฟ';
 button.addEventListener('click',()=>{
  if(dialog)return;
  if(!actions.canOpen()){actions.status('ยังจัดการเซฟไม่ได้ กรุณารอหรือยืนยันการบันทึกที่ค้างอยู่ก่อน');return;}
  const selected=actions.begin();
  dialog=document.createElement('dialog');dialog.id='save-management-dialog';dialog.setAttribute('aria-labelledby','save-management-title');
  const title=document.createElement('h2');title.id='save-management-title';title.textContent='ลบเมืองที่ใช้งานอยู่?';
  const detail=document.createElement('p');detail.textContent=`เมืองวันที่ ${selected.tick} · ${selected.cityId.slice(0,8)} จะถูกลบออกจากเมืองที่ใช้งาน แต่เก็บสำเนาสำรองบนเซิร์ฟเวอร์ ไม่ใช่ลบถาวร บัญชี เครดิต และรายการตลาดเดิมไม่ถูกลบ เมืองใหม่จะมีรหัสใหม่และไม่รับรายการตลาดเดิมมาใช้ซ้ำ`;
  const state=document.createElement('p');state.setAttribute('role','status');state.setAttribute('aria-live','polite');
  const confirm=document.createElement('button');confirm.type='button';confirm.id='save-management-delete';confirm.textContent='ยืนยันลบเมืองนี้';
  const back=document.createElement('button');back.type='button';back.id='save-management-cancel';back.textContent='กลับโดยไม่ลบ';
  let phase:'confirm'|'deleted'='confirm',busy=false;
  const close=()=>{dialog?.close();dialog?.remove();dialog=null;button.focus();};
  const cancel=()=>{if(busy||phase!=='confirm'||actions.uncertain())return;actions.cancel();close();};
  back.onclick=cancel;dialog.addEventListener('cancel',event=>{event.preventDefault();cancel();});
  confirm.onclick=async()=>{
   if(busy||actions.rejected?.())return;busy=true;confirm.disabled=back.disabled=true;confirm.setAttribute('aria-busy','true');
   try{
    if(phase==='confirm'){
     state.textContent='กำลังเก็บสำเนาและรอเซิร์ฟเวอร์ยืนยันการลบ…';
     await actions.remove();phase='deleted';
     title.textContent='ลบเมืองที่ใช้งานแล้ว';detail.textContent='ยังเก็บสำเนาสำรองของเมืองเดิมบนเซิร์ฟเวอร์ บัญชีและข้อมูลตลาดเดิมไม่เปลี่ยน คุณสามารถเริ่มเมืองใหม่ได้';
     confirm.id='save-management-create';confirm.textContent='เริ่มเมืองใหม่';back.hidden=false;
     state.textContent='เซิร์ฟเวอร์ยืนยันการลบแล้ว · ยังไม่ได้สร้างเมืองใหม่';
    }else{
     state.textContent='กำลังสร้างเมืองใหม่บนเซิร์ฟเวอร์…';
     await actions.createFresh();actions.complete();close();
    }
   }catch(error){state.textContent=`ยังไม่สำเร็จ: ${saveManagementError(error)} · ข้อมูลในเบราว์เซอร์ไม่ถูกลบ ${actions.rejected?.()?(actions.canReload?.()?'คำขอนี้ถูกปฏิเสธ ไม่ส่งซ้ำ กดกลับหน้าเข้าเกมเพื่อตรวจเมืองหลัก':'คำขอนี้ถูกปฏิเสธ ไม่ส่งลบซ้ำ กดกลับโดยไม่ลบ แล้วใช้ปุ่มบันทึกเพื่อตรวจเซฟหลักก่อน'):actions.uncertain()?'อย่าปิดหน้านี้ กดปุ่มเดิมเพื่อตรวจและลองคำขอเดิมอีกครั้ง':'กรุณาตรวจแล้วลองใหม่'}`;}
   finally{busy=false;confirm.disabled=actions.rejected?.()===true;const reload=actions.canReload?.()===true;back.textContent=reload?'กลับหน้าเข้าเกม':'กลับโดยไม่ลบ';back.disabled=!reload&&(phase!=='confirm'||actions.uncertain());back.onclick=reload?()=>{if(!busy&&actions.canReload?.())actions.reload?.();}:cancel;confirm.setAttribute('aria-busy','false');}
  };
  dialog.append(title,detail,state,confirm,back);document.body.append(dialog);dialog.showModal();back.focus();
 });
 return {get open(){return dialog!==null;}};
}
