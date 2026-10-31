import { residentialVisualHeight } from './building-visuals.ts';
export type ApartmentPart = { name: string; position: [number, number, number]; size: [number, number, number]; finish: 'wall' | 'trim' | 'rail' | 'window' | 'soil' | 'plant' | 'lamp' };
/** Purpose-built flat-roof midrises, not stacked complete house models. */
export function apartmentLayout(level: number) {
  const floors = Math.max(3, Math.min(5, level - 1));
  const height = residentialVisualHeight(level), roofY = height - .2;
  const pitch = (roofY - .1) / floors;
  const parts: ApartmentPart[] = [];
  const box = (name: string, x: number, y: number, z: number, w: number, h: number, d: number, finish: ApartmentPart['finish']) => parts.push({ name, position: [x,y,z], size: [w,h,d], finish });
  const mainX=level===6?-.24:-.12, mainWidth=level===6?.86:1.12;
  box('Apartment warm facade',mainX,roofY/2,-.2,mainWidth,roofY,.96,'wall');
  box('Apartment flat roof',mainX,roofY-.025,-.2,mainWidth+.06,.05,1.02,'trim');
  for(let floor=0;floor<floors;floor++) {
    const base=.1+floor*pitch;
    box(`Apartment floor ${floor+1}`, mainX,base,-.2,mainWidth+.03,.035,.99,'trim');
    for(const x of level===6?[-.49,-.03]:[-.43,.16]) {
      box('Apartment warm window',x,base+pitch*.52,.286,.22,pitch*.46,.018,'window');
      box('Apartment rear window',x,base+pitch*.52,-.686,.22,pitch*.46,.018,'window');
      if(floor>0) {
        box('Apartment balcony deck',x,base+.025,.41,.44,.05,.28,'trim');
        box('Apartment balcony rail',x,base+.17,.545,.44,.035,.025,'rail');
        for(const dx of [-.2,.2]) box('Apartment balcony post',x+dx,base+.1,.545,.025,.17,.025,'rail');
      }
    }
  }
  box('Apartment entrance',-.12,.27,.289,.2,.34,.02,'rail');
  box('Apartment courtyard path',0,.035,.67,1.48,.07,.24,'trim');
  for(const x of [-.61,.61]) {
    box('Apartment courtyard planter',x,.1,.65,.22,.13,.22,'soil');
    box('Apartment courtyard greenery',x,.21,.65,.18,.1,.18,'plant');
  }
  if(level>=5) {
    const wingHeight=level===6?roofY*.85:roofY*.45;
    const wingX=level===6?.47:.60, wingWidth=level===6?.60:.34;
    box('Apartment side wing',wingX,wingHeight/2,-.32,wingWidth,wingHeight,.65,'wall');
    box('Apartment side wing roof',wingX,wingHeight+.025,-.32,wingWidth+.04,.05,.69,'trim');
    for(let n=0;n<(level===6?4:2);n++) box('Apartment wing window',wingX,.3+n*(level===6?.7:.55),.014,level===6?.32:.16,.28,.018,'window');
  }
  if(level===6) {
    box('Apartment courtyard lamp post',0,.4,.74,.025,.74,.025,'rail');
    box('Apartment courtyard lamp',0,.79,.74,.1,.06,.1,'lamp');
  }
  return { floors, height, roofY, parts };
}
