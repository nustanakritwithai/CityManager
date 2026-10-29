import { paintRoadIcon } from './road-icons.ts';
import { installToolMenu } from './tool-menu.ts';
import './road-menu.css';
export type RoadMode = 'normal' | 'oneway' | 'split';
const options: readonly [RoadMode,'road'|'arrows-up'|'unlink',string][] = [
  ['normal','road','ถนนปกติ'], ['oneway','arrows-up','2 เลนวันเวย์'], ['split','unlink','ตัดทางเชื่อม'],
];
/** Portal above the unchanged dock button: not clipped by the mobile dock's horizontal scrolling. */
export function installRoadMenu(anchor: HTMLButtonElement, choose: (mode: RoadMode)=>void) {
  const menu=document.createElement('div');menu.id='road-submenu';menu.className='road-submenu';menu.setAttribute('aria-label','รูปแบบถนน');
  const popup = installToolMenu(anchor, menu);
  for(const [mode,glyph,label] of options) {
    const b=document.createElement('button');b.type='button';b.className='tool tool-option road-option';b.dataset.roadMode=mode;b.title=label;b.setAttribute('aria-label',label);b.setAttribute('aria-pressed','false');
    const icon=document.createElement('span');icon.className='tool-icon';icon.setAttribute('aria-hidden','true');paintRoadIcon(icon,glyph);
    const name=document.createElement('span');name.textContent=label;b.append(icon,name);
    b.onclick=()=>{popup.close();choose(mode);anchor.focus({preventScroll:true});};menu.append(b);
  }
  return {...popup,open:(mode:RoadMode)=>{for(const b of menu.querySelectorAll<HTMLButtonElement>('button'))b.setAttribute('aria-pressed',String(b.dataset.roadMode===mode));popup.open();}};
}
