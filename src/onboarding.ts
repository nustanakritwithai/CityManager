/**
 * First-run coach on desktop: three icon steps (road → zone → play) that tick themselves off
 * from the city's own state. Click-through except its close button; dismissal is a per-browser
 * convenience in localStorage. Read-only over City.
 */
import { iconElement } from './ui-icons.ts';
import type { City } from './sim.ts';

const KEY = 'citymanager.coach.v1';
const STEPS = [['road', 'road', 'ต่อถนนจากประตูเมือง'], ['zone', 'R', 'วางโซนข้างถนน'], ['play', 'clock', 'กดเล่นแล้วดูเมืองโต']] as const;
type Baseline = { roads: number; zones: number; tick: number };

function dismissed(): boolean { try { return localStorage.getItem(KEY) === 'done'; } catch { return false; } }
function remember() { try { localStorage.setItem(KEY, 'done'); } catch { /* private mode: coach just reappears next visit */ } }

export class Coach {
  private readonly root = document.createElement('aside');
  private readonly items = new Map<string, HTMLElement>();
  private baseline: Baseline | null = null;
  private city: City | null = null;
  private closed = dismissed();
  constructor() {
    this.root.className = 'coach'; this.root.id = 'coach'; this.root.setAttribute('aria-label', 'เริ่มสร้างเมือง'); this.root.hidden = true;
    const head = document.createElement('div'); head.className = 'coach-head';
    const title = document.createElement('strong'); title.textContent = 'เริ่มสร้างเมือง';
    const close = document.createElement('button'); close.type = 'button'; close.className = 'coach-close'; close.textContent = '✕'; close.setAttribute('aria-label', 'ปิดคำแนะนำ');
    close.addEventListener('click', () => { this.closed = true; remember(); this.root.hidden = true; });
    head.append(title, close);
    const list = document.createElement('ol'); list.className = 'coach-steps';
    for (const [key, icon, label] of STEPS) {
      const li = document.createElement('li'); li.dataset.step = key; li.append(iconElement(icon, 'ui-icon coach-icon'), document.createTextNode(label));
      this.items.set(key, li); list.append(li);
    }
    this.root.append(head, list); document.body.append(this.root);
  }
  update(city: City) {
    if (this.closed) return;
    const roads = city.cells.filter(c => c.road).length, zones = city.cells.filter(c => c.zone).length;
    if (city !== this.city) { this.city = city; this.baseline = city.tick < 60 ? { roads, zones, tick: city.tick } : null; }
    if (!this.baseline) { this.root.hidden = true; return; }
    const done = { road: roads > this.baseline.roads, zone: zones > this.baseline.zones, play: city.tick > this.baseline.tick };
    for (const [key, li] of this.items) li.classList.toggle('done', done[key as keyof typeof done]);
    if (done.road && done.zone && done.play) { this.closed = true; remember(); this.root.hidden = true; return; }
    this.root.hidden = false;
  }
}
