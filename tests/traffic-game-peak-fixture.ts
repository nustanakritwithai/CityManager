import assert from 'node:assert/strict';
import {deserializeParkSession,expandValidatedParkSession} from '../src/park-runtime.ts';
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


/** Validate both the acknowledged legacy bytes and the live expanded state. */
export function peakLiveCity(raw: string, original: City): City {
  const decoded=deserializeParkSession(raw);
  assert.equal(serialize(decoded.city),serialize(original),'ACK decodes to the exact original fixture');
  assert.equal(original.cells.length,576); assert.equal(original.households.reduce((n,h)=>n+h.members,0),2000);
  assert.equal(original.cells.filter(c=>c.road).length,490);
  const live=expandValidatedParkSession(decoded);
  assert.equal(live.city.cells.length,672); assert.deepEqual(live.city.cells.slice(0,576),original.cells);
  assert.deepEqual(live.city.resources.fertility.slice(0,576),original.resources.fertility);
  const {cells:_oldCells,resources:_oldResources,...oldState}=original;
  const {cells:_newCells,resources:_newResources,...newState}=live.city;
  assert.deepEqual(newState,oldState,'Migration preserves identities, accounts, ledgers and all non-map state');
  assert.deepEqual(live.runtime.activity,decoded.runtime.activity); assert.deepEqual(live.runtime.recreation,decoded.runtime.recreation);
  return live.city;
}
