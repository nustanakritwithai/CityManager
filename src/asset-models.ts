import {
  BoundingBox, Color, Entity, Mesh, MeshInstance, StandardMaterial, Texture, PIXELFORMAT_SRGBA8, FILTER_LINEAR, BLEND_ADDITIVE, BLEND_NORMAL,
  type AppBase, type ContainerResource, type RenderComponent
} from 'playcanvas';
import { TOWER_ROOFS, luxuryTower, luxuryTowerLayout, residentialVisualHeight, roomLights, towerGlassGeometry, type TowerName } from './building-visuals.ts';
import type { RoadTile } from './road-tiles.ts';
import { retailCapacity } from './retail-capacity.ts';

const MODEL_NAMES = [
  'house-a', 'house-b', 'house-c', 'house-d', 'house-e', 'house-f', 'house-g', 'house-h', 'house-i',
  'shop-a', 'shop-b', 'shop-c', 'shop-d', 'shop-e', 'shop-f', 'shop-g', 'tower-a', 'tower-b', 'tower-c',
  'parasol-a', 'parasol-b', 'awning',
  'factory-a', 'factory-b', 'factory-c', 'factory-d', 'factory-e', 'factory-f', 'chimney', 'tank',
  'tree', 'tree-large', 'planter', 'streetlight',
  'road-straight', 'road-end', 'road-corner', 'road-tee', 'road-cross', 'road-crossing', 'road-square',
] as const;
export type CityModelName = typeof MODEL_NAMES[number];
export type CityAssetStatus = {
  ready: boolean;
  loaded: CityModelName[];
  failed: CityModelName[];
  pending: CityModelName[];
  errors: Partial<Record<CityModelName, string>>;
};

/**
 * Atlas swatches (512px Kenney colormaps, glTF top-left origin) that read as glass
 * or bulbs. Only these texels glow at night, and only on occupied/staffed buildings.
 */
const SUBURBAN_GLASS = [320, 128, 384, 256] as const, INDUSTRIAL_GLASS = [256, 384, 320, 512] as const;
const glowRegion = (name: CityModelName): readonly [number, number, number, number] | undefined =>
  /^(house|shop|tower)-/.test(name) ? SUBURBAN_GLASS : /^factory-/.test(name) ? INDUSTRIAL_GLASS : name === 'streetlight' ? [256, 256, 320, 384] : undefined;

/** Visual variants per building level; a parcel hash picks one, never the sim RNG. */
const LEVEL_VARIANTS: Readonly<Record<'R' | 'C' | 'I', readonly (readonly CityModelName[])[]>> = {
  R: [['house-a', 'house-c', 'house-d'], ['house-b', 'house-e', 'house-f'], ['tower-a', 'tower-b', 'tower-c']],
  C: [['shop-a', 'shop-b', 'shop-c', 'shop-d'], ['shop-e', 'shop-f', 'shop-g'], ['tower-a', 'tower-b', 'tower-c']],
  I: [['factory-a', 'factory-c'], ['factory-b', 'factory-d'], ['factory-e', 'factory-f']],
};
/**
 * Roof colours for houses, taken from the Kenney atlas itself so they stay in its style. The atlas
 * roof swatches are its green pair at (row 2–3, column 0); a palette repaints only those two cells.
 */
const ROOF_PALETTES: readonly (readonly [light: string, dark: string])[] = [['#ff9144', '#ff7e44'], ['#6282d1', '#5a63c3'], ['#f36743', '#dd5b4a'], ['#787d95', '#626880']];
const ROOF_SWATCHES: readonly [x: number, y: number][] = [[0, 128], [0, 192]];
const cellHash = (cell: number, salt = 0) => ((Math.imul((cell + salt * 977) >>> 0, 1103515245) + 12345) >>> 16) & 0x7fff;
export type GlowRegistrar = (material: StandardMaterial, strength: number, blink?: boolean) => void;

