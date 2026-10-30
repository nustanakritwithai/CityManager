import {CityView} from '../renderer.ts';
import {installToolMenu} from '../tool-menu.ts';
import '../tool-menu.css';
import '../grouped-tool-menu.css';
import './preview.css';
import {RailPreviewRuntime} from './preview-runtime.ts';
import {SceneRail} from './scene.ts';
import {railStationRows,railTrainPose} from './presentation.ts';

const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const host=new RailPreviewRuntime();let paused=true,speed=1/1440;
let saved:ReturnType<RailPreviewRuntime['capture']>|undefined;
let mode:'select'|'remove'|'repair'='select',start:number|null=null;
let pending:{from:number;to:number;remove:boolean}|null=null;
let armedConfirmation:HTMLElement|null=null;
const message=(text:string)=>{$('feedback').textContent=text;};
const view=await CityView.create($<HTMLCanvasElement>('city-canvas'),cell=>{
  if(!$('rail-panel').hidden||pending)return;
  if(mode==='select'){view.render(host.city,cell,[]);return;}
  if(start===null){start=cell;view.render(host.city,cell,[]);message('เลือกปลายอีกด้านของช่วงรางที่ติดกัน');return;}
  const from=start;start=null;
  if(Math.abs(from-cell)!==1||Math.floor(from/24)!==Math.floor(cell/24)||from<245||from>255||cell<245||cell>255){message('เลือกช่วงรางที่ติดกันระหว่างสถานี A และ B');return;}
  pending={from,to:cell,remove:mode==='remove'};view.abortGesture();view.cameraBlocked=true;
  $('confirmation-text').textContent=`${mode==='remove'?'ถอด':'คืน'}ช่วงราง ${from} ↔ ${cell} ? ต้องไม่มีรถวิ่งหรือผู้โดยสารบนรถ`;
  $('confirmation').hidden=false;$('confirm').focus();
},()=>{},()=>{});
function centerRail(){view.focus(250);view.radius=Math.max(39,26/(innerWidth/innerHeight));view.updateCamera();}
view.traffic.setEnabled(false);view.render(host.city,null,[]);centerRail();
const scene=new SceneRail(view);
function panel(open:boolean){view.abortGesture();$('rail-panel').hidden=!open;view.cameraBlocked=open||!!pending;if(open)mode='select';start=null;}
function clearConfirmation(){pending=null;armedConfirmation=null;start=null;$('confirmation').hidden=true;view.abortGesture();view.cameraBlocked=!$('rail-panel').hidden;}
const menu=document.createElement('div');menu.id='rail-submenu';menu.className='grouped-tool-submenu';
const popup=installToolMenu($<HTMLButtonElement>('transport-tool'),menu,true);
for(const [action,label] of [['manage','จัดการสาย'],['remove','ถอดช่วงราง'],['repair','คืนช่วงราง']] as const){
  const button=document.createElement('button');button.type='button';button.className='tool-option';button.dataset.railTool=action;button.textContent=label;
  button.onclick=()=>{popup.close();clearConfirmation();panel(action==='manage');mode=action==='manage'?'select':action;message(action==='manage'?'ข้อมูลบริการและคิวจริงในเมืองทดสอบ':'แตะรางสองช่องที่ติดกัน แล้วตรวจและยืนยัน');};menu.append(button);
}
$('transport-tool').onclick=()=>{if(popup.isOpen())popup.close();else popup.open();};
function cancel(){view.abortGesture();if(popup.isOpen()){popup.close(true);return;}if(pending){clearConfirmation();message('ยกเลิกแล้ว รางยังเหมือนเดิม');return;}if(!$('rail-panel').hidden){panel(false);return;}start=null;mode='select';view.render(host.city,null,[]);message('กลับสู่การเลื่อนแผนที่');}
$('cancel-tool').onclick=cancel;$('close-panel').onclick=()=>panel(false);
// A map pointerup may synthesize a compatibility click after opening this dialog.
// Require a NEW press on its button; the original map gesture cannot confirm/cancel.
function confirmationAction(id:string,action:()=>void){const button=$(id);
  button.addEventListener('pointerdown',()=>{armedConfirmation=button;});
  button.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')armedConfirmation=button;});
  button.addEventListener('pointercancel',()=>{armedConfirmation=null;});
  button.onclick=()=>{if(armedConfirmation!==button)return;armedConfirmation=null;action();};
}
document.addEventListener('pointerdown',event=>{if(event.target!==armedConfirmation)armedConfirmation=null;},true);
confirmationAction('cancel-confirm',()=>{clearConfirmation();message('ยกเลิกแล้ว รางยังเหมือนเดิม');});
confirmationAction('confirm',()=>{const command=pending;if(!command)return;clearConfirmation();try{host.editTrack(command.from,command.to,command.remove);message(command.remove?'ถอดรางแล้ว คิวยังคงอยู่':'คืนรางแล้ว บริการเดินต่อได้');view.render(host.city,null,[]);}catch(error){message(error instanceof Error?error.message:'แก้รางไม่ได้');}render();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();cancel();}});
window.addEventListener('blur',()=>{view.abortGesture();if(pending)clearConfirmation();start=null;});
window.addEventListener('resize',()=>{view.abortGesture();if(pending)clearConfirmation();start=null;centerRail();});
$('camera-home').onclick=centerRail;
$('pause').onclick=()=>{paused=!paused;render();};
$<HTMLSelectElement>('speed').onchange=event=>{speed=Number((event.target as HTMLSelectElement).value);};
$('toggle-service').onclick=()=>{host.toggleService();render();};
$('add-trip').onclick=()=>{try{message(host.offerTrip(291,305,24)?'รับผู้โดยสารทดลอง 24 คน เริ่มเดินไปสถานี':'เดินถึงสถานีไม่ได้ ผู้โดยสารยังอยู่ในคิวต้นทาง');}catch(error){message(String(error));}render();};
$('add-inaccessible').onclick=()=>{host.offerTrip(0,575,10);message('จุดนี้เดินไม่ถึงสถานี · 10 คนยังไม่ถูกโอนเข้ารถไฟ');render();};
$('capture').onclick=()=>{try{saved=host.capture();$<HTMLButtonElement>('restore').disabled=false;message('เก็บทั้งเมืองและสถานะรถไฟไว้ในหน่วยความจำแล้ว');}catch(error){message(String(error));}};
$('restore').onclick=()=>{if(!saved)return;try{host.restore(saved);paused=true;clearConfirmation();view.render(host.city,null,[]);message('กู้คืนคิว รถ และนาฬิกาตรงสถานะที่เก็บไว้แล้ว');render();}catch(error){message(String(error));}};
const stepButton=document.createElement('button');stepButton.id='step-ten';stepButton.textContent='เดิน 10 นาทีทดลอง';stepButton.onclick=()=>{paused=true;host.advance(10);render();};$('add-trip').after(stepButton);
const metricKeys=[['waiting','รอบนชานชาลา'],['outside','รอนอกสถานี'],['onboard','บนรถ / 8 ที่'],['egress','เดินถึงปลายทาง'],['completed','เดินทางสำเร็จ'],['roadAssignable','ยังไม่รับเข้ารถไฟ']] as const;
const metricValues=new Map<string,HTMLElement>();
for(const [key,label] of metricKeys){const card=document.createElement('div');card.className='metric';const value=document.createElement('strong');value.dataset.railMetric=key;value.textContent='0';const caption=document.createElement('span');caption.textContent=label;card.append(value,caption);$('rail-metrics').append(card);metricValues.set(key,value);}
const stationElements=new Map<string,{text:HTMLElement;button:HTMLButtonElement}>();
for(const station of host.config.stations){const row=document.createElement('div');row.className='station-row';const copy=document.createElement('div'),name=document.createElement('strong'),text=document.createElement('p'),button=document.createElement('button');name.textContent=`สถานี ${station.id.toUpperCase()}`;copy.append(name,text);button.id=`station-${station.id}`;button.onclick=()=>{host.toggleStation(station.id);render();};row.append(copy,button);$('station-rows').append(row);stationElements.set(station.id,{text,button});}
const labels:Record<string,string>={'moving':'รถกำลังเดินทาง','at-station':'รถจอดที่สถานี','paused-service':'พักบริการ · ส่งผู้โดยสารที่อยู่บนรถต่อ','station-closed':'มีสถานีปิด · คิวยังคงอยู่','disconnected':'รางขาด · คิวยังคงอยู่'};
function render(){
  const state=host.rail.snapshot,d=host.diagnostics(),minute=state.minute%1440;
  $('clock').textContent=`วัน ${Math.floor(state.minute/1440)} · ${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
  $('pause').textContent=paused?'เดินเวลา':'หยุดเวลา';$('pause').setAttribute('aria-pressed',String(!paused));
  $('service-status').textContent=labels[d.status];$('toggle-service').textContent=state.enabled?'พักบริการ':'เปิดบริการ';
  for(const [key] of metricKeys)metricValues.get(key)!.textContent=String(d[key]);
  for(const row of railStationRows(host.config,state)){const e=stationElements.get(row.id)!;e.text.textContent=`รอ ${row.waiting}/${row.queueCapacity} · กำลังเดินมา ${row.access} · คิวนอก ${row.outside}`;e.button.textContent=row.open?'ปิดสถานี':'เปิดสถานี';e.button.setAttribute('aria-pressed',String(row.open));}
  scene.sync(host.config,host.graph,state,host.parks.minuteRemainder);
}
view.app.on('update',(dt:number)=>{
  if(paused||document.hidden)return;
  try{const deadline=performance.now()+8;host.advance(Math.min(dt,.25)*speed*1440,false,()=>performance.now()<deadline);render();}
  catch(error){paused=true;message(String(error));console.error(error);}
});
panel(false);render();
Object.defineProperty(window,'railPreview',{value:{diagnostics:()=>({...host.diagnostics(),...scene.diagnostics,paused,speed,mode,pending:!!pending}),
  snapshot:()=>host.rail.snapshot,pose:()=>railTrainPose(host.config,host.graph,host.rail.snapshot,host.parks.minuteRemainder),
  citySnapshot:()=>host.capture().binding.cityRaw,cellScreen:(cell:number)=>view.project(cell),graph:()=>structuredClone(host.graph)}});
