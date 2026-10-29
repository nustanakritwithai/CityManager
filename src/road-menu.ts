import './road-menu.css';
export type RoadMode = 'normal' | 'parallel' | 'oneway' | 'join' | 'split';
const options: readonly [RoadMode,string,string][] = [
  ['normal','↔','สองทาง'], ['parallel','═','คู่ขนาน'], ['oneway','⇈','2 เลนวันเวย์'], ['join','╋','เชื่อมแยก'], ['split','╎','แยกทาง'],
];
/** Portal above the unchanged dock button: not clipped by the mobile dock's horizontal scrolling. */
export function installRoadMenu(anchor: HTMLButtonElement, choose: (mode: RoadMode)=>void) {
  const menu=document.createElement('div');menu.id='road-submenu';menu.className='road-submenu';menu.hidden=true;menu.setAttribute('role','group');menu.setAttribute('aria-label','รูปแบบถนน');
  anchor.setAttribute('aria-controls',menu.id);anchor.setAttribute('aria-expanded','false');
  const position=()=>{if(menu.hidden)return;const r=anchor.getBoundingClientRect();menu.style.left=`${r.left}px`;menu.style.bottom=`${innerHeight-r.top+6}px`;menu.style.width=`${r.width}px`;menu.style.setProperty('--road-button-height',`${r.height}px`);for(const b of menu.querySelectorAll<HTMLButtonElement>('button')){b.style.width=`${r.width}px`;b.style.height=b.style.minHeight=`${r.height}px`;b.style.minWidth='0';}};
  const close=()=>{menu.hidden=true;anchor.setAttribute('aria-expanded','false');};
  for(const [mode,glyph,label] of options) {
    const b=document.createElement('button');b.type='button';b.className='tool road-option';b.dataset.roadMode=mode;b.title=label;b.setAttribute('aria-label',label);b.setAttribute('aria-pressed','false');
    const icon=document.createElement('span');icon.className='tool-icon';icon.setAttribute('aria-hidden','true');icon.textContent=glyph;
    const name=document.createElement('span');name.textContent=label;b.append(icon,name);
    b.onclick=()=>{close();choose(mode);anchor.focus({preventScroll:true});};menu.append(b);
  }
  document.body.append(menu);
  document.addEventListener('pointerdown',e=>{if(!menu.hidden&&!menu.contains(e.target as Node)&&!anchor.contains(e.target as Node))close();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!menu.hidden){close();anchor.focus({preventScroll:true});}});
  window.addEventListener('resize',position);window.addEventListener('scroll',position,true);
  return {close,isOpen:()=>!menu.hidden,open:(mode:RoadMode)=>{for(const b of menu.querySelectorAll<HTMLButtonElement>('button'))b.setAttribute('aria-pressed',String(b.dataset.roadMode===mode));menu.hidden=false;anchor.setAttribute('aria-expanded','true');position();}};
}
