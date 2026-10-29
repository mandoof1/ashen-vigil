/**
 * Renderer, environment lighting, post-processing chain and quality application.
 * Display size and internal render resolution are kept separate; the composer targets,
 * renderer, camera and UI stay synchronised through resizes.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { makeSkyCanvas } from './Textures';
import type { QualitySettings } from '../config/Quality';
import { clamp } from '../core/MathX';

export interface Emitter { x: number; y: number; z: number; color: number; intensity: number; range: number; light?: THREE.PointLight }

export interface RenderStats { drawCalls: number; triangles: number; programs: number }

export class Graphics {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private aaPass: Pass | null = null;
  private renderTarget: THREE.WebGLRenderTarget | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envRT: THREE.WebGLRenderTarget | THREE.Texture | null = null;
  hemi!: THREE.HemisphereLight;
  moon!: THREE.DirectionalLight;
  interior!: THREE.DirectionalLight;
  private pointPool: THREE.PointLight[] = [];
  private fog: THREE.FogExp2;
  private skyTex: THREE.Texture | null = null;
  public renderScale = 1;
  public displayWidth = 1;
  public displayHeight = 1;
  public renderWidth = 1;
  public renderHeight = 1;
  public quality: QualitySettings;
  private maxAniso: number;
  public postActive = false;
  private adaptiveScale = 1;
  private adaptiveTarget = 1;
  private lastShadowFocus = new THREE.Vector3(1e9, 1e9, 1e9);

  constructor(canvas: HTMLCanvasElement, quality: QualitySettings) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality.aa === 'msaa',
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    this.renderer.setPixelRatio(1); // internal resolution is driven explicitly, not by devicePixelRatio
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.26;
    this.renderer.shadowMap.enabled = quality.shadows !== 'off';
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // three r186 deprecates PCFSoftShadowMap
    this.renderer.info.autoReset = false;
    this.maxAniso = this.renderer.capabilities.getMaxAnisotropy();

    this.fog = new THREE.FogExp2(0x1a222c, 0.011);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(0x0d131b);
    this.buildEnvironment();
    this.buildLights();
    this.buildPost();
  }

  get anisotropy(): number { return Math.min(this.maxAniso, this.quality.anisotropy); }

  private buildEnvironment(): void {
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.pmrem.compileEquirectangularShader();
    // one procedural night sky drives both the visible background and the reflections,
    // so metal and stone always agree with what is actually overhead
    const skyTex = new THREE.CanvasTexture(makeSkyCanvas(1024));
    skyTex.mapping = THREE.EquirectangularReflectionMapping;
    skyTex.colorSpace = THREE.SRGBColorSpace;
    this.skyTex = skyTex;
    this.scene.background = skyTex;
    this.scene.backgroundIntensity = 0.85;
    const rt = this.pmrem.fromEquirectangular(skyTex);
    this.envRT = rt.texture;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 1.05;
  }

  private buildLights(): void {
    this.hemi = new THREE.HemisphereLight(0x7890a8, 0x565d66, 3.0);
    this.scene.add(this.hemi);

    this.moon = new THREE.DirectionalLight(0xc2d8f2, 3.6);
    this.moon.position.set(32, 33, -53);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(2048, 2048);
    this.moon.shadow.camera.near = 1;
    this.moon.shadow.camera.far = 140;
    this.moon.shadow.bias = -0.0009;
    this.moon.shadow.normalBias = 0.045;
    this.moon.shadow.camera.left = -30;
    this.moon.shadow.camera.right = 30;
    this.moon.shadow.camera.top = 30;
    this.moon.shadow.camera.bottom = -30;
    this.scene.add(this.moon);
    this.scene.add(this.moon.target);

    // soft fill from the opposite side keeps dark interiors readable (no crushed blacks)
    this.interior = new THREE.DirectionalLight(0x94a6bc, 1.9);
    this.interior.position.set(26, 20, 44);
    this.scene.add(this.interior);
    this.scene.add(this.interior.target);

    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffa86a, 0, 18, 2);
      l.color = new THREE.Color(0xffa86a);
      l.visible = false;
      this.scene.add(l);
      this.pointPool.push(l);
    }
  }

  private buildPost(): void {
    this.composer = null;
    this.bloomPass = null;
    this.aaPass = null;
    if (this.quality.aa === 'msaa' || !this.quality.bloom) {
      this.postActive = false;
      return;
    }
    const w = Math.max(2, this.renderWidth), h = Math.max(2, this.renderHeight);
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: 0,
      depthBuffer: true,
    });
    this.renderTarget = rt;
    const composer = new EffectComposer(this.renderer, rt);
    composer.addPass(new RenderPass(this.scene, this.cameraPlaceholder()));
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.34, 0.6, 0.82);
    composer.addPass(bloom);
    this.bloomPass = bloom;
    if (this.quality.aa === 'smaa') {
      const p = new SMAAPass();
      composer.addPass(p);
      this.aaPass = p;
    } else if (this.quality.aa === 'fxaa') {
      const p = new ShaderPass(FXAAShader);
      composer.addPass(p);
      this.aaPass = p as unknown as Pass;
    }
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.postActive = true;
  }

  private cameraCache: THREE.Camera | null = null;
  cameraPlaceholder(): THREE.Camera { return this.cameraCache ?? new THREE.PerspectiveCamera(); }

  setCamera(camera: THREE.Camera): void {
    this.cameraCache = camera;
    if (this.composer) {
      const rp = this.composer.passes.find((p) => p instanceof RenderPass) as RenderPass | undefined;
      if (rp) rp.camera = camera;
    }
  }

  // ------------------------------------------------------------- resizing
  resize(width: number, height: number, pixelRatio: number): void {
    this.displayWidth = Math.max(1, Math.floor(width));
    this.displayHeight = Math.max(1, Math.floor(height));
    const scale = clamp(this.renderScale * this.adaptiveScale * Math.min(pixelRatio, 2), 0.35, 2.2);
    this.renderWidth = Math.max(2, Math.floor(this.displayWidth * scale));
    this.renderHeight = Math.max(2, Math.floor(this.displayHeight * scale));
    this.renderer.setSize(this.renderWidth, this.renderHeight, false);
    this.renderer.domElement.style.width = `${this.displayWidth}px`;
    this.renderer.domElement.style.height = `${this.displayHeight}px`;
    if (this.composer) {
      this.composer.setSize(this.renderWidth, this.renderHeight);
      if (this.aaPass instanceof ShaderPass) {
        const res = this.aaPass.material.uniforms['resolution']?.value as THREE.Vector2 | undefined;
        if (res) res.set(1 / this.renderWidth, 1 / this.renderHeight);
      }
      if (this.aaPass instanceof SMAAPass) this.aaPass.setSize(this.renderWidth, this.renderHeight);
      this.bloomPass?.setSize(this.renderWidth, this.renderHeight);
    }
  }

  setRenderScale(scale: number): void {
    this.renderScale = clamp(scale, 0.5, 1);
  }

  /** Optional adaptive resolution: averages frame timing, uses hysteresis, never touches simulation. */
  adaptResolution(avgFrameMs: number): boolean {
    if (!this.quality.adaptiveResolution) {
      if (this.adaptiveScale !== 1) { this.adaptiveScale = 1; return true; }
      return false;
    }
    const lo = 0.6, hi = 1;
    let changed = false;
    if (avgFrameMs > 21.5 && this.adaptiveTarget > lo) { this.adaptiveTarget = Math.max(lo, this.adaptiveTarget - 0.05); changed = true; }
    else if (avgFrameMs < 13.5 && this.adaptiveTarget < hi) { this.adaptiveTarget = Math.min(hi, this.adaptiveTarget + 0.05); changed = true; }
    if (changed) {
      this.adaptiveScale = this.adaptiveTarget;
    }
    return changed;
  }

  get currentAdaptiveScale(): number { return this.adaptiveScale; }

  get adaptiveActive(): boolean { return this.quality.adaptiveResolution && Math.abs(this.adaptiveScale - 1) > 0.001; }

  // -------------------------------------------------------------- quality
  applyQuality(q: QualitySettings, levelObjects: { clusters: Array<{ object: THREE.Object3D; center: THREE.Vector3; radius: number; kind: string }>; lodPairs: Array<{ hi: THREE.Object3D; lo: THREE.Object3D; center: THREE.Vector3; radius: number }> }): void {
    const shadowsChanged = q.shadows !== this.quality.shadows;
    this.quality = q;
    this.renderer.shadowMap.enabled = q.shadows !== 'off';
    if (shadowsChanged) this.setShadowQuality(q.shadows);
    this.fog.density = 0.0105 * q.fogDensity;
    this.scene.environmentIntensity = 0.45 + 0.2 * (q.preset === 'low' ? 0.4 : 1);
    this.hemi.intensity = q.preset === 'low' ? 0.95 : 0.85;
    this.moon.intensity = q.shadows === 'off' ? 1.9 : 1.5;
    this.moon.shadow.camera.updateProjectionMatrix();
    this.buildPost();
    for (const c of levelObjects.clusters) {
      if (c.kind === 'vegetation') c.object.visible = q.vegetationRange > 10;
      if (c.kind === 'decoration') c.object.visible = q.decorationDensity > 0.15;
    }
  }

  setShadowQuality(mode: string): void {
    const size = mode === 'high' ? 2048 : mode === 'medium' ? 1024 : 512;
    if (this.moon.shadow.mapSize.x !== size) {
      this.moon.shadow.mapSize.set(size, size);
      this.moon.shadow.map?.dispose();
      this.moon.shadow.map = null;
    }
    this.renderer.shadowMap.enabled = mode !== 'off';
    for (const l of this.pointPool) l.castShadow = false;
  }

  /** Shadow frustum follows the viewer and snaps to the texel grid to avoid shimmer. */
  updateShadowFocus(focus: THREE.Vector3, camera: THREE.Camera): void {
    const ext = this.quality.shadowDistance;
    if (this.lastShadowFocus.distanceToSquared(focus) > 4) {
      this.lastShadowFocus.copy(focus);
      const texels = this.moon.shadow.mapSize.x;
      const worldPerTexel = (ext * 2) / texels;
      const snap = (v: number) => Math.round(v / worldPerTexel) * worldPerTexel;
      const fx = snap(focus.x), fz = snap(focus.z);
      this.moon.target.position.set(fx, focus.y, fz);
      this.moon.position.set(fx - 26, focus.y + 42, fz + 20);
      const cam = this.moon.shadow.camera;
      cam.left = -ext; cam.right = ext; cam.top = ext; cam.bottom = -ext;
      cam.far = ext * 3.2;
      cam.updateProjectionMatrix();
      this.moon.shadow.needsUpdate = true;
    }
    this.interior.target.position.set(focus.x, focus.y, focus.z);
    this.interior.position.set(focus.x + 20, focus.y + 18, focus.z - 26);
    void camera;
  }

  /** Assign the limited point-light budget to the nearest emitters. */
  assignPointLights(emitters: Emitter[]): void {
    const n = this.pointPool.length;
    for (let i = 0; i < n; i++) this.pointPool[i].intensity = 0;
    const sorted = emitters
      .map((e) => ({ e, d: (e.x - this.lastShadowFocus.x) ** 2 + (e.z - this.lastShadowFocus.z) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, n);
    for (let i = 0; i < sorted.length; i++) {
      const l = this.pointPool[i];
      const e = sorted[i].e;
      l.color.setHex(e.color);
      l.intensity = e.intensity;
      l.distance = e.range;
      l.position.set(e.x, e.y, e.z);
      l.visible = e.intensity > 0.01;
    }
  }

  render(): void {
    this.renderer.info.reset();
    if (this.composer && this.postActive) this.composer.render();
    else this.renderer.render(this.scene, this.cameraCache!);
  }

  get stats(): RenderStats {
    return {
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      programs: this.renderer.info.programs?.length ?? 0,
    };
  }

  dispose(): void {
    this.composer?.dispose();
    this.renderTarget?.dispose();
    this.pmrem?.dispose();
    if (this.envRT instanceof THREE.Texture) this.envRT.dispose();
    this.skyTex?.dispose();
    this.renderer.dispose();
  }
}

type Pass = { setSize?(w: number, h: number): void };
