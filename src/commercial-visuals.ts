export type CommercialTier = 'shop' | 'market' | 'mall';
export const COMMERCIAL_TIERS: readonly CommercialTier[] = Object.freeze(['shop', 'market', 'mall']);
/** One commercial business and level system: a shop at levels 1–3, a market at 4–6 and a mall at 7–9. */
export function commercialPresentation(level: number) {
  if (!Number.isInteger(level) || level < 1 || level > 9) throw new RangeError('Commercial level must be 1–9');
  const tier: CommercialTier = level <= 3 ? 'shop' : level <= 6 ? 'market' : 'mall';
  const title = tier === 'shop' ? 'ร้านค้า' : tier === 'market' ? 'ตลาด' : 'ห้าง';
  return {tier, title, label:`${title} · ระดับ ${level}/9`};
}
export type CommercialPart = {name:string;x:number;y:number;z:number;width:number;height:number;depth:number;color:string;window?:boolean};
/** Small, static, single-parcel buildings. All colors are shared by the renderer's material cache. */
export function commercialVisualPlan(level: number) {
  const presentation = commercialPresentation(level), parts:CommercialPart[]=[];
  const add=(name:string,x:number,y:number,z:number,width:number,height:number,depth:number,color:string,window=false)=>parts.push({name,x,y,z,width,height,depth,color,...(window?{window:true}:{})});
  const cream='#d8d6c5', trim='#567f82', roof='#a65f43', glass='#648590', accent='#719255';
  add('Paved commercial forecourt',0,.1,0,1.7,.08,1.7,'#b8b8a9');
  if(level<=3){
    // A shophouse: an open shop front under an awning with goods set out in front, one more floor each level.
    const ground=.5, upper=.28, height=ground+(level-1)*upper, z=-.14, front=z+.5, roofTop=.14+height+.09;
    add('Shop body',0,.14+height/2,z,1.3,height,1,cream);
    add('Shop roof',0,.14+height+.045,z,1.4,.09,1.1,roof);
    add('Open shop front',0,.32,front+.014,.9,.32,.028,glass,true);
    for(const x of [-.55,.55])add('Shop front pillar',x,.14+ground/2,front+.02,.1,ground,.04,trim);
    add('Shop awning',0,.5,front+.15,1.36,.05,.3,accent);
    add('Shop sign',0,.58,front+.018,.7,.1,.035,accent);
    for(let n=0;n<level+1;n++)add('Display crate',-.45+n*.9/level,.2,.68,.2,.12,.2,'#997c58');
    for(let floor=1;floor<level;floor++)add('Upper floor window',0,.14+ground+(floor-1)*upper+upper/2,front+.014,.95,.14,.028,glass,true);
    if(level===3){
      add('Balcony rail',0,.14+ground+.03,front+.06,1.2,.06,.12,trim);
      add('Rooftop water tank',.38,roofTop+.09,z-.24,.22,.18,.22,'#c9c4b0');
    }
  }else if(level<=6){
    // A covered market hall: more stalls and a higher roof each level.
    const hall=level-3, height=1.16+(hall-1)*.12;
    add('Market rear wall',0,height/2+.14,-.35,1.35,height,.42,cream);
    add('Broad market canopy',0,height+.22,-.03,1.62,.13,1.22,roof);
    for(const x of [-.66,.66])add('Canopy post',x,(height+.03)/2+.14,.48,.07,height+.03,.07,trim);
    for(let n=0;n<hall+2;n++){
      const x=-.5+n/(hall+1);
      add('Sales counter',x,.27,.52,.22,.26,.31,'#997c58');
      add('Counter awning stripe',x,height+.295,.39,.18,.035,.3,accent);
    }
    if(hall>=2)add('Covered market clerestory',0,height+.4,-.22,1.05,.23,.5,glass,true);
    if(hall===3)add('Raised market roof',0,height+.56,-.22,1.2,.09,.64,roof);
    add('Market sign',0,height+.22,.59,.46,.16,.035,accent);
    add('Market service light',0,height+.15,.5,.65,.035,.035,glass,true);
  }else{
    const tier=level-6, height=2.3+tier*.22;
    add('Wide mall podium',0,.52,0,1.64,.76,1.55,cream);
    add('Mall storefront band',0,.5,.79,1.43,.4,.025,glass,true);
    add('Mall side storefront',.835,.5,-.04,.025,.4,1.25,glass,true);
    for(const x of [-.51,.51]){
      add('Stepped mall wing',x,height/2+.46,-.12,.54,height-.84,1.18,cream);
      add('Wing upper glazing',x,1.2,.485,.43,.28,.026,glass,true);
      add('Upper mall gallery glazing',x,height-.22,.485,.43,.28,.026,glass,true);
      add('Wing roof terrace',x,height+.08,-.12,.61,.08,1.26,trim);
    }
    add('Central mall atrium',0,height/2+.2,-.12,.5,height,1.23,glass,true);
    add('Atrium skylight',0,height+.24,-.12,.66,.1,1.35,trim);
    add('Broad entrance canopy',0,.98,.65,1.68,.11,.35,accent);
    add('Mall sign backing',0,1.17,.8,.67,.27,.045,trim);
    // A compact M silhouette, not a flashing billboard or a generic office spire.
    for(const x of [-.21,.21])add('Mall M upright',x,1.18,.83,.065,.2,.025,'#eadbb0');
    for(const x of [-.1,.1])add('Mall M shoulder',x,1.22,.83,.12,.065,.025,'#eadbb0');
    add('Mall M centre',0,1.15,.83,.07,.1,.025,'#eadbb0');
    if(tier>=2)for(const x of [-.65,.65])add('Terrace planter',x,height+.195,-.47,.2,.15,.25,accent);
    if(tier===3)add('Upper mall pavilion',0,height+.42,-.4,.38,.27,.48,cream);
  }
  return {...presentation,level,parts,height:Math.max(...parts.map(p=>p.y+p.height/2))};
}
