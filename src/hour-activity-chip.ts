/**
 * The chip under the city summary: the game time, ticking each game minute, and what the town is doing this hour.
 * Read-only. The clock text is the only thing that changes between hours; the activity is worked out again only when
 * the hour turns or the city changes.
 */
import { dayCounts, hourActivity } from './hour-activity.ts';
import { clockLabel } from './game-clock.ts';
import { iconElement } from './ui-icons.ts';
import type { City } from './sim.ts';

export class HourActivityChip {
  readonly element = document.createElement('section');
  private readonly icon = document.createElement('span');
  private readonly clock = document.createElement('strong');
  private readonly title = document.createElement('span');
  private readonly detail = document.createElement('small');
  private hour = -1;
  private clockText = '';
  private iconName = '';

  constructor(parent: HTMLElement = document.body) {
    this.element.id = 'hour-activity'; this.element.className = 'hour-activity';
    this.icon.className = 'hour-activity-icon'; this.clock.className = 'hour-activity-clock';
    this.title.className = 'hour-activity-title'; this.detail.className = 'hour-activity-detail';
    const head = document.createElement('span'); head.className = 'hour-activity-head'; head.append(this.clock, this.title);
    this.element.append(this.icon, head, this.detail);
    parent.append(this.element);
  }

  /**
   * Show the time `minuteOfDay` and, when its hour differs from the one shown or `fresh` says the city changed, that
   * hour's activity. `parkVisitors` are the people in the parks right now.
   */
  update(city: City, minuteOfDay: number, parkVisitors: number, fresh = false) {
    const clock = clockLabel(minuteOfDay);
    if (clock !== this.clockText) { this.clockText = clock; this.clock.textContent = clock; }
    const hour = Number(clock.slice(0, 2));
    if (!fresh && hour === this.hour) return;
    this.hour = hour;
    const a = hourActivity(minuteOfDay, dayCounts(city), parkVisitors);
    if (a.icon !== this.iconName) { this.iconName = a.icon; this.icon.replaceChildren(iconElement(a.icon)); }
    this.element.dataset.hour = String(a.hour);
    if (this.title.textContent !== a.title) this.title.textContent = a.title;
    if (this.detail.textContent !== a.detail) this.detail.textContent = a.detail;
    this.element.setAttribute('aria-label', `กิจกรรมในเมืองช่วง ${a.clock} น. ${a.title}: ${a.detail}`);
  }
}