/** Keep additive night overlays black when a disconnected building is greyed out. */
export function disconnectedBuildingMaterial(source: StandardMaterial): StandardMaterial {
  const material = source.clone() as StandardMaterial;
  material.name = `${source.name} · disconnected`;
  material.diffuse = source.blendType === BLEND_ADDITIVE && !source.useLighting ? new Color(0, 0, 0) : new Color(.52, .54, .58);
  material.emissiveIntensity = 0; material.update(); return material;
}

const loads = new WeakMap<AppBase, Promise<CityAssets>>();
const baseUrl = (import.meta as ImportMeta & { env: { BASE_URL: string } }).env.BASE_URL;

/** Renderer-only, self-hosted models. Null instances leave procedural fallback to CityView. */
export class CityAssets {
  readonly status: CityAssetStatus = { ready: false, loaded: [], failed: [], pending: [...MODEL_NAMES], errors: {} };
  private readonly resources = new Map<CityModelName, ContainerResource>();
  private readonly lit = new Map<StandardMaterial, StandardMaterial>();
  private readonly masks = new Map<string, Texture>();
  private readonly glassMeshes = new Map<Mesh, Mesh | null>();
  private readonly luxuryMaterials = new Map<string, StandardMaterial>();
  private roomMaterial: StandardMaterial | null = null;
  private readonly tinted = new Map<StandardMaterial, StandardMaterial>();
  private readonly roofed = new Map<StandardMaterial, StandardMaterial[]>();
  private readonly roofMaps = new Map<Texture, Texture[]>();
  glowRegistrar: GlowRegistrar | null = null;

  private constructor(private readonly app: AppBase) {
    app.once('destroy', () => {
      for (const mesh of this.glassMeshes.values()) if (mesh) {
        mesh.decRefCount(); if (mesh.refCount < 1) mesh.destroy();
      }
      this.glassMeshes.clear();
      for (const material of this.luxuryMaterials.values()) material.destroy();
      this.luxuryMaterials.clear();
      this.roomMaterial?.emissiveMap?.destroy(); this.roomMaterial?.destroy(); this.roomMaterial = null;
    });
  }

  /** One bounded load per application; failures never prevent the city from starting. */
  static load(app: AppBase): Promise<CityAssets> {
    const existing = loads.get(app);
    if (existing) return existing;
    const assets = new CityAssets(app);
    const result = Promise.all(MODEL_NAMES.map(name => assets.loadOne(name))).then(() => {
      assets.status.ready = true;
      app.renderNextFrame = true;
      return assets;
    });
    loads.set(app, result);
    return result;
  }

  private loadOne(name: CityModelName): Promise<void> {
    return new Promise(resolve => {
      let settled = false;
      const finish = (resource?: ContainerResource, error?: string) => {
        if (settled) return; // Ignore callbacks that arrive after the timeout.
        settled = true;
        clearTimeout(timer);
        this.status.pending = this.status.pending.filter(item => item !== name);
        if (resource) {
          this.resources.set(name, resource);
          this.status.loaded.push(name);
        } else this.fail(name, error || 'Model resource is unavailable.');
        this.app.renderNextFrame = true;
        resolve();
      };
      const timer = setTimeout(() => finish(undefined, 'Model request exceeded 10 seconds.'), 10_000);
      try {
        this.app.assets.loadFromUrl(`${baseUrl}assets/kenney-city/models/${name}.glb`, 'container', (error, asset) => {
          const resource = asset?.resource;
          if (error || !resource || typeof resource.instantiateRenderEntity !== 'function') finish(undefined, error || 'Invalid GLB container.');
          else finish(resource);
        });
      } catch (error) {
        finish(undefined, error instanceof Error ? error.message : String(error));
      }
    });
  }

  private fail(name: CityModelName, message: string) {
    this.resources.delete(name);
    this.status.loaded = this.status.loaded.filter(item => item !== name);
    if (!this.status.failed.includes(name)) {
      this.status.failed.push(name);
      console.warn(`CityManager model ${name} unavailable; using procedural fallback. ${message}`);
    }
    this.status.errors[name] = message;
  }

