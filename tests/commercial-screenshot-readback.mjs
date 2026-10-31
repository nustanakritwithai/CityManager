// Same bounded transport policy as the reviewed built-game save fixture.
// Alternate view readback is allowed once, only on screenshot timeout after fresh health.
export async function commercialScreenshotReadback(send,probe,record,mode='surface'){
 record.mode=mode;record.health=await probe();
 try{return await send('Page.captureScreenshot',{format:'png',fromSurface:mode==='surface',captureBeyondViewport:false,optimizeForSpeed:true});}
 catch(error){
  record.primaryError=String(error);
  if(mode!=='surface'||error?.cdpTimeoutMethod!=='Page.captureScreenshot')throw error;
  record.healthAfterTimeout=await probe();record.mode='view';
  return await send('Page.captureScreenshot',{format:'png',fromSurface:false,captureBeyondViewport:false,optimizeForSpeed:true});
 }
}
