import { installEntryScale } from './entry-scale.ts';
import { freshServerCityRaw } from './fresh-server-city.ts';
import { createCitySaveAuth } from './city-save-auth.ts';
import { ServerCitySaveClient } from './server-city-save.ts';
import { deserializeParkSession } from './park-runtime.ts';
import { summary } from './sim.ts';
import { listCitySaveSlots, requestForCitySlot, type CitySaveSlot, type CitySlot } from './city-save-slots.ts';
export function citySaveMetadata(raw:string){const {city}=deserializeParkSession(raw);return {name:'CityManager',population:summary(city).population,tick:city.tick};}
type EntryDependencies={auth:ReturnType<typeof createCitySaveAuth>;createClient:(request:ReturnType<typeof createCitySaveAuth>['request'],owner:string)=>ServerCitySaveClient};
/** Only the authenticated server head is playable. Browser city copies are never read as candidates. */
export async function requireServerCityEntry(configured?:string,dependencies:Partial<EntryDependencies>={}){
 const auth=dependencies.auth??createCitySaveAuth(configured);
 const createClient=dependencies.createClient??((request,owner)=>new ServerCitySaveClient(request,owner));
 const blocked=Array.from(document.body.children).filter((n):n is HTMLElement=>n instanceof HTMLElement).map(node=>({node,inert:node.inert}));blocked.forEach(({node})=>node.inert=true);
 const overlay=document.createElement('section');overlay.className='guest-entry-gate';
 const stopEntryScale=installEntryScale(overlay,window);
 const card=document.createElement('div');card.className='guest-entry-card';
 const title=document.createElement('h1');title.textContent='CityManager';
 const note=document.createElement('p');note.textContent='เมืองของคุณเก็บไว้บนเซิร์ฟเวอร์ · เข้าเล่นด้วยบัญชีแขก (Guest)';
 const hint=document.createElement('p');hint.className='guest-entry-note';hint.textContent='เล่นครั้งแรก: ในหน้าต่างเข้าสู่ระบบ ให้สร้าง Guest ใหม่ แล้วกดปุ่ม Continue';
 const button=document.createElement('button');button.textContent='เล่นต่อ';button.disabled=true;
 const status=document.createElement('p');status.setAttribute('role','status');status.className='guest-entry-status';card.append(title,note,button,status,hint);overlay.append(card);document.body.append(overlay);
 let busy=false,client:ServerCitySaveClient|null=null,expectedOwner:string|null=null;
 let offeredEmpty:string|null=null;
 let slot:CitySaveSlot|null=null;
 let slotMode:'detect'|'legacy'|'numbered'='detect';
 let choices:CitySlot[]=[];
 const picker=document.createElement('div');picker.className='guest-entry-slots';picker.hidden=true;card.append(picker);
 // No browser-held Guest pin: the server session (cookie or Pages login) is the only identity.
 await auth.prepare().then(()=>{button.disabled=false;},()=>{status.textContent='ยังเตรียมการเชื่อมต่อไม่ได้ โปรดโหลดหน้าใหม่';});
 return new Promise<{client:ServerCitySaveClient;auth:ReturnType<typeof createCitySaveAuth>;raw:string;slot:CitySaveSlot|null}>(resolve=>{
  const finish=(raw:string)=>{deserializeParkSession(raw);stopEntryScale();overlay.remove();blocked.forEach(({node,inert})=>node.inert=inert);resolve({client:client!,auth,raw,slot});};
  const renderSlots=()=>{
   picker.replaceChildren();
   for(const choice of choices){
    const row=document.createElement('section');row.setAttribute('aria-label',`ช่องเซฟ ${choice.slot}`);
    const title=document.createElement('h2');title.textContent=`ช่อง ${choice.slot}`;
    const detail=document.createElement('p');
    detail.textContent=choice.state==='occupied'?`${choice.metadata.name} · วัน ${choice.metadata.tick} · ประชากร ${choice.metadata.population}`:'ช่องว่าง';
    const open=document.createElement('button');open.type='button';
    const pending=client?.pending&&choice.slot===slot;
    open.textContent=pending?'ตรวจผลคำขอเดิม':choice.state==='occupied'?'เล่นเมืองนี้':'สร้างเมืองใหม่';
    open.setAttribute('aria-label',`${open.textContent} ช่อง ${choice.slot}`);
    open.disabled=busy||!!client?.pending&&!pending;
    open.onclick=()=>runSlot(choice);
    row.append(title,detail,open);picker.append(row);
   }
  };
  const refreshSlots=async()=>{
   const latest=await listCitySaveSlots(auth.request);
   if(!latest)throw Error('ยังเปิดช่องเซฟไม่ได้');
   choices=latest;renderSlots();
  };
  const runSlot=async(choice:CitySlot)=>{
   if(busy||client?.pending&&slot!==choice.slot)return;
   busy=true;button.disabled=true;renderSlots();
   status.textContent='กำลังตรวจเซฟบนเซิร์ฟเวอร์…';
   try{
    const owner=await auth.connect(expectedOwner);
    if(!client||slot!==choice.slot){slot=choice.slot;client=createClient(requestForCitySlot(auth.request,slot),owner);}
    if(client.conflict)client.discardConflictedAttempt();
    const retried=client.pending?await client.retry():null;
    const active=await client.load();
    if(active&&!('deleted' in active)){
     if(retried?.cityId===active.cityId||choice.state==='occupied'&&choice.cityId===active.cityId){finish(active.raw);return;}
     throw Error('ข้อมูลในช่องนี้เปลี่ยนแล้ว กรุณาเลือกอีกครั้ง');
    }
    if(retried||choice.state==='occupied')throw Error('ข้อมูลในช่องนี้เปลี่ยนแล้ว กรุณาเลือกอีกครั้ง');
    const raw=freshServerCityRaw(owner);
    const created=await client.create(raw,citySaveMetadata(raw));
    const confirmed=await client.load();
    if(!confirmed||'deleted' in confirmed||confirmed.cityId!==created.cityId)throw Error('ข้อมูลในช่องนี้เปลี่ยนแล้ว กรุณาเลือกอีกครั้ง');
    finish(confirmed.raw);
   }catch(error){
    if(client?.conflict)client.discardConflictedAttempt();
    if(!client?.pending){
     try{await refreshSlots();}
     catch{choices=[];button.hidden=false;button.textContent='ตรวจช่องเซฟอีกครั้ง';}
    }
    status.textContent=`ยังเข้าเมืองไม่ได้ · ${error instanceof Error?error.message:'เชื่อมต่อไม่ได้'}`;
   }finally{busy=false;button.disabled=false;renderSlots();void auth.prepare();}
  };
  button.onclick=async()=>{
   if(busy)return;busy=true;button.disabled=true;
   try{
    status.textContent='กำลังเชื่อมต่อและตรวจเซฟ…';
    const owner=await auth.connect(expectedOwner);expectedOwner=owner;
    if(slotMode==='detect'){
     const offered=await listCitySaveSlots(auth.request);
     slotMode=offered?'numbered':'legacy';
     if(offered)choices=offered;
    }else if(slotMode==='numbered'){await refreshSlots();}
    if(slotMode==='numbered'){
     button.hidden=true;picker.hidden=false;hint.hidden=true;note.textContent='เลือกเมืองที่ต้องการเล่น';status.textContent='';return;
    }
    client??=createClient(auth.request,owner);
    // Rejected browser-only intent cannot replace the authoritative server head.
    if(client.conflict)client.discardConflictedAttempt();
    if(client.pending)await client.retry();
    const active=await client.load();
    if(active&&!('deleted' in active)){finish(active.raw);return;}
    const emptyKey=active?`${active.cityId}:${active.revision}`:'never-created';
    if(offeredEmpty!==emptyKey){
     offeredEmpty=emptyKey;button.textContent='เริ่มเมืองใหม่';
     status.textContent=active?'เมืองเดิมถูกลบจากเมืองที่ใช้งานแล้ว เก็บสำเนาสำรองบนเซิร์ฟเวอร์ กดเริ่มเมืองใหม่เพื่อสร้างรหัสเมืองใหม่ ไม่เปิดเซฟเก่าอัตโนมัติ':'บัญชีนี้ยังไม่มีเมืองที่เซิร์ฟเวอร์ยืนยัน กดเริ่มเมืองใหม่เพื่อสร้างเมืองบนเซิร์ฟเวอร์ ไม่ใช้เซฟเก่าในเบราว์เซอร์';return;
    }
    const raw=freshServerCityRaw(owner);await client.create(raw,citySaveMetadata(raw));
    const confirmed=await client.load();if(!confirmed||'deleted' in confirmed)throw Error('เมืองใหม่ยังไม่ใช่เมืองหลัก กรุณาตรวจสถานะอีกครั้ง');finish(confirmed.raw);
   }catch(error){status.textContent=`ยังเข้าเมืองไม่ได้: ${error instanceof Error?error.message:'เชื่อมต่อไม่ได้'} · กดเล่นต่อเพื่อลองใหม่`;}
   finally{busy=false;button.disabled=false;if(slotMode==='numbered')renderSlots();void auth.prepare();}
  };
 });
}
