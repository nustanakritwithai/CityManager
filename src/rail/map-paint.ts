import { expandedCellCoordinate } from '../expanded-map-grid.ts';
/** 2D railway for the minimap and the full city map: lilac track, numbered stations, gold train. */
import {publishedRailMap} from './map-state.ts';
const SIZE=24;
const centre=(cell:number,px:number)=>{const p=expandedCellCoordinate(cell);return {x:(p.x+.5)*px,y:(p.z+.5)*px};};
export function paintRailOverlay(ctx:CanvasRenderingContext2D,cellPx:number,labels:boolean){
  const map=publishedRailMap();if(!map||(!map.links.length&&!map.stations.length))return;
  ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
  for(const [width,color] of [[cellPx*.42,'#2b2450'],[cellPx*.24,'#c3b8ff']] as const){
    ctx.lineWidth=Math.max(width,color==='#2b2450'?3:1.6);ctx.strokeStyle=color;ctx.beginPath();
    for(const [a,b] of map.links){const p=centre(a,cellPx),q=centre(b,cellPx);ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);}
    ctx.stroke();
  }
  for(const station of map.stations){
    const p=centre(station.cell,cellPx),s=Math.max(5,cellPx*.62);
    ctx.fillStyle='#f4efe2';ctx.strokeStyle='#7c6ce0';ctx.lineWidth=Math.max(1.5,cellPx*.12);
    ctx.beginPath();ctx.roundRect(p.x-s/2,p.y-s/2,s,s,s*.25);ctx.fill();ctx.stroke();
    if(labels||cellPx>=8){ctx.fillStyle='#2b2450';ctx.font=`700 ${Math.max(6,s*.62)}px "IBM Plex Sans Thai", sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(station.index),p.x,p.y+.5);}
    if(labels&&map.running){
      // Waiting riders under the numbered badge: below the station (building labels sit above their cells) and kept inside the canvas.
      const text=`รอ ${station.waiting}`,y=p.y+cellPx*.95,edge=cellPx*SIZE;
      ctx.font=`600 ${Math.max(10,cellPx*.42)}px "IBM Plex Sans Thai", sans-serif`;const half=ctx.measureText(text).width/2+3,x=Math.min(edge-half,Math.max(half,p.x));
      ctx.lineWidth=3;ctx.strokeStyle='rgba(15,25,46,.85)';ctx.strokeText(text,x,y);ctx.fillStyle='#ded8ff';ctx.fillText(text,x,y);
    }
  }
  if(map.train){
    const x=(map.train.x+.5)*cellPx,y=(map.train.z+.5)*cellPx,r=Math.max(2.5,cellPx*.26);
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle='#f4c962';ctx.fill();ctx.lineWidth=Math.max(1,cellPx*.08);ctx.strokeStyle='#2b2450';ctx.stroke();
  }
  ctx.restore();
}
