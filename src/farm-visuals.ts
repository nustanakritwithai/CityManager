import type { Entity, StandardMaterial } from 'playcanvas';
import type { CropId } from './goods.ts';

export type FarmPart = { name: string; position: readonly [number, number, number]; size: readonly [number, number, number]; color: string; surface?: 'glass' | 'grow' | 'lamp' };
export const FARM_CROP_COLORS: Readonly<Record<CropId, string>> = { rice: '#d9bf54', vegetables: '#63a94c', sugarcane: '#3e9275' };
/** Renderer-only geometry. Every level stays on the same 1.68-unit soil parcel. */
export function farmVisualParts(level: number, crop: CropId, fertility = 75): FarmPart[] {
  const tier = Math.max(1, Math.min(6, Math.trunc(level))), parts: FarmPart[] = [];
  const box = (name: string, x: number, y: number, z: number, w: number, h: number, d: number, color: string, surface?: FarmPart['surface']) => parts.push({ name, position: [x,y,z], size: [w,h,d], color, ...(surface ? { surface } : {}) });
  box('Farm soil',0,.09,0,1.68,.035,1.68,'#725b3e');
  const cropHeight = (crop === 'sugarcane' ? .24 : crop === 'vegetables' ? .1 : .16) + Math.max(0,Math.min(100,fertility))*.0003;
  const rows = (cx: number, width: number, z: number, depth: number, count: number) => {
    for(let n=0;n<count;n++) {
      const x=cx-width/2+(n+.5)*width/count;
      box('Crop furrow',x,.12,z,width/count*.7,.035,depth,'#493c2e');
      box(`Renewable crop row ${crop}`,x,.15+cropHeight/2,z,width/count*.45,cropHeight,depth-.06,FARM_CROP_COLORS[crop]);
    }
  };
  if(tier<=4) {
    rows(-.24,1.04,.22,1.05,tier===1?3:5);
    const barnWidth=tier===1?.42:.54;
    box('Farm barn',.46,.32,-.47,barnWidth,.43,.46,tier===1?'#ba7657':'#b45d42');
    box('Farm barn roof',.46,.57,-.47,barnWidth+.1,.1,.56,'#657468');
    box('Farm barn door',.46,.26,-.231,.16,.28,.025,'#544c3e');
    if(tier>=2) box('Farm fence',0,.22,.8,1.55,.05,.045,'#c6b38a');
    if(tier>=3) {
      box('Irrigation channel',-.24,.15,-.38,1.06,.025,.055,'#69b7c8');
      for(const x of [-.72,.22]) box('Irrigation pipe',x,.16,.21,.025,.025,1.17,'#9caeae');
      for(let n=0;n<(tier===4?2:1);n++) {
        const z=.12+n*.46;
        box('Farm silo',.57,.39,z,.32,.53,.32,'#c4cdd0');
        box('Farm silo cap',.57,.68,z,.36,.06,.36,'#869ca3');
      }
      for(let n=0;n<(tier===4?3:2);n++) {
        const x=-.65+n*.3;
        box('Orchard trunk',x,.26,-.65,.045,.28,.045,'#816247');
        box('Orchard canopy',x,.45,-.65,.24,.26,.25,'#61914d');
      }
    }
  } else {
    const centers=tier===6?[-.4,.4]:[0], width=tier===6?.66:1.36;
    for(const cx of centers) {
      rows(cx,width-.13,.22,.89,tier===6?3:6);
      // Thin separate panes, never an opaque box: crop rows remain visible from above.
      for(const x of [cx-width/2,cx+width/2]) {
        box('Greenhouse glass wall',x,.49,.22,.012,.69,1.02,'#b2e0d7','glass');
        for(const z of [-.29,.22,.73]) box('Greenhouse frame',x,.49,z,.025,.71,.025,'#d0d6c9');
      }
      for(const z of [-.29,.73]) {
        box('Greenhouse glass end',cx,.49,z,width,.69,.012,'#b2e0d7','glass');
        box('Greenhouse roof frame',cx,.85,z,width+.025,.025,.025,'#d0d6c9');
      }
      box('Greenhouse glass roof',cx,.85,.22,width,.015,1.02,'#b2e0d7','glass');
      box('Greenhouse grow light',cx,.74,.22,.045,.025,.87,'#b566e8','grow');
    }
    // Rear service strip keeps large silos clear of the transparent growing houses.
    for(const x of tier===6?[-.45,.45]:[-.45]) {
      box('Large farm silo',x,.63,-.61,.34,1.04,.34,'#c4cdd0');
      box('Large farm silo cap',x,1.18,-.61,.38,.06,.38,'#869ca3');
    }
    if(tier===6) {
      box('Farm yard lamp pole',.78,.52,.77,.025,.8,.025,'#626d6b');
      box('Farm yard lamp',.78,.94,.77,.09,.07,.09,'#ffdb8a','lamp');
    }
  }
  return parts;
}
export type FarmVisualHost = {
  box(parent: Entity,x:number,y:number,z:number,sx:number,sy:number,sz:number,color:string|StandardMaterial,castShadows?:boolean): Entity;
  surface(kind: NonNullable<FarmPart['surface']>, active: boolean): StandardMaterial;
};
/** Shared by the production renderer and isolated browser acceptance scene. */
export function buildFarmVisual(host: FarmVisualHost, root: Entity, level: number, crop: CropId, fertility: number, active: boolean): void {
  for(const part of farmVisualParts(level,crop,fertility)) {
    const entity=host.box(root,...part.position,...part.size,part.surface?host.surface(part.surface,active):part.color,part.surface?false:part.size[1]>.12);
    entity.name=part.name;
  }
}
