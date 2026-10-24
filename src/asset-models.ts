import { BoundingBox, Entity, type AppBase, type ContainerResource, type RenderComponent } from 'playcanvas';

const MODEL_NAMES = ['house-a', 'house-b', 'shop-a', 'shop-b', 'factory-a', 'factory-b', 'tree', 'streetlight'] as const;
export type CityModelName = typeof MODEL_NAMES[number];
export type CityAssetStatus = {
  ready: boolean;
  loaded: CityModelName[];
  failed: CityModelName[];
  pending: CityModelName[];
  errors: Partial<Record<CityModelName, string>>;
};

const loads = new WeakMap<AppBase, Promise<CityAssets>>();
const baseUrl = (import.meta as ImportMeta & { env: { BASE_URL: string } }).env.BASE_URL;

/** Renderer-only, self-hosted models. Null instances leave procedural fallback to CityView. */
export class CityAssets {
  readonly status: CityAssetStatus = { ready: false, loaded: [], failed: [], pending: [...MODEL_NAMES], errors: {} };
  private readonly resources = new Map<CityModelName, ContainerResource>();

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
  private instantiate(name: CityModelName, width: number, heightFactor = 1): Entity | null {
    const resource = this.resources.get(name);
    if (!resource) return null;
    let wrapper: Entity | undefined;
    try {
      const source = resource.instantiateRenderEntity({ castShadows: false, receiveShadows: false });
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

  building(zone: 'R' | 'C' | 'I', level: number, cell: number): Entity | null {
    const prefix = { R: 'house', C: 'shop', I: 'factory' }[zone];
    // Keep the building's silhouette stable across upgrades; only its visual height grows.
    const variant = (((Math.imul(cell >>> 0, 1103515245) + 12345) >>> 16) & 1) ? 'b' : 'a';
    const name = `${prefix}-${variant}` as CityModelName;
    return this.instantiate(name, 1.55, 1 + .16 * Math.max(0, Math.min(2, level - 1)));
  }

  tree(): Entity | null { return this.instantiate('tree', 1.3); }
  streetlight(): Entity | null { return this.instantiate('streetlight', .38); }
}
