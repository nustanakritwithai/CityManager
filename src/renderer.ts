import {
  AppBase, AppOptions, createGraphicsDevice, DEVICETYPE_WEBGL2,
  RenderComponentSystem, CameraComponentSystem, LightComponentSystem,
  Entity, Mesh, MeshInstance, StandardMaterial, Color, Vec3, FILLMODE_NONE, RESOLUTION_AUTO
} from 'playcanvas';
import { SIZE, connectedRoads, type City } from './sim.ts';

const UNIT = 2;
export class CityView {
  app: AppBase;
  camera = new Entity('City camera');
  target = new Vec3(0, 0, 0);
  yaw = Math.PI / 4;
  radius = 65;
  mode = 'select';
  tiles = new Map<number, { entity: Entity; signature: string }>();
  markers = new Entity('Tool previews');
  materials = new Map<string, StandardMaterial>();
  pointers = new Map<number, { x: number; y: number }>();
  dragStart: number | null = null;
  private down: { x: number; y: number; button: number; moved: boolean; multi: boolean; cell: number | null } | null = null;
  constructor(public canvas: HTMLCanvasElement, app: AppBase, public onCell: (i: number) => void, public onHover: (i: number | null) => void, public onRoad: (a: number, b: number) => void) {
    this.app = app;
  }
  static async create(canvas: HTMLCanvasElement, onCell: (i: number) => void, onHover: (i: number | null) => void, onRoad: (a: number, b: number) => void) {
    const device = await createGraphicsDevice(canvas, { deviceTypes: [DEVICETYPE_WEBGL2], antialias: true });
    device.maxPixelRatio = Math.min(devicePixelRatio, 1.5);
    const options = new AppOptions();
    options.graphicsDevice = device;
    options.componentSystems = [RenderComponentSystem, CameraComponentSystem, LightComponentSystem];
    const app = new AppBase(canvas);
    app.init(options);
    app.setCanvasFillMode(FILLMODE_NONE);
    app.setCanvasResolution(RESOLUTION_AUTO);
    app.autoRender = false;
    const view = new CityView(canvas, app, onCell, onHover, onRoad);
    view.setup();
    app.start();
    return view;
  }
  material(hex: string, emissive = false) {
    const key = hex + emissive;
    if (this.materials.has(key)) return this.materials.get(key)!;
    const material = new StandardMaterial();
    const color = new Color().fromString(hex);
    material.diffuse = color;
    material.gloss = 0.25;
    if (emissive) material.emissive = color.clone().mulScalar(0.3);
    material.update();
    this.materials.set(key, material);
    return material;
  }
  box(parent: Entity, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string) {
    const entity = new Entity('Original primitive');
    entity.addComponent('render', { type: 'box', material: this.material(color), castShadows: false });
    entity.setLocalPosition(x, y, z);
    entity.setLocalScale(sx, sy, sz);
    parent.addChild(entity);
    return entity;
  }
  setup() {
    this.app.scene.ambientLight = new Color(0.65, 0.72, 0.78);
    this.camera.addComponent('camera', { clearColor: new Color(0.1, 0.19, 0.25), fov: 48, nearClip: 0.1, farClip: 260 });
    this.app.root.addChild(this.camera);
    const sun = new Entity('Afternoon sun');
    sun.addComponent('light', { type: 'directional', color: new Color(1, 0.9, 0.72), intensity: 1.7, castShadows: false });
    sun.setLocalEulerAngles(48, 25, 0);
    this.app.root.addChild(sun);
    this.box(this.app.root, 0, -0.85, 0, 160, 0.4, 160, '#264858');
    this.box(this.app.root, 0, -0.4, 0, SIZE * UNIT + 1.1, 0.8, SIZE * UNIT + 1.1, '#4b6357');
    // One ground and one grid mesh instead of 576 individual draw calls.
    // Road graph and parcel occupancy still live only in sim.ts.
    this.box(this.app.root, 0, 0.005, 0, SIZE * UNIT, 0.035, SIZE * UNIT, '#799375');
    const positions: number[] = [], normals: number[] = [], indices: number[] = [];
    const quad = (x0: number, z0: number, x1: number, z1: number) => {
      const start = positions.length / 3;
      positions.push(x0, .027, z0, x0, .027, z1, x1, .027, z1, x1, .027, z0);
      normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    };
    for (let n = 0; n <= SIZE; n++) {
      const d = n * UNIT - SIZE;
      quad(d - .022, -SIZE, d + .022, SIZE);
      quad(-SIZE, d - .022, SIZE, d + .022);
    }
    const gridMesh = new Mesh(this.app.graphicsDevice);
    gridMesh.setPositions(positions); gridMesh.setNormals(normals); gridMesh.setIndices(indices); gridMesh.update();
    const grid = new Entity('Parcel grid');
    grid.addComponent('render', { meshInstances: [new MeshInstance(gridMesh, this.material('#60775e'))], castShadows: false });
    this.app.root.addChild(grid);
    // Outside gateway across the western map edge.
    const gate = this.position(Math.floor(SIZE / 2) * SIZE);
    this.box(this.app.root, gate.x - 4, 0.04, gate.z, 8, 0.12, 1.4, '#d6b45c');
    this.box(this.app.root, gate.x - 1.1, 1.1, gate.z - 0.85, 0.18, 2.2, 0.18, '#f5cd71');
    this.box(this.app.root, gate.x - 1.1, 1.1, gate.z + 0.85, 0.18, 2.2, 0.18, '#f5cd71');
    for (let n = 0; n < 34; n++) {
      const angle = n * 2.39996;
      const x = Math.cos(angle) * (SIZE + 1.7), z = Math.sin(angle) * (SIZE + 1.7);
      if (Math.abs(x) < SIZE - 1 && Math.abs(z) < SIZE - 1 || x < -SIZE && Math.abs(z - gate.z) < 3) continue;
      this.box(this.app.root, x, 0.65, z, 0.22, 1.1, 0.22, '#755f43');
      const crown = new Entity('Original tree');
      crown.addComponent('render', { type: 'cone', material: this.material('#3e6955') });
      crown.setLocalPosition(x, 1.55, z); crown.setLocalScale(1.4, 2, 1.4); this.app.root.addChild(crown);
    }
    this.app.root.addChild(this.markers);
    new ResizeObserver(() => this.resize()).observe(this.canvas);
    this.radius = this.fitRadius(); this.resize(); this.updateCamera(); this.input();
  }
  fitRadius() { return Math.max(65, Math.min(150, 65 * .95 / (this.canvas.clientWidth / this.canvas.clientHeight))); }
  resize() { this.app.resizeCanvas(this.canvas.clientWidth, this.canvas.clientHeight); this.app.renderNextFrame = true; }
  abortGesture() {
    this.down = null; this.dragStart = null;
    for (const id of this.pointers.keys()) if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
    this.pointers.clear();
  }
  position(i: number) { return { x: ((i % SIZE) - (SIZE - 1) / 2) * UNIT, z: (Math.floor(i / SIZE) - (SIZE - 1) / 2) * UNIT }; }
  project(i: number) {
    const p = this.position(i); const v = this.camera.camera!.worldToScreen(new Vec3(p.x, 0.1, p.z));
    return { x: v.x, y: v.y };
  }
  pick(clientX: number, clientY: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    const a = this.camera.camera!.screenToWorld(x, y, 0.1), b = this.camera.camera!.screenToWorld(x, y, 200);
    const t = -a.y / (b.y - a.y);
    const px = a.x + (b.x - a.x) * t, pz = a.z + (b.z - a.z) * t;
    const gx = Math.floor(px / UNIT + SIZE / 2), gz = Math.floor(pz / UNIT + SIZE / 2);
    return gx >= 0 && gx < SIZE && gz >= 0 && gz < SIZE ? gz * SIZE + gx : null;
  }
  updateCamera() {
    const elevation = 0.88;
    this.camera.setPosition(this.target.x + Math.sin(this.yaw) * this.radius * Math.cos(elevation), this.radius * Math.sin(elevation), this.target.z + Math.cos(this.yaw) * this.radius * Math.cos(elevation));
    this.camera.lookAt(this.target);
    this.app.renderNextFrame = true;
  }
  pan(dx: number, dy: number) {
    const scale = this.radius / 700;
    this.target.x += (-dx * Math.cos(this.yaw) - dy * Math.sin(this.yaw)) * scale;
    this.target.z += (dx * Math.sin(this.yaw) - dy * Math.cos(this.yaw)) * scale;
    this.target.x = Math.max(-22, Math.min(22, this.target.x));
    this.target.z = Math.max(-22, Math.min(22, this.target.z)); this.updateCamera();
  }
  control(action: string) {
    if (action === 'reset') { this.target.set(0, 0, 0); this.yaw = Math.PI / 4; this.radius = this.fitRadius(); }
    if (action === 'zoom-in') this.radius = Math.max(19, this.radius * 0.86);
    if (action === 'zoom-out') this.radius = Math.min(180, this.radius / 0.86);
    if (action === 'rotate-left') this.yaw -= Math.PI / 8;
    if (action === 'rotate-right') this.yaw += Math.PI / 8;
    if (action === 'left') this.pan(55, 0);
    if (action === 'right') this.pan(-55, 0);
    if (action === 'up') this.pan(0, 55);
    if (action === 'down') this.pan(0, -55);
    this.updateCamera();
  }
  input() {
    const c = this.canvas;
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('wheel', e => { e.preventDefault(); this.radius = Math.max(19, Math.min(180, this.radius * Math.exp(e.deltaY * 0.001))); this.updateCamera(); }, { passive: false });
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId); this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        const cell = this.pick(e.clientX, e.clientY);
        this.down = { x: e.clientX, y: e.clientY, button: e.button, moved: false, multi: false, cell };
        this.dragStart = this.mode === 'road' && e.button === 0 ? cell : null;
      } else if (this.down) { this.down.multi = true; this.dragStart = null; }
    });
    c.addEventListener('pointermove', e => {
      const previous = this.pointers.get(e.pointerId);
      if (!previous) { this.onHover(this.pick(e.clientX, e.clientY)); return; }
      const dx = e.clientX - previous.x, dy = e.clientY - previous.y;
      if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 7) this.down.moved = true;
      if (this.pointers.size === 2) {
        const other = [...this.pointers.entries()].find(([id]) => id !== e.pointerId)![1];
        const oldDistance = Math.hypot(previous.x - other.x, previous.y - other.y);
        const newDistance = Math.hypot(e.clientX - other.x, e.clientY - other.y);
        if (newDistance > 1) this.radius = Math.max(19, Math.min(180, this.radius * oldDistance / newDistance));
        this.pan(dx / 2, dy / 2); this.updateCamera();
      } else if (this.down?.button === 2 || e.altKey) {
        this.yaw -= dx * 0.007; this.updateCamera();
      } else if (this.mode === 'pan' || this.down?.button === 1) this.pan(dx, dy);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.onHover(this.pick(e.clientX, e.clientY));
    });
    c.addEventListener('pointerup', e => {
      this.dragStart = null;
      if (this.down && !this.down.moved && !this.down.multi && this.down.button === 0 && this.mode !== 'pan') {
        const index = this.pick(e.clientX, e.clientY); if (index !== null) this.onCell(index);
      } else if (this.down && this.down.moved && !this.down.multi && this.down.button === 0 && this.mode === 'road') {
        const end = this.pick(e.clientX, e.clientY);
        if (this.down.cell !== null && end !== null) this.onRoad(this.down.cell, end);
      }
      this.pointers.delete(e.pointerId); if (!this.pointers.size) this.down = null;
    });
    c.addEventListener('pointercancel', e => { this.pointers.delete(e.pointerId); this.down = null; this.dragStart = null; this.onHover(null); });
  }
  render(city: City, selected: number | null, preview: number[]) {
    this.app.renderNextFrame = true;
    const connected = connectedRoads(city);
    for (let i = 0; i < city.cells.length; i++) {
      const cell = city.cells[i], b = city.buildings.find(b => b.cell === i);
      const signature = `${cell.road}:${cell.zone}:${b?.id}:${b?.level}:${connected.has(i)}`;
      if (this.tiles.get(i)?.signature === signature) continue;
      this.tiles.get(i)?.entity.destroy();
      const tile = new Entity(`Parcel ${i}`); const { x, z } = this.position(i); tile.setLocalPosition(x, 0, z); this.app.root.addChild(tile);
      this.tiles.set(i, { entity: tile, signature });
      if (cell.road) {
        this.box(tile, 0, 0.065, 0, 1.96, 0.1, 1.96, connected.has(i) ? '#3c4b54' : '#8f5550');
        this.box(tile, 0, 0.125, 0, 0.5, 0.015, 0.11, connected.has(i) ? '#ecdeb0' : '#ffc7a0');
      } else if (cell.zone) {
        const color = { R: '#5cad86', C: '#5d9fc7', I: '#d7a053' }[cell.zone];
        this.box(tile, 0, 0.05, 0, 1.8, 0.07, 1.8, color);
        if (b) {
          const h = 0.9 + b.level * 0.75 + (i % 3) * 0.22;
          const tower = b.zone === 'I' ? h * 0.65 : h;
          this.box(tile, -0.1, tower / 2 + 0.1, 0, 1.25, tower, 1.2, { R: '#d7e5d1', C: '#b6d4df', I: '#d9c09a' }[b.zone]);
          this.box(tile, -0.1, tower + 0.17, 0, 1.34, 0.16, 1.3, { R: '#386454', C: '#38677f', I: '#8c6340' }[b.zone]);
          for (let level = 0; level < Math.min(b.level + 1, 5); level++) {
            for (const wx of [-0.44, 0.2]) this.box(tile, wx, 0.52 + level * 0.55, 0.608, 0.25, 0.27, 0.035, '#f9df9a');
          }
          if (b.zone === 'I') this.box(tile, 0.52, h * 0.65, -0.38, 0.2, h * 1.1, 0.22, '#786b60');
        }
      }
    }
    for (const child of [...this.markers.children]) child.destroy();
    for (const i of new Set([...preview, ...(selected === null ? [] : [selected])])) {
      const p = this.position(i); const color = i === selected ? '#fff1bb' : '#f7bf60';
      for (const dz of [-0.92, 0.92]) this.box(this.markers, p.x, 0.18, p.z + dz, 1.94, 0.08, 0.07, color);
      for (const dx of [-0.92, 0.92]) this.box(this.markers, p.x + dx, 0.18, p.z, 0.07, 0.08, 1.94, color);
    }
  }
}
