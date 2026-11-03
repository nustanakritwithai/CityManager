/** Fit the entry gate to a touch screen even when the browser uses a wider layout viewport. */
type EntryScaleEnvironment = {
 innerWidth:number;
 screen:{width:number};
 navigator:{maxTouchPoints:number};
 matchMedia:(query:string)=>Pick<MediaQueryList,'matches'|'addEventListener'|'removeEventListener'>;
 addEventListener:(type:string, listener:()=>void)=>void;
 removeEventListener:(type:string, listener:()=>void)=>void;
 visualViewport:Pick<VisualViewport,'addEventListener'|'removeEventListener'>|null;
};
export function entryTouchScale(touch:boolean, viewportWidth:number, screenWidth:number):number {
 if(!touch||!Number.isFinite(viewportWidth)||viewportWidth<=0||!Number.isFinite(screenWidth)||screenWidth<=0)return 1;
 return Math.max(1,viewportWidth/screenWidth);
}
export function installEntryScale(gate:Pick<HTMLElement,'style'>, env:EntryScaleEnvironment):()=>void {
 const coarse=env.matchMedia('(any-pointer: coarse)');
 const update=()=>{const touch=coarse.matches||env.navigator.maxTouchPoints>0;gate.style.setProperty('--entry-unit',`${entryTouchScale(touch,env.innerWidth,env.screen.width)}px`);};
 coarse.addEventListener('change',update);env.addEventListener('resize',update);env.visualViewport?.addEventListener('resize',update);update();
 return ()=>{coarse.removeEventListener('change',update);env.removeEventListener('resize',update);env.visualViewport?.removeEventListener('resize',update);};
}
