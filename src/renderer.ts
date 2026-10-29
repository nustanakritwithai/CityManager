import { roadLinked, roadTopologyKey } from './road-topology.ts';
import {
  AppBase, AppOptions, createGraphicsDevice, DEVICETYPE_WEBGL2,
  RenderComponentSystem, CameraComponentSystem, LightComponentSystem,
  Entity, Mesh, MeshInstance, StandardMaterial, Color, Vec3, type RenderComponent, FILLMODE_NONE, RESOLUTION_AUTO, ContainerHandler, TextureHandler, BLEND_NORMAL
} from 'playcanvas';
import { SIZE, GATEWAY, access, connectedRoads, firmWorkerCount, type City } from './sim.ts';
import { factoryLevel } from './factory-levels.ts';
import { utilityService, type UtilityKind } from './utilities.ts';
import { pocketPark } from './scene-decor.ts';
import { diffBuildings, buildScale, type BuildingState, type BuildEvent } from './build-events.ts';
import { CityAssets } from './asset-models.ts';
import { roadTileFor, type Side } from './road-tiles.ts';
import { CityGround } from './terrain.ts';
import { SceneAtmosphere } from './scene-atmosphere.ts';
import { SceneTraffic } from './scene-traffic.ts';
import { CityWorld } from './scene-world.ts';
import type { Atmosphere, Quality } from './atmosphere.ts';
import type { Overlay, Tone } from './map-overlay.ts';

