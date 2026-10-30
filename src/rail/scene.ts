import {Entity} from 'playcanvas';
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
  constructor(private view:CityView){
    view.app.root.addChild(this.root);this.root.addChild(this.infrastructure);this.root.addChild(this.train);
    this.train.enabled=false;
    view.box(this.train,0,.33,0,.46,.48,1.25,'#f4c962');
    view.box(this.train,0,.61,0,.49,.09,1.29,'#fff1d1',false);
    for(const x of [-.24,.24])for(const z of [-.38,0,.38])view.box(this.train,x,.4,z,.02,.18,.24,'#234c60',false);
    for(const z of [-.43,.43])view.box(this.train,0,.14,z,.51,.12,.18,'#273a42',false);
  }
  private syncInfrastructure(stations:readonly RailStationSite[],graph:RailGraph){
    const revision=JSON.stringify([stations,graph]);
    if(this.revision!==revision){
      this.infrastructure.destroy();this.infrastructure=new Entity('Rail infrastructure');this.root.addChild(this.infrastructure);this.revision=revision;
      const seen=new Set<string>();
      for(const link of graph.links){
        const key=[Math.min(link.from,link.to),Math.max(link.from,link.to)].join(':');if(seen.has(key))continue;seen.add(key);
        const a=this.view.position(link.from),b=this.view.position(link.to),horizontal=a.z===b.z,x=(a.x+b.x)/2,z=(a.z+b.z)/2;
        this.view.box(this.infrastructure,x,.12,z,horizontal?2:.55,.08,horizontal?.55:2,'#8e8b7b',false);
        for(const side of [-.18,.18])this.view.box(this.infrastructure,x+(horizontal?0:side),.19,z+(horizontal?side:0),horizontal?2:.045,.055,horizontal?.045:2,'#d1d7ce',false);
        for(const offset of [-.75,-.25,.25,.75])this.view.box(this.infrastructure,x+(horizontal?offset:0),.16,z+(horizontal?0:offset),horizontal?.08:.65,.06,horizontal?.65:.08,'#665848',false);
      }
      for(const station of stations){
        const {x,z}=this.view.position(station.cell);
        this.view.box(this.infrastructure,x,.2,z+.65,1.8,.22,.8,'#d5d4ba',false);
        for(const dx of [-.72,.72])this.view.box(this.infrastructure,x+dx,.72,z+.9,.08,.85,.08,'#456c72');
        this.view.box(this.infrastructure,x,1.2,z+.77,1.9,.13,.88,station.id===stations[0].id?'#2a9294':'#ba6751');
      }
    }
  }
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
      const p=this.view.position(row.cell);marker.setLocalPosition(p.x-.65+(n%4)*.35,.05,p.z+.5+Math.floor(n/4)*.22);
    }
    for(const [key,marker] of this.waiting)if(!wanted.has(key)){marker.destroy();this.waiting.delete(key);}
    this.view.app.renderNextFrame=true;
  }
  get diagnostics(){return {trains:this.train.enabled?1:0,renderedWaitingMarkers:this.waiting.size};}
  destroy(){this.root.destroy();this.waiting.clear();}
}
