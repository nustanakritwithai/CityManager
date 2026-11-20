import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, summary, unemploymentRate, zoneCell, access, JOB_SEEKER_UNEMPLOYMENT_LIMIT, type City } from '../src/sim.ts';
import { keepSupplied } from './plants.ts';
import { holdEducationReady } from './education-ready.ts';
import { legacyIndustry } from './legacy-sizes.ts';

/** The starter city with ten more lots zoned for homes and a school from day 30; each day is logged as it starts. */
function seekerCity(days: number, prepare: (c: City) => City = c => c) {
  const c = prepare(createCity(61025)), log: { openJobs: number; rate: number; arrivals: number; arrived: number; tick: number }[] = [], lots: number[] = [];
  for (let i = 0; i < c.cells.length && lots.length < 10; i++) if (!c.cells[i].road && !c.cells[i].zone && c.cells[i].building === null && access(c, i) && zoneCell(c, i, 'R').ok) lots.push(i);
  for (let d = 1; d <= days; d++) {
    const openJobs = summary(c).openJobs, rate = unemploymentRate(c), arrivals = c.migration.arrivals;
    step(c); keepSupplied(c); if (d >= 30) holdEducationReady(c);
    log.push({ openJobs, rate, arrivals, arrived: c.migration.arrivals - arrivals, tick: c.tick });
  }
  return { c, log, lots };
}

test('people keep coming to look for work with every job taken, until a tenth of the workforce is out of work', { timeout: 300_000 }, () => {
  const { c, log } = seekerCity(240);
  const full = log.filter(d => d.openJobs === 0 && d.arrivals >= 2);
  const looking = full.filter(d => d.rate < JOB_SEEKER_UNEMPLOYMENT_LIMIT), crowded = full.filter(d => d.rate >= JOB_SEEKER_UNEMPLOYMENT_LIMIT);
  assert.ok(looking.some(d => d.arrived > 0), 'a newcomer arrived on a day that started with no open job');
  assert.ok(looking.every(d => d.arrived <= 1), 'one household a day comes to look for work');
  assert.ok(crowded.length > 0, 'the town reaches the limit');
  for (const d of crowded) assert.equal(d.arrived, 0, `day ${d.tick}: nobody comes once a tenth are out of work`);
  // Newcomers with no job yet are single people on their savings.
  const seekers = c.households.filter(h => h.origin === 'arrival' && h.profile === 'single-worker');
  assert.ok(seekers.length > 0);
  assert.ok(seekers.every(h => h.members === 1 && h.workforce === 1));
  assert.ok(unemploymentRate(c) > 0, 'some people are out of work');
  assert.deepEqual(deserialize(serialize(c)), c, 'the save accepts newcomers who came with no job open');
});

test('newcomers looking for work are what get houses built on zoned lots', { timeout: 300_000 }, () => {
  const { c, lots } = seekerCity(240), built = lots.filter(i => c.cells[i].building !== null);
  const workers = c.households.reduce((n, h) => n + h.workforce, 0), jobs = c.employment.reduce((n, e) => n + e.workers, 0);
  assert.ok(built.length > 0, 'houses went up on the lots zoned for them');
  assert.ok(built.every(i => c.buildings.find(b => b.cell === i)?.zone === 'R'));
  assert.ok(built.some(i => c.households.some(h => h.home === c.cells[i].building)), 'and people live in them');
  assert.ok(workers > jobs, `${workers} people of working age for ${jobs} jobs: more people than work`);
});

test('a city saved before keeps homes for open jobs only: nobody comes with every job taken', { timeout: 300_000 }, () => {
  const { log } = seekerCity(150, legacyIndustry);
  for (const d of log.filter(d => d.openJobs === 0 && d.arrivals >= 2)) assert.equal(d.arrived, 0, `day ${d.tick}`);
});
