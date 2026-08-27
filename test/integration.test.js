/**
 * integration.test.js — exercises AnatomyViewer without a WebGL context.
 *
 * `createScene()` builds the camera, model root, ground and all four anatomical
 * systems, and `_buildLighting()` builds the light rig; neither needs a renderer.
 * So the scene the browser will actually render can be assembled and asserted
 * here — part registry, node hierarchy, lighting setup, visibility toggles,
 * selection, isolation and screen projection.
 *
 * What this does NOT verify: shader compilation and the rasterised image. That
 * requires a real GPU context and is covered by running the app in a browser.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { Group, Vector3 } from 'three';
import { AnatomyViewer, SYSTEMS } from '../src/AnatomyViewer.js';

/** A container good enough for layout-dependent code paths. */
const fakeContainer = () => ({
  clientWidth: 1280,
  clientHeight: 720,
  appendChild() {},
});

function makeViewer() {
  const v = new AnatomyViewer(fakeContainer(), {
    visible: { skeletal: true, muscular: true, visceral: false, integumentary: false },
  });
  v.createScene(1280, 720);
  v._buildLighting();
  return v;
}

describe('AnatomyViewer scene assembly', () => {
  const v = makeViewer();

  it('creates a camera with a sane frustum for a 1.75 m body', () => {
    expect(v.camera.isPerspectiveCamera).toBe(true);
    expect(v.camera.aspect).toBeCloseTo(1280 / 720, 6);
    expect(v.camera.near).toBeLessThan(0.1);
    expect(v.camera.far).toBeGreaterThan(20);
  });

  it('builds all four anatomical systems under one model root', () => {
    for (const sys of SYSTEMS) {
      expect(v.systems.get(sys), `missing system ${sys}`).toBeTruthy();
      expect(v.systems.get(sys).parent).toBe(v.model);
    }
    expect(v.model.name).toBe('anatomy-model');
  });

  it('registers every part by id for picking and labelling', () => {
    expect(v.parts.size).toBeGreaterThan(150);
    // Spot-check one part per system.
    for (const id of ['cranium', 'femur.left', 'biceps-brachii.left', 'heart', 'surface.trunk']) {
      expect(v.parts.has(id), `unregistered part ${id}`).toBe(true);
    }
    // Every registered object carries metadata.
    for (const [id, obj] of v.parts) {
      expect(obj.userData.part?.id, `${id} missing metadata`).toBe(id);
    }
  });

  it('records model statistics', () => {
    expect(v.stats.parts).toBe(v.parts.size);
    expect(v.stats.triangles).toBeGreaterThan(100_000);
    expect(v.stats.drawCalls).toBeGreaterThan(100);
  });

  it('adds a shadow-catching ground plane', () => {
    const ground = v.scene.getObjectByName('ground');
    expect(ground).toBeTruthy();
    expect(ground.receiveShadow).toBe(true);
    expect(ground.material.type).toBe('ShadowMaterial');
    expect(ground.rotation.x).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('casts shadows from bones but not from the translucent skin', () => {
    let boneCasts = 0;
    let skinCasts = 0;
    for (const [id, obj] of v.parts) {
      obj.traverse((o) => {
        if (!o.isMesh) return;
        if (id.startsWith('surface.')) skinCasts += o.castShadow ? 1 : 0;
        else boneCasts += o.castShadow ? 1 : 0;
      });
    }
    expect(boneCasts).toBeGreaterThan(100);
    expect(skinCasts).toBe(0);
  });
});

describe('lighting rig', () => {
  const v = makeViewer();
  const rig = v.scene.getObjectByName('lighting-rig');

  it('has hemisphere, key, fill, rim and bounce lights', () => {
    const kinds = { hemi: 0, dir: 0, ambient: 0 };
    rig.traverse((o) => {
      if (o.isHemisphereLight) kinds.hemi++;
      else if (o.isDirectionalLight) kinds.dir++;
      else if (o.isAmbientLight) kinds.ambient++;
    });
    expect(kinds.hemi).toBe(1);
    expect(kinds.dir).toBe(3); // key + fill + rim
    expect(kinds.ambient).toBe(1);
  });

  it('casts shadows from exactly one light (the key)', () => {
    const casters = [];
    rig.traverse((o) => {
      if (o.isDirectionalLight && o.castShadow) casters.push(o);
    });
    expect(casters).toHaveLength(1);
    expect(casters[0]).toBe(v.keyLight);
    // Key light at the classic anatomical-plate angle: above, to one side, in front.
    expect(v.keyLight.position.y).toBeGreaterThan(v.keyLight.position.z);
    expect(v.keyLight.position.y).toBeGreaterThan(3);
    expect(v.keyLight.shadow.mapSize.x).toBeGreaterThanOrEqual(1024);
    expect(v.keyLight.shadow.bias).toBeLessThan(0);
  });

  it('places the rim light behind the model', () => {
    const rim = rig.children.find((o) => o.isDirectionalLight && o !== v.keyLight && o.position.z < 0);
    expect(rim).toBeTruthy();
    expect(rim.position.z).toBeLessThan(-2);
  });

  it('separates warm key from cool fill', () => {
    const dirs = rig.children.filter((o) => o.isDirectionalLight);
    const key = dirs.find((d) => d.castShadow);
    const fill = dirs.find((d) => !d.castShadow && d.position.z > 0);
    expect(key.color.r).toBeGreaterThan(key.color.b); // warm
    expect(fill.color.b).toBeGreaterThan(fill.color.r); // cool
  });

  it('skips the PMREM environment when there is no renderer', () => {
    expect(v.envRT).toBeUndefined();
    expect(v.scene.environment).toBeNull();
  });
});

describe('system visibility', () => {
  let v;
  beforeEach(() => {
    v = makeViewer();
  });

  it('applies the initial visibility options', () => {
    expect(v.systems.get('skeletal').visible).toBe(true);
    expect(v.systems.get('muscular').visible).toBe(true);
    expect(v.systems.get('visceral').visible).toBe(false);
  });

  it('toggles a whole system at once', () => {
    v.setSystemVisible('visceral', true);
    expect(v.systems.get('visceral').visible).toBe(true);
    v.setSystemVisible('visceral', false);
    expect(v.systems.get('visceral').visible).toBe(false);
  });

  it('ignores unknown systems without throwing', () => {
    expect(() => v.setSystemVisible('nonsense', true)).not.toThrow();
  });
});

describe('selection and isolation', () => {
  let v;
  beforeEach(() => {
    v = makeViewer();
  });

  it('lifts the emissive of the selected part', () => {
    v.select('heart');
    expect(v.selected).toBe('heart');
    let lit = 0;
    v.parts.get('heart').traverse((o) => {
      if (o.isMesh && o.material.emissiveIntensity > 0) lit++;
    });
    expect(lit).toBeGreaterThan(0);
  });

  it('clears the previous selection when a new one is made', () => {
    v.select('heart');
    const heartMat = v.parts.get('heart').getObjectByProperty('isMesh', true).material;
    v.select('liver');
    expect(heartMat.emissiveIntensity).toBe(0);
  });

  it('does not mutate the shared material when highlighting', () => {
    const before = v.parts.get('cranium').getObjectByProperty('isMesh', true).material;
    v.select('cranium');
    const after = v.parts.get('cranium').getObjectByProperty('isMesh', true).material;
    expect(after).not.toBe(before); // a per-part clone, so other bones are unaffected
  });

  it('isolate() hides every other system', () => {
    v.isolate('heart');
    expect(v.isolated).toBe('heart');
    const visibleSystems = SYSTEMS.filter((s) => v.systems.get(s).visible);
    expect(visibleSystems).toHaveLength(1);
    expect(visibleSystems[0]).toBe('visceral');
  });

  it('isolate(null) restores the configured visibility', () => {
    v.isolate('heart');
    v.isolate(null);
    expect(v.isolated).toBeNull();
    expect(v.systems.get('skeletal').visible).toBe(true);
    expect(v.systems.get('visceral').visible).toBe(false);
  });
});

describe('camera helpers', () => {
  const v = makeViewer();

  it('reports a part centre in world space', () => {
    v.model.updateMatrixWorld(true);
    const c = v.partWorldCentre('heart');
    expect(c).toBeInstanceOf(Vector3);
    // The heart sits left of midline, mid-thorax, anterior.
    expect(c.x).toBeGreaterThan(0);
    expect(c.y).toBeGreaterThan(1.1);
    expect(c.y).toBeLessThan(1.3);
    expect(c.z).toBeGreaterThan(0);
  });

  it('projects world points into the viewport', () => {
    v.renderer = {
      domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) },
    };
    v.camera.position.set(0, 1.2, 4);
    v.camera.lookAt(0, 1.2, 0);
    v.camera.updateMatrixWorld(true);
    const p = v.project(new Vector3(0, 1.2, 0));
    // Dead centre of the view → centre of the canvas.
    expect(p.x).toBeCloseTo(640, 0);
    expect(p.y).toBeCloseTo(360, 0);
  });

  it('frames the whole body without leaving the frustum', () => {
    v.controls = { target: new Vector3(), update() {} };
    v.frameAll();
    const dist = v.camera.position.distanceTo(v.controls.target);
    expect(dist).toBeGreaterThan(1);
    expect(dist).toBeLessThan(10);
    expect(v.camera.near).toBeLessThan(dist / 10);
    expect(v.camera.far).toBeGreaterThan(dist);
  });
});