  /** Fresh entities/mesh instances share the loaded meshes, materials and textures. */
  private mask(region: readonly [number, number, number, number]): Texture {
    const key = region.join(','), existing = this.masks.get(key);
    if (existing) return existing;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#000'; context.fillRect(0, 0, 512, 512);
    context.fillStyle = '#fff'; context.fillRect(region[0], region[1], region[2] - region[0], region[3] - region[1]);
    const texture = new Texture(this.app.graphicsDevice, { name: `Night glow mask ${key}`, width: 512, height: 512, format: PIXELFORMAT_SRGBA8,
      mipmaps: false, minFilter: FILTER_LINEAR, magFilter: FILTER_LINEAR });
    texture.setSource(canvas); this.masks.set(key, texture); return texture;
  }

  /** One shared room texture/material and at most one extra mesh per tower source mesh. */
  private towerRoomMaterial(): StandardMaterial {
    if (this.roomMaterial) return this.roomMaterial;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#000'; context.fillRect(0, 0, 512, 512);
    for (const room of roomLights()) {
      context.fillStyle = room.color;
      context.fillRect((room.column + .14) * 512 / 5, (room.row + .14) * 512 / 6, .72 * 512 / 5, .72 * 512 / 6);
    }
    const texture = new Texture(this.app.graphicsDevice, { name: 'Tower room lights', width: 512, height: 512,
      format: PIXELFORMAT_SRGBA8, mipmaps: false, minFilter: FILTER_LINEAR, magFilter: FILTER_LINEAR });
    texture.setSource(canvas);
    const material = new StandardMaterial(); material.name = 'Tower rooms · night only';
    material.diffuse = new Color(0, 0, 0); material.emissive = new Color(1, 1, 1);
    material.emissiveMap = texture; material.emissiveMapChannel = 'rgb'; material.emissiveIntensity = 0;
    material.useLighting = false; material.useFog = false; material.blendType = BLEND_ADDITIVE; material.depthWrite = false;
    material.update(); this.roomMaterial = material; this.glowRegistrar?.(material, 2.2);
    return material;
  }

  private towerGlass(mesh: Mesh): Mesh | null {
    if (this.glassMeshes.has(mesh)) return this.glassMeshes.get(mesh)!;
    const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
    mesh.getPositions(positions); mesh.getNormals(normals); mesh.getUvs(0, uvs); mesh.getIndices(indices);
    const data = towerGlassGeometry(positions, normals, uvs, indices);
    let overlay: Mesh | null = null;
    if (data.indices.length) {
      overlay = new Mesh(this.app.graphicsDevice);
      overlay.setPositions(data.positions); overlay.setNormals(data.normals); overlay.setUvs(0, data.uvs); overlay.setIndices(data.indices); overlay.update();
      // Keep cached geometry alive when the last visible building is rebuilt/destroyed.
      overlay.incRefCount();
    }
    this.glassMeshes.set(mesh, overlay); return overlay;
  }

  private litMaterial(source: StandardMaterial, region: readonly [number, number, number, number], strength: number): StandardMaterial {
    const existing = this.lit.get(source);
    if (existing) return existing;
    const material = source.clone() as StandardMaterial;
    material.name = `${source.name} · lit windows`;
    material.emissive = new Color(1, .72, .38); material.emissiveMap = this.mask(region); material.emissiveIntensity = 0;
    material.update(); this.lit.set(source, material);
    this.glowRegistrar?.(material, strength);
    return material;
  }

  /** The same atlas with the roof swatches repainted; one texture per (atlas, palette), shared by every house. */
  private roofMap(source: Texture, palette: number): Texture | null {
    const image = source.getSource() as CanvasImageSource | undefined;
    if (!image) return null;
    let maps = this.roofMaps.get(source); if (!maps) { maps = []; this.roofMaps.set(source, maps); }
    if (maps[palette]) return maps[palette];
    const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
    const context = canvas.getContext('2d')!, unit = source.width / 512;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    ROOF_SWATCHES.forEach(([x, y], i) => { context.fillStyle = ROOF_PALETTES[palette][i]; context.fillRect(x * unit, y * unit, 64 * unit, 64 * unit); });
    const texture = new Texture(this.app.graphicsDevice, { name: `Kenney atlas · roof ${palette}`, width: canvas.width, height: canvas.height, format: source.format,
      mipmaps: source.mipmaps, minFilter: source.minFilter, magFilter: source.magFilter, addressU: source.addressU, addressV: source.addressV });
    texture.setSource(canvas); maps[palette] = texture; return texture;
  }

