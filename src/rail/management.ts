import { formatCellCoordinate } from '../expanded-map-geometry.ts';
import { expandedCellCoordinate, expandedCellPath } from '../expanded-map-grid.ts';
import type {City} from '../sim.ts';
import type {ParkRuntime} from '../park-runtime.ts';
import type {CityView} from '../renderer.ts';
import {installToolMenu} from '../tool-menu.ts';
import {iconElement} from '../ui-icons.ts';
import {GAME_RAIL_POLICY,GAME_RAIL_TRACK_MINUTES,RailNetworkRuntime} from './network-runtime.ts';
import {railStationRows,railTrainPose} from './presentation.ts';
import {SceneRail} from './scene.ts';
import {publishRailMap,uniqueRuns} from './map-state.ts';
import './management.css';

export type RailManagementOptions={view:CityView;city:()=>City;runtime:()=>ParkRuntime;selectTool:()=>void;changed:()=>void;status:(message:string)=>void;enabled:boolean;
  /** Redraw the map frames only; never a city change (see `changed`). */
  repaint?:()=>void};
type Mode='select'|'station'|'add-track'|'remove-station'|'remove-track';
type Pending={rail:RailNetworkRuntime|undefined;city:City;runtime:ParkRuntime;infrastructure:string|undefined;run:()=>void;cells:number[]};
type Ask={title:string;icon:string;detail?:string;cells?:number[];tone?:'danger'};
const SIZE=24;
/** Player-facing "column,row" like the place panel, never the internal cell index. */
export const cellLabel=(cell:number)=>`(${formatCellCoordinate(cell)})`;
/** Cells from `a` to `b` along one row or column, or just the two ends when they are not aligned. */
export function straight(a:number,b:number):number[]{
  const x=expandedCellCoordinate(a),y=expandedCellCoordinate(b);if(a===b)return [a];if(x.x!==y.x&&x.z!==y.z)return [a,b];return expandedCellPath(a,b);
}
const connected=(links:readonly {from:number;to:number}[],a:number,b:number)=>{const seen=new Set([a]),queue=[a];while(queue.length){const at=queue.shift()!;if(at===b)return true;for(const l of links)if(l.from===at&&!seen.has(l.to)){seen.add(l.to);queue.push(l.to);}}return false;};
const element=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{const node=document.createElement(tag);node.textContent=text;return node;};

