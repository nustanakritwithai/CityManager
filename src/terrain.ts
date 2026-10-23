import {
  Entity, Mesh, MeshInstance, StandardMaterial, Texture, Color,
  PIXELFORMAT_SRGBA8, FILTER_LINEAR, FILTER_LINEAR_MIPMAP_LINEAR,
  ADDRESS_REPEAT, BLEND_NORMAL, type AppBase
} from 'playcanvas';

// Visual-only deterministic noise. It never reads or advances the city RNG.
function hash(x: number, y: number, salt: number): number {
  let n = Math.imul(x + salt, 374761393) + Math.imul(y, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function noise(x: number, y: number, scale: number, salt: number): number {
  const gx = x / scale, gy = y / scale, ix = Math.floor(gx), iy = Math.floor(gy);
  const fx = gx - ix, fy = gy - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, salt) * (1 - u) + hash(ix + 1, iy, salt) * u;
  const b = hash(ix, iy + 1, salt) * (1 - u) + hash(ix + 1, iy + 1, salt) * u;
  return a * (1 - v) + b * v;
}

/** Original baked ground and a separate construction overlay; no terrain simulation. */
export class CityGround {
  readonly root = new Entity('Original textured city ground');
  readonly vergeMaterial: StandardMaterial;
  readonly soilMaterial: StandardMaterial;
  readonly lawnMaterial: StandardMaterial;
  private readonly grid = new Entity('Construction grid');
  private textureCount = 0;

  constructor(private readonly app: AppBase, size: number, unit: number) {
    const grass = this.bake(512, 'grass');
    const lawn = this.bake(128, 'lawn');
    const soil = this.bake(128, 'soil');
    const groundMaterial = this.material('Baked meadow', grass, '#789468');
    this.lawnMaterial = this.material('Soft lawn pads', lawn, '#829b6c');
    this.vergeMaterial = this.material('Grass verges', lawn, '#789468');
    if (lawn) this.vergeMaterial.diffuse = new Color(.91, .95, .89);
    this.vergeMaterial.update();
    this.soilMaterial = this.material('Warm soil pads', soil, '#a3926f');

    const extent = size * unit / 2;
    const floor = new Mesh(app.graphicsDevice);
    floor.setPositions([-extent, .025, -extent, -extent, .025, extent, extent, .025, extent, extent, .025, -extent]);
    floor.setNormals([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
    // The 512px texture spans the whole map once, so there is no per-cell tiling.
    floor.setUvs(0, [0, 0, 0, 1, 1, 1, 1, 0]);
    floor.setIndices([0, 1, 2, 0, 2, 3]); floor.update();
    const surface = new Entity('Baked grass surface');
    surface.addComponent('render', { meshInstances: [new MeshInstance(floor, groundMaterial)], castShadows: false, receiveShadows: false });
    this.root.addChild(surface);

    const positions: number[] = [], normals: number[] = [], indices: number[] = [];
    const quad = (x0: number, z0: number, x1: number, z1: number) => {
      const start = positions.length / 3;
      positions.push(x0, .055, z0, x0, .055, z1, x1, .055, z1, x1, .055, z0);
      normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    };
    const halfLine = .011;
    for (let n = 0; n <= size; n++) {
      const d = n * unit - extent;
      quad(d - halfLine, -extent, d + halfLine, extent);
      quad(-extent, d - halfLine, extent, d + halfLine);
    }
    const gridMesh = new Mesh(app.graphicsDevice);
    gridMesh.setPositions(positions); gridMesh.setNormals(normals); gridMesh.setIndices(indices); gridMesh.update();
    const gridMaterial = new StandardMaterial();
    gridMaterial.name = 'Soft construction grid';
    gridMaterial.diffuse = new Color().fromString('#57704b');
    gridMaterial.opacity = .62; gridMaterial.blendType = BLEND_NORMAL;
    gridMaterial.depthWrite = false; gridMaterial.update();
    this.grid.addComponent('render', { meshInstances: [new MeshInstance(gridMesh, gridMaterial)], castShadows: false, receiveShadows: false });
    this.root.addChild(this.grid); this.grid.enabled = false;
  }

  private material(name: string, texture: Texture | null, fallback: string): StandardMaterial {
    const material = new StandardMaterial(); material.name = name;
    material.diffuse = texture ? new Color(1, 1, 1) : new Color().fromString(fallback);
    material.diffuseMap = texture; material.specular = new Color(0, 0, 0); material.gloss = .08;
    material.update(); return material;
  }

  private bake(resolution: number, kind: 'grass' | 'lawn' | 'soil'): Texture | null {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = resolution;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const image = context.createImageData(resolution, resolution);
    const base = kind === 'soil' ? [163, 146, 111] : kind === 'lawn' ? [126, 152, 105] : [118, 146, 103];
    for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
      const broad = (noise(x, y, resolution * .28, 17) - .5) * 2;
      const medium = (noise(x, y, resolution * .07, 43) - .5) * 2;
      const grain = (hash(x, y, 71) - .5) * 2;
      const softEarth = kind === 'grass' ? Math.max(0, noise(x, y, resolution * .4, 97) - .56) : 0;
      const variation = broad * (kind === 'soil' ? 8 : 7) + medium * 2.4 + grain * 1.5;
      const offset = (y * resolution + x) * 4;
      image.data[offset] = base[0] + variation + softEarth * 20;
      image.data[offset + 1] = base[1] + variation * .95 - softEarth * 5;
      image.data[offset + 2] = base[2] + variation * .7 - softEarth * 8;
      image.data[offset + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    const texture = new Texture(this.app.graphicsDevice, {
      name: `Original ${kind} ${resolution}`, width: resolution, height: resolution,
      format: PIXELFORMAT_SRGBA8, mipmaps: true,
      minFilter: FILTER_LINEAR_MIPMAP_LINEAR, magFilter: FILTER_LINEAR,
      addressU: ADDRESS_REPEAT, addressV: ADDRESS_REPEAT
    });
    texture.setSource(canvas); this.textureCount++; return texture;
  }

  setBuildGrid(visible: boolean): void {
    if (this.grid.enabled !== visible) { this.grid.enabled = visible; this.app.renderNextFrame = true; }
  }

  get diagnostics() { return { buildGrid: this.grid.enabled, textureSize: this.textureCount ? 512 : 0, textureCount: this.textureCount }; }
}
