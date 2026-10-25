/**
 * Guided first game: a small card above the tool dock that walks a new player from an empty map
 * to a working city, one step at a time, with a button that picks the right tool. Steps come from
 * the city (guide-steps.ts); only "active / done / skipped" is kept per browser.
 */
import { guideState } from './guide-steps.ts';
import type { City, Zone } from './sim.ts';
import './guide.css';

export const GUIDE_KEY = 'citymanager.guide.v1';
type Stored = 'active' | 'done' | 'skipped' | null;
const read = (): Stored => { try { const v = localStorage.getItem(GUIDE_KEY); return v === 'active' || v === 'done' || v === 'skipped' ? v : null; } catch { return null; } };
const write = (v: Exclude<Stored, null>) => { try { localStorage.setItem(GUIDE_KEY, v); } catch { /* the guide still runs for this visit */ } };
const TOOL_LABELS: Record<string, string> = { road: 'เลือกถนน', R: 'เลือกบ้าน', C: 'เลือกพาณิชย์', I: 'เลือกโรงงาน', F: 'เลือกฟาร์ม', play: 'กดเล่น' };

export class Guide {
  private readonly root = document.createElement('aside');
  private readonly count = document.createElement('span');
  private readonly title = document.createElement('strong');
  private readonly text = document.createElement('p');
  private readonly progress = document.createElement('span');
  private readonly action = document.createElement('button');
  private state: Stored = read();
  private key = '';
  private finishedAt = 0;
  private readonly onTool: (tool: Exclude<Zone, null> | 'road') => void;
  private readonly onPlay: () => void;

  constructor(onTool: (tool: Exclude<Zone, null> | 'road') => void, onPlay: () => void) {
    this.onTool = onTool; this.onPlay = onPlay;
    this.root.id = 'guide-card'; this.root.className = 'guide panel'; this.root.hidden = true; this.root.setAttribute('aria-label', 'ผู้ช่วยสอน'); this.root.setAttribute('aria-live', 'polite');
    const head = document.createElement('div'); head.className = 'guide-head';
    const skip = document.createElement('button'); skip.type = 'button'; skip.className = 'guide-skip'; skip.textContent = 'ข้าม'; skip.setAttribute('aria-label', 'ข้ามผู้ช่วยสอน');
    skip.addEventListener('click', () => this.stop('skipped'));
    this.count.className = 'guide-count'; head.append(this.count, skip);
    const body = document.createElement('div'); body.className = 'guide-body';
    this.progress.className = 'guide-progress'; this.text.className = 'guide-text';
    this.action.type = 'button'; this.action.className = 'guide-action';
    body.append(this.title, this.progress);
    this.root.append(head, body, this.text, this.action);
    document.querySelector('.bottom-hud')?.prepend(this.root);
    // The map legend sits above the dock; lift it over the card while the card shows.
    new ResizeObserver(() => document.documentElement.style.setProperty('--guide-h', `${this.root.hidden ? 0 : this.root.offsetHeight + 8}px`)).observe(this.root);
  }

  get active() { return this.state === 'active'; }
  /** Begin (or restart) the guide for a city started from an empty map. */
  start() { this.state = 'active'; write('active'); this.key = ''; this.finishedAt = 0; }
  /** Boot: an empty first game starts the guide unless this browser already finished or skipped it. */
  offer() { if (this.state !== 'done' && this.state !== 'skipped') this.start(); }
  stop(how: 'done' | 'skipped') { this.state = how; write(how); this.root.hidden = true; }
  /** Hide for this city only (a sample city needs no guide); the stored choice is untouched. */
  hold() { this.state = null; this.root.hidden = true; }

  update(city: City) {
    if (!this.active) { this.root.hidden = true; return; }
    const { index, total, step } = guideState(city);
    if (!step) {
      // One closing line, then the goal pill takes over.
      if (!this.finishedAt) { this.finishedAt = performance.now(); this.render('done', `ครบ ${total} ขั้นแล้ว`, 'เยี่ยม! เมืองพร้อมโตต่อ', 'ต่อจากนี้ดูป้ายระดับใต้ชื่อเกม เป้าหมายคือระดับ 5 เมืองพึ่งพาตนเองได้', '', null); }
      else if (performance.now() - this.finishedAt > 8000) this.stop('done');
      return;
    }
    this.render(`${index}:${step.progress.join('/')}`, `ขั้น ${index + 1}/${total}`, step.title, step.text, `${step.progress[0]}/${step.progress[1]}`, step.tool);
  }

  private render(key: string, count: string, title: string, text: string, progress: string, tool: string | null) {
    this.root.hidden = false;
    if (key === this.key) return;
    this.key = key; this.root.dataset.step = key.split(':')[0];
    this.count.textContent = `ผู้ช่วยสอน · ${count}`; this.title.textContent = title; this.text.textContent = text;
    this.progress.textContent = progress; this.progress.hidden = !progress;
    this.action.hidden = !tool; this.action.textContent = tool ? TOOL_LABELS[tool] : '';
    this.action.onclick = !tool ? null : tool === 'play' ? () => this.onPlay() : () => this.onTool(tool as Exclude<Zone, null> | 'road');
  }
}
