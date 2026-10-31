/** App-scoped, explicitly disposable night glow; no lights, listeners or timers. */
type GlowMaterial={emissiveIntensity:number;update():void};
type State={night:number;materials:Set<GlowMaterial>};
const states=new WeakMap<object,State>();
function state(app:object):State{let s=states.get(app);if(!s){s={night:0,materials:new Set()};states.set(app,s);}return s;}
export function registerVehicleGlow(app:object,material:GlowMaterial):()=>void {
 const s=state(app);s.materials.add(material);material.emissiveIntensity=s.night*2.2;material.update();
 return ()=>{s.materials.delete(material);};
}
export function updateVehicleGlow(app:object,night:number):void {
 const s=state(app);s.night=Math.max(0,Math.min(1,night));
 for(const m of s.materials){m.emissiveIntensity=s.night*2.2;m.update();}
}
export function vehicleGlowCount(app:object):number{return states.get(app)?.materials.size??0;}
