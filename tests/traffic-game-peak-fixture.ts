import {population2000Fixture} from './population-capacity-fixture.ts';
import {deserialize,serialize,type City} from '../src/sim.ts';

/** Reconciled 2,000-person stress city, not a naturally grown city. Existing
 * homes and firms are relocated; no traffic actors or OD rows are injected. */
export function trafficGamePeakFixture(): City {
  const city=population2000Fixture();
  const homes=city.buildings.filter(b=>b.zone==='R');
  const destinations=city.buildings.filter(b=>b.zone!=='R');
  city.cells.forEach(c=>{c.road=true;c.zone=null;c.building=null;});
  // Keep the gateway at (0,12) as a road.
  for(const [i,b] of homes.entries()){
    b.cell=(i>=12?i+1:i)*24;
    city.cells[b.cell]={road:false,zone:b.zone,building:b.id};
  }
  for(const [i,b] of destinations.entries()){
    b.cell=(i%24)*24+23-Math.floor(i/24);
    city.cells[b.cell]={road:false,zone:b.zone,building:b.id};
  }
  // Exercise the same validation used by a real saved city at browser startup.
  return deserialize(serialize(city));
}
