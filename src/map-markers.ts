import { ICONS } from './ui-icons.ts';
import { Vec3 } from 'playcanvas';
import type { CityView } from './renderer.ts';
import type { Issue, IssueKind, Overlay } from './map-overlay.ts';
import type { Preview } from './placement-preview.ts';

const SEVERE: ReadonlySet<IssueKind> = new Set(['no-road', 'no-utilities', 'no-workers', 'no-input', 'unsuitable-fertility']);
const MAX_MARKERS = 64;

/**
 * Screen-space labels over the 3D map: building issue badges, the placement tip and
 * the active layer legend. Purely presentational (pointer-events: none); the same facts
 * remain in the inspector, so nothing is conveyed by these badges alone.
 */
/** The badge shows the cause, not just that something is wrong. */
const ISSUE_ICONS: Record<string, string> = { 'no-road': 'road', 'no-utilities': 'power', 'no-workers': 'worker', 'no-input': 'crop', 'stock-cap': 'box', 'no-buyer': 'coin', 'no-stock': 'shop', 'unsuitable-fertility': 'F', 'empty-home': 'R', 'importing': 'import' };
export class MapMarkers {
  private readonly layer = document.createElement('div');
  private readonly tip = document.createElement('div');
  private readonly legend = document.createElement('div');
  private issues: { issue: Issue; node: HTMLElement }[] = [];
  private tipCell: number | null = null;
  // worldToScreen must not read and write the same vector.
  private readonly world = new Vec3();
  private readonly point = new Vec3();

  constructor(private readonly view: CityView) {
    this.layer.className = 'map-markers'; this.layer.setAttribute('aria-hidden', 'true');
    this.tip.className = 'map-tip'; this.tip.hidden = true;
    this.legend.className = 'map-legend'; this.legend.hidden = true;
    this.layer.append(this.tip, this.legend);
    document.querySelector('#city-canvas')!.insertAdjacentElement('afterend', this.layer);
    view.app.on('postrender', () => this.place());
  }

  setIssues(issues: Issue[]) {
    for (const old of this.issues) old.node.remove();
    this.issues = issues.slice(0, MAX_MARKERS).map(issue => {
      const node = document.createElement('span');
      node.className = `map-issue ${SEVERE.has(issue.kind) ? 'bad' : 'warn'}`; node.dataset.kind = issue.kind; node.title = issue.text;
      node.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[ISSUE_ICONS[issue.kind]] ?? ''}</svg>`;
      this.layer.append(node); return { issue, node };
    });
    this.place();
  }

  setPreview(preview: Preview | null, cell: number | null) {
    this.tipCell = preview ? cell : null;
    this.tip.hidden = !preview;
    if (preview) { this.tip.textContent = preview.label; this.tip.dataset.ok = String(preview.ok); }
    this.place();
  }

  setLegend(overlay: Overlay | null) {
    this.legend.hidden = !overlay;
    this.legend.replaceChildren(...(overlay?.legend ?? []).map(([tone, text]) => {
      const item = document.createElement('span'); item.className = `map-legend-item ${tone}`; item.textContent = text; return item;
    }));
  }

  setVisible(visible: boolean) { this.layer.hidden = !visible; }

  private screen(cell: number, height: number) {
    const { x, z } = this.view.position(cell);
    this.view.camera.camera!.worldToScreen(this.world.set(x, height, z), this.point);
    return this.point;
  }

  /** Follows the camera after every rendered frame; off-screen badges are hidden. */
  private place() {
    if (this.layer.hidden) return;
    for (const { issue, node } of this.issues) {
      const p = this.screen(issue.cell, 2.4), visible = p.z > 0 && p.x > -20 && p.y > -20 && p.x < innerWidth + 20 && p.y < innerHeight + 20;
      node.hidden = !visible;
      if (visible) node.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    }
    if (this.tipCell !== null && !this.tip.hidden) {
      const p = this.screen(this.tipCell, .3);
      this.tip.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    }
  }
}
