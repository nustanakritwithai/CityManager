export type SlotEntry={cityId:string;slot:number;revision:number;deleted:boolean;metadata:{name:string;population:number;tick:number};updatedAt?:string};
type SlotActions={list:()=>Promise<SlotEntry[]>; play:(entry:SlotEntry)=>Promise<void>; create:(slot:number)=>Promise<void>; importLocal:(slot:number)=>Promise<void>; remove:(entry:SlotEntry)=>Promise<void>; restore:(entry:SlotEntry,slot:number)=>Promise<void>};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function validateSlotList(input:unknown):SlotEntry[]{
 if(!Array.isArray(input))throw Error('Invalid server save list');
 const active=new Set<number>(),ids=new Set<string>();
 for(const row of input){
  if(!row||typeof row!=='object'||!UUID.test(row.cityId)||!Number.isInteger(row.slot)||row.slot<1||row.slot>3||!Number.isSafeInteger(row.revision)||row.revision<1||typeof row.deleted!=='boolean'||!row.metadata||typeof row.metadata.name!=='string'||row.metadata.name.length>120||!Number.isSafeInteger(row.metadata.population)||row.metadata.population<0||!Number.isSafeInteger(row.metadata.tick)||row.metadata.tick<0||ids.has(row.cityId)||(!row.deleted&&active.has(row.slot)))throw Error('Invalid server save list');
  ids.add(row.cityId);if(!row.deleted)active.add(row.slot);
 }
 return input as SlotEntry[];
}
/** An explicit picker: only the supplied actions can write or load a city. */
export function createCitySlotPicker(root:HTMLElement, actions:SlotActions, confirmDelete:(entry:SlotEntry)=>boolean) {
 const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const body=document.createElement('div');root.replaceChildren(status,body);
 let busy=false,loaded=false,entries:SlotEntry[]=[];
 function button(text:string,action:()=>Promise<void>){const b=document.createElement('button');b.type='button';b.textContent=text;b.disabled=busy;b.addEventListener('click',()=>{if(busy)return;void run(action);});return b;}
 async function run(action:()=>Promise<void>){busy=true;render();status.textContent='กำลังดำเนินการ…';try{await action();status.textContent='';}catch(e){loaded=false;status.textContent=e instanceof Error?e.message:'เกิดข้อผิดพลาด ข้อมูลเดิมยังอยู่';}finally{busy=false;render();}}
 async function refresh(){loaded=false;entries=validateSlotList(await actions.list());loaded=true;}
 function render(){
  body.replaceChildren();if(!loaded){body.append(button('ลองเชื่อมต่ออีกครั้ง',refresh));return;}const active=new Map(entries.filter(e=>!e.deleted).map(e=>[e.slot,e]));
  for(let slot=1;slot<=3;slot++){
   const section=document.createElement('section');section.setAttribute('aria-label',`ช่องเซฟ ${slot}`);const heading=document.createElement('h2');heading.textContent=`ช่องเซฟ ${slot}`;section.append(heading);
   const city=active.get(slot);
   if(city){const info=document.createElement('p');info.textContent=`${city.metadata.name} · ประชากร ${city.metadata.population} · วัน ${city.metadata.tick}${city.updatedAt?` · ${city.updatedAt}`:''}`;section.append(info,button('เล่น',()=>actions.play(city)),button('ลบ',async()=>{if(!confirmDelete(city))return;await actions.remove(city);await refresh();}));}
   else {const text=document.createElement('p');text.textContent='ช่องว่าง';section.append(text,button('สร้างเมืองใหม่',async()=>{await actions.create(slot);await refresh();}),button('นำเข้าเซฟในเครื่อง',async()=>{await actions.importLocal(slot);await refresh();}));}
   body.append(section);
  }
  const deleted=entries.filter(e=>e.deleted);if(deleted.length){const section=document.createElement('section'),heading=document.createElement('h2');heading.textContent='เซฟที่ลบแล้ว';section.append(heading);for(const city of deleted){const line=document.createElement('div'),name=document.createElement('span');name.textContent=`${city.metadata.name} · วัน ${city.metadata.tick}`;line.append(name);for(let slot=1;slot<=3;slot++)if(!active.has(slot))line.append(button(`กู้คืนในช่อง ${slot}`,async()=>{await actions.restore(city,slot);await refresh();}));section.append(line);}body.append(section);}
 }
 return {async open(){await run(async()=>{await refresh();});},refresh:()=>run(refresh)};
}