const UNIT = 2;
const hashCell = (n: number) => ((Math.imul(n >>> 0, 2654435761) >>> 13) & 0xffff);

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
  private overlayRoot = new Entity('Map information layer');
  private overlayRef: Overlay | null = null;
  private buildingState = new Map<number, BuildingState>();
  private animations = new Map<number, { kind: BuildEvent['kind']; t: number }>();
  private faded = new Map<StandardMaterial, StandardMaterial>();
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private highway = new Entity('Decorative highway');
  materials = new Map<string, StandardMaterial>();
  assets: CityAssets | null = null;
  ground!: CityGround;
  atmosphere!: SceneAtmosphere;
  world!: CityWorld;
  traffic!: SceneTraffic;
  private windowLit!: StandardMaterial;
  private edgeMesh?: Mesh;
  private edgeSignature = '';
  private visualRevision = 0;
  private lastScene: { city: City; selected: number | null; preview: number[] } | null = null;
  private forest: { entity: Entity; x: number; y: number; z: number; scale: number }[] = [];
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
      assets.glowRegistrar = (material, strength) => view.atmosphere.registerGlow(material, strength);
      view.assets = assets; view.visualRevision++;
      view.tileHighway();
      for (const tree of view.forest) {
        const model = assets.tree(hashCell(Math.round(tree.x * 13 + tree.z * 7)) % 10 < 3);
        if (model) {
          tree.entity.destroy(); model.setLocalPosition(tree.x, tree.y, tree.z);
          const scale = model.getLocalScale(); model.setLocalScale(scale.x * tree.scale, scale.y * tree.scale, scale.z * tree.scale);
          app.root.addChild(model); tree.entity = model;
        }
      }
      if (view.lastScene) view.render(view.lastScene.city, view.lastScene.selected, view.lastScene.preview);
    });
    return view;
  }
  /** Replace the primitive highway with Kenney road tiles once models are available. */
  private tileHighway() {
    const gate = this.position(GATEWAY), tiles = new Entity('Decorative highway tiles');
    for (let x = gate.x - 9; x > -92; x -= UNIT) {
      const tile = this.assets?.road('road-straight', true);
      if (!tile) return;
      tile.setLocalPosition(x, .03, gate.z); tiles.addChild(tile);
    }
    this.highway.enabled = false; this.app.root.addChild(tiles); this.app.renderNextFrame = true;
  }
  /** A small wooden bench facing the street. */
  private bench(tile: Entity, x: number, z: number) {
    this.box(tile, x, .2, z, .34, .035, .11, '#9a6a43', false);
    this.box(tile, x, .27, z - .05, .34, .09, .025, '#8a5d3a', false);
    for (const dx of [-.14, .14]) this.box(tile, x + dx, .14, z, .03, .09, .09, '#4b4f5c', false);
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
  /** Tall parts cast shadows; flat pads, roads and the world base never do. */
  /** Translucent zone fill: strong on vacant parcels, faint under buildings. */
  private zoneFill(hex: string, built: boolean) {
    const key = `zone:${hex}:${built}`;
    if (this.materials.has(key)) return this.materials.get(key)!;
    const material = new StandardMaterial();
    material.diffuse = new Color().fromString(hex); material.gloss = .2;
    material.opacity = built ? .28 : .55; material.blendType = BLEND_NORMAL; material.depthWrite = false; material.update();
    this.materials.set(key, material); return material;
  }
  box(parent: Entity, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string | StandardMaterial, castShadows = sy > .12) {
    const entity = new Entity('Original primitive');
    entity.addComponent('render', { type: 'box', material: typeof color === 'string' ? this.material(color) : color, castShadows });
    entity.setLocalPosition(x, y, z);
    entity.setLocalScale(sx, sy, sz);
    parent.addChild(entity);
    return entity;
  }
  private farm(tile: Entity, fertility: number, level: number) {
    const plot = new Entity('Original farm plot'); tile.addChild(plot);
    this.box(plot, 0, .09, 0, 1.68, .035, 1.68, this.ground.soilMaterial);
    this.box(plot, -.17, .12, .12, 1.2, .035, 1.24, '#725b3e');
    const cropHeight = .12 + Math.max(0, Math.min(100, fertility)) * .0007;
    for (const [row, x] of [-.62, -.36, -.1, .16].entries()) {
      const crop = this.box(plot, x, .15 + cropHeight / 2, .12, .17, cropHeight, 1.14, row % 2 ? '#86ad58' : '#b0bc61');
      crop.name = 'Renewable crop row';
    }
    for (let tier = 4; tier <= level; tier++) {
      const marker = this.box(plot, .4 + (tier - 4) * .15, .69, -.46, .1, .1, .1, '#e3bd55'); marker.name = `Farm level ${tier} marker`;
    }
    const shed = this.box(plot, .55, .32, -.46, .5, .43, .48, '#d7dec9'); shed.name = 'Original farm shed';
    this.box(plot, .55, .58, -.46, .6, .13, .57, '#4c7056');
    this.box(plot, .55, .29, -.208, .14, .27, .025, '#536754');
    this.box(plot, -.03, .28, .8, 1.5, .065, .045, '#b9ae87');
  }
  private cropMarket(tile: Entity, cell: number, lit: boolean) {
    const stall = new Entity('Crop market'); tile.addChild(stall);
    this.box(stall, 0, .09, 0, 1.65, .025, 1.65, '#b6b9a3');
    // Level-one market: an open stall under an awning with parasols, not a shop building.
    this.box(stall, 0, .34, -.25, 1.1, .45, .5, '#d4ddd1');
    this.box(stall, 0, .27, .2, 1.16, .27, .25, lit ? this.windowLit : '#8f7957');
    const awning = this.assets?.detail('awning', 1.3, hashCell(cell) % 3);
    if (awning) { awning.setLocalPosition(0, .1, -.05); awning.name = 'Crop market model'; stall.addChild(awning); }
    else {
      this.box(stall, 0, .7, -.1, 1.34, .14, .98, '#e07a45');
      for (const x of [-.53, .53]) this.box(stall, x, .35, .34, .065, .5, .065, '#6f7862');
    }
    for (const [name, x, z] of [['parasol-a', -.55, .62], ['parasol-b', .6, .55]] as const) {
      const parasol = this.assets?.detail(name, .55, hashCell(cell) % 3);
      if (parasol) { parasol.setLocalPosition(x, .1, z); stall.addChild(parasol); }
    }
    // Empty wooden market furniture; stock quantities are shown by the inspector.
    for (const x of [-.45, .04]) {
      this.box(stall, x, .18, .63, .36, .17, .27, '#967954');
      this.box(stall, x, .275, .63, .39, .035, .3, '#b49b6a');
    }
  }
  agricultureDiagnostics() {
    const tiles = [...this.tiles.values()];
    return { farmPlots: tiles.filter(tile => tile.entity.findByName('Original farm plot')).length,
      marketStalls: tiles.filter(tile => tile.entity.findByName('Crop market')).length,
      buildGrid: this.ground.diagnostics.buildGrid };
  }
  setup() {
    this.app.scene.ambientLight = new Color(0.52, 0.58, 0.63);
    this.camera.addComponent('camera', { clearColor: new Color(0.16, 0.27, 0.32), fov: 48, nearClip: 0.5, farClip: 260 });
    this.app.root.addChild(this.camera);
    // Sun/moon, sky dome, fog and post effects follow the visual-only time of day.
    this.atmosphere = new SceneAtmosphere(this.app, this.camera);
    this.windowLit = this.material('#f9df9a').clone() as StandardMaterial;
    this.windowLit.emissive = new Color(1, .82, .52); this.windowLit.update();
    this.atmosphere.registerGlow(this.windowLit, 1.6);
    this.traffic = new SceneTraffic(this);
    const gateZ = this.position(Math.floor(SIZE / 2) * SIZE).z;
    this.world = new CityWorld(this.app, SIZE * UNIT / 2, gateZ);
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
    // Decorative highway to the outside market; it is not part of the road graph.
    const highwayEnd = -92, highwayStart = gate.x - 8, highwayLength = highwayStart - highwayEnd, highwayMid = (highwayStart + highwayEnd) / 2;
    this.app.root.addChild(this.highway);
    this.box(this.highway, highwayMid, .05, gate.z, highwayLength, .1, 2.4, '#bcc4b8', false);
    this.box(this.highway, highwayMid, .085, gate.z, highwayLength, .05, 1.9, '#46535b', false);
    for (let x = highwayStart - 1.5; x > highwayEnd + 1; x -= 3) this.box(this.highway, x, .115, gate.z, 1.1, .012, .09, '#eee5bd', false);
    for (let n = 0; n < 34; n++) {
      const angle = n * 2.39996;
      const x = Math.cos(angle) * (SIZE + 1.7), z = Math.sin(angle) * (SIZE + 1.7);
      if (Math.abs(x) < SIZE - 1 && Math.abs(z) < SIZE - 1 || x < -SIZE && Math.abs(z - gate.z) < 3) continue;
      this.plantTree(x, Math.max(.04, this.world.height(x, z)), z, 1);
    }
    for (const spot of this.world.treeSpots) this.plantTree(spot.x, spot.y, spot.z, spot.scale);
    this.app.root.addChild(this.markers);
    this.app.root.addChild(this.overlayRoot);
    this.setQuality('high');
    this.app.on('update', (dt: number) => this.animate(dt));
    new ResizeObserver(() => this.resize()).observe(this.canvas);
    window.addEventListener('resize', () => this.resize());
    this.radius = this.fitRadius(); this.resize(); this.updateCamera(); this.input();
  }
  private plantTree(x: number, y: number, z: number, scale: number) {
    const tree = new Entity('Procedural fallback tree'); tree.setLocalPosition(x, y, z); tree.setLocalScale(scale, scale, scale); this.app.root.addChild(tree);
    this.box(tree, 0, 0.65, 0, 0.22, 1.1, 0.22, '#755f43');
    const crown = new Entity('Original tree');
    crown.addComponent('render', { type: 'cone', material: this.material('#3e6955') });
    crown.setLocalPosition(0, 1.55, 0); crown.setLocalScale(1.4, 2, 1.4); tree.addChild(crown);
    this.forest.push({ entity: tree, x, y, z, scale });
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
    this.atmosphere?.follow(this.radius);
    this.app.renderNextFrame = true;
  }
  /** Centre the camera on a parcel (used by the issue list). */
  focus(cell: number) {
    const { x, z } = this.position(cell);
    this.target.set(Math.max(-22, Math.min(22, x)), 0, Math.max(-22, Math.min(22, z))); this.updateCamera();
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
      const wasMoved = this.down?.moved;
      if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 7) this.down.moved = true;
      if (!this.cameraBlocked && this.pointers.size === 2) {
        const other = [...this.pointers.entries()].find(([id]) => id !== e.pointerId)![1];
        const oldDistance = Math.hypot(previous.x - other.x, previous.y - other.y);
        const newDistance = Math.hypot(e.clientX - other.x, e.clientY - other.y);
        if (newDistance > 1) this.radius = Math.max(19, Math.min(180, this.radius * oldDistance / newDistance));
        this.pan(dx / 2, dy / 2); this.updateCamera();
      } else if (!this.cameraBlocked && (this.down?.button === 2 || e.altKey)) {
        this.yaw -= dx * 0.007; this.updateCamera();
      } else if (!this.cameraBlocked && this.down?.button === 1) this.pan(dx, dy);
      else if (!this.cameraBlocked && this.mode === 'select' && this.down?.button === 0 && this.down.moved && !this.down.multi) {
        // Apply the full displacement when the threshold is crossed, then incremental moves.
        this.pan(wasMoved ? dx : e.clientX - this.down.x, wasMoved ? dy : e.clientY - this.down.y);
      }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.onHover(this.pick(e.clientX, e.clientY));
    });
    c.addEventListener('pointerup', e => {
      if (!this.pointers.has(e.pointerId)) return;
      this.dragStart = null;
      if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 7) this.down.moved = true;
      if (this.down && !this.down.moved && !this.down.multi && this.down.button === 0) {
        const index = this.pick(e.clientX, e.clientY); if (index !== null) this.onCell(index);
      } else if (!this.cameraBlocked && this.down && this.down.moved && !this.down.multi && this.down.button === 0 && this.mode === 'road') {
        const end = this.pick(e.clientX, e.clientY);
        if (this.down.cell !== null && end !== null) this.onRoad(this.down.cell, end);
      }
      this.pointers.delete(e.pointerId); if (!this.pointers.size) this.down = null;
    });
    c.addEventListener('pointercancel', e => { if (!this.pointers.has(e.pointerId)) return; this.pointers.delete(e.pointerId); this.down = null; this.dragStart = null; this.onHover(null); });
  }
  /** Swap every material under `entity` for a greyed clone (cached per source material). */
  private fade(entity: Entity) {
    for (const render of entity.findComponents('render') as RenderComponent[]) for (const instance of render.meshInstances) {
      const source = instance.material;
      if (!(source instanceof StandardMaterial)) continue;
      let material = this.faded.get(source);
      if (!material) {
        material = source.clone() as StandardMaterial; material.name = `${source.name} · disconnected`;
        material.diffuse = new Color(.52, .54, .58); material.emissiveIntensity = 0; material.update();
        this.faded.set(source, material);
      }
      instance.material = material;
    }
  }
  /** Short grow/bounce for parcels that just gained a building or a level. */
  private animate(dt: number) {
    if (!this.animations.size) return;
    for (const [cell, animation] of this.animations) {
      animation.t += Math.min(dt, .1);
      const tile = this.tiles.get(cell)?.entity, done = animation.t >= (animation.kind === 'built' ? .7 : .5);
      tile?.setLocalScale(1, done ? 1 : buildScale(animation.kind, animation.t), 1);
      if (done) this.animations.delete(cell);
    }
    this.app.renderNextFrame = true;
  }
  get animating() { return this.animations.size; }

  /** Unlit translucent plates so the layer stays readable at night; null hides it. */
  setOverlay(overlay: Overlay | null) {
    if (overlay === this.overlayRef) return;
    this.overlayRef = overlay;
    for (const child of [...this.overlayRoot.children]) child.destroy();
    for (const item of overlay?.cells ?? []) {
      const { x, z } = this.position(item.cell);
      this.box(this.overlayRoot, x, .19, z, 1.9, .02, 1.9, this.overlayMaterial(item.tone, Math.round(item.strength * 10) / 10), false);
    }
    this.app.renderNextFrame = true;
  }
  private overlayMaterial(tone: Tone, strength: number) {
    const key = `overlay:${tone}:${strength}`;
    if (this.materials.has(key)) return this.materials.get(key)!;
    const material = new StandardMaterial(), colour = new Color().fromString({ good: '#3ccf6e', warn: '#f2c14e', bad: '#e5533d', rice: '#f5d35a', vegetables: '#4fd06a', sugarcane: '#59c3ec' }[tone]);
    material.diffuse = new Color(0, 0, 0); material.emissive = colour; material.useLighting = false; material.useFog = false;
    material.opacity = .25 + strength * .45; material.blendType = BLEND_NORMAL; material.depthWrite = false; material.update();
    this.materials.set(key, material); return material;
  }
  /** `invalid` marks previewed cells where the action would be refused (red frame). */
  render(city: City, selected: number | null, preview: number[], invalid: ReadonlySet<number> = new Set()) {
    this.app.renderNextFrame = true;
    this.ground.setBuildGrid(['road', 'R', 'C', 'I', 'F', 'power', 'water', 'park', 'bulldoze'].includes(this.mode));
    this.lastScene = { city, selected, preview: [...preview] };
    this.updateGroundEdges(city);
    const connected = connectedRoads(city), online = utilityService(city, connected).online;
    const fadeLater: Entity[] = [];
    for (let i = 0; i < city.cells.length; i++) {
      const cell = city.cells[i], b = city.buildings.find(b => b.cell === i);
      const links = cell.road ? [roadLinked(city, i, i + (-1)), roadLinked(city, i, i + (1)), roadLinked(city, i, i + (-24)), roadLinked(city, i, i + (24))].map(Number).join('') : '';
      const fertility = cell.zone === 'F' ? city.resources.fertility[i] : '';
      // Night lights only for real occupancy: residents at home or allocated workers on site.
      const lit = !!b && (b.zone === 'R' ? city.households.some(h => h.home === b.id) : city.firms.some(f => f.building === b.id && firmWorkerCount(city, f.id) > 0));
      // Buildings without connected frontage are suspended in the sim, so they render faded.
      const reach = !!b && access(city, i);
      const municipalPark = city.parks.find(p => p.cell === i), park = pocketPark(city, i), plant = city.plants.find(p => p.cell === i), plantOn = !!plant && online.has(plant.id);
      const signature = `${cell.road}:${cell.zone}:${b?.id}:${b?.level}:${connected.has(i)}:${links}:${city.roadTopology?.oneWay[i] ?? 0}:${this.visualRevision}:${fertility}:${lit}:${reach}:${park}:${municipalPark?.id}:${municipalPark?.level}:${plant?.kind}:${plantOn}`;
      if (this.tiles.get(i)?.signature === signature) continue;
      this.tiles.get(i)?.entity.destroy();
      const tile = new Entity(`Parcel ${i}`); const { x, z } = this.position(i); tile.setLocalPosition(x, 0, z); this.app.root.addChild(tile);
      this.tiles.set(i, { entity: tile, signature });
      if (b && !reach || plant && !plantOn) fadeLater.push(tile);
      if (cell.road) {
        const horizontal = (roadLinked(city, i, i + (-1))) || (roadLinked(city, i, i + (1)));
        const vertical = (roadLinked(city, i, i + (-24))) || (roadLinked(city, i, i + (24)));
        const open = new Set<Side>();
        if (roadLinked(city, i, i + (-1)) || i === GATEWAY) open.add('-x');
        if (roadLinked(city, i, i + (1))) open.add('+x');
        if (roadLinked(city, i, i + (-24))) open.add('-z');
        if (roadLinked(city, i, i + (24))) open.add('+z');
        const choice = roadTileFor(open, i), model = this.assets?.road(choice.tile, connected.has(i));
        if (model) { model.setLocalEulerAngles(0, choice.rotation, 0); model.setLocalPosition(0, .03, 0); tile.addChild(model); }
        else {
          this.box(tile, 0, .065, 0, 1.98, .1, 1.98, '#bcc4b8');
          this.box(tile, 0, .12, 0, vertical && !horizontal ? 1.48 : 1.98, .035, horizontal && !vertical ? 1.48 : 1.98, connected.has(i) ? '#46535b' : '#a86155');
          if (!(horizontal && vertical)) this.box(tile, 0, .145, 0, vertical ? .09 : .5, .012, vertical ? .5 : .09, connected.has(i) ? '#eee5bd' : '#ffc7a0');
        }
        const direction = city.roadTopology?.oneWay[i];
        if (direction) {
          const arrows = new Entity('Two lanes one-way arrows'); tile.addChild(arrows);
          // Local +z arrow, rotated to match the selected grid direction.
          arrows.setLocalEulerAngles(0, direction === 1 ? 90 : direction === -1 ? -90 : direction === -SIZE ? 180 : 0, 0);
          for (const lane of [-.36, .36]) {
            this.box(arrows, lane, .18, 0, .055, .012, .48, '#ffffff', false);
            const left = this.box(arrows, lane - .08, .18, .17, .055, .012, .23, '#ffffff', false);
            const right = this.box(arrows, lane + .08, .18, .17, .055, .012, .23, '#ffffff', false);
            left.setLocalEulerAngles(0, 40, 0); right.setLocalEulerAngles(0, -40, 0);
          }
        }
        // Lamps stand on the sidewalk of straight streets, every fourth parcel along the street.
        const along = horizontal && !vertical ? i % SIZE : vertical && !horizontal ? Math.floor(i / SIZE) : -1;
        if (connected.has(i) && along >= 0 && along % 4 === 0) {
          const lamp = this.assets?.streetlight();
          if (lamp) {
            const [lx, lz, px, pz] = horizontal ? [0, -.84, 0, -.45] : [-.84, 0, -.45, 0];
            lamp.setLocalPosition(lx, .13, lz); if (!horizontal) lamp.setLocalEulerAngles(0, -90, 0); tile.addChild(lamp);
            const pool = new Entity('Street lamp light pool');
            pool.addComponent('render', { type: 'plane', material: this.atmosphere.lampPool, castShadows: false, receiveShadows: false });
            pool.setLocalPosition(px, .16, pz); pool.setLocalScale(1.7, 1, 1.7); tile.addChild(pool);
          }
        }
      } else if (municipalPark) {
        this.municipalPark(tile);
      } else if (plant) {
        this.plant(tile, plant.kind, plantOn);
      } else if (park) {
        // Visual-only pocket park on unzoned roadside land between buildings.
        this.box(tile, 0, .05, 0, 1.7, .05, 1.7, this.ground.lawnMaterial, false);
        const h = hashCell(i);
        // One tree on most park cells (two on some) keeps the instance count small.
        for (const [tx, tz] of [[-.35, -.3], [.45, .4]].slice(0, h % 3 === 0 ? 2 : h % 3 === 1 ? 1 : 0)) {
          const tree = this.assets?.tree(h % 5 === 0); if (tree) { tree.setLocalPosition(tx, .07, tz); tree.setLocalScale(.6, .6, .6); tile.addChild(tree); }
        }
        if (h % 4 === 1) { const planter = this.assets?.detail('planter', .42); if (planter) { planter.setLocalPosition(.5, .07, -.5); tile.addChild(planter); } }
      } else if (cell.zone) {
        const color = { R: '#5cad86', C: '#5d9fc7', I: '#d7a053', F: '#93af58' }[cell.zone];
        this.box(tile, 0, 0.05, 0, 1.8, 0.07, 1.8, this.zoneFill(color, !!b), false);
        // Solid zone outline keeps R/C/I/F readable at every time of day.
        for (const dz of [-.86, .86]) this.box(tile, 0, .075, dz, 1.8, .03, .08, color, false);
        for (const dx of [-.86, .86]) this.box(tile, dx, .075, 0, .08, .03, 1.8, color, false);
        if (b) {
          if (b.zone === 'F') { this.farm(tile, city.resources.fertility[i], b.level); continue; }
          if (b.zone === 'C' && b.level === 1) { this.cropMarket(tile, i, lit); continue; }
          this.box(tile, 0, .086, 0, 1.63, .018, 1.63, b.zone === 'R' ? this.ground.lawnMaterial : b.zone === 'I' ? this.ground.soilMaterial : '#afb5a8');
          // Code-native apartment/condo silhouettes fit the same tile even when assets fail.
          if (b.zone === 'R' && b.level > 3) {
            const condo = b.level >= 7, tier = condo ? b.level - 6 : b.level - 3;
            const height = (condo ? 3.8 : 2.1) + tier * .6;
            this.box(tile, 0, height / 2 + .1, 0, 1.3, height, 1.25, condo ? '#9fbcc8' : '#d5d6c5');
            this.box(tile, 0, height + .16, 0, 1.4, .12, 1.35, condo ? '#667c8b' : '#aa8270');
            for (let floor = 0; floor < (condo ? tier + 4 : tier + 2); floor++)
              for (const x of [-.36, .12]) this.box(tile, x, .48 + floor * .58, .635, .25, .25, .025, lit ? this.windowLit : '#718a97', false);
            continue;
          }
          // Retained shops move up one commercial tier; their geometry stays unchanged.
          const visualLevel = b.zone === 'C' ? Math.max(1, b.level - 1) : b.level;
          const model = this.assets?.building(b.zone, b.zone === 'I' ? factoryLevel(b.level).model : visualLevel, i, lit);
          if (model) {
            model.setLocalPosition(0, .1, 0); tile.addChild(model);
            // Bigger factories show their scale with a chimney and an input tank.
            if (b.zone === 'I' && b.level >= 2) { const chimney = this.assets?.detail('chimney', .32); if (chimney) { chimney.setLocalPosition(.68, .1, -.62); tile.addChild(chimney); } }
            if (b.zone === 'I' && b.level >= 3) { const tank = this.assets?.detail('tank', .6); if (tank) { tank.setLocalPosition(-.6, .1, .66); tile.addChild(tank); } }
            // One inset marker per level above three, contained within the same parcel.
            if (b.zone === 'I') for (let n = 0; n < factoryLevel(b.level).markers; n++) this.box(tile, -.7 + n * .23, .12, .82, .13, .06, .09, '#f1c267', false);
            if (b.zone === 'R' && hashCell(i) % 3 === 0) { const planter = this.assets?.detail('planter', .42); if (planter) { planter.setLocalPosition(.66, .1, .7); tile.addChild(planter); } }
            // A lived-in house gets a front-yard bench; some also a second bush (decoration only).
            if (b.zone === 'R' && lit && hashCell(i + 5) % 2 === 0) this.bench(tile, -.62, .7);
            if (b.zone === 'R' && hashCell(i) % 3 === 1) { const bush = this.assets?.detail('planter', .34); if (bush) { bush.setLocalPosition(-.7, .1, -.68); tile.addChild(bush); } }
            continue;
          }
          const h = 0.9 + visualLevel * 0.75 + (i % 3) * 0.22;
          const tower = b.zone === 'I' ? h * 0.65 : h;
          this.box(tile, -0.1, tower / 2 + 0.1, 0, 1.25, tower, 1.2, { R: '#d7e5d1', C: '#b6d4df', I: '#d9c09a' }[b.zone]);
          this.box(tile, -0.1, tower + 0.17, 0, 1.34, 0.16, 1.3, { R: '#d0683f', C: '#4a62a6', I: '#8c6340' }[b.zone]);
          for (let level = 0; level < Math.min(visualLevel + 1, 5); level++) {
            for (const wx of [-0.44, 0.2]) this.box(tile, wx, 0.52 + level * 0.55, 0.608, 0.25, 0.27, 0.035, lit ? this.windowLit : '#f9df9a', false);
          }
          if (b.zone === 'I') this.box(tile, 0.52, h * 0.65, -0.38, 0.2, h * 1.1, 0.22, '#786b60');
        }
      }
    }
    for (const tile of fadeLater) this.fade(tile);
    const changes = diffBuildings(this.buildingState, city.buildings);
    this.buildingState = changes.next;
    if (!this.reducedMotion.matches) for (const event of changes.events) this.animations.set(event.cell, { kind: event.kind, t: 0 });
    this.traffic.sync(city);
    for (const child of [...this.markers.children]) child.destroy();
    for (const i of new Set([...preview, ...(selected === null ? [] : [selected])])) {
      const p = this.position(i); const color = i === selected ? '#fff1bb' : invalid.has(i) ? '#ff5a4a' : this.mode === 'select' || this.mode === 'pan' ? '#f7bf60' : '#6fe08a';
      for (const dz of [-0.92, 0.92]) this.box(this.markers, p.x, 0.18, p.z + dz, 1.94, 0.08, 0.07, this.material(color, true));
      for (const dx of [-0.92, 0.92]) this.box(this.markers, p.x + dx, 0.18, p.z, 0.07, 0.08, 1.94, this.material(color, true));
    }
  }
  /** The complete garden stays inside one 2-unit tile, independently of roads. */
  private municipalPark(tile: Entity) {
    this.box(tile, 0, .06, 0, 1.8, .08, 1.8, '#87a96b', false);
    this.box(tile, 0, .11, 0, .3, .025, 1.65, '#d4c7a5', false);
    this.box(tile, 0, .12, .25, 1.65, .025, .25, '#d4c7a5', false);
    for (const [x, z] of [[-.5, -.45], [.48, -.43]]) {
      this.box(tile, x, .36, z, .09, .5, .09, '#795b42');
      this.box(tile, x, .66, z, .52, .5, .52, '#4b7d4a');
      this.box(tile, x, .94, z, .35, .15, .35, '#679751');
    }
    for (const x of [-.48, .48]) {
      this.box(tile, x, .25, .58, .48, .07, .18, '#a8794d');
      this.box(tile, x, .36, .68, .48, .2, .05, '#a8794d');
      for (const dx of [-.17, .17]) this.box(tile, x + dx, .17, .58, .04, .2, .12, '#535c50');
    }
  }

  /** A city water pump or power plant: simple massing in its utility colour; it glows while it supplies the network. */
  private plant(tile: Entity, kind: UtilityKind, on: boolean) {
    this.box(tile, 0, .06, 0, 1.78, .08, 1.78, '#9ea6a0', false);
    if (kind === 'power') {
      this.box(tile, -.25, .42, .1, 1.05, .66, .95, '#c9ccc4');
      this.box(tile, -.25, .8, .1, 1.12, .1, 1.02, '#5b6470');
      this.box(tile, .62, .7, -.45, .3, 1.2, .3, '#8d8f8c');
      const chimney = this.assets?.detail('chimney', .4); if (chimney) { chimney.setLocalPosition(.6, .1, .55); tile.addChild(chimney); }
      this.box(tile, -.25, .45, .59, .36, .3, .04, on ? this.material('#ffd23f', true) : '#8a8467', false);
    } else {
      const tank = this.assets?.detail('tank', 1.1);
      if (tank) { tank.setLocalPosition(-.3, .1, -.2); tile.addChild(tank); } else this.box(tile, -.3, .55, -.2, .9, .9, .9, '#c8d6dc');
      this.box(tile, .45, .14, .5, .7, .1, .55, '#3f7fa3', false);
      this.box(tile, .45, .2, .5, .58, .02, .44, on ? this.material('#59c3ec', true) : '#7a8b92', false);
    }
  }
  setAtmosphere(atmosphere: Atmosphere) { this.atmosphere.apply(atmosphere); this.world.apply(atmosphere); }
  setQuality(quality: Quality) { this.atmosphere.setQuality(quality); }

  private updateGroundEdges(city: City) {
    const signature = city.cells.map(cell => cell.road ? '1' : '0').join('') + ':' + roadTopologyKey(city) + ':' + city.buildings.map(b => b.cell).join(',');
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
