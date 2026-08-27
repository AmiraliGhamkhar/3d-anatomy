/**
 * InstancedPart.js — many small bones, one draw call.
 *
 * Each hand has 27 bones and each foot 26. Modelled as individual meshes that is
 * 106 draw calls of sub-centimetre geometry: expensive, and almost all of it is
 * wasted because carpals look alike, as do phalanges.
 *
 * So the repetitive groups are drawn as `InstancedMesh` with one shared geometry
 * and a per-instance matrix that scales/rotates it to the real bone's dimensions.
 * Picking is preserved: three's Raycaster reports `instanceId` on an instanced
 * intersection, and each instance carries its own name/Latin term, so clicking a
 * middle phalanx still tells you which middle phalanx it is.
 */
import { Euler, InstancedMesh, Matrix4, Quaternion, StaticDrawUsage, Vector3 } from 'three';

const _m = new Matrix4();
const _q = new Quaternion();
const _twistQ = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _dir = new Vector3();
const _up = new Vector3(0, 1, 0);
const DEG = Math.PI / 180;

/**
 * @param {object} def
 * @param {string} def.id
 * @param {string} def.name       group name, e.g. 'Phalanges of the right hand'
 * @param {string} [def.latin]
 * @param {string} def.system
 * @param {string} def.region
 * @param {(q:number)=>import('three').BufferGeometry} def.build  unit geometry
 * @param {import('three').Material} def.material
 * @param {Array<object>} def.instances  one entry per bone:
 *   { id, name, latin?, note?, position:[x,y,z]cm,
 *     direction?:[x,y,z] (unit bone axis, replaces rotation),
 *     twist?:deg (roll about the bone axis),
 *     rotation?:[rx,ry,rz]deg, scale: number | [sx,sy,sz] }
 *   `position` is the PROXIMAL end of the bone; `scale.y` is its length in units
 *   of the unit geometry (built 1 cm long), so a digit reads as a chain of
 *   segments placed end to end.
 * @param {boolean} [def.castShadow=true]
 */
export function makeInstancedPart(def) {
  const {
    id,
    name,
    latin = '',
    system,
    region = '',
    build,
    material,
    instances,
    q = 1,
    castShadow = true,
    receiveShadow = true,
  } = def;

  const geometry = build(q);
  const mesh = new InstancedMesh(geometry, material, instances.length);
  mesh.name = id;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  // Instanced meshes must opt into per-instance picking explicitly.
  mesh.instanceMatrix.setUsage(StaticDrawUsage);

  instances.forEach((inst, i) => {
    const s = Array.isArray(inst.scale) ? inst.scale : [inst.scale ?? 1, inst.scale ?? 1, inst.scale ?? 1];

    if (inst.direction) {
      // Unit geometry grows along +Y, so the fastest way to lay a bone along an
      // anatomical axis is the rotation taking +Y to that axis. Far less
      // error-prone than hand-solving Euler angles for every digit.
      _dir.set(inst.direction[0], inst.direction[1], inst.direction[2]).normalize();
      _q.setFromUnitVectors(_up, _dir);
      if (inst.twist) _q.multiply(_twistQ.setFromAxisAngle(_up, inst.twist * DEG));
    } else {
      _e.set(
        (inst.rotation?.[0] ?? 0) * DEG,
        (inst.rotation?.[1] ?? 0) * DEG,
        (inst.rotation?.[2] ?? 0) * DEG,
        'XYZ',
      );
      _q.setFromEuler(_e);
    }

    _p.set(
      (inst.position?.[0] ?? 0) * 0.01,
      (inst.position?.[1] ?? 0) * 0.01,
      (inst.position?.[2] ?? 0) * 0.01,
    );
    _s.set(s[0], s[1], s[2]);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(i, _m);
  });
  mesh.instanceMatrix.needsUpdate = true;

  // Bounding volumes must include every instance, otherwise frustum culling will
  // cull the hand while it is still on screen.
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();

  mesh.userData.part = {
    id,
    name,
    latin,
    system,
    region,
    instanced: true,
    instances: instances.map((inst) => ({
      id: inst.id,
      name: inst.name,
      latin: inst.latin ?? latin,
      note: inst.note ?? '',
    })),
  };
  mesh.userData.triangles = (geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3) * instances.length;
  return mesh;
}

/**
 * Resolve a raycast hit on an instanced part to the specific bone that was hit.
 * @param {import('three').Intersection} hit
 */
export function resolveInstance(hit) {
  const part = hit.object?.userData?.part;
  if (!part?.instanced) return part ?? null;
  return part.instances?.[hit.instanceId] ?? part;
}
