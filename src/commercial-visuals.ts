/** One commercial business and level system; tiers change presentation only. */
export function commercialPresentation(level: number) {
  if (!Number.isInteger(level) || level < 1 || level > 9) throw new RangeError('Commercial level must be 1–9');
  const tier = level <= 3 ? 'market' : level <= 6 ? 'building' : 'mall';
  const title = tier === 'market' ? 'ตลาด' : tier === 'building' ? 'อาคารพาณิชย์' : 'Big Mall';
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
    const height=.68+(level-1)*.1;
    add('Market rear wall',0,height/2+.14,-.35,1.35,height,.42,cream);
    add('Broad market canopy',0,height+.22,-.03,1.62,.13,1.22,roof);
    for(const x of [-.66,.66])add('Canopy post',x,(height+.03)/2+.14,.48,.07,height+.03,.07,trim);
    for(let n=0;n<level+1;n++){
      const x=-.5+n/(level)*1;
      add('Sales counter',x,.27,.52,.26,.26,.31,'#997c58');
      add('Counter awning stripe',x,height+.295,.39,.2,.035,.3,accent);
    }
    if(level>=2)add('Covered market clerestory',0,height+.4,-.22,1.05,.23,.5,glass,true);
    if(level===3)add('Raised market roof',0,height+.56,-.22,1.2,.09,.64,roof);
    add('Market sign',0,height+.22,.59,.46,.16,.035,accent);
    add('Market service light',0,height+.15,.5,.65,.035,.035,glass,true);
  }else if(level<=6){
    const floors=level-2, floorHeight=.5, height=floors*floorHeight;
    add('Commercial building body',0,height/2+.14,-.1,1.43,height,1.27,cream);
    for(let floor=0;floor<floors;floor++){
      const y=.39+floor*floorHeight;
      add('Storefront glazing',0,y,.545,1.16,.28,.028,glass,true);
      add('Side glazing',.728,y,-.13,.028,.28,.8,glass,true);
      add('Horizontal floor cornice',0,y+.2,-.1,1.5,.065,1.34,trim);
    }
    add('Storefront awning',0,.71,.65,1.57,.1,.32,accent);
    add('Entrance door',0,.34,.568,.25,.38,.035,glass,true);
    add('Flat commercial roof',0,height+.2,-.1,1.54,.12,1.39,roof);
    add('Rooftop service room',-.35,height+.38,-.3,.45,.25,.43,cream);
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
