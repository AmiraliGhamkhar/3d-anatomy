/**
 * AnatomyViewer.js — the runtime: renderer, lighting rig, controls, picking.
 *
 * LIGHTING STRATEGY
 * Anatomical visualisation has two goals that ordinary product lighting does not:
 * form must be legible (you have to be able to tell a muscle belly from the
 * groove beside it) and colour must stay truthful (a cyan-tinted liver is worse
 * than a dull one). So:
 *
 *   • A neutral studio **environment map** (PMREM from a generated room) provides
 *     the broad ambient term. This is what makes MeshPhysicalMaterial's
 *     clearcoat/sheen on cartilage and mucosa read correctly — point lights alone
 *     give hard, plastic-looking highlights.
 *   • A soft **key** directional light with shadows, at ~45° elevation and 35°
 *     azimuth — the classic "anatomical plate" angle, which reveals both the
 *     anterior and one lateral surface at once.
 *   • A cool, dim **fill** from the opposite side to keep the shadows open
 *     without flattening them.
 *   • A **rim** light from behind, which is what separates overlapping structures
 *     (ribs over lung, muscle over bone) when they are nearly the same colour.
 *   • ACES filmic tone mapping so bright specular hits roll off instead of
 *     clipping, and dithering on the materials to stop banding in the soft
 *     gradients that dominate tissue shading.
 *
 * Everything is disposed through `dispose()`; a viewer that leaks GPU memory is a
 * real problem in a page that may mount and unmount the model repeatedly.
 */
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  Color,
  ColorManagement,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Raycaster,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SAOPass } from 'three/addons/postprocessing/SAOPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';

import { buildAxialSkeleton } from './systems/SkeletonAxial.js';
import { buildAppendicularSkeleton } from './systems/SkeletonAppendicular.js';
import { buildMuscularSystem } from './systems/MuscularSystem.js';
import { buildOrganSystem } from './systems/OrganSystem.js';
import { buildSurfaceSystem } from './systems/SurfaceSystem.js';
import { makePart } from './core/Part.js';
import { makeInstancedPart, resolveInstance } from './core/InstancedPart.js';
import { sharedTissue, tissue, disposeMaterials, disposeMaterialCache } from './core/materials.js';
import { PerformanceGovernor } from './core/Performance.js';
import { countDrawCalls, countTriangles } from './core/quality.js';

/** The four top-level systems, in the order they are normally layered. */
export const SYSTEMS = Object.freeze(['skeletal', 'muscular', 'visceral', 'integumentary']);

export class AnatomyViewer {
  /**
   * @param {HTMLElement} container element to render into
   * @param {object} [opts]
   * @param {string} [opts.quality='auto'] 'auto' | 'low' | 'medium' | 'high' | 'ultra'
   * @param {boolean} [opts.postprocessing=true] allow AO/FXAA on capable tiers
   * @param {Record<string,boolean>} [opts.visible] initial per-system visibility
   * @param {number} [opts.skinOpacity=0.22]
   */
  constructor(container, opts = {}) {
    this.container = container;
    this.options = {
      quality: 'auto',
      postprocessing: true,
      visible: { skeletal: true, muscular: false, visceral: false, integumentary: false },
      skinOpacity: 0.22,
      ...opts,
    };

    this.parts = new Map(); // id → Object3D
    this.systems = new Map(); // system → Group
    this.selected = null;
    this.isolated = null;
    this.onPick = null;
    this.onStats = null;

    this._raycaster = new Raycaster();
    this._pointer = new Vector2();
    this._disposed = false;
    this._raf = 0;
    this._needsRender = true;
  }

  /* ------------------------------------------------------------ */
  /* Setup                                                         */
  /* ------------------------------------------------------------ */

  init() {
    ColorManagement.enabled = true;

    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;

    this.renderer = new WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.info.autoReset = false;
    this.container.appendChild(this.renderer.domElement);

    this.createScene(width, height);
    this._buildLighting();
    this._setupPostprocessing();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.target.set(0, 1.15, 0);
    this.controls.minDistance = 0.4;
    this.controls.maxDistance = 12;
    this.controls.addEventListener('change', () => (this._needsRender = true));

    this.governor = new PerformanceGovernor({
      renderer: this.renderer,
      scene: this.scene,
      onTierChange: (tier, name) => this.onTierChange?.(tier, name),
    });
    if (this.options.quality !== 'auto') this.governor.setTier(this.options.quality);
    this.governor.apply();

    this._bindEvents();
    this.frameAll();
    this._startLoop();
    return this;
  }

