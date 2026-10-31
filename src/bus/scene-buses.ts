/**
 * Instanced bus layer, same pattern as the traffic fleet renderer (dynamic instance buffers,
 * one mesh per batch, no per-vehicle entities). Buses are batched by level (capacity 40/60/80).
 * Lines, stops, depots and waiting figures are instanced too. This file does not read the engine.
 */
import { Entity, Mesh, MeshInstance, StandardMaterial, Color, VertexBuffer, VertexFormat, BUFFER_DYNAMIC, BLEND_NORMAL, type AppBase } from 'playcanvas';
import { busInstanceCounts, type BusDrawList, type BusInstanceCounts } from './draw-list.ts';
import { writeBasisMatrix } from './geometry.ts';
import { writeBusMatrix, writeLoadMatrix } from './poses.ts';

type Part = { x?: number; y?: number; z?: number; sx: number; sy: number; sz: number; shade: number };
const FACES = [
  { n: [1, 0, 0], v: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
  { n: [-1, 0, 0], v: [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]] },
  { n: [0, 1, 0], v: [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]] },
  { n: [0, -1, 0], v: [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]] },
  { n: [0, 0, 1], v: [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]] },
  { n: [0, 0, -1], v: [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]] },
];

function unitMesh(app: AppBase, parts: readonly Part[]): Mesh {
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], indices: number[] = [];
  for (const part of parts) {
    const x = part.x ?? 0, y = part.y ?? 0, z = part.z ?? 0;
    for (const face of FACES) {
      const base = positions.length / 3;
      for (const p of face.v) {
        positions.push(x + p[0]! * part.sx / 2, y + p[1]! * part.sy / 2, z + p[2]! * part.sz / 2);
        normals.push(face.n[0]!, face.n[1]!, face.n[2]!);
        colors.push(part.shade, part.shade, part.shade, 255);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const mesh = new Mesh(app.graphicsDevice);
  mesh.setPositions(positions); mesh.setNormals(normals); mesh.setColors32(colors); mesh.setIndices(indices); mesh.update();
  return mesh;
}

class Instancer {
  private buffer: VertexBuffer | null = null;
  private matrices = new Float32Array(0);
  private capacity = 0;
  private readonly instance: MeshInstance;
  private readonly material: StandardMaterial;
  readonly entity: Entity;
  constructor(private readonly app: AppBase, mesh: Mesh, parent: Entity, color: string, opts: { opacity?: number; emissive?: boolean; vertex?: boolean } = {}) {
    this.material = new StandardMaterial();
    const rgb = new Color().fromString(color);
    if (opts.emissive) { this.material.diffuse = new Color(0, 0, 0); this.material.emissive = rgb; this.material.useLighting = false; }
    else { this.material.diffuse = rgb; if (opts.vertex) this.material.diffuseVertexColor = true; }
    if (opts.opacity != null && opts.opacity < 1) { this.material.opacity = opts.opacity; this.material.blendType = BLEND_NORMAL; this.material.depthWrite = false; }
    this.material.update();
    this.entity = new Entity('Bus instance batch');
    parent.addChild(this.entity);
    this.instance = new MeshInstance(mesh, this.material, this.entity);
    this.instance.castShadow = false; this.instance.receiveShadow = false; this.instance.cull = false;
    this.entity.addComponent('render', { meshInstances: [this.instance], castShadows: false, receiveShadows: false });
    this.entity.enabled = false;
  }
  /** `count` instances. `write` fills one 16-float matrix at `index`. */
  sync(count: number, write: (matrices: Float32Array, index: number) => void): void {
    this.entity.enabled = count > 0;
    if (!count) return;
    if (count > this.capacity) {
      this.instance.setInstancing(null); this.buffer?.destroy();
      this.capacity = 2 ** Math.ceil(Math.log2(Math.max(16, count)));
      this.matrices = new Float32Array(this.capacity * 16);
      this.buffer = new VertexBuffer(this.app.graphicsDevice, VertexFormat.getDefaultInstancingFormat(this.app.graphicsDevice), this.capacity, { usage: BUFFER_DYNAMIC, data: this.matrices });
      this.instance.setInstancing(this.buffer, false);
    }
    for (let i = 0; i < count; i++) write(this.matrices, i);
    this.buffer!.setData(this.matrices);
    this.instance.instancingCount = count;
  }
  destroy(): void { this.instance.setInstancing(null); this.buffer?.destroy(); this.entity.destroy(); this.material.destroy(); }
}

export class SceneBuses {
  private readonly root = new Entity('Bus layer');
  private readonly busMesh: Mesh;
  private readonly ribbon: Mesh;
  private readonly buses: Instancer[];
  private readonly loads: Instancer;
  private readonly dwelling: Instancer;
  private readonly poles: Instancer;
  private readonly shelters: Instancer;
  private readonly depots: Instancer[];
  private readonly crowds: Instancer;
  private readonly lines = new Map<string, Instancer>();
  private counts: BusInstanceCounts = busInstanceCounts({ buses: [], loads: [], dwelling: [], lines: [], stops: [], depots: [], crowds: [], captions: [] });
  constructor(private readonly app: AppBase) {
    app.root.addChild(this.root);
    this.busMesh = unitMesh(app, [
      { sx: 1, sy: 0.62, sz: 1, y: -0.05, shade: 255 },
      { sx: 0.92, sy: 0.28, sz: 0.62, y: 0.32, z: 0.08, shade: 150 },
      { sx: 0.72, sy: 0.16, sz: 0.08, y: 0.34, z: 0.42, shade: 70 },
    ]);
    this.ribbon = unitMesh(app, [{ sx: 1, sy: 1, sz: 1, shade: 255 }]);
    const pole = unitMesh(app, [
      { sx: 0.16, sy: 0.9, sz: 0.16, shade: 210 },
      { sx: 0.72, sy: 0.28, sz: 0.12, y: 0.28, z: 0.18, shade: 255 },
      { sx: 0.72, sy: 0.08, sz: 0.14, y: 0.28, z: 0.18, shade: 40 },
    ]);
    const shelter = unitMesh(app, [
      { sx: 1, sy: 0.08, sz: 1, y: -0.42, shade: 170 },
      { sx: 1, sy: 0.08, sz: 0.9, y: 0.36, shade: 240 },
      { sx: 1, sy: 0.55, sz: 0.08, y: 0.02, z: -0.36, shade: 200 },
      { sx: 0.7, sy: 0.08, sz: 0.28, y: -0.12, shade: 110 },
    ]);
    const depot = unitMesh(app, [
      { sx: 1, sy: 0.08, sz: 1, y: -0.46, shade: 150 },
      { sx: 0.82, sy: 0.7, sz: 0.68, shade: 230 },
      { sx: 0.92, sy: 0.1, sz: 0.78, y: 0.38, shade: 70 },
      { sx: 0.28, sy: 0.32, sz: 0.06, y: -0.12, z: 0.36, shade: 40 },
    ]);
    const person = unitMesh(app, [
      { sx: 0.4, sy: 0.5, sz: 0.28, shade: 255 },
      { sx: 0.26, sy: 0.26, sz: 0.26, y: 0.4, shade: 190 },
    ]);
    const box = unitMesh(app, [{ sx: 1, sy: 1, sz: 1, shade: 255 }]);
    this.buses = ['#1f6feb', '#148f62', '#e3941a'].map(color => new Instancer(app, this.busMesh, this.root, color, { vertex: true }));
    this.loads = new Instancer(app, box, this.root, '#ffe08a', { emissive: true });
    this.dwelling = new Instancer(app, box, this.root, '#f2c14e', { emissive: true, opacity: 0.8 });
    this.poles = new Instancer(app, pole, this.root, '#e8eef5', { vertex: true });
    this.shelters = new Instancer(app, shelter, this.root, '#f7f4ee', { vertex: true });
    this.depots = ['#e6b325', '#f0c14e', '#ffd56a', '#8d887c'].map(color => new Instancer(app, depot, this.root, color, { vertex: true }));
    this.crowds = new Instancer(app, person, this.root, '#e07a5f', { vertex: true });
  }
  /** Upload one instance per draw-list entry. An empty list hides the layer. */
  sync(draw: BusDrawList): void {
    this.counts = busInstanceCounts(draw);
    const levels: (typeof draw.buses)[] = [[], [], []];
    for (const bus of draw.buses) levels[bus.paint]!.push(bus);
    levels.forEach((group, paint) => this.buses[paint]!.sync(group.length, (m, i) => writeBusMatrix(m, i * 16, group[i]!)));
    this.loads.sync(draw.loads.length, (m, i) => writeLoadMatrix(m, i * 16, draw.loads[i]!));
    this.dwelling.sync(draw.dwelling.length, (m, i) => {
      const pose = draw.dwelling[i]!;
      writeBasisMatrix(m, i * 16, { x: pose.x, y: 0.19, z: pose.z, headingX: pose.headingX, headingZ: pose.headingZ, sx: pose.width * 1.35, sy: 0.03, sz: pose.length * 1.1 });
    });
    const used = new Set<string>();
    const groups = new Map<string, typeof draw.lines>();
    for (const seg of draw.lines) {
      const key = `${seg.paused ? 1 : 0}|${seg.color}`;
      const group = groups.get(key); if (group) group.push(seg); else groups.set(key, [seg]);
    }
    for (const [key, group] of groups) {
      used.add(key);
      const paused = key.startsWith('1'), color = key.slice(2);
      let batch = this.lines.get(key);
      if (!batch) { batch = new Instancer(this.app, this.ribbon, this.root, color, { emissive: true, opacity: paused ? 0.4 : 0.92 }); this.lines.set(key, batch); }
      batch.sync(group.length, (m, i) => {
        const seg = group[i]!;
        writeBasisMatrix(m, i * 16, { x: seg.x, y: seg.y, z: seg.z, headingX: seg.headingX, headingZ: seg.headingZ, sx: seg.width, sy: 0.025, sz: seg.length });
      });
    }
    for (const [key, batch] of this.lines) if (!used.has(key)) batch.sync(0, () => {});
    const poles = draw.stops.filter(stop => stop.kind === 'pole'), shelters = draw.stops.filter(stop => stop.kind === 'shelter');
    this.poles.sync(poles.length, (m, i) => place(m, i, poles[i]!));
    this.shelters.sync(shelters.length, (m, i) => place(m, i, shelters[i]!));
    const depots: (typeof draw.depots)[] = [[], [], [], []];
    for (const depot of draw.depots) depots[depot.open ? depot.level - 1 : 3]!.push(depot);
    depots.forEach((group, i) => this.depots[i]!.sync(group.length, (m, n) => place(m, n, group[n]!)));
    this.crowds.sync(draw.crowds.length, (m, i) => {
      const mark = draw.crowds[i]!;
      writeBasisMatrix(m, i * 16, { x: mark.x, y: mark.y, z: mark.z, headingX: 0, headingZ: 1, sx: 0.18, sy: 0.4, sz: 0.16 });
    });
    this.root.enabled = this.counts.total > 0;
    this.app.renderNextFrame = true;
  }
  get diagnostics() { return { ...this.counts, batches: this.liveBatches }; }
  private get liveBatches() {
    return [...this.buses, this.loads, this.dwelling, this.poles, this.shelters, ...this.depots, this.crowds, ...this.lines.values()].filter(batch => batch.entity.enabled).length;
  }
  destroy(): void {
    for (const batch of [...this.buses, this.loads, this.dwelling, this.poles, this.shelters, ...this.depots, this.crowds, ...this.lines.values()]) batch.destroy();
    this.root.destroy();
  }
}
function place(m: Float32Array, index: number, mark: { x: number; y: number; z: number; headingX: number; headingZ: number; sx: number; sy: number; sz: number }) {
  writeBasisMatrix(m, index * 16, mark);
}
