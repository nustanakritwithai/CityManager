import {
  Entity, Mesh, MeshInstance, StandardMaterial, Texture, Color, Vec3, CameraFrame,
  FOG_LINEAR, TONEMAP_ACES, SSAOTYPE_LIGHTING, SSAOTYPE_NONE, SHADOW_PCF3_32F, CULLFACE_FRONT, BLEND_ADDITIVE,
  PIXELFORMAT_SRGBA8, FILTER_LINEAR, ADDRESS_CLAMP_TO_EDGE, type AppBase
} from 'playcanvas';
import type { Atmosphere, Quality, Rgb } from './atmosphere.ts';

const SKY_RINGS = 10, SKY_SEGMENTS = 32, SKY_RADIUS = 210;
const setColor = (target: Color, rgb: Rgb, scale = 1) => target.set(rgb[0] * scale, rgb[1] * scale, rgb[2] * scale);

/** Renderer-only lighting, sky, fog, shadows, post effects and night glow. */
export class SceneAtmosphere {
  readonly sun: Entity;
  private readonly sky = new Entity('Time-of-day sky dome');
  private readonly skyMesh: Mesh;
  private readonly skyDirections: Vec3[] = [];
  private readonly glow = new Map<StandardMaterial, number>();
  private frame: CameraFrame | null = null;
  private quality: Quality = 'high';
  private current: Atmosphere | null = null;
  private radius = 65;
  readonly lampPool: StandardMaterial;

