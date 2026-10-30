import type {City} from '../sim.ts';
import type {ParkRuntime} from '../park-runtime.ts';
import type {CityView} from '../renderer.ts';
import {installToolMenu} from '../tool-menu.ts';
import {RailNetworkRuntime} from './network-runtime.ts';
import {railStationRows} from './presentation.ts';
import {SceneRail} from './scene.ts';
import './management.css';

export type RailManagementOptions={view:CityView;city:()=>City;runtime:()=>ParkRuntime;selectTool:()=>void;changed:()=>void;status:(message:string)=>void;enabled:boolean};
type Mode='select'|'station'|'remove-station'|'remove-track';
type Pending={rail:RailNetworkRuntime|undefined;city:City;runtime:ParkRuntime;infrastructure:string|undefined;run:()=>void};
const element=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{const node=document.createElement(tag);node.textContent=text;return node;};

/** UI consumes authoritative rail state. It never creates passenger demand or advances time. */
export function installRailManagement(options:RailManagementOptions){
  const {view}=options,scene=new SceneRail(view);
  const anchor=element('button');anchor.id='rail-tool';anchor.type='button';anchor.className='tool';anchor.title='รถไฟโดยสาร';
  const icon=element('span','▣');icon.className='tool-icon';icon.setAttribute('aria-hidden','true');anchor.append(icon,element('span','รถไฟ'));
  document.querySelector('.tool-buttons')?.append(anchor);
  const menu=element('div');menu.id='rail-management-submenu';menu.className='grouped-tool-submenu';const popup=installToolMenu(anchor,menu,true);
  const panel=element('dialog');panel.id='rail-management';panel.className='rail-management';panel.setAttribute('aria-labelledby','rail-management-title');
  const heading=element('div');heading.className='rail-management-heading';const title=element('h2','รถไฟโดยสาร');title.id='rail-management-title';
  const closeButton=element('button','×');closeButton.type='button';closeButton.setAttribute('aria-label','ปิดหน้าจัดการรถไฟ');heading.append(title,closeButton);
  const serviceText=element('p'),metrics=element('div'),stations=element('div'),actions=element('div'),note=element('p','การเปิดสายใหม่และเพิ่มระดับยังต้องกำหนดความจุ เวลา และค่าใช้จ่ายก่อน ไม่คิดค่าโดยสารในขณะนี้');
  metrics.className='rail-management-metrics';actions.className='rail-management-actions';note.className='rail-management-note';
  const feedback=element('p');feedback.className='rail-management-feedback';feedback.setAttribute('role','status');
  panel.append(heading,serviceText,metrics,stations,actions,note,feedback);document.body.append(panel);
  const confirm=element('dialog');confirm.id='rail-management-confirm';confirm.className='rail-management rail-management-confirm';confirm.setAttribute('aria-labelledby','rail-confirm-title');
  const confirmTitle=element('h2','ยืนยันแผนรถไฟ');confirmTitle.id='rail-confirm-title';const confirmText=element('p'),confirmActions=element('div');confirmActions.className='rail-management-actions';
  const back=element('button','ยกเลิก'),accept=element('button','ยืนยัน');back.type=accept.type='button';back.id='rail-confirm-cancel';accept.id='rail-confirm-accept';confirmActions.append(back,accept);confirm.append(confirmTitle,confirmText,confirmActions);document.body.append(confirm);
  let mode:Mode='select',start:number|null=null,pending:Pending|null=null,armed:HTMLButtonElement|null=null,heldCamera:boolean|null=null;
  let activeRuntime=options.runtime(),activeCity=options.city();
  let pointer:{id:number;x:number;y:number}|null=null;
  const buttons=new Map<string,HTMLButtonElement>(),metricValues=new Map<string,HTMLElement>();
  const infrastructure=(rail:RailNetworkRuntime|undefined)=>{const state=rail?.snapshot;return state?JSON.stringify([state.cityId,state.epoch,state.stations,state.graph,state.service?.config]):undefined;};
  const report=(message:string)=>{feedback.textContent=message;options.status(message);};
  const hasOtherOverlay=()=>document.querySelector('#inspector[data-open="true"],dialog[open]:not(#rail-management):not(#rail-management-confirm)')!==null;
  const holdCamera=()=>{if(heldCamera===null)heldCamera=view.cameraBlocked;view.abortGesture();view.cameraBlocked=true;};
  const releaseCamera=()=>{if(panel.open||confirm.open)return;if(heldCamera!==null){view.cameraBlocked=heldCamera||hasOtherOverlay();heldCamera=null;}};
  const clearConfirmation=()=>{pending=null;armed=null;start=null;if(confirm.open)confirm.close();view.abortGesture();releaseCamera();};
  const closePanel=()=>{if(panel.open)panel.close();view.abortGesture();releaseCamera();};
  const clearMode=()=>{mode='select';start=null;pointer=null;anchor.classList.remove('active');anchor.setAttribute('aria-pressed','false');};
  function close(){popup.close();clearConfirmation();closePanel();clearMode();}
  function run(change:()=>void){try{change();options.changed();sync();}catch(error){
    const message=error instanceof Error?error.message:'';
    const labels:Record<string,string>={'Rail corridor is occupied':'ยังถอดรางไม่ได้ มีรถกำลังวิ่งหรือผู้โดยสารอยู่บนรถ','Rail needs an empty reserved parcel; crossings are not configured':'เลือกช่องว่างที่ไม่มีถนนหรืออาคาร ยังไม่รองรับทางตัด','This shuttle supports two distinct stations':'แผนนี้รับสถานีสองแห่งที่ไม่ซ้ำกัน','Remove the idle line before removing a station':'ถอดสายที่ว่างก่อนถอนแผนสถานี','Retained journeys require an authoritative retirement receipt':'ยังถอดสายไม่ได้ มีรายการเดินทางที่ต้องเก็บรักษาไว้','Unknown station':'ไม่พบสถานีนี้แล้ว','No shuttle line':'ยังไม่มีสายรถไฟ','Track segment not found':'ไม่พบช่วงรางนี้แล้ว'};
    report(labels[message]??'ยังแก้ไขรถไฟไม่ได้ กรุณาตรวจสถานะเมืองแล้วลองใหม่');
  }}
  function ask(message:string,change:()=>void){
    const rail=options.runtime().rail;pending={rail,city:options.city(),runtime:options.runtime(),infrastructure:infrastructure(rail),run:change};armed=null;start=null;
    closePanel();holdCamera();confirmText.textContent=message;confirm.showModal();back.focus();
  }
  function confirmAction(button:HTMLButtonElement,action:()=>void){
    button.addEventListener('pointerdown',()=>{armed=button;});button.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')armed=button;});button.addEventListener('pointercancel',()=>{armed=null;});
    button.addEventListener('click',()=>{if(armed!==button)return;armed=null;action();});
  }
  confirmAction(back,()=>{clearConfirmation();report('ยกเลิกแล้ว ข้อมูลรถไฟยังเหมือนเดิม');});
  confirmAction(accept,()=>{const command=pending;if(!command)return;clearConfirmation();
    if(command.city!==options.city()||command.runtime!==options.runtime()||command.rail!==options.runtime().rail||command.infrastructure!==infrastructure(options.runtime().rail)){report('สถานะเมืองเปลี่ยนแล้ว กรุณาเลือกคำสั่งใหม่');return;}
    run(command.run);
  });
  const clearArmed=(event:PointerEvent)=>{if(event.target!==armed)armed=null;};document.addEventListener('pointerdown',clearArmed,true);
  function choose(next:Mode){close();options.selectTool();mode=next;anchor.classList.toggle('active',next!=='select');anchor.setAttribute('aria-pressed',String(next!=='select'));
    report(next==='station'?'แตะช่องว่างเพื่อวางแผนสถานี ยังไม่คิดเงินและยังไม่เปิดบริการ':next==='remove-station'?'แตะสถานีที่ต้องการถอนแผน':next==='remove-track'?'แตะปลายรางสองช่องที่ติดกัน แล้วตรวจและยืนยัน':'เลือกเครื่องมือรถไฟ');
  }
  function openPanel(){close();options.selectTool();sync();holdCamera();panel.showModal();closeButton.focus();}
  const menuButton=(key:string,label:string,action:()=>void)=>{const button=element('button',label);button.type='button';button.className='tool-option';button.dataset.railAction=key;button.onclick=action;menu.append(button);buttons.set(key,button);return button;};
  menuButton('manage','จัดการรถไฟ',openPanel);menuButton('station','แผนสถานี',()=>choose('station'));menuButton('remove-station','ถอนแผนสถานี',()=>choose('remove-station'));menuButton('remove-track','ถอดช่วงราง',()=>choose('remove-track'));
  const addTrack=menuButton('add-track','เพิ่มราง — รอตั้งค่า',()=>{});addTrack.disabled=true;
  const serviceButton=element('button');serviceButton.type='button';serviceButton.id='rail-service-toggle';serviceButton.onclick=()=>{const rail=options.runtime().rail,state=rail?.snapshot.service;if(rail&&state)run(()=>{rail.setServiceEnabled(!state.snapshot.enabled);report(state.snapshot.enabled?'พักรับผู้โดยสารใหม่ และส่งผู้ที่อยู่บนรถต่อ':'เปิดบริการเดิมแล้ว');});};
  const removeLine=element('button','ถอดสายที่ว่าง');removeLine.type='button';removeLine.id='rail-remove-line';removeLine.onclick=()=>{const rail=options.runtime().rail;if(rail)ask('ถอดสายรถไฟนี้? ต้องไม่มีผู้โดยสารหรือรายการเดินทางค้างอยู่',()=>{rail.removeService();report('ถอดสายรถไฟที่ว่างแล้ว');});};
  const configure=element('button','เปิดสายใหม่ — รอตั้งค่า'),upgrade=element('button','เพิ่มระดับ — รอตั้งค่า');configure.type=upgrade.type='button';configure.disabled=upgrade.disabled=true;actions.append(serviceButton,removeLine,configure,upgrade);
  for(const [key,label] of [['waiting','รอบนชานชาลา'],['outside','เดินมา / รอนอก'],['onboard','อยู่บนรถ'],['egress','เดินถึงปลายทาง'],['completed','เดินทางสำเร็จ'],['seats','ที่นั่ง']] as const){const card=element('div');card.className='rail-management-metric';const value=element('strong','0');value.dataset.railMetric=key;card.append(value,element('span',label));metrics.append(card);metricValues.set(key,value);}
  let stationSignature='';const stationElements=new Map<string,{text:HTMLElement;button:HTMLButtonElement}>();
  function sync(){
    const runtime=options.runtime(),city=options.city();if(runtime!==activeRuntime||city!==activeCity){close();activeRuntime=runtime;activeCity=city;stationSignature='';}
    const state=runtime.rail?.snapshot,service=state?.service;anchor.hidden=!options.enabled&&!state;
    buttons.get('station')!.disabled=!options.enabled||!!service||(state?.stations.length??0)>=2;
    buttons.get('remove-station')!.disabled=!state?.stations.length||!!service;
    buttons.get('remove-track')!.disabled=!state?.graph.links.length;
    serviceButton.hidden=removeLine.hidden=!service;
    serviceButton.textContent=service?.snapshot.enabled?'พักบริการ':'เปิดบริการเดิม';serviceButton.setAttribute('aria-pressed',String(!!service?.snapshot.enabled));
    const totals={waiting:0,outside:0,onboard:0,egress:0,completed:0,seats:service?.config.seats??0};
    for(const batch of service?.snapshot.batches??[]){totals.waiting+=batch.waiting;totals.outside+=batch.outside;totals.onboard+=batch.onboard;totals.egress+=batch.egress.reduce((sum,e)=>sum+e.persons,0);totals.completed+=batch.completed;}
    for(const [key,value] of Object.entries(totals))metricValues.get(key)!.textContent=String(value);
    serviceText.textContent=service?(service.snapshot.enabled?'บริการเดิมพร้อมเดินรถ':'พักรับผู้โดยสารใหม่ ผู้โดยสารที่ค้างยังอยู่ในระบบ'):`แผนสถานี ${state?.stations.length??0}/2 แห่ง — ยังไม่เปิดบริการ`;
    const signature=JSON.stringify([state?.stations??[],!!service]);
    if(stationSignature!==signature){stationSignature=signature;stations.replaceChildren();stationElements.clear();
      for(const [index,site] of (state?.stations??[]).entries()){const row=element('div');row.className='rail-management-station';const copy=element('div'),text=element('p'),button=element('button');button.type='button';button.dataset.railStation=site.id;copy.append(element('h3',`สถานี ${index+1}`),text);row.append(copy,button);stations.append(row);stationElements.set(site.id,{text,button});
        button.onclick=()=>{const rail=options.runtime().rail,latest=rail?.snapshot;if(!rail||!latest)return;if(latest.service){const open=latest.service.snapshot.openStations[site.id];run(()=>{rail.setStationOpen(site.id,!open);report(open?'ปิดรับที่สถานีแล้ว ผู้โดยสารที่ค้างยังอยู่ในระบบ':'เปิดสถานีแล้ว');});}else ask('ถอนแผนสถานีนี้? ยังไม่มีบริการหรือผู้โดยสารในแผนนี้',()=>{rail.removeStation(site.id);report('ถอนแผนสถานีแล้ว');});};
      }
    }
    const rows=service?railStationRows(service.config,service.snapshot):[];
    for(const site of state?.stations??[]){const ui=stationElements.get(site.id)!,row=rows.find(r=>r.id===site.id);ui.text.textContent=row?`รอ ${row.waiting}/${row.queueCapacity} · เดินมา ${row.access} · รอนอก ${row.outside}`:`ช่อง ${site.cell} · แผนยังไม่เปิดบริการ`;ui.button.textContent=row?(row.open?'ปิดสถานี':'เปิดสถานี'):'ถอนแผน';ui.button.setAttribute('aria-pressed',String(!!row?.open));}
    scene.syncNetwork(state,runtime.minuteRemainder);
  }
  function activate(cell:number):boolean{
    if(panel.open||confirm.open)return true;if(mode==='select')return false;
    const runtime=options.runtime(),rail=runtime.rail;
    if(mode==='station'){
      if(!options.enabled){report('ยังไม่เปิดวางแผนรถไฟ');return true;}
      ask('วางแผนสถานีตรงนี้? แผนนี้ยังไม่คิดเงินและยังไม่เปิดบริการ',()=>{
        const planned=runtime.rail??RailNetworkRuntime.create(options.city(),crypto.randomUUID(),options.city().tick*1440+runtime.activity.minute);
        planned.addStation(crypto.randomUUID(),cell);runtime.rail=planned;report('วางแผนสถานีแล้ว ยังไม่เปิดบริการ');
      });return true;
    }
    if(!rail){clearMode();return true;}
    if(mode==='remove-station'){const station=rail.snapshot.stations.find(s=>s.cell===cell);if(!station){report('แตะสถานีที่ต้องการถอนแผน');return true;}ask('ถอนแผนสถานีนี้?',()=>{rail.removeStation(station.id);report('ถอนแผนสถานีแล้ว');});return true;}
    if(start===null){start=cell;report('แตะปลายรางอีกด้านที่ติดกัน');return true;}
    const from=start;start=null;if(!rail.snapshot.graph.links.some(link=>link.from===from&&link.to===cell)){report('เลือกสองช่องที่มีช่วงรางเชื่อมถึงกัน');return true;}
    ask('ถอดช่วงรางนี้? ถ้ามีรถกำลังวิ่งหรือผู้โดยสารบนรถ จะยังถอดไม่ได้',()=>{rail.editTrack(from,cell,true);report('ถอดช่วงรางแล้ว ผู้โดยสารที่รอยังอยู่ในระบบ');});return true;
  }
  function cancel():boolean{if(popup.isOpen()){popup.close(true);return true;}if(pending){clearConfirmation();return true;}if(panel.open){closePanel();return true;}if(mode!=='select'||start!==null){clearMode();view.abortGesture();report('กลับสู่เครื่องมือเลือก');return true;}return false;}
  anchor.onclick=()=>{if(popup.isOpen())popup.close();else{options.selectTool();sync();popup.open();}};closeButton.onclick=closePanel;
  panel.addEventListener('cancel',event=>{event.preventDefault();closePanel();});confirm.addEventListener('cancel',event=>{event.preventDefault();clearConfirmation();});
  panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closePanel();}});
  confirm.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();clearConfirmation();}});
  const interrupted=()=>{start=null;pointer=null;clearConfirmation();view.abortGesture();};
  const canvas=document.querySelector<HTMLCanvasElement>('#city-canvas');
  const pointerDown=(event:PointerEvent)=>{pointer={id:event.pointerId,x:event.clientX,y:event.clientY};};
  const pointerMove=(event:PointerEvent)=>{if(pointer?.id===event.pointerId&&Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>8)start=null;};
  const pointerUp=()=>{pointer=null;};
  canvas?.addEventListener('pointerdown',pointerDown);canvas?.addEventListener('pointermove',pointerMove);canvas?.addEventListener('pointerup',pointerUp);canvas?.addEventListener('pointercancel',interrupted);
  window.addEventListener('blur',interrupted);window.addEventListener('resize',interrupted);
  sync();
  return {activate,cancel,sync,close,isReserved:(cell:number)=>options.runtime().rail?.isReserved(cell)??false,diagnostics:()=>({...scene.diagnostics,mode,pending:!!pending,start,panelOpen:panel.open}),destroy:()=>{close();scene.destroy();anchor.remove();menu.remove();panel.remove();confirm.remove();document.removeEventListener('pointerdown',clearArmed,true);canvas?.removeEventListener('pointerdown',pointerDown);canvas?.removeEventListener('pointermove',pointerMove);canvas?.removeEventListener('pointerup',pointerUp);canvas?.removeEventListener('pointercancel',interrupted);window.removeEventListener('blur',interrupted);window.removeEventListener('resize',interrupted);}};
}