  /**
   * Build the scene graph: camera, model root, ground and all four anatomical
   * systems.
   *
   * Kept separate from `init()` because none of it needs a WebGL context — which
   * means the entire anatomy assembly can be exercised and asserted headlessly.
   */
  createScene(width = 1, height = 1) {
    this.scene = new Scene();
    this.scene.background = new Color('#0d1117');

    this.camera = new PerspectiveCamera(38, width / height, 0.05, 60);
    this.camera.position.set(2.4, 1.35, 3.4);

    this.model = new Group();
    this.model.name = 'anatomy-model';
    this.scene.add(this.model);

    this._buildGround();
    this._buildAnatomy();
    // Leave the scene in the configured state, so a scene built without a
    // renderer (headless assembly, tests, SSR) still matches what init() shows.
    for (const [sys, on] of Object.entries(this.options.visible)) this.setSystemVisible(sys, on);
    return this;
  }

  /** Environment + three-point rig. */
  _buildLighting() {
    // PMREM environment: the dominant ambient term for PBR tissue. Skipped when
    // there is no renderer (headless scene assembly).
    if (this.renderer) {
      const pmrem = new PMREMGenerator(this.renderer);
      pmrem.compileEquirectangularShader();
      this.envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = 0.55;
      pmrem.dispose();
    }

    this.lights = new Group();
    this.lights.name = 'lighting-rig';

    // Hemisphere: sky/ground bias that stops undersides from going flat black.
    const hemi = new HemisphereLight('#eaf2ff', '#3a3226', 0.45);
    this.lights.add(hemi);

    // Key light — the "anatomical plate" angle.
    const key = new DirectionalLight('#fff6ea', 2.35);
    key.position.set(2.6, 4.2, 3.4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 16;
    key.shadow.camera.left = -2.2;
    key.shadow.camera.right = 2.2;
    key.shadow.camera.top = 3.0;
    key.shadow.camera.bottom = -1.0;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.012;
    key.shadow.radius = 3;
    this.lights.add(key);
    this.keyLight = key;

    // Fill — cool, from the opposite side, no shadow (keeps shadows legible).
    const fill = new DirectionalLight('#bcd6ff', 0.85);
    fill.position.set(-3.4, 1.6, 1.8);
    this.lights.add(fill);

    // Rim — separates overlapping structures of similar colour.
    const rim = new DirectionalLight('#ffffff', 1.5);
    rim.position.set(-1.2, 2.6, -4.0);
    this.lights.add(rim);

    // Gentle bounce from below, mimicking a table reflector.
    const bounce = new AmbientLight('#ffd9b0', 0.18);
    this.lights.add(bounce);

    this.scene.add(this.lights);
  }

  /**
   * Ground plane.
   *
   * A `ShadowMaterial` catches the shadow without drawing a visible floor, so the
   * model appears to stand in space while still being grounded — which matters,
   * because a floating body has no vertical reference and is hard to orient.
   */
  _buildGround() {
    const geo = new PlaneGeometry(14, 14);
    const mat = new ShadowMaterial({ opacity: 0.28 });
    this.ground = new Mesh(geo, mat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = 0;
    this.ground.receiveShadow = true;
    this.ground.name = 'ground';
    this.scene.add(this.ground);
  }

  /** Build every system into its own node. */
  _buildAnatomy() {
    const q = 1;

    // Material resolution: `tissue()` for one-offs, `sharedTissue()` for the many
    // repeated parts so they share a program and a texture set.
    const resolveMaterial = (nameOrFn, def) => {
      if (typeof nameOrFn === 'function') return nameOrFn;
      if (def.opacity != null && def.opacity < 1) {
        // Translucent parts need their own material instance.
        return tissue(nameOrFn, { opacity: def.opacity, transparent: true, side: 2 });
      }
      return sharedTissue(nameOrFn);
    };

    const partFactory = (def) => {
      const material = resolveMaterial(def.material, def);
      const part = makePart({ ...def, material });
      this.parts.set(def.id, part);
      return part;
    };
    const instancedFactory = (def) => {
      const material = resolveMaterial(def.material, def);
      const part = makeInstancedPart({ ...def, material });
      this.parts.set(def.id, part);
      return part;
    };

    const skeletal = new Group();
    skeletal.name = 'system.skeletal';
    skeletal.add(buildAxialSkeleton(partFactory, { q }));
    skeletal.add(buildAppendicularSkeleton(partFactory, instancedFactory, { q }));
    this.systems.set('skeletal', skeletal);
    this.model.add(skeletal);

    const muscular = buildMuscularSystem(partFactory, { q });
    muscular.name = 'system.muscular';
    this.systems.set('muscular', muscular);
    this.model.add(muscular);

    const visceral = buildOrganSystem(partFactory, { q });
    visceral.name = 'system.visceral';
    this.systems.set('visceral', visceral);
    this.model.add(visceral);

    const skin = buildSurfaceSystem(partFactory, { q, opacity: this.options.skinOpacity });
    skin.name = 'system.integumentary';
    this.systems.set('integumentary', skin);
    this.model.add(skin);

    this.stats = {
      parts: this.parts.size,
      triangles: countTriangles(this.model),
      drawCalls: countDrawCalls(this.model),
    };
  }

  /** Optional screen-space AO + FXAA. Only wired up on tiers that can afford it. */
  _setupPostprocessing() {
    if (!this.options.postprocessing) {
      this.composer = null;
      return;
    }
    try {
      const { clientWidth: w, clientHeight: h } = this.container;
      const composer = new EffectComposer(this.renderer);
      composer.setSize(w || 1, h || 1);
      composer.addPass(new RenderPass(this.scene, this.camera));

      // SAOPass takes positional args in r180, not an options object.
      const sao = new SAOPass(this.scene, this.camera);
      sao.params.saoBias = 0.5;
      sao.params.saoIntensity = 0.0035;
      sao.params.saoScale = 4;
      sao.params.saoKernelRadius = 26;
      sao.params.saoMinResolution = 0;
      this.saoPass = sao;
      composer.addPass(sao);

      // EffectComposer.setSize() forwards to FXAAPass.setSize(), so the
      // resolution uniform is maintained for us.
      composer.addPass(new FXAAPass());

      // OutputPass performs tone mapping + colour-space conversion for the chain.
      composer.addPass(new OutputPass());
      this.composer = composer;
    } catch (err) {
      // Post-processing is a nice-to-have; never let it break the viewer.
      console.warn('[AnatomyViewer] post-processing unavailable, falling back to direct render:', err);
      this.composer = null;
    }
  }

  /* ------------------------------------------------------------ */
  /* Interaction                                                   */
  /* ------------------------------------------------------------ */

  _bindEvents() {
    this._onResize = () => this.resize();
    this._onPointerDown = (e) => {
      this._downX = e.clientX;
      this._downY = e.clientY;
    };
    this._onPointerUp = (e) => {
      // Only treat it as a click if the pointer barely moved — otherwise every
      // orbit drag would select something.
      if (Math.hypot(e.clientX - this._downX, e.clientY - this._downY) > 5) return;
      const hit = this.pick(e.clientX, e.clientY);
      this.select(hit?.id ?? null);
      this.onPick?.(hit);
    };

    window.addEventListener('resize', this._onResize);
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this._onPointerDown);
    el.addEventListener('pointerup', this._onPointerUp);
  }

  /**
   * Raycast at a client-space position.
   * @returns {{id:string,name:string,latin:string,system:string,note:string}|null}
   */
  pick(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._raycaster.setFromCamera(this._pointer, this.camera);

    const candidates = [];
    this.model.traverse((o) => {
      if ((o.isMesh || o.isInstancedMesh) && o.visible && this._branchVisible(o)) candidates.push(o);
    });
    const hits = this._raycaster.intersectObjects(candidates, false);
    if (!hits.length) return null;

    const hit = hits[0];
    const meta = resolveInstance(hit);
    return meta ? { ...meta, distance: hit.distance } : null;
  }

  /** A mesh may be `visible` while an ancestor system is hidden. */
  _branchVisible(obj) {
    let p = obj;
    while (p) {
      if (!p.visible) return false;
      p = p.parent;
    }
    return true;
  }

  /** Highlight a part (emissive lift) — reversible and cheap. */
  select(id) {
    if (this.selected && this.selected !== id) this._setEmissive(this.selected, 0x000000, 0);
    this.selected = id;
    if (id) this._setEmissive(id, 0xffb27a, 0.35);
    this._needsRender = true;
  }

  _setEmissive(id, color, intensity) {
    const part = this.parts.get(id);
    if (!part) return;
    part.traverse((o) => {
      const mat = o.material;
      if (!mat || !mat.emissive) return;
      // Do not mutate a shared material's emissive in place — clone once.
      if (!mat.userData._emissiveClone) {
        o.material = mat.clone();
        o.material.userData._emissiveClone = true;
      }
      o.material.emissive.setHex(color);
      o.material.emissiveIntensity = intensity;
    });
  }

  /** Hide everything except one part, so a single structure can be studied. */
  isolate(id) {
    this.isolated = id;
    if (!id) {
      for (const [sys, group] of this.systems) group.visible = this.options.visible[sys] ?? false;
      return;
    }
    for (const group of this.systems.values()) group.visible = false;
    const part = this.parts.get(id);
    if (part) {
      let root = part;
      while (root.parent && root.parent !== this.model) root = root.parent;
      root.visible = true;
      // Hide siblings within that subtree.
      root.traverse((o) => {
        if (o.userData.part && o !== part && !this._isAncestorOf(o, part)) o.visible = false;
      });
      part.visible = true;
    }
    this._needsRender = true;
  }

  _isAncestorOf(maybeAncestor, node) {
    let p = node.parent;
    while (p) {
      if (p === maybeAncestor) return true;
      p = p.parent;
    }
    return false;
  }

  /** Show or hide a whole system. */
  setSystemVisible(system, visible) {
    const group = this.systems.get(system);
    if (!group) return;
    this.options.visible[system] = visible;
    if (!this.isolated) group.visible = visible;
    this._needsRender = true;
  }

  /** Set the opacity of the integumentary (skin) layer. */
  setSkinOpacity(opacity) {
    this.options.skinOpacity = opacity;
    const skin = this.systems.get('integumentary');
    if (!skin) return;
    skin.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m.userData._skinClone) {
          o.material = m.clone();
          o.material.userData._skinClone = true;
        }
        o.material.transparent = true;
        o.material.opacity = opacity;
        o.material.depthWrite = opacity > 0.85;
        o.material.side = 2;
        o.material.needsUpdate = true;
      }
    });
    this._needsRender = true;
  }

  /** Frame the whole body in the viewport. */
  frameAll() {
    const box = new Box3().setFromObject(this.model);
    const size = box.getSize(new Vector3());
    const centre = box.getCenter(new Vector3());
    const radius = size.length() * 0.5;
    const fov = (this.camera.fov * Math.PI) / 180;
    const dist = (radius / Math.sin(fov / 2)) * 0.62;
    this.controls.target.copy(centre);
    this.camera.position.set(centre.x + dist * 0.62, centre.y + dist * 0.18, centre.z + dist * 0.78);
    this.camera.near = Math.max(0.02, dist / 200);
    this.camera.far = dist * 12;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this._needsRender = true;
  }

  /** Move the camera to focus on one part. */
  focus(id) {
    const part = this.parts.get(id);
    if (!part) return;
    const box = new Box3().setFromObject(part);
    const centre = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const radius = Math.max(0.05, size.length() * 0.5);
    const fov = (this.camera.fov * Math.PI) / 180;
    const dist = (radius / Math.sin(fov / 2)) * 1.9;
    this.controls.target.copy(centre);
    const dir = new Vector3().subVectors(this.camera.position, centre).normalize();
    this.camera.position.copy(centre).addScaledVector(dir, dist);
    this.controls.update();
    this._needsRender = true;
  }

  /** World-space centre of a part, for anchoring HTML labels. */
  partWorldCentre(id, target = new Vector3()) {
    const part = this.parts.get(id);
    if (!part) return target.set(0, 0, 0);
    const box = new Box3().setFromObject(part);
    return box.getCenter(target);
  }

  /** Project a world point to CSS pixels (for label overlays). */
  project(world, target = new Vector2()) {
    const v = world.clone().project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return target.set(((v.x + 1) / 2) * rect.width, ((-v.y + 1) / 2) * rect.height);
  }

  /* ------------------------------------------------------------ */
  /* Render loop                                                   */
  /* ------------------------------------------------------------ */

  _startLoop() {
    const tick = (now) => {
      if (this._disposed) return;
      this._raf = requestAnimationFrame(tick);
      this.controls.update();
      this.governor.update(now);

      // LODs must be refreshed before we decide whether to draw.
      this.scene.traverse((o) => {
        if (o.isLOD) o.update(this.camera);
      });

      if (this._needsRender || this.controls.enableDamping) {
        this.renderer.info.reset();
        if (this.composer && this.governor.tier.shadows) {
          this.composer.render();
        } else {
          this.renderer.render(this.scene, this.camera);
        }
        this._needsRender = false;
      }

      this.onStats?.(this.governor.stats);
    };
    this._raf = requestAnimationFrame(tick);
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.governor.apply();
    this._needsRender = true;
  }

  /** Free every GPU resource this viewer created. */
  dispose() {
    this._disposed = true;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    const el = this.renderer?.domElement;
    if (el) {
      el.removeEventListener('pointerdown', this._onPointerDown);
      el.removeEventListener('pointerup', this._onPointerUp);
    }

    this.scene?.traverse((o) => {
      if (o.isMesh || o.isInstancedMesh) {
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m?.dispose();
      }
    });
    this.envRT?.dispose();
    this.composer?.dispose?.();
    disposeMaterialCache();
    disposeMaterials();
    this.controls?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement?.remove();
  }
}