  constructor(private readonly app: AppBase, private readonly camera: Entity) {
    this.sun = new Entity('Sun and moon light');
    this.sun.addComponent('light', {
      type: 'directional', color: new Color(1, .93, .81), intensity: 1.25, castShadows: false,
      shadowType: SHADOW_PCF3_32F, shadowBias: .25, normalOffsetBias: .06, shadowDistance: 110, numCascades: 2, cascadeDistribution: .55,
    });
    app.root.addChild(this.sun);

    const positions: number[] = [], indices: number[] = [], colors: number[] = [];
    for (let ring = 0; ring <= SKY_RINGS; ring++) {
      // Rings run from below the horizon (hidden by fog/ground) up to the zenith.
      const elevation = -.18 + (Math.PI / 2 + .18) * ring / SKY_RINGS;
      for (let segment = 0; segment <= SKY_SEGMENTS; segment++) {
        const azimuth = Math.PI * 2 * segment / SKY_SEGMENTS;
        const direction = new Vec3(Math.cos(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.sin(azimuth) * Math.cos(elevation));
        this.skyDirections.push(direction);
        positions.push(direction.x * SKY_RADIUS, direction.y * SKY_RADIUS, direction.z * SKY_RADIUS);
        colors.push(0, 0, 0, 255);
      }
    }
    for (let ring = 0; ring < SKY_RINGS; ring++) for (let segment = 0; segment < SKY_SEGMENTS; segment++) {
      const a = ring * (SKY_SEGMENTS + 1) + segment, b = a + SKY_SEGMENTS + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
    this.skyMesh = new Mesh(app.graphicsDevice);
    this.skyMesh.setPositions(positions); this.skyMesh.setColors32(colors); this.skyMesh.setIndices(indices); this.skyMesh.update();
    const skyMaterial = new StandardMaterial();
    skyMaterial.name = 'Sky gradient'; skyMaterial.useLighting = false; skyMaterial.useFog = false; skyMaterial.useSkybox = false;
    skyMaterial.diffuse = new Color(0, 0, 0); skyMaterial.emissive = new Color(1, 1, 1); skyMaterial.emissiveVertexColor = true;
    skyMaterial.cull = CULLFACE_FRONT; skyMaterial.depthWrite = false; skyMaterial.update();
    this.sky.addComponent('render', { meshInstances: [new MeshInstance(this.skyMesh, skyMaterial)], castShadows: false, receiveShadows: false });
    app.root.addChild(this.sky);

    this.lampPool = new StandardMaterial();
    this.lampPool.name = 'Street lamp light pool';
    this.lampPool.diffuse = new Color(0, 0, 0); this.lampPool.useLighting = false; this.lampPool.emissive = new Color(1, .78, .45);
    this.lampPool.emissiveMap = this.radialTexture(); this.lampPool.blendType = BLEND_ADDITIVE; this.lampPool.depthWrite = false;
    this.lampPool.update();
    this.registerGlow(this.lampPool, .9);
    app.scene.fog.type = FOG_LINEAR;
  }

  private radialTexture(): Texture {
    const size = 64, canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
    const context = canvas.getContext('2d')!, gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)'); gradient.addColorStop(.45, 'rgba(150,150,150,1)'); gradient.addColorStop(1, 'rgba(0,0,0,1)');
    context.fillStyle = gradient; context.fillRect(0, 0, size, size);
    const texture = new Texture(this.app.graphicsDevice, { name: 'Lamp pool', width: size, height: size, format: PIXELFORMAT_SRGBA8, mipmaps: false,
      minFilter: FILTER_LINEAR, magFilter: FILTER_LINEAR, addressU: ADDRESS_CLAMP_TO_EDGE, addressV: ADDRESS_CLAMP_TO_EDGE });
    texture.setSource(canvas); return texture;
  }

  /** Emissive strength follows night; strength is the full-night emissiveIntensity. */
  registerGlow(material: StandardMaterial, strength: number) {
    this.glow.set(material, strength);
    const night = this.current?.night ?? 0;
    material.emissiveIntensity = strength * night; material.update();
  }

  setQuality(quality: Quality) {
    this.quality = quality;
    const light = this.sun.light!;
    light.castShadows = quality !== 'low';
    light.shadowResolution = quality === 'high' ? 2048 : 1024;
    light.numCascades = quality === 'high' ? 2 : 1;
    const cameraComponent = this.camera.camera!;
    if (quality === 'low') {
      this.frame?.destroy(); this.frame = null;
      cameraComponent.toneMapping = TONEMAP_ACES;
    } else {
      if (!this.frame) this.frame = new CameraFrame(this.app, cameraComponent);
      const frame = this.frame;
      frame.rendering.toneMapping = TONEMAP_ACES;
      frame.rendering.samples = quality === 'high' ? 4 : 2;
      frame.ssao.type = quality === 'high' ? SSAOTYPE_LIGHTING : SSAOTYPE_NONE;
      Object.assign(frame.ssao, { intensity: .42, radius: 2.4, samples: 12, power: 4, minAngle: 10, scale: .5, blurEnabled: true, randomize: false });
      frame.bloom.intensity = .01; frame.bloom.threshold = 1.1; frame.bloom.blurLevel = 14;
      frame.grading.enabled = true;
      frame.vignette.intensity = .16; frame.vignette.inner = .55; frame.vignette.outer = 1.25; frame.vignette.curvature = .6;
    }
    if (this.current) this.apply(this.current); else this.frame?.update();
    this.app.renderNextFrame = true;
  }
  get activeQuality() { return this.quality; }

  /** Keep the dome, fog and shadow range relative to the current camera. */
  follow(radius: number) {
    this.radius = radius;
    this.sky.setPosition(this.camera.getPosition());
    const light = this.sun.light!; light.shadowDistance = radius * 1.05 + 55;
    if (this.current) this.applyFog(this.current);
  }

  private applyFog(a: Atmosphere) {
    const fog = this.app.scene.fog, near = this.radius * .9 / a.haze, far = this.radius * 2.6 / Math.sqrt(a.haze) + 40;
    setColor(fog.color, a.fogColor); fog.start = near; fog.end = Math.max(near + 30, far);
  }

  apply(a: Atmosphere) {
    this.current = a;
    const light = this.sun.light!;
    setColor(light.color, a.lightColor); light.intensity = a.lightIntensity;
    // A directional light shines along its entity's -Y axis.
    const [dx, dy, dz] = a.lightDirection;
    this.sun.setPosition(-dx * 60, -dy * 60, -dz * 60); this.sun.lookAt(0, 0, 0); this.sun.rotateLocal(90, 0, 0);
    setColor(this.app.scene.ambientLight, a.ambient, .74);
    this.camera.camera!.clearColor = new Color(a.skyHorizon[0], a.skyHorizon[1], a.skyHorizon[2]);
    this.applyFog(a);

    const colors: number[] = [], sunPos = new Vec3(-dx, -dy, -dz);
    for (const direction of this.skyDirections) {
      const t = Math.pow(Math.max(0, direction.y), .55);
      const glow = Math.pow(Math.max(0, direction.dot(sunPos)), 10) * (1 - Math.max(0, direction.y) * .6);
      for (let c = 0; c < 3; c++) colors.push(Math.round(Math.min(1, a.skyHorizon[c] + (a.skyZenith[c] - a.skyHorizon[c]) * t + a.sunGlow[c] * glow) * 255));
      colors.push(255);
    }
    this.skyMesh.setColors32(colors); this.skyMesh.update();

    for (const [material, strength] of this.glow) { material.emissiveIntensity = strength * a.night; material.update(); }
    if (this.frame) {
      const frame = this.frame;
      frame.bloom.intensity = .008 + a.night * .045;
      frame.grading.saturation = a.saturation; frame.grading.contrast = a.contrast; frame.grading.brightness = 1 + a.brightness;
      frame.grading.tint = new Color(a.tint[0], a.tint[1], a.tint[2]);
      frame.update();
    }
    this.app.renderNextFrame = true;
  }

  get diagnostics() {
    return { quality: this.quality, shadows: this.sun.light!.castShadows, postProcessing: !!this.frame,
      ssao: this.frame?.ssao.type === SSAOTYPE_LIGHTING, hour: this.current?.hour ?? null, night: this.current?.night ?? null,
      glowMaterials: this.glow.size };
  }
}
