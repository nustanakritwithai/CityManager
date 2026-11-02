import { expandedCellCoordinate } from '../expanded-map-grid.ts';
import {stationAxis,stationEnds,trackMeshData} from './track-geometry.ts';
import {Entity,Mesh,MeshInstance} from 'playcanvas';
import type {CityView} from '../renderer.ts';
import type {RailGraph} from './graph.ts';
import type {PassengerRailConfig,PassengerRailSnapshot} from './passenger.ts';
import {railTrainPose,railStationRows} from './presentation.ts';
import type {RailNetworkState,RailStationSite} from './network-runtime.ts';

/** Platform frame of a station cell: unit vector along the track and the side the platform sits on. */
type Platform={x:number;z:number;alongX:number;alongZ:number;sideX:number;sideZ:number};
const RAIL={body:'#f3efe6',stripe:'#7c6ce0',gold:'#f4c962',window:'#20384a',roof:'#c3c8d2',nose:'#2f3550',bogie:'#2b3138',light:'#fff4c2'};
const SHIRTS=['#e3eee6','#9fc5ff','#f3c29a','#c3b8ff','#9fe3bb','#ffd7a1'];
/** Read-only projection. Removing a visual never removes a passenger from simulation. */
export class SceneRail {
  private root=new Entity('Passenger railway');
  private infrastructure=new Entity('Rail infrastructure');
  private train=new Entity('Passenger shuttle');
  private waiting=new Map<string,Entity>();
  private revision='';
  private trackMeshes:Mesh[]=[];
  private trackMeshInstances=0;
  private platforms=new Map<string,Platform>();
  constructor(private view:CityView){
    view.app.root.addChild(this.root);this.root.addChild(this.infrastructure);this.root.addChild(this.train);
    this.train.enabled=false;
    // Two cars facing local +z: a lead car with a dark cab nose and lamps, then a passenger car.
    const lamp=view.material(RAIL.light,true);
    for(const [z,lead] of [[.56,true],[-.6,false]] as const){
      const len=lead?1.02:1.06;
      view.box(this.train,0,.36,z,.46,.42,len,RAIL.body);
      view.box(this.train,0,.6,z,.42,.07,len-.04,RAIL.roof,false);
      view.box(this.train,0,.64,z,.14,.02,len-.12,RAIL.stripe,false);
      view.box(this.train,0,.27,z,.47,.06,len+.005,RAIL.stripe,false);
      view.box(this.train,0,.33,z,.47,.02,len+.005,RAIL.gold,false);
      for(const x of [-.235,.235])for(const dz of [-.3,0,.3])view.box(this.train,x,.45,z+dz,.012,.13,.22,RAIL.window,false);
      for(const dz of [-.33,.33])view.box(this.train,0,.12,z+dz,.4,.1,.22,RAIL.bogie,false);
      if(lead){
        view.box(this.train,0,.4,z+len/2+.06,.44,.34,.14,RAIL.nose,false);
        view.box(this.train,0,.47,z+len/2+.13,.36,.12,.02,RAIL.window,false);
        for(const x of [-.14,.14])view.box(this.train,x,.27,z+len/2+.13,.07,.05,.02,lamp,false);
      }
    }
    view.box(this.train,0,.26,-.03,.16,.1,.14,RAIL.bogie,false);
  }
  private syncInfrastructure(stations:readonly RailStationSite[],graph:RailGraph){
    const revision=`${graph.revision}:${stations.map(s=>`${s.id}:${s.cell}`).join('|')}`;
    if(this.revision!==revision){
      this.infrastructure.destroy();for(const mesh of this.trackMeshes)mesh.destroy();this.trackMeshes=[];this.trackMeshInstances=0;this.infrastructure=new Entity('Rail infrastructure');this.root.addChild(this.infrastructure);this.revision=revision;
      for(const data of trackMeshData(graph)){
        const mesh=new Mesh(this.view.app.graphicsDevice);mesh.setPositions(data.positions);mesh.setNormals(data.normals);mesh.setIndices(data.indices);mesh.update();this.trackMeshes.push(mesh);
        const entity=new Entity('Batched rail '+data.color);entity.addComponent('render',{meshInstances:[new MeshInstance(mesh,this.view.material(data.color))]});this.infrastructure.addChild(entity);this.trackMeshInstances++;
      }
      this.platforms.clear();
      stations.forEach((station,index)=>this.station(station,index,graph));
    }
  }
  /** Platform beside the track, canopy, name board, bench and booth; a buffer stop where the line ends. */
  private station(station:RailStationSite,index:number,graph:RailGraph){
    const {x,z}=this.view.position(station.cell),axis=stationAxis(station.cell,graph);
    const alongX=axis==='x'?1:0,alongZ=axis==='x'?0:1,sideX=axis==='x'?0:1,sideZ=axis==='x'?1:0;
    this.platforms.set(station.id,{x,z,alongX,alongZ,sideX,sideZ});
    // a: along the track, s: across it (platform side positive), sized in the same frame.
    const put=(a:number,y:number,s:number,la:number,h:number,ls:number,color:string,shadow?:boolean)=>this.view.box(this.infrastructure,x+alongX*a+sideX*s,y,z+alongZ*a+sideZ*s,axis==='x'?la:ls,h,axis==='x'?ls:la,color,shadow);
    const accent=index===0?'#2a9294':'#ba6751';
    // Ballast under the whole station cell so the track meets the platform.
    put(0,.1,0,1.96,.06,.74,'#a7a397',false);
    for(const a of [-.75,-.25,.25,.75])put(a,.145,0,.1,.04,.6,'#5a4a3b',false);
    for(const s of [-.18,.18])put(0,.19,s,1.96,.05,.05,'#d8dee3',false);
    // Raised platform with a yellow safety edge on the track side.
    put(0,.21,.68,1.8,.26,.56,'#d9d2bf');put(0,.345,.43,1.8,.012,.06,'#f2c94c',false);
    // Canopy on two posts with a ridge in the station colour.
    // It covers the far half of the platform so riders waiting at the near end stay visible from above.
    for(const a of [.1,-.75])put(a,.7,.78,.07,.72,.07,'#4b5a6e');
    put(-.33,1.08,.7,1.2,.07,.7,accent);put(-.33,1.13,.7,1.2,.04,.16,'#f4efe2',false);
    // Name board on the canopy edge, with a rail-lilac face.
    put(-.33,.93,.42,.62,.16,.03,'#7c6ce0',false);put(-.33,.93,.405,.5,.08,.01,'#f4efe2',false);
    // Bench under the canopy and a ticket booth at its end.
    put(-.25,.42,.86,.42,.05,.14,'#8a5d3a',false);put(-.72,.5,.83,.26,.32,.22,'#efe6d2');
    // Buffer stop at the dead end, opposite the only track that leaves.
    const next=stationEnds(station.cell,graph);
    if(next!==null){const a=expandedCellCoordinate(next),b=expandedCellCoordinate(station.cell),nx=a.x-b.x,nz=a.z-b.z,end=-(axis==='x'?nx:nz)*.86;put(end,.24,0,.1,.18,.5,'#c0392b');put(end,.3,0,.12,.04,.54,'#f4efe2',false);}
  }
  /** City/runtime replacement must not reuse an equal revision from another snapshot. */
  invalidateInfrastructure(){this.revision='';}
  syncNetwork(network:RailNetworkState|undefined,fraction=0){
    if(network?.service){this.sync(network.service.config,network.graph,network.service.snapshot,fraction);return;}
    this.syncInfrastructure(network?.stations??[],network?.graph??{revision:0,links:[]});
    this.train.enabled=false;
    for(const marker of this.waiting.values())marker.destroy();this.waiting.clear();
    this.view.app.renderNextFrame=true;
  }
  sync(config:PassengerRailConfig,graph:RailGraph,state:PassengerRailSnapshot,fraction=0){
    this.syncInfrastructure(config.stations,graph);this.train.enabled=true;
    const pose=railTrainPose(config,graph,state,fraction);
    this.train.setLocalPosition((pose.x-11.5)*2,.05,(pose.z-11.5)*2);
    this.train.setLocalEulerAngles(0,Math.atan2(pose.headingX,pose.headingZ)*180/Math.PI,0);
    const wanted=new Set<string>();
    for(const row of railStationRows(config,state))for(let n=0;n<Math.min(row.waiting,8);n++){
      const key=`${row.id}:${n}`;wanted.add(key);let marker=this.waiting.get(key);
      if(!marker){marker=new Entity('Waiting passenger marker');this.view.box(marker,0,.2,0,.1,.1,.08,'#3a4256',false);this.view.box(marker,0,.32,0,.12,.16,.1,SHIRTS[n%SHIRTS.length],false);this.view.box(marker,0,.46,0,.09,.09,.09,'#c5926e',false);this.root.addChild(marker);this.waiting.set(key,marker);}
      const p=this.platforms.get(row.id)??{x:this.view.position(row.cell).x,z:this.view.position(row.cell).z,alongX:1,alongZ:0,sideX:0,sideZ:1};
      const a=.28+(n%4)*.18,s=.55+Math.floor(n/4)*.2;marker.setLocalPosition(p.x+p.alongX*a+p.sideX*s,.2,p.z+p.alongZ*a+p.sideZ*s);
    }
    for(const [key,marker] of this.waiting)if(!wanted.has(key)){marker.destroy();this.waiting.delete(key);}
    this.view.app.renderNextFrame=true;
  }
  get diagnostics(){const position=this.train.getPosition();return {trainPosition:{x:position.x,y:position.y,z:position.z},trains:this.train.enabled?1:0,renderedWaitingMarkers:this.waiting.size,trackMeshInstances:this.trackMeshInstances};}
  destroy(){this.root.destroy();for(const mesh of this.trackMeshes)mesh.destroy();this.trackMeshes=[];this.waiting.clear();}
}
