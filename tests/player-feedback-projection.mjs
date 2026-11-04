// Resize updates the camera before PlayCanvas invalidates its cached view matrix
// at prerender. Read after complete animation frames, then require identical
// viewport/canvas geometry and parcel projection before issuing one native tap.
export async function settleFeedbackProjection({read,afterRender,timeout=15000,now=Date.now}){
 const deadline=now()+timeout;let previous=await read(),frames=0;
 while(now()<deadline){
  await afterRender();const current=await read();frames++;
  if(frames>=2&&JSON.stringify(current)===JSON.stringify(previous))return current;
  previous=current;
 }
 throw Error('Cell projection did not stabilize after rendered frames');
}
