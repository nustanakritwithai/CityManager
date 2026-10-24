import {
  BoundingBox, Color, Entity, StandardMaterial, Texture, PIXELFORMAT_SRGBA8, FILTER_LINEAR,
  type AppBase, type ContainerResource, type RenderComponent
} from 'playcanvas';
import type { RoadTile } from './road-tiles.ts';

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
  R: [['house-a', 'house-c', 'house-d'], ['house-b', 'house-e', 'house-f'], ['house-g', 'house-h', 'house-i']],
  C: [['shop-a', 'shop-b', 'shop-c', 'shop-d'], ['shop-e', 'shop-f', 'shop-g'], ['tower-a', 'tower-b', 'tower-c']],
  I: [['factory-a', 'factory-c'], ['factory-b', 'factory-d'], ['factory-e', 'factory-f']],
};
const cellHash = (cell: number, salt = 0) => ((Math.imul((cell + salt * 977) >>> 0, 1103515245) + 12345) >>> 16) & 0x7fff;
export type GlowRegistrar = (material: StandardMaterial, strength: number) => void;

const loads = new WeakMap<AppBase, Promise<CityAssets>>();
const baseUrl = (import.meta as ImportMeta & { env: { BASE_URL: string } }).env.BASE_URL;

/** Renderer-only, self-hosted models. Null instances leave procedural fallback to CityView. */
export class CityAssets {
  readonly status: CityAssetStatus = { ready: false, loaded: [], failed: [], pending: [...MODEL_NAMES], errors: {} };
  private readonly resources = new Map<CityModelName, ContainerResource>();
  private readonly lit = new Map<StandardMaterial, StandardMaterial>();
  private readonly masks = new Map<string, Texture>();
  private readonly tinted = new Map<StandardMaterial, StandardMaterial>();
  glowRegistrar: GlowRegistrar | null = null;

  private constructor(private readonly app: AppBase) {}

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

  /** Disconnected roads keep the warning tint they had as primitives. */
  private tintedMaterial(source: StandardMaterial): StandardMaterial {
    const existing = this.tinted.get(source);
    if (existing) return existing;
    const material = source.clone() as StandardMaterial;
    material.name = `${source.name} · disconnected`; material.diffuse = new Color(1, .6, .52); material.update();
    this.tinted.set(source, material); return material;
  }

  private instantiate(name: CityModelName, width: number, heightFactor = 1, lit = false, tint = false): Entity | null {
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
      const region = glowRegion(name);
      if (lit && region || tint) for (const render of source.findComponents('render') as RenderComponent[]) for (const instance of render.meshInstances) {
        if (!(instance.material instanceof StandardMaterial)) continue;
        instance.material = tint ? this.tintedMaterial(instance.material) : this.litMaterial(instance.material, region!, name === 'streetlight' ? 3 : 2.2);
      }
      // Flat road tiles only receive shadows.
      if (name.startsWith('road-')) for (const render of source.findComponents('render') as RenderComponent[]) render.castShadows = false;
      const span = bounds ? Math.max(bounds.halfExtents.x, bounds.halfExtents.z) * 2 : 0;
      if (!bounds || !Number.isFinite(span) || span <= 0) throw new Error('Model has no finite renderable footprint.');
      // Defensive runtime fit also handles a source whose authoring pivot differs from the package convention.
      offset.setLocalPosition(-bounds.center.x, -(bounds.center.y - bounds.halfExtents.y), -bounds.center.z);
      const scale = width / span;
      wrapper.setLocalScale(scale, scale * heightFactor, scale);
      return wrapper;
    } catch (error) {
      wrapper?.destroy();
      this.fail(name, error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  /**
   * `level` is the visual level (1–3); a higher level always uses a larger model family.
   * `lit` marks a building with residents or allocated workers; empty ones stay dark at night.
   */
  building(zone: 'R' | 'C' | 'I', level: number, cell: number, lit = false): Entity | null {
    const family = LEVEL_VARIANTS[zone][Math.max(1, Math.min(3, level)) - 1];
    const name = family[cellHash(cell) % family.length];
    return this.instantiate(name, name.startsWith('tower-') ? 1.35 : 1.55, 1, lit);
  }

  road(tile: RoadTile, connected: boolean): Entity | null { return this.instantiate(tile, 2, 1, false, !connected); }
  detail(name: 'parasol-a' | 'parasol-b' | 'awning' | 'chimney' | 'tank' | 'planter', width: number): Entity | null { return this.instantiate(name, width); }
  tree(large = false): Entity | null { return large ? this.instantiate('tree-large', 1.1) : this.instantiate('tree', 1.3); }
  streetlight(): Entity | null { return this.instantiate('streetlight', .38, 1, true); }
}
