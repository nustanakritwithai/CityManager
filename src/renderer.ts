import {
  AppBase, AppOptions, createGraphicsDevice, DEVICETYPE_WEBGL2,
  RenderComponentSystem, CameraComponentSystem, LightComponentSystem,
  Entity, Mesh, MeshInstance, StandardMaterial, Color, Vec3, FILLMODE_NONE, RESOLUTION_AUTO, ContainerHandler, TextureHandler, BLEND_NORMAL
} from 'playcanvas';
import { SIZE, connectedRoads, type City } from './sim.ts';
import { CityAssets } from './asset-models.ts';
import { CityGround } from './terrain.ts';

const UNIT = 2;
export class CityView {
  app: AppBase;
  camera = new Entity('City camera');
  target = new Vec3(-10, 0, 0);
  yaw = Math.PI / 4;
  radius = 65;
  mode = 'select';
  cameraBlocked = false;
  tiles = new Map<number, { entity: Entity; signature: string }>();
  markers = new Entity('Tool previews');
  materials = new Map<string, StandardMaterial>();
  assets: CityAssets | null = null;
  ground!: CityGround;
  private edgeMesh?: Mesh;
  private edgeSignature = '';
  private visualRevision = 0;
  private lastScene: { city: City; selected: number | null; preview: number[] } | null = null;
  private forest: { entity: Entity; x: number; z: number }[] = [];
  pointers = new Map<number, { x: number; y: number }>();
  dragStart: number | null = null;
  private aspect = 0;
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
    options.resourceHandlers = [ContainerHandler, TextureHandler];
    const app = new AppBase(canvas);
    app.init(options);
    app.setCanvasFillMode(FILLMODE_NONE);
    app.setCanvasResolution(RESOLUTION_AUTO);
    app.autoRender = false;
    const view = new CityView(canvas, app, onCell, onHover, onRoad);
    view.setup();
    app.start();
    void CityAssets.load(app).then(assets => {
      view.assets = assets; view.visualRevision++;
      for (const tree of view.forest) {
        const model = assets.tree();
        if (model) { tree.entity.destroy(); model.setLocalPosition(tree.x, .04, tree.z); app.root.addChild(model); tree.entity = model; }
      }
      if (view.lastScene) view.render(view.lastScene.city, view.lastScene.selected, view.lastScene.preview);
    });
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
  box(parent: Entity, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string | StandardMaterial) {
    const entity = new Entity('Original primitive');
    entity.addComponent('render', { type: 'box', material: typeof color === 'string' ? this.material(color) : color, castShadows: false });
    entity.setLocalPosition(x, y, z);
    entity.setLocalScale(sx, sy, sz);
    parent.addChild(entity);
    return entity;
  }
  setup() {
    this.app.scene.ambientLight = new Color(0.52, 0.58, 0.63);
    this.camera.addComponent('camera', { clearColor: new Color(0.16, 0.27, 0.32), fov: 48, nearClip: 0.5, farClip: 260 });
    this.app.root.addChild(this.camera);
    const sun = new Entity('Afternoon sun');
    sun.addComponent('light', { type: 'directional', color: new Color(1, 0.93, 0.81), intensity: 1.25, castShadows: false });
    sun.setLocalEulerAngles(48, 25, 0);
    this.app.root.addChild(sun);
    this.box(this.app.root, 0, -0.85, 0, 160, 0.4, 160, '#365e6b');
    this.box(this.app.root, 0, -.45, 0, SIZE * UNIT + 5.1, .6, SIZE * UNIT + 5.1, '#b7b596');
    this.box(this.app.root, 0, -.24, 0, SIZE * UNIT + 4.5, .48, SIZE * UNIT + 4.5, '#7c9875');
    // One original textured ground, a tool-only grid and one batched edge mesh.
    // These visual surfaces never change the flat simulation/picking plane.
    this.ground = new CityGround(this.app, SIZE, UNIT);
    this.app.root.addChild(this.ground.root);
    const edgeMaterial = new StandardMaterial();
    edgeMaterial.diffuse = new Color(1, 1, 1); edgeMaterial.diffuseVertexColor = true;
    edgeMaterial.opacityVertexColor = true; edgeMaterial.opacityVertexColorChannel = 'a';
    edgeMaterial.blendType = BLEND_NORMAL; edgeMaterial.depthWrite = false; edgeMaterial.update();
    this.edgeMesh = new Mesh(this.app.graphicsDevice);
    // Establish the vertex-color format before MeshInstance caches shader flags.
    this.edgeMesh.setPositions([0, .041, 0, 0, .041, 0, 0, .041, 0]);
    this.edgeMesh.setNormals([0, 1, 0, 0, 1, 0, 0, 1, 0]);
    this.edgeMesh.setColors32([147, 137, 104, 0, 147, 137, 104, 0, 147, 137, 104, 0]);
    this.edgeMesh.setIndices([0, 1, 2]); this.edgeMesh.update();
    const edges = new Entity('Soft road and plot transitions');
    edges.addComponent('render', { meshInstances: [new MeshInstance(this.edgeMesh, edgeMaterial)], castShadows: false });
    this.app.root.addChild(edges);
    // Outside gateway across the western map edge.
    const gate = this.position(Math.floor(SIZE / 2) * SIZE);
    this.box(this.app.root, gate.x - 4, 0.04, gate.z, 8, 0.12, 1.4, '#d6b45c');
    this.box(this.app.root, gate.x - 1.1, 1.1, gate.z - 0.85, 0.18, 2.2, 0.18, '#f5cd71');
    this.box(this.app.root, gate.x - 1.1, 1.1, gate.z + 0.85, 0.18, 2.2, 0.18, '#f5cd71');
    for (let n = 0; n < 34; n++) {
      const angle = n * 2.39996;
      const x = Math.cos(angle) * (SIZE + 1.7), z = Math.sin(angle) * (SIZE + 1.7);
      if (Math.abs(x) < SIZE - 1 && Math.abs(z) < SIZE - 1 || x < -SIZE && Math.abs(z - gate.z) < 3) continue;
      const tree = new Entity('Procedural fallback tree'); tree.setLocalPosition(x, 0, z); this.app.root.addChild(tree);
      this.box(tree, 0, 0.65, 0, 0.22, 1.1, 0.22, '#755f43');
      const crown = new Entity('Original tree');
      crown.addComponent('render', { type: 'cone', material: this.material('#3e6955') });
      crown.setLocalPosition(0, 1.55, 0); crown.setLocalScale(1.4, 2, 1.4); tree.addChild(crown);
      this.forest.push({ entity: tree, x, z });
    }
    this.app.root.addChild(this.markers);
    new ResizeObserver(() => this.resize()).observe(this.canvas);
    window.addEventListener('resize', () => this.resize());
    this.radius = this.fitRadius(); this.resize(); this.updateCamera(); this.input();
  }
  fitRadius() { return Math.max(42, Math.min(100, 42 * .86 / (innerWidth / innerHeight))); }
  resize() {
    const aspect = innerWidth / innerHeight;
    this.app.resizeCanvas(innerWidth, innerHeight);
    if (this.aspect && Math.abs(aspect - this.aspect) > .01) { this.radius = this.fitRadius(); this.updateCamera(); }
    this.aspect = aspect; this.app.renderNextFrame = true;
  }
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
    if (this.cameraBlocked) return;
    if (action === 'reset') { this.target.set(-10, 0, 0); this.yaw = Math.PI / 4; this.radius = this.fitRadius(); }
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
    c.addEventListener('wheel', e => { e.preventDefault(); if (this.cameraBlocked) return; this.radius = Math.max(19, Math.min(180, this.radius * Math.exp(e.deltaY * 0.001))); this.updateCamera(); }, { passive: false });
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
      if (!this.cameraBlocked && this.pointers.size === 2) {
        const other = [...this.pointers.entries()].find(([id]) => id !== e.pointerId)![1];
        const oldDistance = Math.hypot(previous.x - other.x, previous.y - other.y);
        const newDistance = Math.hypot(e.clientX - other.x, e.clientY - other.y);
        if (newDistance > 1) this.radius = Math.max(19, Math.min(180, this.radius * oldDistance / newDistance));
        this.pan(dx / 2, dy / 2); this.updateCamera();
      } else if (!this.cameraBlocked && (this.down?.button === 2 || e.altKey)) {
        this.yaw -= dx * 0.007; this.updateCamera();
      } else if (!this.cameraBlocked && (this.mode === 'pan' || this.down?.button === 1)) this.pan(dx, dy);
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
    this.ground.setBuildGrid(['road', 'R', 'C', 'I', 'bulldoze'].includes(this.mode));
    this.lastScene = { city, selected, preview: [...preview] };
    this.updateGroundEdges(city);
    const connected = connectedRoads(city);
    for (let i = 0; i < city.cells.length; i++) {
      const cell = city.cells[i], b = city.buildings.find(b => b.cell === i);
      const links = cell.road ? [i % SIZE > 0 && city.cells[i - 1].road, i % SIZE < SIZE - 1 && city.cells[i + 1].road, i >= SIZE && city.cells[i - SIZE].road, i < SIZE * (SIZE - 1) && city.cells[i + SIZE].road].map(Number).join('') : '';
      const signature = `${cell.road}:${cell.zone}:${b?.id}:${b?.level}:${connected.has(i)}:${links}:${this.visualRevision}`;
      if (this.tiles.get(i)?.signature === signature) continue;
      this.tiles.get(i)?.entity.destroy();
      const tile = new Entity(`Parcel ${i}`); const { x, z } = this.position(i); tile.setLocalPosition(x, 0, z); this.app.root.addChild(tile);
      this.tiles.set(i, { entity: tile, signature });
      if (cell.road) {
        const horizontal = (i % SIZE > 0 && city.cells[i - 1].road) || (i % SIZE < SIZE - 1 && city.cells[i + 1].road);
        const vertical = (i >= SIZE && city.cells[i - SIZE].road) || (i < SIZE * (SIZE - 1) && city.cells[i + SIZE].road);
        this.box(tile, 0, .065, 0, 1.98, .1, 1.98, '#bcc4b8');
        this.box(tile, 0, .12, 0, vertical && !horizontal ? 1.48 : 1.98, .035, horizontal && !vertical ? 1.48 : 1.98, connected.has(i) ? '#46535b' : '#a86155');
        if (!(horizontal && vertical)) this.box(tile, 0, .145, 0, vertical ? .09 : .5, .012, vertical ? .5 : .09, connected.has(i) ? '#eee5bd' : '#ffc7a0');
        if (connected.has(i) && i % 4 === 0 && horizontal && !vertical) {
          const lamp = this.assets?.streetlight();
          if (lamp) { lamp.setLocalPosition(0, .13, -.84); tile.addChild(lamp); }
        }
      } else if (cell.zone) {
        const color = { R: '#5cad86', C: '#5d9fc7', I: '#d7a053' }[cell.zone];
        this.box(tile, 0, 0.05, 0, 1.8, 0.07, 1.8, color);
        if (b) {
          this.box(tile, 0, .086, 0, 1.63, .018, 1.63, b.zone === 'R' ? this.ground.lawnMaterial : b.zone === 'I' ? this.ground.soilMaterial : '#afb5a8');
          const model = this.assets?.building(b.zone, b.level, i);
          if (model) { model.setLocalPosition(0, .1, 0); tile.addChild(model); continue; }
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
  private updateGroundEdges(city: City) {
    const signature = city.cells.map(cell => cell.road ? '1' : '0').join('') + ':' + city.buildings.map(b => b.cell).join(',');
    if (!this.edgeMesh || signature === this.edgeSignature) return;
    this.edgeSignature = signature;
    const positions: number[] = [], normals: number[] = [], colors: number[] = [], indices: number[] = [];
    const band = (x: number, z: number, dx: number, dz: number, inner: number, outer: number, opacity: number) => {
      const start = positions.length / 3, tx = -dz * .99, tz = dx * .99;
      for (const [distance, tangent, alpha] of [[inner, -1, opacity], [outer, -1, 0], [outer, 1, 0], [inner, 1, opacity]]) {
        positions.push(x + dx * distance + tx * tangent, .041, z + dz * distance + tz * tangent);
        normals.push(0, 1, 0); colors.push(147, 137, 104, alpha);
      }
      indices.push(start, start + 2, start + 1, start, start + 3, start + 2);
    };
    for (let i = 0; i < city.cells.length; i++) if (city.cells[i].road) {
      const { x, z } = this.position(i);
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const cx = i % SIZE + dx, cz = Math.floor(i / SIZE) + dz;
        if (cx >= 0 && cz >= 0 && cx < SIZE && cz < SIZE && !city.cells[cz * SIZE + cx].road) band(x, z, dx, dz, .98, 1.34, 100);
      }
    }
    for (const building of city.buildings) {
      const { x, z } = this.position(building.cell);
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) band(x, z, dx, dz, .87, 1.18, 55);
    }
    this.edgeMesh.setPositions(positions); this.edgeMesh.setNormals(normals); this.edgeMesh.setColors32(colors); this.edgeMesh.setIndices(indices); this.edgeMesh.update();
  }
}
