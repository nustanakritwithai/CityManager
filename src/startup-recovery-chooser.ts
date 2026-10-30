import type {SaveSource} from './save-storage.ts';
import type {ResumeChoice} from './save-choice.ts';
/** One entry action. Ambiguous cities require a choice, never a highest-day guess. */
export function installStartupRecoveryChooser(options:{summary:()=>string;load:(source:SaveSource)=>Promise<boolean>;loadChoices?:()=>Promise<{choices:ResumeChoice[];selected:string|null;complete?:boolean}>;loadChoice?:(id:string)=>Promise<boolean>;loadEmergency?:()=>Promise<boolean>;exportEmergency?:()=>Promise<boolean>;startFresh?:()=>Promise<boolean>;previewOnly?:()=>Promise<boolean>;status:()=>string;recoveryState?:'available'|'unavailable'|'none'}) {
 const dialog=document.createElement('dialog');dialog.id='startup-recovery-chooser';dialog.setAttribute('aria-labelledby','startup-recovery-title');
 const title=document.createElement('h2');title.id='startup-recovery-title';title.textContent='เข้าเมืองของคุณ';title.tabIndex=-1;
 const note=document.createElement('p');note.id='startup-recovery-notice';note.textContent=options.recoveryState==='unavailable'?'ยังตรวจสำเนากู้คืนไม่ได้ ข้อมูลเดิมยังอยู่ เลือกเมืองอย่างระมัดระวัง':'เลือกเมืองครั้งเดียว แล้วกดเข้าเมือง สำเนาอื่นยังเก็บไว้ ไม่รวมเงินหรือสิ่งปลูกสร้างเข้าด้วยกัน';
 const label=document.createElement('label');label.textContent='เมืองที่จะเปิด';label.htmlFor='startup-city-choice';
 const select=document.createElement('select');select.id='startup-city-choice';select.setAttribute('aria-label','เมืองที่จะเปิด');select.style.cssText='width:100%;min-height:48px';
 const selectedName=document.createElement('p');selectedName.id='startup-selected-city';selectedName.hidden=true;
 const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='เลือกเมืองที่ต้องการเล่นต่อ';select.append(placeholder);
 const enter=document.createElement('button');enter.id='startup-enter-city';enter.type='button';enter.textContent='เข้าเมือง';enter.disabled=true;
 const details=document.createElement('details');details.id='startup-recovery-details';const heading=document.createElement('summary');heading.textContent='ตัวเลือกกู้คืนและส่งออก';details.append(heading);
 const summary=document.createElement('p');summary.id='startup-recovery-summary';summary.style.whiteSpace='pre-line';summary.textContent=options.summary();details.append(summary);
 const status=document.createElement('p');status.id='startup-recovery-status';status.setAttribute('role','status');
 const change=document.createElement('button');change.id='startup-change-city';change.textContent='เลือกเมืองอื่น';change.type='button';change.hidden=true;change.onclick=()=>{label.hidden=select.hidden=false;selectedName.hidden=true;change.hidden=true;select.focus();};details.append(change);
 const buttons:HTMLButtonElement[]=[enter,change];let busy=false;
 const run=async(work:()=>Promise<boolean|undefined>,close=true)=>{if(busy)return;busy=true;buttons.forEach(b=>b.disabled=true);select.disabled=true;status.textContent='กำลังเปิดเมือง…';try{if(await work()){if(close){dialog.close();dialog.remove();return;}}status.textContent=options.status()||'ยังเปิดชุดนี้ไม่ได้ ข้อมูลเดิมยังอยู่';if(close)await refreshChoices(false);}catch{status.textContent='ยังเปิดชุดนี้ไม่ได้ ข้อมูลเดิมยังอยู่';}finally{busy=false;buttons.forEach(b=>b.disabled=false);select.disabled=false;enter.disabled=!select.value;summary.textContent=options.summary();}};
 select.onchange=()=>{enter.disabled=busy||!select.value;};enter.onclick=()=>void run(()=>options.loadChoice?.(select.value)??Promise.resolve(false));
 const add=(id:string,text:string,work:()=>Promise<boolean|undefined>,close=true)=>{const b=document.createElement('button');b.id=id;b.type='button';b.textContent=text;b.onclick=()=>void run(work,close);buttons.push(b);details.append(b);};
 if(options.loadEmergency)add('startup-recover-emergency','ดูสำเนากู้คืนทั้งหมด',options.loadEmergency);
 if(options.exportEmergency)add('startup-export-emergency','ส่งออกสำเนากู้คืน',options.exportEmergency,false);
 for(const [source,text] of [['current','ตรวจเซฟหลัก'],['checkpoint','ตรวจสำเนาอัตโนมัติ'],['backup','ตรวจสำเนาเดิม'],['conflict','ตรวจสำเนางานที่ขัดแย้ง']] as const)add(`startup-recover-${source}`,text,()=>options.load(source));
 if(options.previewOnly)add('startup-preview-only','ดูเมืองชั่วคราว ไม่บันทึกและไม่ใช้ตลาด',options.previewOnly);
 if(options.startFresh)add('startup-explicit-fresh','ไม่พบเซฟในช่องหลัก · ตรวจสำเนากู้คืนไม่ได้ — เข้าเมืองใหม่',options.startFresh);
 const caution=document.createElement('p');caution.textContent='ข้อมูลเดิมไม่ถูกลบ หากยังเปิดไม่ได้ให้ส่งข้อความสถานะ ไม่ต้องล้างข้อมูลเว็บไซต์';details.append(caution);
 dialog.addEventListener('cancel',event=>event.preventDefault());dialog.append(title,note,selectedName,label,select,enter,details,status);document.body.append(dialog);dialog.showModal();title.focus();
 const refreshChoices=async(allowRemember=true)=>{try{const result=await options.loadChoices?.();if(!result||!dialog.isConnected)return;select.replaceChildren(placeholder);select.value='';label.hidden=select.hidden=false;selectedName.hidden=true;change.hidden=true;for(const choice of result.choices){const o=document.createElement('option');o.value=choice.id;o.textContent=choice.label;select.append(o);}if(allowRemember&&result.selected){select.value=result.selected;const chosen=result.choices.find(c=>c.id===result.selected);if(chosen){selectedName.textContent=chosen.label;selectedName.hidden=false;label.hidden=select.hidden=true;change.hidden=false;}}if(result.complete===false)note.textContent='ยังตรวจบางสำเนาไม่ได้ ข้อมูลเดิมยังอยู่ โปรดเลือกเมืองอย่างระมัดระวัง';enter.disabled=busy||!select.value;if(!result.choices.length)status.textContent='ยังไม่พบเมืองที่ตรวจสอบได้ ดูตัวเลือกกู้คืนโดยไม่ลบข้อมูลเดิม';}catch{status.textContent='ยังตรวจรายการเมืองไม่ได้ ข้อมูลเดิมยังอยู่';}};
 void refreshChoices();
 return dialog;
}
