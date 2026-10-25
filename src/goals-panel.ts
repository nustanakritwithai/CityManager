/**
 * Goal UI: the level pill under the wordmark, the goals card at the top of the city overview and
 * the win screen. Everything reads cityGoals(); nothing is saved.
 */
import { WinLatch, cityGoals, cityRecord, type CityGoals } from './city-goals.ts';
import type { City } from './sim.ts';
import './goals.css';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string) => {
  const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
};
const money = (satang: number) => Math.round(satang / 100).toLocaleString('th-TH') + ' ฿';

function dots(goals: CityGoals): HTMLElement {
  const row = el('span', 'goal-dots'); row.setAttribute('aria-hidden', 'true');
  for (const stage of goals.stages) row.append(el('i', stage.done ? 'done' : stage === goals.next ? 'current' : ''));
  return row;
}

/** Small "level N/5" button under the wordmark; pressing it opens the goals card. */
export class GoalPill {
  readonly button = el('button', 'goal-pill');
  private key = '';
  constructor(onOpen: () => void) {
    this.button.type = 'button'; this.button.id = 'goal-pill';
    this.button.addEventListener('click', onOpen);
    document.querySelector('.wordmark > div')?.append(this.button);
  }
  update(goals: CityGoals) {
    const name = goals.level ? goals.stages[goals.level - 1].name : 'เริ่มสร้างเมือง', key = `${goals.level}:${goals.next?.id}`;
    if (key === this.key) return;
    this.key = key;
    const face = el('span', 'goal-pill-face'); face.append(dots(goals), el('span', 'goal-pill-level', `ระดับ ${goals.level}/5`), el('span', 'goal-pill-name', ` · ${name}`));
    this.button.replaceChildren(face);
    this.button.title = goals.next ? `เป้าหมายถัดไป: ${goals.next.name}` : 'เมืองพึ่งพาตนเองได้แล้ว';
    this.button.setAttribute('aria-label', `ระดับเมือง ${goals.level} จาก 5 · ${name} · ดูเป้าหมาย`);
    this.button.classList.toggle('won', goals.won);
  }
}

/** The five stages as a stepper, with the open checks of the next stage spelled out. */
export function renderGoalsCard(host: HTMLElement, goals: CityGoals) {
  const head = el('div', 'dash-head'); head.append(el('h3', '', 'เป้าหมายเมือง'), el('span', 'dash-note', goals.won ? 'ชนะแล้ว · เล่นต่อได้' : `ระดับ ${goals.level}/5`));
  const steps = el('ol', 'goal-steps');
  for (const stage of goals.stages) {
    const li = el('li', stage.done ? 'done' : stage === goals.next ? 'current' : 'locked');
    li.dataset.goal = stage.id;
    li.append(el('b', 'goal-step-mark', stage.done ? '✓' : String(stage.level)), el('span', 'goal-step-name', stage.name));
    steps.append(li);
  }
  const parts: HTMLElement[] = [head, steps];
  if (goals.next) {
    const next = el('section', 'goal-next'); next.append(el('h4', '', `ถัดไป: ${goals.next.name}`));
    const list = el('ul', 'goal-checks');
    for (const check of goals.next.checks) {
      const li = el('li', check.done ? 'done' : ''); li.append(el('b', 'goal-check-mark', check.done ? '✓' : '○'), el('span', '', check.label));
      if (check.value) li.append(el('small', '', check.value));
      list.append(li);
    }
    next.append(list, el('p', 'dash-note-line', goals.next.hint)); parts.push(next);
  } else parts.push(el('p', 'dash-note-line', 'เมืองผลิตสินค้าพอขายเอง ไม่ต้องนำเข้า และเงินคลังเติบโต เล่นต่อแบบอิสระได้ หรือเริ่มเมืองใหม่จากเมนูเกม'));
  host.replaceChildren(...parts);
}

/** One win screen per running city: it fires when the city reaches stage 5 while time is running. */
export class WinWatch {
  private readonly latch = new WinLatch();
  private readonly onNewCity: () => void;
  private readonly onWin: () => void;
  constructor(onNewCity: () => void, onWin: () => void) { this.onNewCity = onNewCity; this.onWin = onWin; }
  /** Call after every render; `running` is false for loads, resets and paused edits. */
  check(city: City, goals: CityGoals, running: boolean) { if (this.latch.check(city, goals.won, running)) this.show(city); }
  private show(city: City) {
    this.onWin();
    const r = cityRecord(city), dialog = el('dialog', 'win-dialog');
    dialog.setAttribute('aria-labelledby', 'win-title');
    const title = el('h2', '', 'เมืองพึ่งพาตนเองได้แล้ว'); title.id = 'win-title';
    const stats = el('dl', 'win-stats');
    for (const [label, value] of [
      ['ใช้เวลา', `${r.day.toLocaleString('th-TH')} วัน (${Math.ceil(r.day / 30)} เดือน)`],
      ['ประชากร', `${r.population.toLocaleString('th-TH')} คน · ${r.households.toLocaleString('th-TH')} ครัวเรือน`],
      ['สินค้าที่ผลิตในเมือง', `${r.produced.toLocaleString('th-TH')} หน่วย`],
      ['ครัวเรือนซื้อไปใช้', `${r.soldLocally.toLocaleString('th-TH')} หน่วย`],
      ['ภาษีที่เก็บได้', money(r.taxes)],
      ['เงินคลังตอนนี้', money(r.treasury)],
    ]) { stats.append(el('dt', '', label), el('dd', '', value)); }
    const keep = el('button', 'win-continue', 'เล่นต่อ'); keep.type = 'button'; keep.autofocus = true;
    const fresh = el('button', 'win-new', 'เริ่มเมืองใหม่'); fresh.type = 'button';
    keep.onclick = () => dialog.close(); fresh.onclick = () => { dialog.close(); this.onNewCity(); };
    const actions = el('div', 'win-actions'); actions.append(keep, fresh);
    dialog.append(el('p', 'win-kicker', 'ผ่านครบ 5 ระดับ'), title, el('p', '', 'โรงงานในเมืองผลิตพอให้ร้านขาย ไม่ต้องนำเข้า และเงินคลังเพิ่มขึ้น 3 เดือนติดกัน'), stats, actions);
    document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove()); dialog.showModal();
  }
}

export { cityGoals };
