import { DISTRICT_COLORS } from './districts.ts';
import { cellWorldPosition, worldPositionCell } from './expanded-map-geometry.ts';
import { expandedCellAt, expandedCellCoordinate, EXPANDED_MAP_CELLS } from './expanded-map-grid.ts';
import { roadLinked, roadTopologyKey } from './road-topology.ts';
import {
  AppBase, AppOptions, createGraphicsDevice, DEVICETYPE_WEBGL2,
  RenderComponentSystem, CameraComponentSystem, LightComponentSystem,
  Entity, Mesh, MeshInstance, StandardMaterial, Color, Vec3, type RenderComponent, FILLMODE_NONE, RESOLUTION_AUTO, ContainerHandler, TextureHandler, BLEND_NORMAL
} from 'playcanvas';
import { SIZE, GATEWAY, access, connectedRoads, firmWorkerCount, type City } from './sim.ts';
import { commercialVisualPlan } from './commercial-visuals.ts';
import { factoryLevel } from './factory-levels.ts';
import { FactoryVisuals, factoryWorking } from './factory-visuals.ts';
import { utilityService, plantLevel, type UtilityKind } from './utilities.ts';
import { civicCells, civicFootprint, type CivicKind } from './civic/sites.ts';
import { pocketPark } from './scene-decor.ts';
import { diffBuildings, diffRoads, dustPuff, placeList, buildScale, DUST_SECONDS, type BuildingState, type BuildEvent } from './build-events.ts';
import { INCIDENT_SECONDS, flameHeight, lightLit, markFade, smokePuff, type IncidentMark } from './incident-marks.ts';
import type { IncidentKind } from './incidents.ts';
import { CityAssets, disconnectedBuildingMaterial } from './asset-models.ts';
import { roadTileFor, type Side } from './road-tiles.ts';
import { CityGround } from './terrain.ts';
import { SceneAtmosphere } from './scene-atmosphere.ts';
import { SceneTraffic } from './scene-traffic.ts';
import { CityWorld } from './scene-world.ts';
import type { Atmosphere, Quality } from './atmosphere.ts';
import type { Overlay, Tone } from './map-overlay.ts';
import { CanvasSelectionClickGuard } from './canvas-selection-click.ts';

