import {CityView} from '../../src/renderer.ts';
import {SceneCitizenVehicles} from '../../src/scene-citizen-vehicles.ts';
import {citizenVehiclePoses} from '../../src/citizen-vehicle-poses.ts';
import {createCitizenTransport} from '../../src/citizen-transport-runtime.ts';
import {createParkRuntime} from '../../src/park-runtime.ts';
import {advanceCitizenLife,serializeCitizenLife,deserializeCitizenLife} from '../../src/citizen-life-session.ts';
import {population2000Fixture} from '../population-capacity-fixture.ts';
import {step,serialize,summary} from '../../src/sim.ts';
async function boot(){
 const canvas=document.querySelector('canvas')!;let city=population2000Fixture();step(city);
 let parks=createParkRuntime(city),transport=createCitizenTransport(city);
 const cityBefore=serialize(city),view=await CityView.create(canvas,()=>{},()=>{},()=>{});
 view.traffic.setEnabled(false);view.setQuality('low');view.target.set(0,0,0);view.radius=65;view.updateCamera();view.render(city,null,[]);
 const vehicles=new SceneCitizenVehicles(view.app);view.app.autoRender=true;
 let running=false,frames=0,peakStepMs=0;
 const draw=()=>vehicles.sync(citizenVehiclePoses(transport.journeys,transport.queue));
 const advance=(minutes:number)=>{const start=performance.now();advanceCitizenLife(city,parks,transport,minutes,()=>step(city));peakStepMs=Math.max(peakStepMs,performance.now()-start);draw();};
 advance(420);
 view.app.on('update',()=>{if(running){advance(1);frames++;}view.app.renderNextFrame=true;});
 Object.assign(window,{citizenCityQA:{
   start:()=>{running=true;peakStepMs=0;},pause:()=>{running=false;},
   snapshot:()=>({population:summary(city).population,commuters:transport.journeys.people.length,vehicles:transport.fleet.length,
     onRoad:Object.keys(transport.queue.positions).length,queued:Object.keys(transport.queue.blocked).length,
     rendered:vehicles.diagnostics.cars,drawBatches:vehicles.diagnostics.drawBatches,frames,peakStepMs,
     unchangedEconomy:serialize(city)===cityBefore,assetsReady:!!view.assets,assetStatus:view.assets?.status,
     oldDecorativeActors:view.traffic.count,minute:parks.activity.minute}),
   roundTrip:()=>{const raw=serializeCitizenLife(city,parks,transport),restored=deserializeCitizenLife(raw);city=restored.city;parks=restored.parks;transport=restored.transport;draw();return serializeCitizenLife(city,parks,transport)===raw;},
 }});
}
boot().catch(error=>{Object.assign(window,{citizenCityError:String(error)});console.error(error);});
