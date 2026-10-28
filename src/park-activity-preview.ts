import { buildPark, createCity, deserialize, serialize, step, summary, SIZE, type City } from './sim.ts';
import { atmosphereAt } from './atmosphere.ts';
import { CityView } from './renderer.ts';
import { createParkActivity, advanceParkActivity, startParkActivityDay, parkActivityVisitors, serializeParkActivity, restoreParkActivity } from './park-activity.ts';
import { SceneParkActivity, type ParkActivityQuality } from './scene-park-activity.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const SAVE_KEY = 'citymanager.park-activity.candidate.v1';
const neighbors = (i: number) => [i % SIZE ? i - 1 : -1, i % SIZE < SIZE - 1 ? i + 1 : -1, i >= SIZE ? i - SIZE : -1, i < SIZE * (SIZE - 1) ? i + SIZE : -1].filter(n => n >= 0);
function candidateCity(): City {
  const city = createCity(61025);
  for (let n = 0; n < 180; n++) step(city);
  const homes = city.buildings.filter(b => b.zone === 'R' && city.households.some(h => h.home === b.id));
  const score = (cell: number) => homes.reduce((n, h) => n + 1 / (1 + Math.abs(h.cell % SIZE - cell % SIZE) + Math.abs(Math.floor(h.cell / SIZE) - Math.floor(cell / SIZE))), 0);
  const sites = city.cells.map((c, i) => ({ c, i })).filter(({ c, i }) => !c.road && !c.zone && c.building === null && !city.plants.some(p => p.cell === i) && !neighbors(i).some(n => city.cells[n].road))
    .sort((a, b) => score(b.i) - score(a.i) || a.i - b.i);
  if (!sites.length || !buildPark(city, sites[0].i).ok) throw new Error('Could not fund the candidate park from the real city treasury.');
  // Keep the economy's existing save validation authoritative.
  return deserialize(serialize(city));
}

async function boot() {
  let city = candidateCity();
  let activity = createParkActivity(city, 16 * 60 + 55);
  advanceParkActivity(city, activity, 40);
  let paused = false, minuteRemainder = 0, speed = 12;
  const view = await CityView.create($<HTMLCanvasElement>('park-canvas'), () => {}, () => {}, () => {});
  // The production view fills the window; this isolated entry embeds it beside controls.
  view.resize = () => {
    const rect = $('scene').getBoundingClientRect();
    view.app.resizeCanvas(Math.round(rect.width), Math.round(rect.height));
    view.app.renderNextFrame = true;
  };
  new ResizeObserver(() => view.resize()).observe($('scene'));
  view.resize();
  view.traffic.setEnabled(false);
  const people = new SceneParkActivity(view);
  const park = city.parks[0];
  view.render(city, park.cell, []);
  view.radius = 12;
  view.focus(park.cell);
  const status = (message: string) => { $('status').textContent = message; };
  const refresh = () => {
    const visitors = parkActivityVisitors(activity), inside = visitors.filter(v => !['travel', 'leave'].includes(v.phase));
    people.sync(activity);
    view.setAtmosphere(atmosphereAt(activity.minute / 60));
    $('clock').textContent = `${String(Math.floor(activity.minute / 60) % 24).padStart(2, '0')}:${String(activity.minute % 60).padStart(2, '0')} · Day ${city.tick}`;
    $('population').textContent = `${summary(city).population} actual residents · ${city.households.length} households`;
    $('occupancy').textContent = `${inside.length} inside · ${activity.visitors.length} reserved · ${people.diagnostics.renderedVisitors} shown`;
    $('visitors').replaceChildren(...visitors.map(v => {
      const li = document.createElement('li');
      li.textContent = `${v.citizenId} · ${v.phase}${v.partnerId ? ` with ${v.partnerId}` : ''}`;
      return li;
    }));
    $('pause').textContent = paused ? 'Resume' : 'Pause';
    $('pause').setAttribute('aria-pressed', String(paused));
  };
  const advance = (minutes: number) => {
    let left = minutes;
    while (left > 0) {
      const n = Math.min(left, 1440 - activity.minute);
      advanceParkActivity(city, activity, n);
      left -= n;
      if (activity.minute === 1440) {
        step(city); // Exactly one existing economic day; activity never pays anybody.
        startParkActivityDay(city, activity);
        view.render(city, city.parks[0]?.cell ?? null, []);
      }
    }
    refresh();
  };
  $('pause').onclick = () => { paused = !paused; refresh(); };
  $('minute').onclick = () => { paused = true; minuteRemainder = 0; advance(1); };
  $('evening').onclick = () => { activity = createParkActivity(city, 16 * 60 + 55); minuteRemainder = 0; refresh(); status('Restarted this day’s leisure preview; city accounts and labor are unchanged.'); };
  $<HTMLSelectElement>('speed').onchange = event => { speed = Number((event.target as HTMLSelectElement).value); };
  $<HTMLSelectElement>('quality').onchange = event => { people.setQuality((event.target as HTMLSelectElement).value as ParkActivityQuality); refresh(); };
  $('save').onclick = () => {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ version: 1, city: serialize(city), activity: serializeParkActivity(activity), minuteRemainder })); status('Saved the candidate city and activity clock together.'); }
    catch (error) { status(`Save failed: ${error instanceof Error ? error.message : error}`); }
  };
  $('load').onclick = () => {
    try {
      const value = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null');
      if (value?.version !== 1 || !Number.isFinite(value.minuteRemainder) || value.minuteRemainder < 0 || value.minuteRemainder >= 1) throw new Error('No valid candidate save.');
      const loaded = deserialize(value.city), loadedActivity = restoreParkActivity(loaded, value.activity);
      city = loaded; activity = loadedActivity; minuteRemainder = value.minuteRemainder; paused = true;
      view.render(city, city.parks[0]?.cell ?? null, []); refresh(); status('Loaded exact activity state; paused for inspection.');
    } catch (error) { status(`Load failed: ${error instanceof Error ? error.message : error}`); }
  };
  view.app.on('update', (dt: number) => {
    if (paused || document.hidden) return;
    minuteRemainder += Math.min(dt, .25) * speed;
    if (minuteRemainder >= 1) { const minutes = Math.floor(minuteRemainder); minuteRemainder -= minutes; advance(minutes); }
  });
  Object.defineProperty(window, 'parkActivityCandidate', { value: {
    snapshot: () => ({ city: serialize(city), activity: serializeParkActivity(activity), minuteRemainder }),
    diagnostics: () => ({ ...people.diagnostics, minute: activity.minute, day: activity.day, paused, visitors: parkActivityVisitors(activity), parkCell: city.parks[0]?.cell, assets: view.assets?.status }),
    // Isolated preview controls also support deterministic browser verification.
    advance: (minutes: number) => { if (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > 1440) throw new Error('Invalid minute step'); paused = true; advance(minutes); },
    setQuality: (quality: ParkActivityQuality) => { if (!['low', 'medium', 'high'].includes(quality)) throw new Error('Invalid quality'); people.setQuality(quality); refresh(); },
  } });
  refresh();
  status('A one-tile park reached over open land. Visitor reservations come from real household members.');
}
void boot().catch(error => { console.error(error); $('status').textContent = `Candidate could not start: ${error.message}`; });
