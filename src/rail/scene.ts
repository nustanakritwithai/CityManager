import {trackMeshData} from './track-geometry.ts';
import {Entity,Mesh,MeshInstance} from 'playcanvas';
import type {CityView} from '../renderer.ts';
import type {RailGraph} from './graph.ts';
import type {PassengerRailConfig,PassengerRailSnapshot} from './passenger.ts';
import {railTrainPose,railStationRows} from './presentation.ts';
import type {RailNetworkState,RailStationSite} from './network-runtime.ts';

/** Read-only projection. Removing a visual never removes a passenger from simulation. */
export class SceneRail {
  private root=new Entity('Passenger railway');
  private infrastructure=new Entity('Rail infrastructure');
  private train=new Entity('Passenger shuttle');
  private waiting=new Map<string,Entity>();
  private revision='';
  private trackMeshes:Mesh[]=[];
  private trackMeshInstances=0;
  constructor(private view:CityView){
    view.app.root.addChild(this.root);this.root.addChild(this.infrastructure);this.root.addChild(this.train);
    this.train.enabled=false;
    view.box(this.train,0,.33,0,.46,.48,1.25,'#f4c962');
    view.box(this.train,0,.61,0,.49,.09,1.29,'#fff1d1',false);
    for(const x of [-.24,.24])for(const z of [-.38,0,.38])view.box(this.train,x,.4,z,.02,.18,.24,'#234c60',false);
    for(const z of [-.43,.43])view.box(this.train,0,.14,z,.51,.12,.18,'#273a42',false);
  }
  private syncInfrastructure(stations:readonly RailStationSite[],graph:RailGraph){
    const revision=`${graph.revision}:${stations.map(s=>`${s.id}:${s.cell}`).join('|')}`;
    if(this.revision!==revision){
      this.infrastructure.destroy();for(const mesh of this.trackMeshes)mesh.destroy();this.trackMeshes=[];this.trackMeshInstances=0;this.infrastructure=new Entity('Rail infrastructure');this.root.addChild(this.infrastructure);this.revision=revision;
      for(const data of trackMeshData(graph)){
        const mesh=new Mesh(this.view.app.graphicsDevice);mesh.setPositions(data.positions);mesh.setNormals(data.normals);mesh.setIndices(data.indices);mesh.update();this.trackMeshes.push(mesh);
        const entity=new Entity('Batched rail '+data.color);entity.addComponent('render',{meshInstances:[new MeshInstance(mesh,this.view.material(data.color))]});this.infrastructure.addChild(entity);this.trackMeshInstances++;
      }
      for(const station of stations){
        const {x,z}=this.view.position(station.cell);
        this.view.box(this.infrastructure,x,.2,z+.58,1.8,.22,.76,'#d5d4ba',false);
        for(const dx of [-.72,.72])this.view.box(this.infrastructure,x+dx,.72,z+.68,.08,.85,.08,'#456c72');
        this.view.box(this.infrastructure,x,1.2,z+.56,1.9,.13,.8,station.id===stations[0].id?'#2a9294':'#ba6751');
      }
    }
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
      if(!marker){marker=new Entity('Waiting passenger marker');this.view.box(marker,0,.35,0,.12,.28,.12,'#e3eee6',false);this.view.box(marker,0,.54,0,.1,.1,.1,'#c5926e',false);this.root.addChild(marker);this.waiting.set(key,marker);}
      const p=this.view.position(row.cell);marker.setLocalPosition(p.x-.65+(n%4)*.35,.05,p.z+.4+Math.floor(n/4)*.22);
    }
    for(const [key,marker] of this.waiting)if(!wanted.has(key)){marker.destroy();this.waiting.delete(key);}
    this.view.app.renderNextFrame=true;
  }
  get diagnostics(){const position=this.train.getPosition();return {trainPosition:{x:position.x,y:position.y,z:position.z},trains:this.train.enabled?1:0,renderedWaitingMarkers:this.waiting.size,trackMeshInstances:this.trackMeshInstances};}
  destroy(){this.root.destroy();for(const mesh of this.trackMeshes)mesh.destroy();this.trackMeshes=[];this.waiting.clear();}
}
