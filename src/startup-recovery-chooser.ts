import type {SaveSource} from './save-storage.ts';
/** A protected startup is not a playable new city. Selection reuses the normal guarded Load. */
export function installStartupRecoveryChooser(options:{summary:()=>string;load:(source:SaveSource)=>Promise<boolean>;status:()=>string}) {
 const dialog=document.createElement('dialog');dialog.id='startup-recovery-chooser';
 dialog.setAttribute('aria-labelledby','startup-recovery-title');
 const title=document.createElement('h2');title.id='startup-recovery-title';title.textContent='เลือกเซฟเดิมก่อนเข้าเมือง';title.tabIndex=-1;title.setAttribute('autofocus','');
 const note=document.createElement('p');note.textContent='ยังไม่เปิดเมืองใหม่ และยังไม่บันทึกทับข้อมูลเดิม เลือกเปิดเซฟเพื่อตรวจเมืองก่อนเล่นต่อ ไม่เลือกชุดที่ใหม่กว่าแทนให้คุณ';
 const summary=document.createElement('p');summary.id='startup-recovery-summary';summary.style.whiteSpace='pre-line';summary.textContent=options.summary();
 const status=document.createElement('p');status.id='startup-recovery-status';status.setAttribute('role','status');
 const buttons:HTMLButtonElement[]=[];let busy=false;
 const choose=async(source:SaveSource)=>{
  if(busy)return;busy=true;buttons.forEach(button=>button.disabled=true);status.textContent='กำลังเปิดเซฟเดิม…';
  try{if(await options.load(source)){dialog.close();dialog.remove();return;}status.textContent=options.status()||'ยังเปิดชุดนี้ไม่ได้ ข้อมูลเดิมยังอยู่';}
  catch{status.textContent='ยังเปิดชุดนี้ไม่ได้ ข้อมูลเดิมยังอยู่';}
  finally{busy=false;buttons.forEach(button=>button.disabled=false);summary.textContent=options.summary();}
 };
 for(const [source,label] of [['current','เปิดเซฟหลัก'],['checkpoint','เปิดสำเนาอัตโนมัติ'],['backup','กู้คืนสำเนาเดิม'],['conflict','กู้คืนสำเนางานที่ขัดแย้ง']] as const){
  const button=document.createElement('button');button.id=`startup-recover-${source}`;button.type='button';button.textContent=label;button.onclick=()=>void choose(source);buttons.push(button);
 }
 const caution=document.createElement('p');caution.textContent='ถ้าเปิดไม่ได้ ให้ส่งข้อความด้านบนให้ผู้ดูแล ห้ามล้างข้อมูลเว็บไซต์หรือสร้าง Guest ใหม่';
 dialog.addEventListener('cancel',event=>event.preventDefault());
 dialog.append(title,note,summary,...buttons,status,caution);document.body.append(dialog);dialog.showModal();title.focus();
 return dialog;
}
