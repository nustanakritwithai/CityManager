import { paintRoadIcon } from './road-icons.ts';
import { installToolMenu } from './tool-menu.ts';
import './road-menu.css';
export type RoadMode = 'normal' | 'oneway' | 'split' | 'collector' | 'arterial';
const options: readonly [RoadMode,'road'|'arrows-up'|'unlink',string,string?][] = [
  ['normal','road','ถนนปกติ'], ['oneway','arrows-up','2 เลนวันเวย์'], ['split','unlink','ตัดทางเชื่อม'],
  // Upgrades reuse the road glyph with a badge for the speed limit (km/h).
  ['collector','road','ถนนรอง','50'], ['arterial','road','ถนนหลัก','60'],
];
/** Portal above the unchanged dock button: not clipped by the mobile dock's horizontal scrolling. */
export function installRoadMenu(anchor: HTMLButtonElement, choose: (mode: RoadMode)=>void) {
  const menu=document.createElement('div');menu.id='road-submenu';menu.className='road-submenu';menu.setAttribute('aria-label','รูปแบบถนน');
  const popup = installToolMenu(anchor, menu);
  for(const [mode,glyph,label,badge] of options) {
    const b=document.createElement('button');b.type='button';b.className='tool tool-option road-option';b.dataset.roadMode=mode;b.title=label;b.setAttribute('aria-label',label);b.setAttribute('aria-pressed','false');
    const icon=document.createElement('span');icon.className='tool-icon';icon.setAttribute('aria-hidden','true');paintRoadIcon(icon,glyph);
    const name=document.createElement('span');name.textContent=label;b.append(icon);
    // A span, not a <small>: touch layouts hide a tool's <small> price line. Kept before the label, which styles as the last span.
    if(badge){const tag=document.createElement('span');tag.className='road-option-badge';tag.textContent=badge;tag.setAttribute('aria-hidden','true');b.append(tag);}
    b.append(name);
    b.onclick=()=>{popup.close();choose(mode);anchor.focus({preventScroll:true});};menu.append(b);
  }
  return {...popup,open:(mode:RoadMode)=>{for(const b of menu.querySelectorAll<HTMLButtonElement>('button'))b.setAttribute('aria-pressed',String(b.dataset.roadMode===mode));popup.open();}};
}
