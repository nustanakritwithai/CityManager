import { Entity } from 'playcanvas';
import type { CityView } from './renderer.ts';
import { parkActivityVisitors, type ParkActivityState } from './park-activity.ts';

export type ParkActivityQuality = 'low' | 'medium' | 'high';
export const PARK_RENDER_CAP = { low: 12, medium: 24, high: 48 } as const;
type Visitor = ReturnType<typeof parkActivityVisitors>[number];
type Figure = { root: Entity; body: Entity; head: Entity; arms: Entity[]; legs: Entity[] };
const COLOURS = ['#ed9479', '#519ac4', '#e2bd64', '#81ba9f', '#b18cc9', '#d5ddd0'];

/** A read-only projection of citizen activity. Never creates visits or advances their clock. */
export class SceneParkActivity {
  private readonly root = new Entity('Simulated park citizens');
  private readonly figures = new Map<string, Figure>();
  private count = 0;
  private reservations = 0;
  private quality: ParkActivityQuality = 'medium';
  constructor(private readonly view: CityView) { view.app.root.addChild(this.root); }
  setQuality(quality: ParkActivityQuality) { this.quality = quality; }
  get diagnostics() {
    return { simulatedVisitors: this.count, activeReservations: this.reservations, waitingAtHome: this.reservations - this.count, renderedVisitors: this.figures.size, hiddenByLOD: this.count - this.figures.size,
      cap: PARK_RENDER_CAP[this.quality], citizenIds: [...this.figures.keys()], quality: this.quality };
  }
  sync(state: ParkActivityState) {
    const visitors = parkActivityVisitors(state);
    this.reservations = state.visitors.length;
    this.count = visitors.length;
    // Choose a stable nearby subset. LOD never feeds back into reservations or activity.
    const distance = (v: Visitor) => ((v.x - 12) * 2 - this.view.target.x) ** 2 + ((v.z - 12) * 2 - this.view.target.z) ** 2;
    const selected = [...visitors].sort((a, b) => distance(a) - distance(b) || a.citizenId.localeCompare(b.citizenId))
      .slice(0, PARK_RENDER_CAP[this.quality]);
    const wanted = new Set(selected.map(v => v.citizenId));
    for (const [id, f] of this.figures) if (!wanted.has(id)) { f.root.destroy(); this.figures.delete(id); }
    for (const visitor of selected) {
      let figure = this.figures.get(visitor.citizenId);
      if (!figure) { figure = this.makeFigure(visitor); this.figures.set(visitor.citizenId, figure); }
      this.pose(figure, visitor, state.minute);
    }
    this.view.app.renderNextFrame = true;
  }
  destroy() { this.root.destroy(); this.figures.clear(); }
  private makeFigure(v: Visitor): Figure {
    const root = new Entity(`Citizen ${v.citizenId}`);
    const colour = COLOURS[(v.householdId + v.memberSlot) % COLOURS.length];
    const part = (x: number, y: number, z: number, sx: number, sy: number, sz: number, hex: string) => this.view.box(root, x, y, z, sx, sy, sz, hex, false);
    const body = part(0, .235, 0, .13, .18, .09, colour);
    const head = part(0, .385, 0, .09, .09, .09, '#eac3a1');
    const arms = [-1, 1].map(side => part(side * .09, .235, 0, .04, .16, .045, colour));
    const legs = [-1, 1].map(side => part(side * .04, .08, 0, .045, .16, .055, '#394755'));
    this.root.addChild(root);
    return { root, body, head, arms, legs };
  }
  private pose(f: Figure, v: Visitor, minute: number) {
    const sitting = v.phase === 'sit';
    const moving = ['travel', 'enter', 'stroll', 'leave'].includes(v.phase);
    const gait = moving ? Math.sin(minute * 2.7 + v.memberSlot) * 24 : 0;
    f.root.setLocalPosition((v.x - 12) * 2, sitting ? .14 : .13, (v.z - 12) * 2);
    f.root.setLocalEulerAngles(0, Math.atan2(v.headingX, v.headingZ) * 180 / Math.PI, 0);
    f.body.setLocalPosition(0, sitting ? .245 : .235, 0);
    f.head.setLocalPosition(0, sitting ? .395 : .385, 0);
    f.arms.forEach((arm, i) => { arm.enabled = this.quality !== 'low'; arm.setLocalEulerAngles(sitting ? -48 : i ? gait : -gait, 0, 0); });
    f.legs.forEach((leg, i) => {
      leg.setLocalPosition(i ? .04 : -.04, sitting ? .13 : .08, sitting ? .065 : 0);
      leg.setLocalEulerAngles(sitting ? -70 : i ? -gait : gait, 0, 0);
    });
  }
}
