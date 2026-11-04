import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, buildCampus, toggleCampus, bulldoze, GATEWAY } from '../src/sim.ts';
import { expandValidatedParkSession, deserializeParkSession } from '../src/park-runtime.ts';
import { buildingIssues } from '../src/building-issues.ts';
export function buildingIssuesFixture() {
  const source = createCity(61025); for (let day = 0; day < 90; day++) step(source);
  let campusCell = -1;
  for (let cell = 0; cell < source.cells.length; cell++) if (buildCampus(source, cell, 'school').ok) { campusCell = cell; break; }
  assert.ok(campusCell >= 0); toggleCampus(source, source.education!.campuses[0].id);
  assert.ok(bulldoze(source, GATEWAY + 1).ok);
  const raw = serialize(source); assert.deepEqual(deserialize(raw), source);
  const city = expandValidatedParkSession(deserializeParkSession(raw)).city;
  assert.ok(buildingIssues(city).some(issue => issue.remaining > 0));
  return { raw, city, campusCell };
}
