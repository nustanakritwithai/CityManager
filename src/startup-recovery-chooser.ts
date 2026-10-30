import type {SaveSource} from './save-storage.ts';
/** A protected startup is not a playable new city. Selection reuses the normal guarded Load. */
export function installStartupRecoveryChooser(options:{summary:()=>string;load:(source:SaveSource)=>Promise<boolean>;loadEmergency?:()=>Promise<boolean>;exportEmergency?:()=>Promise<boolean>;startFresh?:()=>Promise<boolean>;previewOnly?:()=>Promise<boolean>;status:()=>string;recoveryState?:'available'|'unavailable'|'none'}) {
 const dialog=document.createElement('dialog');dialog.id='startup-recovery-chooser';
 dialog.setAttribute('aria-labelledby','startup-recovery-title');
 const title=document.createElement('h2');title.id='startup-recovery-title';title.textContent='เลือกเซฟเดิมก่อนเข้าเมือง';title.tabIndex=-1;title.setAttribute('autofocus','');
 const note=document.createElement('p');note.id='startup-recovery-notice';note.style.fontWeight='700';
 note.textContent=options.recoveryState==='available'?'พบสำเนากู้คืนแยกจากเซฟหลัก อาจมีงานใหม่กว่า โปรดตรวจหรือส่งออกก่อนเลือกเซฟหลัก':options.recoveryState==='unavailable'?'ยังตรวจสำเนากู้คืนไม่ได้ อาจมีข้อมูลเดิมที่มองไม่เห็น เลือกอย่างระมัดระวัง ห้ามล้างข้อมูล':'ยังไม่บันทึกทับข้อมูลเดิม เลือกเซฟเพื่อตรวจก่อนเล่นต่อ';
 const summary=document.createElement('p');summary.id='startup-recovery-summary';summary.style.whiteSpace='pre-line';summary.textContent=options.summary();
 const status=document.createElement('p');status.id='startup-recovery-status';status.setAttribute('role','status');
 const buttons:HTMLButtonElement[]=[],priority:HTMLButtonElement[]=[],other:HTMLButtonElement[]=[];let busy=false;
 const add=(button:HTMLButtonElement,first=false)=>{buttons.push(button);(first?priority:other).push(button);};
 const choose=async(source:SaveSource|'emergency')=>{
  if(busy)return;busy=true;buttons.forEach(button=>button.disabled=true);status.textContent='กำลังเปิดเซฟเดิม…';
  try{if(await (source==='emergency'?options.loadEmergency?.():options.load(source))){dialog.close();dialog.remove();return;}status.textContent=options.status()||'ยังเปิดชุดนี้ไม่ได้ ข้อมูลเดิมยังอยู่';}
  catch{status.textContent='ยังเปิดชุดนี้ไม่ได้ ข้อมูลเดิมยังอยู่';}
  finally{busy=false;buttons.forEach(button=>button.disabled=false);summary.textContent=options.summary();}
 };
 const first=options.recoveryState==='available',deferredEmergency:HTMLButtonElement[]=[];
 const addEmergency=(button:HTMLButtonElement)=>{if(first)add(button,true);else deferredEmergency.push(button);};
 if(options.loadEmergency){const button=document.createElement('button');button.id='startup-recover-emergency';button.type='button';button.textContent='เลือกสำเนากู้คืนในเบราว์เซอร์';button.onclick=()=>void choose('emergency');addEmergency(button);}
 if(options.exportEmergency){const button=document.createElement('button');button.id='startup-export-emergency';button.type='button';button.textContent='เลือกส่งออกสำเนากู้คืน';button.onclick=async()=>{if(busy)return;busy=true;buttons.forEach(b=>b.disabled=true);try{await options.exportEmergency?.();status.textContent=options.status()||'ตรวจไฟล์ดาวน์โหลดก่อนปิดเกม';}finally{busy=false;buttons.forEach(b=>b.disabled=false);}};addEmergency(button);}
 for(const [source,label] of [['current','เปิดเซฟหลัก'],['checkpoint','เปิดสำเนาอัตโนมัติ'],['backup','กู้คืนสำเนาเดิม'],['conflict','กู้คืนสำเนางานที่ขัดแย้ง']] as const){
  const button=document.createElement('button');button.id=`startup-recover-${source}`;button.type='button';button.textContent=label;button.onclick=()=>void choose(source);add(button);
 }
 deferredEmergency.forEach(button=>add(button));
 if(options.previewOnly){const button=document.createElement('button');button.id='startup-preview-only';button.type='button';button.textContent='ดูเมืองชั่วคราวโดยไม่บันทึกและไม่ใช้ตลาด';button.onclick=async()=>{if(busy)return;busy=true;buttons.forEach(b=>b.disabled=true);try{if(await options.previewOnly?.()){dialog.close();dialog.remove();return;}status.textContent=options.status()||'ยังเปิดไม่ได้';}finally{busy=false;buttons.forEach(b=>b.disabled=false);}};add(button,options.recoveryState==='unavailable');}
 if(options.startFresh){const button=document.createElement('button');button.id='startup-explicit-fresh';button.type='button';button.textContent='ไม่พบเซฟในช่องเดิม — เข้าเมืองใหม่โดยยอมรับว่าตรวจสำเนากู้คืนไม่ได้';button.onclick=async()=>{if(busy)return;busy=true;buttons.forEach(b=>b.disabled=true);try{if(await options.startFresh?.()){dialog.close();dialog.remove();return;}status.textContent=options.status()||'ยังเริ่มไม่ได้';}finally{busy=false;buttons.forEach(b=>b.disabled=false);}};add(button,options.recoveryState==='unavailable');}
 const caution=document.createElement('p');caution.textContent='ถ้าเปิดไม่ได้ ให้ส่งข้อความด้านบนให้ผู้ดูแล ห้ามล้างข้อมูลเว็บไซต์หรือสร้าง Guest ใหม่';
 dialog.addEventListener('cancel',event=>event.preventDefault());
 dialog.append(title,note,...priority,summary,...other,status,caution);document.body.append(dialog);dialog.showModal();title.focus();
 return dialog;
}