  private roofMaterial(source: StandardMaterial, palette: number): StandardMaterial {
    let list = this.roofed.get(source); if (!list) { list = []; this.roofed.set(source, list); }
    if (list[palette]) return list[palette];
    const map = source.diffuseMap ? this.roofMap(source.diffuseMap, palette) : null;
    if (!map) return source;
    const material = source.clone() as StandardMaterial;
    material.name = `${source.name} · roof ${palette}`; material.diffuseMap = map; material.update();
    list[palette] = material; return material;
  }

  /** Disconnected roads keep the warning tint they had as primitives. */
  private tintedMaterial(source: StandardMaterial): StandardMaterial {
    const existing = this.tinted.get(source);
    if (existing) return existing;
    const material = source.clone() as StandardMaterial;
    material.name = `${source.name} · disconnected`; material.diffuse = new Color(1, .6, .52); material.update();
    this.tinted.set(source, material); return material;
  }

  private instantiate(name: CityModelName, width: number, heightFactor = 1, lit = false, tint = false, roof?: number, targetHeight?: number): Entity | null {
    const resource = this.resources.get(name);
    if (!resource) return null;
    let wrapper: Entity | undefined;
    try {
      const source = resource.instantiateRenderEntity({ castShadows: true, receiveShadows: true });
      source.name = `Kenney source:${name}`;
      wrapper = new Entity(`Kenney:${name}`);
      const offset = new Entity('Ground-centred model');
      wrapper.addChild(offset); offset.addChild(source);
      let bounds: BoundingBox | undefined;
      for (const render of source.findComponents('render') as RenderComponent[]) {
        for (const instance of render.meshInstances) {
          if (bounds) bounds.add(instance.aabb);
          else bounds = instance.aabb.clone();
        }
      }
      const isTower = name.startsWith('tower-');
      const region = isTower ? undefined : glowRegion(name);
      if (lit && region || tint || roof !== undefined) for (const render of source.findComponents('render') as RenderComponent[]) for (const instance of render.meshInstances) {
        if (!(instance.material instanceof StandardMaterial)) continue;
        let material = roof === undefined ? instance.material : this.roofMaterial(instance.material, roof);
        if (tint) material = this.tintedMaterial(material);
        else if (lit && region) material = this.litMaterial(material, region, name === 'streetlight' ? 3 : 2.2);
        instance.material = material;
      }
      if (isTower && lit) for (const render of source.findComponents('render') as RenderComponent[]) {
        const overlays: MeshInstance[] = [];
        for (const instance of render.meshInstances) {
          const mesh = instance.mesh ? this.towerGlass(instance.mesh) : null;
          if (mesh) {
            const overlay = new MeshInstance(mesh, this.towerRoomMaterial(), instance.node);
            overlay.castShadow = false; overlay.receiveShadow = false; overlays.push(overlay);
          }
        }
        if (overlays.length) {
          const glass = new Entity('Tower room overlays'); source.addChild(glass);
          glass.addComponent('render', { meshInstances: overlays, castShadows: false, receiveShadows: false });
        }
      }
      // Flat road tiles only receive shadows.
      if (name.startsWith('road-')) for (const render of source.findComponents('render') as RenderComponent[]) render.castShadows = false;
      const span = bounds ? Math.max(bounds.halfExtents.x, bounds.halfExtents.z) * 2 : 0;
      if (!bounds || !Number.isFinite(span) || span <= 0) throw new Error('Model has no finite renderable footprint.');
      // Defensive runtime fit also handles a source whose authoring pivot differs from the package convention.
      offset.setLocalPosition(-bounds.center.x, -(bounds.center.y - bounds.halfExtents.y), -bounds.center.z);
      const scale = width / span;
      wrapper.setLocalScale(scale, targetHeight === undefined ? scale * heightFactor : targetHeight / (bounds.halfExtents.y * 2), scale);
      return wrapper;
    } catch (error) {
      wrapper?.destroy();
      this.fail(name, error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  /** Small, app-owned palette shared by every luxury fitting (never one material per parcel). */
  private luxuryMaterial(kind: 'stone' | 'metal' | 'water' | 'glass' | 'beacon'): StandardMaterial {
    const existing = this.luxuryMaterials.get(kind); if (existing) return existing;
    const material = new StandardMaterial(); material.name = `Luxury tower ${kind}`;
    material.diffuse = new Color().fromString({ stone: '#e2e7df', metal: '#6a8090', water: '#28d9d5', glass: '#a0e6ee', beacon: '#70191d' }[kind]);
    if (kind === 'water' || kind === 'glass') {
      material.blendType = BLEND_NORMAL; material.opacity = kind === 'water' ? .72 : .34;
      material.depthWrite = false; material.shininess = 85;
    }
    if (kind === 'beacon') { material.emissive = new Color(1, .015, .01); material.emissiveIntensity = 0; }
    material.update(); this.luxuryMaterials.set(kind, material);
    if (kind === 'beacon') this.glowRegistrar?.(material, 4, true);
    return material;
  }

  private luxuryBox(parent: Entity, name: string, x: number, y: number, z: number,
    width: number, height: number, depth: number, kind: 'stone' | 'metal' | 'water' | 'glass' | 'beacon') {
    const part = new Entity(name);
    part.addComponent('render', { type: 'box', material: this.luxuryMaterial(kind), castShadows: kind !== 'glass' && kind !== 'water' && kind !== 'beacon' });
    part.setLocalPosition(x, y, z); part.setLocalScale(width, height, depth); parent.addChild(part);
  }

  private luxuryDetails(building: Entity, model: Entity, name: CityModelName, zone: 'R' | 'C', lit: boolean): void {
    // Measure the already fitted model: commercial authoring bounds differ among tower-a/b/c.
    let bounds: BoundingBox | undefined;
    for (const render of model.findComponents('render') as RenderComponent[]) for (const instance of render.meshInstances) {
      if (bounds) bounds.add(instance.aabb); else bounds = instance.aabb.clone();
    }
    if (!bounds) return;
    const height = bounds.halfExtents.y * 2, layout = luxuryTowerLayout(height);
    const podium = this.instantiate(name, layout.podiumWidth, 1, lit, false, undefined, layout.podiumHeight);
    if (!podium) return;
    podium.name = 'Luxury podium'; building.addChild(podium);
    const scale = model.getLocalScale().clone();
    model.setLocalScale(scale.x * layout.shaftWidth / 1.35, scale.y * .72, scale.z * layout.shaftWidth / 1.35);
    model.setLocalPosition(0, layout.shaftBase, 0); model.name = 'Luxury setback shaft';
    this.luxuryBox(building, 'Luxury flat crown', 0, layout.crownBase + layout.crownHeight / 2, 0,
      layout.crownWidth, layout.crownHeight, layout.crownWidth, 'stone');
    // Continuous balcony at the podium setback, with translucent rails and solid coping.
    const deck = layout.podiumHeight;
    this.luxuryBox(building, 'Setback balcony deck', 0, deck, 0, 1.35, .035, 1.35, 'stone');
    for (const side of [-1, 1]) {
      this.luxuryBox(building, 'Glass balcony rail', 0, deck + .09, side * .65, 1.3, .16, .018, 'glass');
      this.luxuryBox(building, 'Glass balcony rail', side * .65, deck + .09, 0, .018, .16, 1.3, 'glass');
      this.luxuryBox(building, 'Balcony coping', 0, deck + .175, side * .65, 1.32, .018, .025, 'metal');
      this.luxuryBox(building, 'Balcony coping', side * .65, deck + .175, 0, .025, .018, 1.32, 'metal');
    }
    const roof = layout.roofY;
    if (zone === 'R') {
      // A solid basin supports translucent water with a rimless outer edge, fully inside the crown.
      this.luxuryBox(building, 'Infinity pool basin', .22, roof + .025, .23, .50, .05, .56, 'metal');
      this.luxuryBox(building, 'Turquoise infinity pool', .22, roof + .058, .23, .48, .025, .54, 'water');
      const lounge = this.detail('parasol-a', .30);
      if (lounge) { lounge.name = 'Luxury rooftop parasol'; lounge.setLocalPosition(-.25, roof + .004, -.22); building.addChild(lounge); }
      for (const z of [-.13, .12]) this.luxuryBox(building, 'Poolside lounge seat', -.26, roof + .035, z, .22, .07, .13, 'stone');
    } else {
      this.luxuryBox(building, 'Aviation spire base', 0, roof + .045, 0, .20, .09, .20, 'metal');
      this.luxuryBox(building, 'Aviation spire', 0, roof + .27, 0, .045, .48, .045, 'metal');
      this.luxuryBox(building, 'Aviation beacon', 0, roof + .53, 0, .085, .07, .085, 'beacon');
    }
  }

  /**
   * `level` is residential 1–9, commercial retail level minus one (1–6), or industrial model tier (1–3).
   * `lit` marks a building with residents or allocated workers; empty ones stay dark at night.
   */
  building(zone: 'R' | 'C' | 'I', level: number, cell: number, lit = false): Entity | null {
    const family = LEVEL_VARIANTS[zone][Math.max(1, Math.min(3, level)) - 1];
    const name = family[cellHash(cell) % family.length];
    // Residential levels 4–9 retain their existing apartment/condo height progression.
    const tower = name.startsWith('tower-');
    const targetHeight = tower && zone === 'R' ? residentialVisualHeight(level) : undefined;
    const model = this.instantiate(name, tower ? 1.35 : 1.55, zone === 'C' ? retailCapacity(level + 1).heightFactor : 1,
      lit, false, zone === 'R' && !tower ? cellHash(cell, 7) % ROOF_PALETTES.length : undefined, targetHeight);
    if (!model || !tower) return model;
    // Props use parcel coordinates, not the model's authoring scale or commercial height stretch.
    const building = new Entity(`Detailed ${name}`); building.addChild(model);
    const luxury = luxuryTower(zone, level);
    if (luxury && zone !== 'I') this.luxuryDetails(building, model, name, zone, lit);
    if (zone === 'R' && !luxury) {
      const roof = TOWER_ROOFS[name as TowerName], y = targetHeight! * roof.deckRatio;
      const lounge = this.detail('parasol-a', .36);
      if (lounge) { lounge.setLocalPosition(roof.lounge[0], y + .004, roof.lounge[1]); building.addChild(lounge); }
      const garden = this.detail('planter', .24);
      if (garden) { garden.setLocalPosition(roof.garden[0], y + .004, roof.garden[1]); building.addChild(garden); }
    }
    const plant = this.detail('planter', .24);
    if (plant) { plant.setLocalPosition(.76, 0, .76); building.addChild(plant); }
    const light = this.streetlight();
    if (light) { light.setLocalPosition(-.76, 0, .76); building.addChild(light); }
    return building;
  }

  road(tile: RoadTile, connected: boolean): Entity | null { return this.instantiate(tile, 2, 1, false, !connected); }
  /** `palette` repaints the atlas green (awnings, parasols) with one of the roof colours. */
  detail(name: 'parasol-a' | 'parasol-b' | 'awning' | 'chimney' | 'tank' | 'planter', width: number, palette?: number): Entity | null { return this.instantiate(name, width, 1, false, false, palette === undefined ? undefined : palette % ROOF_PALETTES.length); }
  tree(large = false): Entity | null { return large ? this.instantiate('tree-large', 1.1) : this.instantiate('tree', 1.3); }
  streetlight(): Entity | null { return this.instantiate('streetlight', .38, 1, true); }
}
