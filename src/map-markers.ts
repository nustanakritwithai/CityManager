import { ICONS } from './ui-icons.ts';
import { Vec3 } from 'playcanvas';
import type { CityView } from './renderer.ts';
import type { Overlay } from './map-overlay.ts';
import { ISSUE_ICONS, ISSUE_PRIORITY, type Issue } from './building-issues.ts';
import { bindIssueInput } from './building-issue-input.ts';
import { visibleIssueCells } from './building-issue-layout.ts';
import type { Preview } from './placement-preview.ts';

/** Existing map information layer; only 44px issue targets in select mode intercept input. */
export class MapMarkers {
  private readonly layer = document.createElement('div');
  private readonly tip = document.createElement('div');
  private readonly legend = document.createElement('div');
  private issues: { issue: Issue; node: HTMLButtonElement; dispose: () => void }[] = [];
  private selectionCells: number[] = [];
  private tipCell: number | null = null;
  // worldToScreen must not read and write the same vector.
  private readonly world = new Vec3();
  private readonly point = new Vec3();

  constructor(private readonly view: CityView, private readonly onIssue: (cell: number) => void) {
    this.layer.className = 'map-markers'; this.layer.setAttribute('aria-label', 'สถานะอาคารบนแผนที่');
    this.tip.className = 'map-tip'; this.tip.hidden = true;
    this.legend.className = 'map-legend'; this.legend.hidden = true;
    this.layer.append(this.tip, this.legend);
    document.querySelector('#city-canvas')!.insertAdjacentElement('afterend', this.layer);
    view.app.on('postrender', () => this.place());
  }

  setIssues(issues: Issue[], selectionCells: readonly number[]) {
    // Cache identities only when city facts change; camera frames project these
    // centres without inspecting simulation, occupants, utility or issue state.
    this.selectionCells = [...new Set(selectionCells)];
    const previous = new Map(this.issues.map(item => [item.issue.cell, item]));
    this.issues = [...issues].sort((a, b) => ISSUE_PRIORITY.indexOf(a.kind) - ISSUE_PRIORITY.indexOf(b.kind) || a.cell - b.cell).map(issue => {
      let item = previous.get(issue.cell); previous.delete(issue.cell);
      if (!item) {
        const node = document.createElement('button'); node.type = 'button';
        const dispose = bindIssueInput(node, (x, y) => { if (!this.view.cameraBlocked) this.view.pan(x, y); }, () => this.onIssue(issue.cell), () => !this.layer.hidden && !node.hidden && this.view.mode === 'select' && this.view.pointers.size === 0);
        item = { issue, node, dispose }; this.layer.append(node);
      }
      const { node } = item; item.issue = issue;
      node.className = `map-issue ${issue.tone}`; node.dataset.kind = issue.kind; node.dataset.cell = String(issue.cell);
      node.dataset.remaining = String(issue.remaining); node.title = `${issue.text}${issue.remaining ? ` · อีก ${issue.remaining} เรื่อง` : ''}`;
      node.setAttribute('aria-label', `เปิดรายละเอียดสถานที่: ${issue.details.map(fact => fact.detail).join(' · ')}`);
      node.setAttribute('aria-controls', 'inspector');
      node.innerHTML = `<span class="map-issue-symbol"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[ISSUE_ICONS[issue.kind]] ?? ''}</svg></span>${issue.remaining ? `<span class="map-issue-count" aria-hidden="true">+${issue.remaining}</span>` : ''}`;
      return item;
    });
    for (const old of previous.values()) { old.dispose(); old.node.remove(); }
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
    this.layer.dataset.interactive = String(this.view.mode === 'select');
    const points = this.issues.map(({ issue }) => { const p = this.screen(issue.cell, 3.6); return { cell: issue.cell, x: p.x, y: p.y, z: p.z }; });
    // Cull BEFORE the visible budget, so offscreen buildings cannot starve visible warnings.
    const selectionPoints = this.selectionCells.map(cell => { const p = this.screen(cell, .1); return { cell, x: p.x, y: p.y, z: p.z }; });
    const visible = visibleIssueCells(points, innerWidth, innerHeight, 64, selectionPoints);
    for (let i = 0; i < this.issues.length; i++) {
      const { issue, node } = this.issues[i], p = points[i], shown = visible.has(issue.cell);
      node.hidden = !shown; node.tabIndex = shown && this.view.mode === 'select' ? 0 : -1;
      if (shown) node.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    }
    if (this.tipCell !== null && !this.tip.hidden) {
      const p = this.screen(this.tipCell, .3);
      this.tip.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    }
  }
}
