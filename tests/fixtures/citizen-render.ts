import {AppBase,AppOptions,createGraphicsDevice,DEVICETYPE_WEBGL2,RenderComponentSystem,CameraComponentSystem,LightComponentSystem,Entity,Color,RESOLUTION_AUTO,FILLMODE_NONE} from 'playcanvas';
import {SceneCitizenVehicles} from '../../src/scene-citizen-vehicles.ts';
import {type CitizenVehiclePose} from '../../src/citizen-vehicle-poses.ts';
async function boot(){
 const canvas=document.querySelector('canvas')!;
 const device=await createGraphicsDevice(canvas,{deviceTypes:[DEVICETYPE_WEBGL2],antialias:true});device.maxPixelRatio=1;
 const options=new AppOptions();options.graphicsDevice=device;options.componentSystems=[RenderComponentSystem,CameraComponentSystem,LightComponentSystem];
 const app=new AppBase(canvas);app.init(options);app.setCanvasFillMode(FILLMODE_NONE);app.setCanvasResolution(RESOLUTION_AUTO);app.resizeCanvas(innerWidth,innerHeight);
 app.scene.ambientLight=new Color(.8,.8,.8);
 const camera=new Entity('QA camera');camera.addComponent('camera',{clearColor:new Color(.07,.12,.18),farClip:500,fov:50});camera.setPosition(50,95,110);camera.lookAt(0,0,0);app.root.addChild(camera);
 const renderer=new SceneCitizenVehicles(app);
 const poses:CitizenVehiclePose[]=Array.from({length:2000},(_,i)=>({vehicleId:`qa:${i}`,passengerIds:[`qa-person:${i}`],x:(i%40-19.5)*1.25,z:(Math.floor(i/40)-24.5)*1.6,headingX:0,headingZ:1,paint:i%6}));
 renderer.sync(poses);app.start();
 Object.assign(window,{citizenRendererQA:{snapshot:()=>({...renderer.diagnostics,drawCalls:app.stats.drawCalls.total}),setCount:(n:number)=>renderer.sync(poses.slice(0,n)),setEnabled:(on:boolean)=>renderer.setEnabled(on)}});
}
boot().catch(error=>{Object.assign(window,{citizenRendererError:String(error)});console.error(error);});