describe('node hierarchy', () => {
  const v = makeViewer();

  it('groups the skeleton into axial and appendicular', () => {
    const skeletal = v.systems.get('skeletal');
    expect(skeletal.getObjectByName('axial-skeleton')).toBeInstanceOf(Group);
    expect(skeletal.getObjectByName('appendicular-skeleton')).toBeInstanceOf(Group);
  });

  it('exposes limb segments as addressable nodes', () => {
    const app = v.systems.get('skeletal').getObjectByName('appendicular-skeleton');
    for (const name of ['pectoral-girdle', 'upper-limb', 'pelvic-girdle', 'lower-limb']) {
      expect(app.getObjectByName(name), `missing ${name}`).toBeTruthy();
    }
    const upper = app.getObjectByName('upper-limb');
    expect(upper.getObjectByName('upper-limb.left')).toBeTruthy();
    expect(upper.getObjectByName('upper-limb.right')).toBeTruthy();
    expect(upper.getObjectByName('upper-limb.left').getObjectByName('forearm')).toBeTruthy();
  });

  it('groups muscles by region and viscera by cavity', () => {
    const mus = v.systems.get('muscular');
    for (const name of ['muscles.arm', 'muscles.thigh', 'muscles.back', 'muscles.respiratory']) {
      expect(mus.getObjectByName(name), `missing ${name}`).toBeTruthy();
    }
    const vis = v.systems.get('visceral');
    for (const name of ['viscera.cns', 'viscera.thoracic', 'viscera.abdominal', 'viscera.pelvic']) {
      expect(vis.getObjectByName(name), `missing ${name}`).toBeTruthy();
    }
  });

  it('names the lighting rig as a single node', () => {
    expect(v.scene.getObjectByName('lighting-rig')).toBeInstanceOf(Group);
  });
});