const UNIT = 2;
/** At most this many dust clouds at once; the oldest goes first. */
const MAX_DUST = 8;
const PAVE_SECONDS = .45;
/** Incident marks alive at once; the oldest goes first. */
const MAX_INCIDENT_FX = 10;
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
  /** Work effects: dust where something rose or fell, a warm sweep along new road. Visual only. */
  private readonly effects = new Entity('Build effects');
  private dust: { entity: Entity; t: number }[] = [];
  private paving: { entity: Entity; t: number }[] = [];
  private roadState: Set<number> | null = null;
  /** The city the work effects last compared against; another city (a load, a new game) starts still. */
  private effectsCity: City | null = null;
  /** Wall-clock time of the last effects frame, or null while nothing animates. */
  private fxClock: number | null = null;
  private dustMaterial!: StandardMaterial;
  private paveMaterial!: StandardMaterial;
  /** Incidents on the map: flames and smoke on a fire, a pair of warning lights for police or an ambulance. */
  private incidentFx: { cell: number; kind: IncidentKind; entity: Entity; t: number; roof: number; flames: Entity[]; smoke: Entity[]; lights: Entity[] }[] = [];
  private readonly fxMaterials = new Map<string, StandardMaterial>();
  private faded = new Map<StandardMaterial, StandardMaterial>();
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private highway = new Entity('Decorative highway');
  materials = new Map<string, StandardMaterial>();
  assets: CityAssets | null = null;
  ground!: CityGround;
  atmosphere!: SceneAtmosphere;
  private factories!: FactoryVisuals;
  world!: CityWorld;
  traffic!: SceneTraffic;
  private windowLit!: StandardMaterial;
  private edgeMesh?: Mesh;
  private edgeSignature = '';
  private visualRevision = 0;
  private quality: Quality = 'high';
  private lastScene: { city: City; selected: number | null; preview: number[] } | null = null;
  private forest: { entity: Entity; x: number; y: number; z: number; scale: number }[] = [];
  private taxiDepots: { cell: number; level: 1 | 2; open: boolean }[] = [];
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
      assets.glowRegistrar = (material, strength, blink) => view.atmosphere.registerGlow(material, strength, blink);
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
  private commercial(tile: Entity, level: number, lit: boolean) {
    const plan = commercialVisualPlan(level);
    const model = new Entity(`Commercial ${plan.tier}`);
    tile.addChild(model);
    for (const part of plan.parts) {
      const entity = this.box(model, part.x, part.y, part.z, part.width, part.height, part.depth,
        part.window && lit ? this.windowLit : part.color);
      entity.name = part.name;
    }
  }
  agricultureDiagnostics() {
    const tiles = [...this.tiles.values()];
    return { farmPlots: tiles.filter(tile => tile.entity.findByName('Original farm plot')).length,
      marketStalls: tiles.filter(tile => tile.entity.findByName('Commercial market')).length,
      commercialTiers: Object.fromEntries(['market', 'building', 'mall'].map(tier => [tier, tiles.filter(tile => tile.entity.findByName(`Commercial ${tier}`)).length])),
      buildGrid: this.ground.diagnostics.buildGrid };
  }
  setup() {
    this.app.scene.ambientLight = new Color(0.52, 0.58, 0.63);
    this.camera.addComponent('camera', { clearColor: new Color(0.16, 0.27, 0.32), fov: 48, nearClip: 0.5, farClip: 260 });
    this.app.root.addChild(this.camera);
    // Sun/moon, sky dome, fog and post effects follow the visual-only time of day.
    this.atmosphere = new SceneAtmosphere(this.app, this.camera);
    this.factories = new FactoryVisuals(this.app, (m, strength, blink) => this.atmosphere.registerGlow(m, strength, blink));
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
      if (Math.abs(x) < SIZE - 1 && Math.abs(z) < SIZE - 1 || x < -SIZE && Math.abs(z - gate.z) < 3 || Math.abs(x)<=SIZE+2 && z>=-SIZE-10 && z<=-SIZE+2) continue;
      this.plantTree(x, Math.max(.04, this.world.height(x, z)), z, 1);
    }
    for (const spot of this.world.treeSpots) this.plantTree(spot.x, spot.y, spot.z, spot.scale);
    this.app.root.addChild(this.markers);
    this.app.root.addChild(this.overlayRoot);
    this.app.root.addChild(this.effects);
    this.dustMaterial = new StandardMaterial(); this.dustMaterial.name = 'Construction dust';
    this.dustMaterial.diffuse = new Color(.95, .91, .84); this.dustMaterial.emissive = new Color(.97, .93, .86); this.dustMaterial.useLighting = false;
    this.dustMaterial.opacity = .92; this.dustMaterial.blendType = BLEND_NORMAL; this.dustMaterial.depthWrite = false; this.dustMaterial.update();
    this.paveMaterial = new StandardMaterial(); this.paveMaterial.name = 'Fresh road sweep';
    this.paveMaterial.diffuse = new Color(1, .86, .5); this.paveMaterial.emissive = new Color(1, .78, .38); this.paveMaterial.useLighting = false;
    this.paveMaterial.useFog = false; this.paveMaterial.opacity = .6; this.paveMaterial.blendType = BLEND_NORMAL; this.paveMaterial.depthWrite = false; this.paveMaterial.update();
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
  position(i:number) { return cellWorldPosition(i,UNIT); }
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
    return worldPositionCell(px,pz,this.lastScene?.city.cells.length===EXPANDED_MAP_CELLS,UNIT);
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
    this.target.set(Math.max(-22, Math.min(22, x)), 0, Math.max(this.lastScene?.city.cells.length === EXPANDED_MAP_CELLS ? -30 : -22, Math.min(22, z))); this.updateCamera();
  }
  pan(dx: number, dy: number) {
    const scale = this.radius / 700;
    this.target.x += (-dx * Math.cos(this.yaw) - dy * Math.sin(this.yaw)) * scale;
    this.target.z += (dx * Math.sin(this.yaw) - dy * Math.cos(this.yaw)) * scale;
    this.target.x = Math.max(-22, Math.min(22, this.target.x));
    this.target.z = Math.max(this.lastScene?.city.cells.length === EXPANDED_MAP_CELLS ? -30 : -22, Math.min(22, this.target.z)); this.updateCamera();
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
    const selectionClicks = new CanvasSelectionClickGuard();
    document.addEventListener('pointerdown', e => selectionClicks.clear(e.pointerId), true);
    document.addEventListener('pointercancel', e => selectionClicks.clear(e.pointerId), true);
    document.addEventListener('click', e => {
      if (selectionClicks.blocks(e as PointerEvent, e.target === c)) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
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
        const index = this.pick(e.clientX, e.clientY); if (index !== null) { if (e.isTrusted && e.pointerType === 'touch') selectionClicks.arm(e.pointerId, e.timeStamp); this.onCell(index); }
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
        material = disconnectedBuildingMaterial(source);
        this.faded.set(source, material);
      }
      instance.material = material;
    }
  }
  /** Short grow/bounce for parcels that just gained a building or a level. */
  private animate(dt: number) {
    const now = performance.now(), wall = this.fxClock === null ? 0 : (now - this.fxClock) / 1000; this.fxClock = now;
    if (!this.animations.size && !this.dust.length && !this.paving.length && !this.incidentFx.length) { this.fxClock = null; return; }
    // The engine caps dt at 0.1 s, so on a slow device a capped step would stretch every effect over many real
    // seconds of redrawing. Work effects run on the wall clock instead (at least a 60th of a second a frame, at most
    // half a second), so they always end on time; the grow-in keeps its capped step as before.
    const step = Math.min(.5, Math.max(1 / 60, Number.isFinite(wall) ? wall : 0)), grow = Number.isFinite(dt) && dt > 0 ? Math.min(dt, .1) : 1 / 60;
    this.dust = this.dust.filter(cloud => {
      cloud.t += step;
      if (cloud.t >= DUST_SECONDS) { cloud.entity.destroy(); return false; }
      cloud.entity.children.forEach((puff, k, all) => { const p = dustPuff(k, all.length, cloud.t); (puff as Entity).setLocalPosition(p.x, p.y, p.z); (puff as Entity).setLocalScale(p.size, p.size * .7, p.size); });
      return true;
    });
    this.incidentFx = this.incidentFx.filter(fx => {
      fx.t += step;
      if (fx.t >= INCIDENT_SECONDS[fx.kind]) { fx.entity.destroy(); return false; }
      const fade = markFade(fx.kind, fx.t); fx.entity.setLocalScale(fade, fade, fade);
      // Flames stand on the roof (dipping a little into it); smoke rises from just above them.
      fx.flames.forEach((flame, k) => { const h = .75 * flameHeight(k, fx.t); flame.setLocalScale(.3, h, .3); flame.setLocalPosition(flame.getLocalPosition().x, fx.roof - .15 + h / 2, flame.getLocalPosition().z); });
      fx.smoke.forEach((puff, k, all) => { const p = smokePuff(k, all.length, fx.t); puff.setLocalPosition(p.drift, fx.roof + .5 + p.y, p.drift * .6); puff.setLocalScale(p.size, p.size, p.size); });
      fx.lights.forEach((light, k) => { light.enabled = lightLit(fx.t) === k; });
      return true;
    });
    this.paving = this.paving.filter(sweep => {
      sweep.t += step;
      const u = sweep.t / PAVE_SECONDS;
      if (u >= 1) { sweep.entity.destroy(); return false; }
      sweep.entity.enabled = u > 0; const grow = .45 + .55 * Math.max(0, u); sweep.entity.setLocalScale(UNIT * .92 * grow, .02, UNIT * .92 * grow);
      return true;
    });
    for (const [cell, animation] of this.animations) {
      animation.t += grow;
      const tile = this.tiles.get(cell)?.entity, done = animation.t >= (animation.kind === 'built' ? .7 : .5);
      tile?.setLocalScale(1, done ? 1 : buildScale(animation.kind, animation.t), 1);
      if (done) this.animations.delete(cell);
    }
    this.app.renderNextFrame = true;
  }
  get animating() { return this.animations.size + this.dust.length + this.paving.length + this.incidentFx.length; }
  /** A ring of dust at a parcel (or a multi-parcel site's middle); fewer puffs on low quality. */
  private raiseDust(cell: number, site?: Parameters<typeof civicCells>[0]) {
    if (this.dust.length >= MAX_DUST) this.dust.shift()!.entity.destroy();
    const cells = site ? civicCells(site) : [cell], points = cells.map(c => this.position(c));
    const x = points.reduce((n, p) => n + p.x, 0) / points.length, z = points.reduce((n, p) => n + p.z, 0) / points.length;
    const cloud = new Entity('Dust'); cloud.setLocalPosition(x, 0, z); const spread = site ? Math.sqrt(cells.length) : 1; cloud.setLocalScale(spread, 1, spread);
    for (let k = 0, n = this.quality === 'low' ? 4 : 7; k < n; k++) {
      const puff = new Entity('Dust puff'); puff.addComponent('render', { type: 'sphere', material: this.dustMaterial, castShadows: false, receiveShadows: false });
      puff.setLocalScale(0, 0, 0); cloud.addChild(puff);
    }
    this.effects.addChild(cloud); this.dust.push({ entity: cloud, t: 0 }); this.app.renderNextFrame = true;
  }
  private fxMaterial(name: string, colour: [number, number, number], opacity: number) {
    const key = `${name}:${opacity}`, cached = this.fxMaterials.get(key); if (cached) return cached;
    const m = new StandardMaterial(); m.name = name; m.diffuse = new Color(...colour); m.emissive = new Color(...colour); m.useLighting = false; m.useFog = false;
    if (opacity < 1) { m.opacity = opacity; m.blendType = BLEND_NORMAL; m.depthWrite = false; }
    m.update(); this.fxMaterials.set(key, m); return m;
  }
  /** Height of the top of a parcel's model in world units, from its meshes' bounds (1 when it has none). */
  private roofOf(cell: number) {
    let top = 0;
    for (const render of (this.tiles.get(cell)?.entity.findComponents('render') ?? []) as RenderComponent[]) for (const instance of render.meshInstances) top = Math.max(top, instance.aabb.getMax().y);
    return top > .2 ? Math.min(top, 6) : 1;
  }
  /** Shows each incident where it happened for a few seconds; a newer mark on a parcel replaces the old one. Off with reduced motion. */
  showIncidents(marks: readonly IncidentMark[]) {
    if (this.reducedMotion.matches || !marks.length) return;
    const part = (parent: Entity, type: 'box' | 'sphere', material: StandardMaterial, x: number, y: number, z: number, size: number) => {
      const e = new Entity('Incident part'); e.addComponent('render', { type, material, castShadows: false, receiveShadows: false });
      e.setLocalPosition(x, y, z); e.setLocalScale(size, size, size); parent.addChild(e); return e;
    };
    for (const mark of marks) {
      for (const old of this.incidentFx.filter(fx => fx.cell === mark.cell)) old.entity.destroy();
      this.incidentFx = this.incidentFx.filter(fx => fx.cell !== mark.cell);
      const { x, z } = this.position(mark.cell), root = new Entity(`Incident ${mark.kind}`); root.setLocalPosition(x, 0, z); root.setLocalScale(0, 0, 0);
      const roof = this.roofOf(mark.cell), fx = { cell: mark.cell, kind: mark.kind, entity: root, t: 0, roof, flames: [] as Entity[], smoke: [] as Entity[], lights: [] as Entity[] };
      if (mark.kind === 'fire') {
        const flame = this.fxMaterial('Incident flame', [1, .52, .12], .9), core = this.fxMaterial('Incident flame core', [1, .86, .3], .95), smoke = this.fxMaterial('Incident smoke', [.32, .31, .32], .6);
        [[-.3, .15], [.28, -.2], [.05, .32]].forEach(([fx0, fz0], k) => fx.flames.push(part(root, 'box', k === 2 ? core : flame, fx0, 1, fz0, .3)));
        for (let k = 0, n = this.quality === 'low' ? 3 : 5; k < n; k++) fx.smoke.push(part(root, 'sphere', smoke, 0, 1.5, 0, 0));
      } else {
        const [a, b] = mark.kind === 'burglary' ? [[1, .18, .2], [.2, .45, 1]] as const : [[1, 1, 1], [1, .2, .22]] as const, y = roof + .75;
        fx.lights.push(part(root, 'sphere', this.fxMaterial(`Incident light ${a.join()}`, [...a], 1), -.3, y, 0, .36), part(root, 'sphere', this.fxMaterial(`Incident light ${b.join()}`, [...b], 1), .3, y, 0, .36));
        part(root, 'box', this.fxMaterial('Incident light bar', [.16, .18, .22], 1), 0, y - .22, 0, .2).setLocalScale(.95, .12, .3);
      }
      this.effects.addChild(root); this.incidentFx.push(fx);
    }
    while (this.incidentFx.length > MAX_INCIDENT_FX) this.incidentFx.shift()!.entity.destroy();
    this.app.renderNextFrame = true;
  }
  /** A warm square that opens over a new road parcel; along a drag they follow one another. */
  private sweepRoad(cell: number, order: number) {
    const { x, z } = this.position(cell), sweep = new Entity('Road sweep');
    sweep.addComponent('render', { type: 'box', material: this.paveMaterial, castShadows: false, receiveShadows: false });
    // Just above a map overlay (.19), so the sweep shows while the road tool tints the roads.
    sweep.setLocalPosition(x, .22, z); sweep.enabled = false; this.effects.addChild(sweep);
    this.paving.push({ entity: sweep, t: -Math.min(order, 30) * .035 }); this.app.renderNextFrame = true;
  }

  /** In-memory taxi stands. An empty list leaves every parcel signature unchanged. */
  setTaxiDepots(depots: readonly { cell: number; level: 1 | 2; open: boolean }[]) {
    const key = depots.map(d => `${d.cell}:${d.level}:${d.open ? 1 : 0}`).sort().join('|');
    if (key === this.taxiDepotKey) return;
    this.taxiDepotKey = key;
    this.taxiDepots = depots.map(d => ({ cell: d.cell, level: d.level, open: d.open }));
  }
  private taxiDepotKey = '';
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
    const material = new StandardMaterial(), colour = new Color().fromString(({ good: '#3ccf6e', warn: '#f2c14e', bad: '#e5533d', rice: '#f5d35a', vegetables: '#4fd06a', sugarcane: '#59c3ec', ...DISTRICT_COLORS } as Record<string, string>)[tone]);
    material.diffuse = new Color(0, 0, 0); material.emissive = colour; material.useLighting = false; material.useFog = false;
    material.opacity = .25 + strength * .45; material.blendType = BLEND_NORMAL; material.depthWrite = false; material.update();
    this.materials.set(key, material); return material;
  }
  /** `invalid` marks previewed cells where the action would be refused (red frame). */
  render(city: City, selected: number | null, preview: number[], invalid: ReadonlySet<number> = new Set()) {
    this.app.renderNextFrame = true;
    this.ground.setBuildGrid(['road', 'R', 'C', 'I', 'F', 'power', 'water', 'park', 'clinic', 'police', 'fire', 'library', 'temple', 'stadium', 'airport', 'hospital', 'museum', 'amusement', 'cinema', 'restaurant', 'nightmarket', 'concert', 'school', 'university', 'bulldoze', 'bus-depot', 'bus-stop'].includes(this.mode));
    this.lastScene = { city, selected, preview: [...preview] };
    this.updateGroundEdges(city);
    const connected = connectedRoads(city), services = utilityService(city, connected), online = services.online;
    // One lookup table per refresh: a city without services pays nothing per parcel.
    const civicByCell = city.civic?.sites.length ? new Map(city.civic.sites.flatMap(site => civicCells(site).map(cell => [cell, site] as const))) : undefined;
    const fadeLater: Entity[] = [];
    for (let i = 0; i < city.cells.length; i++) {
      const cell = city.cells[i], b = city.buildings.find(b => b.cell === i);
      const coord=expandedCellCoordinate(i); const neighbor=(dx:number,dz:number)=>expandedCellAt(coord.x+dx,coord.z+dz);
      const linked=(dx:number,dz:number)=>{const n=neighbor(dx,dz);return n !== null && roadLinked(city,i,n);};
      const links = cell.road ? [linked(-1,0),linked(1,0),linked(0,-1),linked(0,1)].map(Number).join('') : '';
      const fertility = cell.zone === 'F' ? city.resources.fertility[i] : '';
      // Night lights only for real occupancy: residents at home or allocated workers on site.
      const lit = !!b && (b.zone === 'R' ? city.households.some(h => h.home === b.id) : city.firms.some(f => f.building === b.id && firmWorkerCount(city, f.id) > 0));
      // Buildings without connected frontage are suspended in the sim, so they render faded.
      const reach = !!b && access(city, i);
      const commercial = b?.zone === 'C' ? city.firms.find(f => f.building === b.id) : undefined;
      const commercialLit = !!commercial && lit && reach && services.ok(commercial.building);
      const factory = b?.zone === 'I' ? city.firms.find(f => f.building === b.id) : undefined;
      const factoryPowered = !!factory && reach && services.ok(factory.building);
      const factoryActive = !!factory && factoryWorking(firmWorkerCount(city, factory.id), reach, factoryPowered, factory.recipe, factory.crops);
      const municipalPark = city.parks.find(p => p.cell === i), park = pocketPark(city, i), plant = city.plants.find(p => p.cell === i), plantOn = !!plant && online.has(plant.id);
      const campus = city.education?.campuses.find(item => item.cell === i);
      const stand = this.taxiDepots.find(d => d.cell === i);
      const civic = civicByCell?.get(i);
      const signature = `${cell.road}:${cell.zone}:${b?.id}:${b?.level}:${connected.has(i)}:${links}:${city.roadTopology?.oneWay[i] ?? 0}:${this.visualRevision}:${fertility}:${lit}:${reach}:${factoryActive}:${factoryPowered}:${commercialLit}:${park}:${municipalPark?.id}:${municipalPark?.level}:${civic?.id}:${civic?.kind}:${civic?.cells?.length ?? 1}:${plant?.kind}:${plant?.level ?? 1}:${plantOn}:${campus?.id}:${campus?.kind}:${campus?.level}:${campus?.open}${stand ? `:taxi${stand.level}${stand.open ? 1 : 0}` : ''}`;
      if (this.tiles.get(i)?.signature === signature) continue;
      this.tiles.get(i)?.entity.destroy();
      const tile = new Entity(`Parcel ${i}`); const { x, z } = this.position(i); tile.setLocalPosition(x, 0, z); this.app.root.addChild(tile);
      this.tiles.set(i, { entity: tile, signature });
      if (b && !reach || plant && !plantOn || campus && !campus.open) fadeLater.push(tile);
      if (cell.road) {
        const horizontal = (linked(-1,0)) || (linked(1,0));
        const vertical = (linked(0,-1)) || (linked(0,1));
        const open = new Set<Side>();
        if (linked(-1,0) || i === GATEWAY) open.add('-x');
        if (linked(1,0)) open.add('+x');
        if (linked(0,-1)) open.add('-z');
        if (linked(0,1)) open.add('+z');
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
          arrows.setLocalEulerAngles(0, direction === 1 || direction === 'east' ? 90 : direction === -1 || direction === 'west' ? -90 : direction === -SIZE || direction === 'north' ? 180 : 0, 0);
          for (const lane of [-.36, .36]) {
            this.box(arrows, lane, .18, 0, .055, .012, .48, '#ffffff', false);
            const left = this.box(arrows, lane - .08, .18, .17, .055, .012, .23, '#ffffff', false);
            const right = this.box(arrows, lane + .08, .18, .17, .055, .012, .23, '#ffffff', false);
            left.setLocalEulerAngles(0, 40, 0); right.setLocalEulerAngles(0, -40, 0);
          }
        }
        // Lamps stand on the sidewalk of straight streets, every fourth parcel along the street.
        const along = horizontal && !vertical ? i % SIZE : vertical && !horizontal ? expandedCellCoordinate(i).z : -1;
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
      } else if (campus) {
        this.campus(tile, campus.kind, campus.level);
      } else if (municipalPark) {
        this.municipalPark(tile);
      } else if (civic) {
        // A larger site is drawn once, from its top-left parcel, stretched over its footprint; its other parcels stay bare.
        if (i === civic.cell) {
          const [columns, rows] = civic.cells ? civicFootprint(civic.kind) : [1, 1];
          if (columns * rows === 1) this.civic(tile, civic.kind);
          else { const piece = new Entity('Civic set piece'); piece.setLocalPosition((columns - 1) * UNIT / 2, 0, (rows - 1) * UNIT / 2); piece.setLocalScale(columns * 1.06, Math.min(columns, rows), rows * 1.06); tile.addChild(piece); this.civic(piece, civic.kind); }
        }
      } else if (plant) {
        this.plant(tile, plant.kind, plantOn, plantLevel(plant));
      } else if (stand) {
        this.taxiStand(tile, stand.level, stand.open);
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
          if (b.zone === 'C') { this.commercial(tile, b.level, commercialLit); continue; }
          this.box(tile, 0, .086, 0, 1.63, .018, 1.63, b.zone === 'R' ? this.ground.lawnMaterial : b.zone === 'I' ? this.ground.soilMaterial : '#afb5a8');
          if (b.zone === 'I' && b.level >= 4) {
            tile.addChild(this.factories.build(this.assets, b.level, i, factoryActive, factoryPowered && lit, this.quality === 'low', this.reducedMotion.matches));
            continue;
          }
          // Detailed assets for apartments/condos; retain code-native fallback if loading fails.
          if (b.zone === 'R' && b.level > 3) {
            const residence = this.assets?.building('R', b.level, i, lit);
            if (residence) { residence.setLocalPosition(0, .1, 0); tile.addChild(residence); continue; }
            const condo = b.level >= 7, tier = condo ? b.level - 6 : b.level - 3;
            const height = (condo ? 3.8 : 2.1) + tier * .6;
            this.box(tile, 0, height / 2 + .1, 0, 1.3, height, 1.25, condo ? '#9fbcc8' : '#d5d6c5');
            this.box(tile, 0, height + .16, 0, 1.4, .12, 1.35, condo ? '#667c8b' : '#aa8270');
            for (let floor = 0; floor < (condo ? tier + 4 : tier + 2); floor++)
              for (const x of [-.36, .12]) this.box(tile, x, .48 + floor * .58, .635, .25, .25, .025, lit ? this.windowLit : '#718a97', false);
            continue;
          }
          const visualLevel = b.level;
          const model = this.assets?.building(b.zone, b.zone === 'I' ? factoryLevel(b.level).model : visualLevel, i, lit);
          if (model) {
            model.setLocalPosition(0, .1, 0); tile.addChild(model);
            // Bigger factories show their scale with a chimney and an input tank.
            if (b.zone === 'I' && b.level >= 2) { const chimney = this.assets?.detail('chimney', .32); if (chimney) { chimney.setLocalPosition(.68, .1, -.62); tile.addChild(chimney); } }
            if (b.zone === 'I' && b.level >= 3) { const tank = this.assets?.detail('tank', .6); if (tank) { tank.setLocalPosition(-.6, .1, .66); tile.addChild(tank); } }
            // One inset marker per level above three, contained within the same parcel.
            if (b.zone === 'I') for (let n = 0; n < factoryLevel(b.level).markers; n++) this.box(tile, -.7 + n * .23, .12, .82, .13, .06, .09, '#f1c267', false);
            if (b.zone === 'R' && b.level < 3 && hashCell(i) % 3 === 0) { const planter = this.assets?.detail('planter', .42); if (planter) { planter.setLocalPosition(.66, .1, .7); tile.addChild(planter); } }
            // A lived-in house gets a front-yard bench; some also a second bush (decoration only).
            if (b.zone === 'R' && b.level < 3 && lit && hashCell(i + 5) % 2 === 0) this.bench(tile, -.62, .7);
            if (b.zone === 'R' && b.level < 3 && hashCell(i) % 3 === 1) { const bush = this.assets?.detail('planter', .34); if (bush) { bush.setLocalPosition(-.7, .1, -.68); tile.addChild(bush); } }
            continue;
          }
          const h = b.zone === 'R' ? .75 + visualLevel * .2 : 0.9 + visualLevel * 0.75 + (i % 3) * 0.22;
          const tower = b.zone === 'I' ? h * 0.65 : h;
          this.box(tile, -0.1, tower / 2 + 0.1, 0, 1.25, tower, 1.2, { R: '#d7e5d1', C: '#b6d4df', I: '#d9c09a' }[b.zone]);
          this.box(tile, -0.1, tower + 0.17, 0, 1.34, 0.16, 1.3, { R: '#d0683f', C: '#4a62a6', I: '#8c6340' }[b.zone]);
          for (let level = 0; level < (b.zone === 'R' ? Math.min(visualLevel, 2) : Math.min(visualLevel + 1, 5)); level++) {
            for (const wx of [-0.44, 0.2]) this.box(tile, wx, 0.52 + level * 0.55, 0.608, 0.25, 0.27, 0.035, lit ? this.windowLit : '#f9df9a', false);
          }
          if (b.zone === 'I') this.box(tile, 0.52, h * 0.65, -0.38, 0.2, h * 1.1, 0.22, '#786b60');
        }
      }
    }
    for (const tile of fadeLater) this.fade(tile);
    if (city !== this.effectsCity) {
      this.effectsCity = city; this.buildingState = new Map(); this.roadState = null;
      for (const fx of this.incidentFx) fx.entity.destroy(); this.incidentFx = [];
    }
    const changes = diffBuildings(this.buildingState, placeList(city));
    this.buildingState = changes.next;
    const roads = diffRoads(this.roadState, city.cells);
    this.roadState = roads.next;
    if (!this.reducedMotion.matches) {
      for (const event of changes.events) {
        if (event.kind !== 'removed') this.animations.set(event.cell, { kind: event.kind, t: 0 });
        if (event.kind !== 'upgraded') this.raiseDust(event.cell, civicByCell?.get(event.cell));
      }
      roads.paved.forEach((cell, order) => this.sweepRoad(cell, order));
    }
    this.traffic.sync(city);
    for (const child of [...this.markers.children]) child.destroy();
    for (const i of new Set([...preview, ...(selected === null ? [] : [selected])])) {
      const p = this.position(i); const color = i === selected ? '#fff1bb' : invalid.has(i) ? '#ff5a4a' : this.mode === 'select' || this.mode === 'pan' ? '#f7bf60' : '#6fe08a';
      for (const dz of [-0.92, 0.92]) this.box(this.markers, p.x, 0.18, p.z + dz, 1.94, 0.08, 0.07, this.material(color, true));
      for (const dx of [-0.92, 0.92]) this.box(this.markers, p.x + dx, 0.18, p.z, 0.07, 0.08, 1.94, this.material(color, true));
    }
  }
  /** Yellow kerb stand. Not a saved building; the session owns the depot record. */
  private taxiStand(tile: Entity, level: 1 | 2, open: boolean) {
    tile.name += ' Taxi stand';
    const body = open ? '#f2c94c' : '#8d8348';
    this.box(tile, 0, .08, 0, 1.7, .1, 1.7, '#d9d3c4');
    this.box(tile, 0, .42, -.05, 1.15, .62, .85, body);
    this.box(tile, 0, .8, -.05, 1.28, .12, 1.0, '#2b2b2b');
    this.box(tile, 0, .98, -.05, .7, .22, .16, open ? '#111111' : '#4a4a4a');
    this.box(tile, 0, .28, .48, .9, .08, .28, '#3a3a3a');
    if (level > 1) this.box(tile, .62, .45, -.55, .4, .5, .4, body);
  }
  /** Small procedural civic buildings, independent of downloaded assets and simulation data. */
  private campus(tile: Entity, kind: 'school' | 'university', level: number) {
    tile.name += kind === 'school' ? ' School' : ' University';
    const university = kind === 'university', accent = university ? '#5d65aa' : '#b86339';
    this.box(tile, 0, .08, 0, 1.82, .12, 1.82, '#c9c9af');
    this.box(tile, 0, .6, -.12, 1.38, 1, 1.12, '#f3e1b2');
    this.box(tile, 0, 1.17, -.12, 1.52, .15, 1.25, accent);
    this.box(tile, 0, .37, .46, .27, .6, .06, '#32475c');
    for (const x of [-.48, .48]) this.box(tile, x, .73, .46, .25, .3, .04, '#91cddd');
    // A book-shaped crest identifies the school; university gets a columned entrance.
    if (university) {
      this.box(tile, 0, .97, .65, 1.04, .12, .45, accent);
      for (const x of [-.42, .42]) this.box(tile, x, .5, .68, .13, .85, .13, '#faf0d3');
    } else {
      this.box(tile, -.1, .93, .49, .18, .18, .04, '#fff6d8');
      this.box(tile, .1, .93, .49, .18, .18, .04, '#fff6d8');
    }
    if (level > 1) {
      this.box(tile, -.56, .52, -.69, .52, .85, .42, '#f3e1b2');
      this.box(tile, -.56, 1, -.69, .62, .12, .52, accent);
    }
    this.box(tile, .78, .73, .65, .045, 1.35, .045, '#e8e5d0');
    this.box(tile, .6, 1.23, .65, .36, .25, .035, accent);
  }
  /** The complete garden stays inside one 2-unit tile, independently of roads. */
  /** A city service or place: one small set piece per kind, in its own colour, that reads from above. */
  private civic(tile: Entity, kind: CivicKind) {
    if (kind === 'stadium') {
      // Pitch with two stands and floodlight masts.
      this.box(tile, 0, .05, 0, 1.8, .08, 1.8, '#9aa19a', false);
      this.box(tile, 0, .1, 0, 1.2, .04, .78, '#4fb06a', false);
      this.box(tile, 0, .125, 0, .02, .005, .78, '#f2f5ee', false);
      for (const z of [-.66, .66]) { this.box(tile, 0, .22, z, 1.5, .26, .24, '#d9dde3'); this.box(tile, 0, .4, z * 1.08, 1.5, .1, .12, '#c8452f'); }
      for (const [x, z] of [[-.8, -.8], [.8, -.8], [-.8, .8], [.8, .8]]) { this.box(tile, x, .55, z, .05, 1, .05, '#8b929c'); this.box(tile, x, 1.08, z, .2, .1, .08, '#f6f1c7'); }
      return;
    }
    if (kind === 'airport') {
      // Apron, a runway with centre dashes, a terminal, a control tower and one parked plane.
      this.box(tile, 0, .05, 0, 1.8, .08, 1.8, '#aeb4b0', false);
      this.box(tile, 0, .1, .48, 1.74, .02, .46, '#3d444f', false);
      for (const x of [-.66, -.33, 0, .33, .66]) this.box(tile, x, .115, .48, .16, .005, .04, '#f2f5ee', false);
      this.box(tile, -.36, .26, -.5, .9, .34, .46, '#e9eef5');
      this.box(tile, -.36, .46, -.5, .96, .06, .5, '#3f7fc4');
      this.box(tile, -.36, .24, -.26, .7, .16, .02, '#9ec3e6');
      this.box(tile, .62, .5, -.56, .12, .82, .12, '#d9dde3'); this.box(tile, .62, .96, -.56, .22, .14, .22, '#3f7fc4');
      this.box(tile, .2, .2, .1, .5, .09, .1, '#f7f9fc'); this.box(tile, .16, .2, .1, .1, .03, .5, '#f7f9fc'); this.box(tile, .42, .27, .1, .06, .12, .03, '#c8452f');
      return;
    }
    if (kind === 'temple') {
      // Stepped base, hall and a stacked gold roof.
      this.box(tile, 0, .05, 0, 1.8, .08, 1.8, '#c9b78f', false);
      this.box(tile, 0, .16, 0, 1.3, .14, 1, '#efe6d2');
      this.box(tile, 0, .46, 0, 1, .48, .72, '#f4efe4');
      this.box(tile, 0, .76, 0, 1.2, .1, .9, '#b5452b');
      this.box(tile, 0, .9, 0, .9, .12, .62, '#d8a53a');
      this.box(tile, 0, 1.04, 0, .5, .14, .34, '#b5452b');
      this.box(tile, 0, 1.24, 0, .08, .3, .08, '#d8a53a');
      return;
    }
    if (kind === 'amusement') {
      // Ferris wheel on an A-frame, a striped tent and a ticket booth.
      this.box(tile, 0, .05, 0, 1.8, .08, 1.8, '#c9d7a8', false);
      for (const x of [-.62, -.18]) this.box(tile, x, .5, -.4, .05, .9, .05, '#8b929c');
      this.box(tile, -.4, .95, -.4, .5, .05, .05, '#8b929c');
      for (const [x, y] of [[-.4, 1.32], [-.4, .58], [-.77, .95], [-.03, .95], [-.66, 1.21], [-.14, 1.21], [-.66, .69], [-.14, .69]]) this.box(tile, x, y, -.4, .13, .13, .1, ['#e07bb5', '#f3c46b', '#5aa9e6', '#7bd389'][Math.round((x + y) * 10) & 3]);
      this.box(tile, .45, .3, .35, .7, .4, .7, '#f4efe4'); this.box(tile, .45, .58, .35, .78, .16, .78, '#c8452f'); this.box(tile, .45, .74, .35, .46, .14, .46, '#f3c46b'); this.box(tile, .45, .9, .35, .16, .16, .16, '#c8452f');
      this.box(tile, -.5, .22, .5, .3, .28, .3, '#5aa9e6');
      return;
    }
    if (kind === 'nightmarket') {
      // Rows of small stalls under coloured awnings with a string of lamps.
      this.box(tile, 0, .05, 0, 1.8, .08, 1.8, '#8d8a84', false);
      for (const [n, [x, z]] of [[-.55, -.5], [0, -.5], [.55, -.5], [-.55, .45], [0, .45], [.55, .45]].entries()) {
        this.box(tile, x, .22, z, .36, .26, .3, '#f4efe4'); this.box(tile, x, .42, z, .44, .08, .4, ['#c2569b', '#f3c46b', '#5aa9e6', '#e08a3c', '#7bd389', '#c8452f'][n]);
      }
      for (const x of [-.8, .8]) this.box(tile, x, .45, 0, .04, .8, .04, '#5b6068');
      this.box(tile, 0, .84, 0, 1.6, .02, .02, '#5b6068');
      for (const x of [-.6, -.3, 0, .3, .6]) this.box(tile, x, .78, 0, .07, .07, .07, '#ffe9a3');
      return;
    }
    if (kind === 'concert') {
      // Open ground with a roofed stage, speaker stacks and a lighting truss.
      this.box(tile, 0, .05, 0, 1.8, .08, 1.8, '#a9b59a', false);
      this.box(tile, 0, .2, -.55, 1.3, .22, .5, '#3a3f4a');
      for (const x of [-.62, .62]) { this.box(tile, x, .62, -.55, .06, .9, .06, '#8b929c'); this.box(tile, x * 1.25, .36, -.4, .2, .5, .2, '#22262d'); }
      this.box(tile, 0, 1.08, -.55, 1.4, .08, .6, '#3f6fd8');
      for (const x of [-.4, 0, .4]) this.box(tile, x, 1, -.3, .1, .08, .08, ['#f3c46b', '#e07bb5', '#7bd389'][Math.round(x * 2.5) + 1]);
      for (const [x, z] of [[-.5, .2], [-.15, .35], [.2, .2], [.5, .4], [-.3, .6], [.1, .65]]) this.box(tile, x, .16, z, .08, .16, .08, '#e9eef5');
      return;
    }
    const [wall, trim] = { clinic: ['#eef1ec', '#3fa372'], police: ['#dfe6f2', '#2f5fae'], fire: ['#f1e3dc', '#c8452f'], library: ['#ece6f4', '#8a6fc4'], hospital: ['#f6f7f9', '#d9534f'], museum: ['#eef2ee', '#2f8f8a'], cinema: ['#ece8f6', '#7a4fd0'], restaurant: ['#f6ecdf', '#e08a3c'] }[kind];
    this.box(tile, 0, .05, 0, 1.8, .08, 1.8, '#b9bcb4', false);
    this.box(tile, -.1, .42, -.15, 1.25, .7, 1.05, wall);
    this.box(tile, -.1, .8, -.15, 1.31, .08, 1.11, trim);
    this.box(tile, -.1, .28, .39, .34, .42, .04, '#3b4658');
    for (const x of [-.52, .32]) this.box(tile, x, .5, .39, .22, .2, .03, '#9ec3e6');
    if (kind === 'clinic') { this.box(tile, -.1, .95, -.15, .5, .06, .16, trim); this.box(tile, -.1, .95, -.15, .16, .06, .5, trim); }
    else if (kind === 'police') { this.box(tile, -.1, .95, -.15, .3, .16, .3, trim); this.box(tile, .62, .62, .6, .05, 1.1, .05, '#8b929c'); this.box(tile, .72, 1.08, .6, .22, .14, .02, trim); }
    else if (kind === 'hospital') { this.box(tile, .5, .62, -.5, .5, 1.1, .5, wall); this.box(tile, .5, 1.2, -.5, .56, .06, .56, trim); this.box(tile, -.3, .95, -.15, .46, .06, .14, trim); this.box(tile, -.3, .95, -.15, .14, .06, .46, trim); }
    else if (kind === 'cinema') { this.box(tile, -.1, 1.02, .2, .9, .34, .1, '#22262d'); this.box(tile, -.1, 1.02, .26, .78, .24, .02, '#ffe9a3'); this.box(tile, -.1, .6, .44, .7, .1, .16, trim); }
    else if (kind === 'restaurant') { this.box(tile, -.1, .62, .5, 1.2, .06, .3, trim); for (const x of [.6, .78]) { this.box(tile, x, .2, .55, .12, .2, .12, '#f4efe4'); this.box(tile, x, .38, .55, .22, .04, .22, trim); } this.box(tile, .3, 1, -.4, .14, .4, .14, '#8b929c'); }
    else if (kind === 'museum') { for (const x of [-.56, -.33, -.1, .13, .36]) this.box(tile, x, .42, .42, .07, .7, .07, '#f7f9f7'); this.box(tile, -.1, .92, .3, 1.1, .16, .3, trim); this.box(tile, -.1, 1.04, .3, .6, .1, .2, trim); }
    else if (kind === 'fire') { this.box(tile, .68, .7, -.5, .34, 1.3, .34, wall); this.box(tile, .68, 1.38, -.5, .4, .08, .4, trim); this.box(tile, -.32, .3, .39, .6, .46, .04, trim); }
    else { for (const x of [-.56, -.26, .06, .36]) this.box(tile, x, .42, .42, .08, .7, .08, '#f7f4fb'); this.box(tile, -.1, .9, -.15, .9, .12, .7, trim); }
  }
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
  private plant(tile: Entity, kind: UtilityKind, on: boolean, level: number) {
    this.box(tile, 0, .06, 0, 1.78, .08, 1.78, '#9ea6a0', false);
    // Additional utility modules stay inside this parcel; count shows levels 2/3.
    for (let n = 1; n < level; n++) this.box(tile, -.65 + (n - 1) * .42, .3, -.72, .32, .4, .28, kind === 'power' ? '#d9b64b' : '#69acc7');
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
  setQuality(quality: Quality) { this.atmosphere.setQuality(quality); if (quality !== this.quality) { this.quality = quality; this.visualRevision++; } }

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
        const coordinate=expandedCellCoordinate(i), next=expandedCellAt(coordinate.x+dx,coordinate.z+dz);
        if (next !== null && next < city.cells.length && !city.cells[next].road) band(x, z, dx, dz, .98, 1.34, 100);
      }
    }
    for (const building of city.buildings) {
      const { x, z } = this.position(building.cell);
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) band(x, z, dx, dz, .87, 1.18, 55);
    }
    this.edgeMesh.setPositions(positions); this.edgeMesh.setNormals(normals); this.edgeMesh.setColors32(colors); this.edgeMesh.setIndices(indices); this.edgeMesh.update();
  }
}