/** UI consumes authoritative rail state. It never creates passenger demand or advances time. */
export function installRailManagement(options:RailManagementOptions){
  const {view}=options,scene=new SceneRail(view);
  const anchor=element('button');anchor.id='rail-tool';anchor.type='button';anchor.className='tool';anchor.title='รถไฟโดยสาร';
  const icon=iconElement('train','tool-icon svg-glyph');icon.setAttribute('aria-hidden','true');anchor.append(icon,element('span','รถไฟ'));
  document.querySelector('.tool-buttons')?.append(anchor);
  const menu=element('div');menu.id='rail-management-submenu';menu.className='grouped-tool-submenu rail-submenu';menu.setAttribute('aria-label','รถไฟ: วางสถานี เชื่อมราง จัดการ ถอดราง ถอนสถานี');const popup=installToolMenu(anchor,menu,true,'row');
  const panel=element('dialog');panel.id='rail-management';panel.className='rail-management';panel.setAttribute('aria-labelledby','rail-management-title');
  const heading=element('div');heading.className='rail-management-heading';const headingIcon=iconElement('train','rail-management-mark svg-glyph');
  const headingCopy=element('div'),title=element('h2','รถไฟโดยสาร');title.id='rail-management-title';const serviceText=element('p');serviceText.className='rail-management-state';headingCopy.append(title,serviceText);
  const closeButton=element('button','×');closeButton.type='button';closeButton.setAttribute('aria-label','ปิดหน้าจัดการรถไฟ');heading.append(headingIcon,headingCopy,closeButton);
  // Line diagram: two station nodes, the track between them and the train's place on it.
  const line=element('div');line.className='rail-line';line.setAttribute('aria-hidden','true');
  const lineEnds=[0,1].map(()=>{const end=element('div');end.className='rail-line-end';const dot=element('i'),name=element('strong'),where=element('small');end.append(dot,name,where);return {end,name,where};});
  const lineTrack=element('div');lineTrack.className='rail-line-track';const lineTrain=iconElement('train','rail-line-train svg-glyph');lineTrack.append(lineTrain);
  line.append(lineEnds[0].end,lineTrack,lineEnds[1].end);
  // Before the line opens: the three build steps instead of a block of rules.
  const steps=element('ol');steps.className='rail-steps';
  const stepItems=['วางสถานี 2 แห่ง','เชื่อมรางให้ถึงกัน','เปิดสายรถไฟ'].map(label=>{const item=element('li'),text=element('span',label),count=element('small');item.append(text,count);steps.append(item);return {item,count};});
  const metrics=element('div'),more=element('details'),moreSummary=element('summary','ผู้โดยสารเพิ่มเติม'),moreMetrics=element('div'),stations=element('div'),actions=element('div');
  const note=element('p',`รถ 1 ขบวน ${GAME_RAIL_POLICY.seats} ที่นั่ง · ${GAME_RAIL_TRACK_MINUTES} นาทีเกมต่อช่วงราง · ก่อสร้างและบริการฟรี · ผู้โดยสารจำลองตามความหนาแน่น ยังไม่ลดรถบนถนน`);
  metrics.className='rail-management-metrics';more.className='rail-management-more';moreMetrics.className='rail-management-metrics rail-management-metrics-minor';more.append(moreSummary,moreMetrics);
  stations.className='rail-management-stations';actions.className='rail-management-actions';note.className='rail-management-note';
  const feedback=element('p');feedback.className='rail-management-feedback';feedback.setAttribute('role','status');
  panel.append(heading,line,steps,metrics,more,stations,actions,note,feedback);document.body.append(panel);
  const confirm=element('dialog');confirm.id='rail-management-confirm';confirm.className='rail-management rail-management-confirm';confirm.setAttribute('aria-labelledby','rail-confirm-title');
  const confirmHead=element('div');confirmHead.className='rail-confirm-head';const confirmIcon=iconElement('rail-station','rail-management-mark svg-glyph');
  const confirmTitle=element('h2','ยืนยันแผนรถไฟ');confirmTitle.id='rail-confirm-title';confirmHead.append(confirmIcon,confirmTitle);
  const confirmText=element('p'),confirmDetail=element('p'),confirmActions=element('div');confirmDetail.className='rail-confirm-detail';confirmActions.className='rail-management-actions';
  const back=element('button','ยกเลิก'),accept=element('button','ยืนยัน');back.type=accept.type='button';back.id='rail-confirm-cancel';accept.id='rail-confirm-accept';confirmActions.append(back,accept);confirm.append(confirmHead,confirmText,confirmDetail,confirmActions);document.body.append(confirm);
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
    const labels:Record<string,string>={'Initial rail line needs a legal round trip':'เชื่อมรางให้ถึงสถานีทั้งสองก่อนเปิดสาย','V1 rail supports at most 96 track segments':'รางครบขีดจำกัดของระบบรอบนี้แล้ว','Choose two different cells in one straight row or column':'เลือกต้นทางและปลายทางในแถวหรือแนวเดียวกัน','Rail corridor is occupied':'ยังถอดรางไม่ได้ มีรถกำลังวิ่งหรือผู้โดยสารบนรถ · ไปที่จัดการรถไฟ หยุดรับผู้โดยสารใหม่ เปิดสถานีทั้งสองแห่ง แล้วเปิดบริการและกดเล่นให้ส่งผู้โดยสารจนหมดก่อนถอดราง','Rail needs an empty reserved parcel; crossings are not configured':'เลือกช่องว่างที่ไม่มีถนนหรืออาคาร ยังไม่รองรับทางตัด','This shuttle supports two distinct stations':'แผนนี้รับสถานีสองแห่งที่ไม่ซ้ำกัน','Remove the idle line before removing a station':'ถอดสายที่ว่างก่อนถอนแผนสถานี','Retained journeys require an authoritative retirement receipt':'ยังถอดสายไม่ได้ มีรายการเดินทางที่ต้องเก็บรักษาไว้','Unknown station':'ไม่พบสถานีนี้แล้ว','No shuttle line':'ยังไม่มีสายรถไฟ','Track segment not found':'ไม่พบช่วงรางนี้แล้ว'};
    report(labels[message]??'ยังแก้ไขรถไฟไม่ได้ กรุณาตรวจสถานะเมืองแล้วลองใหม่');
  }}
  function ask(message:string,change:()=>void,look:Ask={title:'ยืนยันแผนรถไฟ',icon:'train'}){
    const rail=options.runtime().rail;pending={rail,city:options.city(),runtime:options.runtime(),infrastructure:infrastructure(rail),run:change,cells:look.cells??[]};armed=null;start=null;
    closePanel();holdCamera();confirmTitle.textContent=look.title;confirmIcon.innerHTML=iconElement(look.icon).innerHTML;confirmText.textContent=message;
    confirmDetail.textContent=look.detail??'';confirmDetail.hidden=!look.detail;confirm.dataset.tone=look.tone??'';accept.textContent=look.tone==='danger'?'ยืนยันถอด':'ยืนยัน';
    confirm.showModal();back.focus();options.repaint?.();
  }
  function confirmAction(button:HTMLButtonElement,action:()=>void){
    button.addEventListener('pointerdown',()=>{armed=button;});button.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')armed=button;});button.addEventListener('pointercancel',()=>{armed=null;});
    button.addEventListener('click',()=>{if(armed!==button)return;armed=null;action();});
  }
  confirmAction(back,()=>{clearConfirmation();report('ยกเลิกแล้ว ข้อมูลรถไฟยังเหมือนเดิม');options.repaint?.();});
  confirmAction(accept,()=>{const command=pending;if(!command)return;clearConfirmation();
    if(command.city!==options.city()||command.runtime!==options.runtime()||command.rail!==options.runtime().rail||command.infrastructure!==infrastructure(options.runtime().rail)){report('สถานะเมืองเปลี่ยนแล้ว กรุณาเลือกคำสั่งใหม่');return;}
    run(command.run);
  });
  const clearArmed=(event:PointerEvent)=>{if(event.target!==armed)armed=null;};document.addEventListener('pointerdown',clearArmed,true);
  function choose(next:Mode){close();options.selectTool();mode=next;anchor.classList.toggle('active',next!=='select');anchor.setAttribute('aria-pressed',String(next!=='select'));
    report(next==='station'?'แตะช่องว่างเพื่อวางสถานี · ต้องมีถนนใกล้สถานีเพื่อรับผู้โดยสาร · ไม่มีค่าก่อสร้าง':next==='add-track'?'แตะต้นทาง แล้วแตะปลายทางแนวตรงเพื่อเชื่อมราง · ไม่ข้ามถนนหรืออาคาร':next==='remove-station'?'แตะสถานีที่ต้องการถอนแผน':next==='remove-track'?'แตะต้นทางและปลายทางของรางแนวตรงที่จะถอด แล้วตรวจและยืนยัน':'เลือกเครื่องมือรถไฟ');
  }
  function openPanel(){close();options.selectTool();sync();holdCamera();panel.showModal();closeButton.focus();}
  // One short word under an icon, like the build and service menus; the full name stays in the title and aria-label.
  const menuButton=(key:string,icon:string,label:string,name:string,action:()=>void)=>{const button=element('button');button.type='button';button.className='tool tool-option';button.dataset.railAction=key;button.title=name;button.setAttribute('aria-label',name);button.append(iconElement(icon,'tool-icon svg-glyph'),element('span',label));button.onclick=action;menu.append(button);buttons.set(key,button);return button;};
  menuButton('station','rail-station','สถานี','วางสถานี',()=>choose('station'));
  const addTrack=menuButton('add-track','rail-track','ราง','เชื่อมราง',()=>choose('add-track'));
  menuButton('manage','gear','จัดการ','จัดการรถไฟ',openPanel);
  menuButton('remove-track','rail-cut','ถอดราง','ถอดช่วงราง',()=>choose('remove-track'));menuButton('remove-station','rail-unplan','ถอนสถานี','ถอนแผนสถานี',()=>choose('remove-station'));
  const serviceButton=element('button');serviceButton.type='button';serviceButton.id='rail-service-toggle';serviceButton.onclick=()=>{const rail=options.runtime().rail,state=rail?.snapshot.service;if(rail&&state)run(()=>{rail.setServiceEnabled(!state.snapshot.enabled);report(state.snapshot.enabled?'พักบริการ ไม่รับขึ้นรถเพิ่ม ผู้โดยสารที่ค้างยังอยู่ในระบบ':'เปิดบริการเดิมแล้ว');});};
  const accepting=element('button');accepting.id='rail-model-accepting';accepting.type='button';accepting.onclick=()=>{const rail=options.runtime().rail,model=rail?.snapshot.model;if(rail&&model)run(()=>{rail.setModelAccepting(!model.accepting);report(model.accepting?'หยุดเพิ่มผู้โดยสารใหม่แล้ว · เปิดบริการไว้ให้รถส่งผู้โดยสารเดิมจนหมดก่อนถอดสาย':'รับผู้โดยสารจำลองใหม่แล้ว');});};
  const removeLine=element('button','ถอดสายที่ว่าง');removeLine.type='button';removeLine.id='rail-remove-line';removeLine.className='rail-danger';removeLine.onclick=()=>{const rail=options.runtime().rail;if(rail)ask('ถอดสายรถไฟนี้? ต้องไม่มีผู้โดยสารหรือรายการเดินทางค้างอยู่',()=>{rail.removeService();report('ถอดสายรถไฟที่ว่างแล้ว');},{title:'ถอดสายรถไฟ',icon:'rail-cut',tone:'danger'});};
  const configure=element('button','เปิดสายรถไฟ');configure.id='rail-configure-service';configure.type='button';configure.className='rail-primary';configure.onclick=()=>{const rail=options.runtime().rail;if(rail)ask('เปิดรถรับส่งระหว่าง 2 สถานี?',()=>{rail.configureGameService();report('เปิดสายรถไฟแล้ว · กดเล่นต่อเพื่อให้รถเดินและจำลองผู้โดยสาร');},{title:'เปิดสายรถไฟ',icon:'train',detail:`รถ ${GAME_RAIL_POLICY.seats} ที่นั่ง · ${GAME_RAIL_TRACK_MINUTES} นาทีเกมต่อช่วงราง · ไม่มีค่าใช้จ่าย`,cells:rail.snapshot.stations.map(s=>s.cell)});};actions.append(serviceButton,accepting,removeLine,configure);
  for(const [key,label,host] of [['waiting','รอบนชานชาลา',metrics],['onboard','อยู่บนรถ',metrics],['completed','เดินทางสำเร็จ',metrics],['outside','เดินมา / รอนอก',moreMetrics],['egress','เดินถึงปลายทาง',moreMetrics],['seats','ที่นั่ง',moreMetrics]] as const){const card=element('div');card.className='rail-management-metric';const value=element('strong','0');value.dataset.railMetric=key;card.append(value,element('span',label));host.append(card);metricValues.set(key,value);}
  let stationSignature='';const stationElements=new Map<string,{text:HTMLElement;button:HTMLButtonElement}>();
  function sync(){
    const runtime=options.runtime(),city=options.city();if(runtime!==activeRuntime||city!==activeCity){close();activeRuntime=runtime;activeCity=city;stationSignature='';scene.invalidateInfrastructure();}
    const state=runtime.rail?.snapshot,service=state?.service;anchor.hidden=!options.enabled&&!state;
    buttons.get('station')!.disabled=!options.enabled||!!service||(state?.stations.length??0)>=2;
    buttons.get('remove-station')!.disabled=!state?.stations.length||!!service;
    buttons.get('remove-track')!.disabled=!state?.graph.links.length;
    addTrack.disabled=!options.enabled||!state;configure.disabled=!!service||state?.stations.length!==2;configure.hidden=!!service;
    serviceButton.hidden=removeLine.hidden=!service;accepting.hidden=!service||!state?.model;accepting.textContent=state?.model?.accepting?'หยุดรับผู้โดยสารใหม่':'รับผู้โดยสารใหม่';accepting.setAttribute('aria-pressed',String(!!state?.model?.accepting));
    serviceButton.textContent=service?.snapshot.enabled?'พักบริการ':'เปิดบริการเดิม';serviceButton.setAttribute('aria-pressed',String(!!service?.snapshot.enabled));
    const totals={waiting:0,outside:0,onboard:0,egress:0,completed:state?.model?.retiredPersons??0,seats:service?.config.seats??0};
    for(const batch of service?.snapshot.batches??[]){totals.waiting+=batch.waiting;totals.outside+=batch.outside;totals.onboard+=batch.onboard;totals.egress+=batch.egress.reduce((sum,e)=>sum+e.persons,0);totals.completed+=batch.completed;}
    for(const [key,value] of Object.entries(totals))metricValues.get(key)!.textContent=String(value);
    serviceText.textContent=service?(service.snapshot.enabled?'เปิดบริการ · รถเดินตามตาราง':'พักรับผู้โดยสารใหม่ · ผู้โดยสารที่ค้างยังอยู่ในระบบ'):'ยังไม่เปิดบริการ';
    panel.dataset.service=service?(service.snapshot.enabled?'running':'paused'):'planning';
    const sites=state?.stations??[],segments=(state?.graph.links.length??0)/2,joined=sites.length===2&&connected(state!.graph.links,sites[0].cell,sites[1].cell);
    lineEnds.forEach((end,index)=>{const site=sites[index];end.name.textContent=`สถานี ${index+1}`;end.where.textContent=site?cellLabel(site.cell):'ยังไม่วาง';end.end.dataset.placed=String(!!site);});
    line.dataset.track=joined?'joined':segments?'partial':'none';lineTrain.hidden=!service;
    if(service){const train=service.snapshot.train,from=sites.findIndex(s=>s.id===train.station);let at=from<=0?0:1;
      if(train.destination){const total=train.path.slice(1).reduce((sum,to,i)=>sum+(state!.graph.links.find(l=>l.from===train.path[i]&&l.to===to)?.minutes??0),0),done=total?1-train.remainingMinutes/total:0;at=from<=0?done:1-done;}
      lineTrain.style?.setProperty('--at',String(Math.max(0,Math.min(1,at))));lineTrain.dataset.moving=String(!!train.destination);}
    steps.hidden=!!service;const done=[sites.length>=2,joined,!!service];
    stepItems.forEach((step,index)=>{step.item.dataset.done=String(done[index]);step.item.dataset.current=String(!done[index]&&done.slice(0,index).every(Boolean));});
    stepItems[0].count.textContent=`${sites.length}/2`;stepItems[1].count.textContent=segments?`${segments} ช่วง`:'';stepItems[2].count.textContent='';
    metrics.hidden=more.hidden=!service;
    const signature=JSON.stringify([state?.stations??[],!!service]);
    if(stationSignature!==signature){stationSignature=signature;stations.replaceChildren();stationElements.clear();
      for(const [index,site] of (state?.stations??[]).entries()){const row=element('div');row.className='rail-management-station';const copy=element('div'),text=element('p'),button=element('button');button.type='button';button.dataset.railStation=site.id;copy.append(element('h3',`สถานี ${index+1}`),text);row.dataset.index=String(index+1);row.append(copy,button);stations.append(row);stationElements.set(site.id,{text,button});
        button.onclick=()=>{const rail=options.runtime().rail,latest=rail?.snapshot;if(!rail||!latest)return;if(latest.service){const open=latest.service.snapshot.openStations[site.id];run(()=>{rail.setStationOpen(site.id,!open);report(open?'ปิดรับที่สถานีแล้ว ผู้โดยสารที่ค้างยังอยู่ในระบบ':'เปิดสถานีแล้ว');});}else ask('ถอนแผนสถานีนี้? ยังไม่มีบริการหรือผู้โดยสารในแผนนี้',()=>{rail.removeStation(site.id);report('ถอนแผนสถานีแล้ว');},{title:`ถอนแผนสถานี ${index+1}`,icon:'rail-unplan',detail:`ตำแหน่ง ${cellLabel(site.cell)}`,cells:[site.cell],tone:'danger'});};
      }
    }
    const rows=service?railStationRows(service.config,service.snapshot):[];
    for(const site of state?.stations??[]){const ui=stationElements.get(site.id)!,row=rows.find(r=>r.id===site.id);ui.text.textContent=row?`${cellLabel(site.cell)} · รอ ${row.waiting}/${row.queueCapacity} · เดินมา ${row.access} · รอนอก ${row.outside}`:`${cellLabel(site.cell)} · แผนยังไม่เปิดบริการ`;ui.button.textContent=row?(row.open?'ปิดสถานี':'เปิดสถานี'):'ถอนแผน';ui.button.setAttribute('aria-pressed',String(!!row?.open));}
    let train=null;if(service){try{const pose=railTrainPose(service.config,state!.graph,service.snapshot,runtime.minuteRemainder);train={x:pose.x,z:pose.z,moving:pose.moving};}catch{train=null;}}
    publishRailMap(state?{links:uniqueRuns(state.graph.links),stations:sites.map((site,index)=>({cell:site.cell,index:index+1,waiting:rows.find(r=>r.id===site.id)?.waiting??0})),train,running:!!service?.snapshot.enabled}:null);
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
      },{title:`วางสถานี ${(rail?.snapshot.stations.length??0)+1}`,icon:'rail-station',detail:`ตำแหน่ง ${cellLabel(cell)}`,cells:[cell]});return true;
    }
    if(!rail){clearMode();return true;}
    if(mode==='remove-station'){const station=rail.snapshot.stations.find(s=>s.cell===cell);if(!station){report('แตะสถานีที่ต้องการถอนแผน');return true;}ask('ถอนแผนสถานีนี้?',()=>{rail.removeStation(station.id);report('ถอนแผนสถานีแล้ว');},{title:'ถอนแผนสถานี',icon:'rail-unplan',detail:`ตำแหน่ง ${cellLabel(cell)}`,cells:[cell],tone:'danger'});return true;}
    if(start===null){start=cell;report(mode==='add-track'?'เลือกต้นทางแล้ว · แตะปลายทางในแถวหรือแนวเดียวกัน':'เลือกต้นทางแล้ว · แตะปลายรางในแถวหรือแนวเดียวกัน');return true;}
    const from=start;start=null;
    if(mode==='add-track'){const cells=straight(from,cell);ask('เชื่อมรางแนวตรงระหว่างสองจุดนี้? ทุกช่องต้องว่าง ไม่มีถนนหรืออาคาร · ไม่มีค่าใช้จ่าย',()=>{rail.addTrackPath(from,cell);report('เชื่อมรางแล้ว · เชื่อมต่อจนถึงสถานีอีกแห่ง แล้วเปิดสายจากจัดการรถไฟ');},{title:'เชื่อมราง',icon:'rail-track',detail:cells.length>1?`ราง ${cells.length-1} ช่วง · ${cellLabel(from)} → ${cellLabel(cell)}`:`${cellLabel(from)} → ${cellLabel(cell)} · ต้องอยู่แถวหรือแนวเดียวกัน`,cells:cells.length>1?cells:[from,cell]});return true;}
    const cells=straight(from,cell),a=expandedCellCoordinate(from),b=expandedCellCoordinate(cell),links=rail.snapshot.graph.links;
    if(from===cell||a.x!==b.x&&a.z!==b.z||!cells.slice(1).every((to,i)=>links.some(link=>link.from===cells[i]&&link.to===to||link.from===to&&link.to===cells[i]))){report('เลือกต้นทางและปลายทางที่มีรางต่อเนื่องในแถวหรือแนวเดียวกัน');return true;}
    ask('ถอดรางที่เลือก? สถานีจะยังอยู่ ถ้ามีรถกำลังวิ่งหรือผู้โดยสารบนรถ จะยังถอดไม่ได้',()=>{rail.removeTrackPath(from,cell);report('ถอดรางที่เลือกแล้ว ผู้โดยสารที่รอยังอยู่ในระบบ');},{title:'ถอดช่วงราง',icon:'rail-cut',detail:`ราง ${cells.length-1} ช่วง · ${cellLabel(from)} → ${cellLabel(cell)}`,cells,tone:'danger'});return true;
  }
  /** Route the ordinary demolition gesture to the same confirmed rail commands. */
  function demolish(cell:number):boolean{
    const rail=options.runtime().rail;if(!rail?.isReserved(cell))return false;
    const state=rail.snapshot,station=state.stations.find(s=>s.cell===cell);
    close();
    if(station){
      if(state.service){openPanel();report('หยุดรับผู้โดยสารใหม่ เปิดสถานีทั้งสองแห่ง เปิดบริการและกดเล่นให้ส่งผู้โดยสารจนหมด แล้วถอดสายที่ว่างก่อนถอนสถานี');return true;}
      ask('ถอนแผนสถานีนี้? รางที่เชื่อมอยู่จะยังอยู่',()=>{rail.removeStation(station.id);report('ถอนแผนสถานีแล้ว');},{title:'ถอนแผนสถานี',icon:'rail-unplan',detail:`ตำแหน่ง ${cellLabel(cell)}`,cells:[cell],tone:'danger'});return true;
    }
    const cells=[...new Set(state.graph.links.filter(l=>l.from===cell||l.to===cell).flatMap(l=>[l.from,l.to]))];
    ask('ถอดรางทุกช่วงที่ติดกับช่องนี้? สถานีจะยังอยู่ ถ้ามีรถกำลังวิ่งหรือผู้โดยสารบนรถ จะยังถอดไม่ได้',()=>{rail.removeTracksAt(cell);report('ถอดรางในช่องที่เลือกแล้ว ผู้โดยสารที่รอยังอยู่ในระบบ');},{title:'ถอดรางในช่องนี้',icon:'rail-cut',detail:`ตำแหน่ง ${cellLabel(cell)} · ราง ${cells.length-1} ช่วง`,cells,tone:'danger'});return true;
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
  /** Frames for the map: the cells under the open confirmation, else the cell or straight run the next tap would use. */
  function preview(hover:number|null):{cells:number[];invalid:number[]}|null{
    if(pending)return {cells:pending.cells,invalid:[]};if(mode==='select')return null;
    const cells=start!==null?(hover===null?[start]:straight(start,hover)):hover===null?[]:[hover];
    const blocked=(cell:number)=>{const c=options.city().cells[cell];return !c||c.road||!!c.zone;};
    return {cells,invalid:mode==='add-track'||mode==='station'?cells.filter(blocked):[]};
  }
  /** What the place panel shows for a rail cell: the station or track on it, its line state and a way to the manager. */
  function placeCard(cell:number){
    const state=options.runtime().rail?.snapshot;if(!state)return null;
    const index=state.stations.findIndex(s=>s.cell===cell),track=state.graph.links.some(l=>l.from===cell||l.to===cell);if(index<0&&!track)return null;
    const service=state.service,row=service&&index>=0?railStationRows(service.config,service.snapshot).find(r=>r.id===state.stations[index].id):undefined;
    const card=element('div');card.className='rail-place-card';
    const facts=element('div');facts.className='rail-place-facts';
    const fact=(value:string,label:string)=>{const item=element('div');item.append(element('strong',value),element('span',label));facts.append(item);};
    if(row){fact(String(row.waiting),'รอบนชานชาลา');fact(String(row.access+row.outside),'กำลังเดินมา');fact(row.open?'เปิด':'ปิด','สถานี');}
    else fact(service?(service.snapshot.enabled?'เปิด':'พัก'):'ยังไม่เปิด','สายรถไฟ');
    const open=element('button','จัดการรถไฟ');open.type='button';open.className='rail-primary';open.dataset.railOpen='manage';open.onclick=openPanel;
    card.append(facts,open);
    if(index<0){const remove=element('button','ถอดรางในช่องนี้');remove.type='button';remove.className='rail-danger';remove.dataset.railRemove=String(cell);remove.onclick=()=>{options.selectTool();demolish(cell);};card.append(remove);}
    const title=index>=0?`สถานีรถไฟ ${index+1}`:'รางรถไฟ';
    const subtitle=index>=0?(service?(row?.open?'เปิดรับผู้โดยสาร':'ปิดรับผู้โดยสาร'):'แผนสถานี · ยังไม่เปิดบริการ'):(service?'เส้นทางของสายที่เปิดอยู่':'แผนราง · ยังไม่เปิดบริการ');
    return {title,subtitle,card};
  }
  return {activate,demolish,cancel,sync,close,preview,placeCard,isReserved:(cell:number)=>options.runtime().rail?.isReserved(cell)??false,diagnostics:()=>({...scene.diagnostics,mode,pending:!!pending,start,panelOpen:panel.open}),destroy:()=>{close();scene.destroy();anchor.remove();menu.remove();panel.remove();confirm.remove();document.removeEventListener('pointerdown',clearArmed,true);canvas?.removeEventListener('pointerdown',pointerDown);canvas?.removeEventListener('pointermove',pointerMove);canvas?.removeEventListener('pointerup',pointerUp);canvas?.removeEventListener('pointercancel',interrupted);window.removeEventListener('blur',interrupted);window.removeEventListener('resize',interrupted);}};
}
