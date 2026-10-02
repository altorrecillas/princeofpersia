// Personajes 3D procedurales con esqueleto jerárquico (príncipe, guardias, esqueleto, Jaffar, princesa, sombra).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeParts } from '../core/merge.js';
import { BONES, setBindPose, jointPositions, getBodyGeometry } from './bodies.js';
import { getFabric } from '../world/textures.js';
import { makeScimitar } from '../world/props.js';
import { DEG, clamp } from '../core/utils.js';

// ------------------------------------------------------------------ canales de pose
export const CH = {
  ry: 0, rz: 1, rx: 2, rr: 3,
  pel: 4, sp: 7, ch: 10, nk: 13, hd: 16,
  ls: 19, le: 22, lw: 23, rs: 25, re: 28, rw: 29,
  lh: 31, lk: 34, la: 35, rh: 36, rk: 39, ra: 40, g: 41, hold: 42, af: 43,
};
export const NCH = 44;

export function poseFrom(o) {
  const p = new Float32Array(NCH);
  const set3 = (k, v) => { if (v) { p[CH[k]] = v[0] || 0; p[CH[k] + 1] = v[1] || 0; p[CH[k] + 2] = v[2] || 0; } };
  // valores por defecto: brazos ligeramente separados y codos flexionados
  p[CH.ls] = 4; p[CH.ls + 2] = 7; p[CH.le] = 12;
  p[CH.rs] = 4; p[CH.rs + 2] = 7; p[CH.re] = 12;
  p[CH.lh + 2] = 2; p[CH.rh + 2] = 2;
  p[CH.g] = 1;
  for (const k of ['ry', 'rz', 'rx', 'rr', 'le', 're', 'lk', 'la', 'rk', 'ra', 'g', 'hold', 'af']) if (o[k] !== undefined) p[CH[k]] = o[k];
  for (const k of ['pel', 'sp', 'ch', 'nk', 'hd', 'ls', 'rs', 'lh', 'rh']) if (o[k]) {
    const v = o[k];
    for (let i = 0; i < 3; i++) if (v[i] !== undefined) p[CH[k] + i] = v[i];
  }
  if (o.lw) { p[CH.lw] = o.lw[0] || 0; p[CH.lw + 1] = o.lw[1] || 0; }
  if (o.rw) { p[CH.rw] = o.rw[0] || 0; p[CH.rw + 1] = o.rw[1] || 0; }
  return p;
}

// pose simétrica (izquierda <-> derecha)
export function mirrorPose(src) {
  const p = new Float32Array(src);
  const swap3 = (a, b) => { for (let i = 0; i < 3; i++) { const t = p[a + i]; p[a + i] = p[b + i]; p[b + i] = t; } };
  const swap1 = (a, b) => { const t = p[a]; p[a] = p[b]; p[b] = t; };
  swap3(CH.ls, CH.rs); swap1(CH.le, CH.re); swap1(CH.lw, CH.rw); swap1(CH.lw + 1, CH.rw + 1);
  swap3(CH.lh, CH.rh); swap1(CH.lk, CH.rk); swap1(CH.la, CH.ra);
  for (const k of ['pel', 'sp', 'ch', 'nk', 'hd']) { p[CH[k] + 1] *= -1; p[CH[k] + 2] *= -1; }
  p[CH.rr] *= -1;
  return p;
}

// ------------------------------------------------------------------ materiales con luz de contorno
function charMat(color, opts = {}, uni) {
  const fab = opts.fabric ? getFabric() : null;
  const m = new THREE.MeshStandardMaterial({
    color, roughness: opts.rough ?? 0.75, metalness: opts.metal ?? 0,
    normalMap: fab ? fab.normalMap : null,
    emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.emissiveIntensity ?? 1,
    transparent: !!opts.transparent, opacity: opts.opacity ?? 1,
  });
  if (fab) m.normalScale = new THREE.Vector2(0.6, 0.6);
  if (fab) m.normalMap.repeat?.set(3, 3);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRimColor = uni.rimColor;
    sh.uniforms.uRimStr = uni.rimStr;
    sh.uniforms.uFlash = uni.flash;
    sh.uniforms.uFlashColor = uni.flashColor;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor; uniform float uRimStr; uniform float uFlash; uniform vec3 uFlashColor;')
      .replace('#include <opaque_fragment>', `
        float rimF = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.6);
        outgoingLight += uRimColor * rimF * uRimStr + uFlashColor * uFlash * (0.4 + rimF);
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'rimchar';
  return m;
}

function lathe(profile, seg = 14) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y)), seg);
}

function add(parent, geo, mat, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos); m.rotation.set(...rot); m.scale.set(...scale);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function joint(parent, x, y, z) {
  const j = new THREE.Bone();
  j.position.set(x, y, z);
  parent.add(j);
  return j;
}

// ------------------------------------------------------------------ cadena elástica (pelo, cinta, fajín, capa)
class SpringChain {
  constructor(anchor, segs, opts = {}) {
    this.anchor = anchor;
    this.segs = segs;           // Object3D encadenados (cada uno hijo del anterior)
    this.stiff = opts.stiff ?? 30; this.damp = opts.damp ?? 6;
    this.drag = opts.drag ?? 0.12; this.gravity = opts.gravity ?? 1;
    this.flutter = opts.flutter ?? 0.15;
    this.back = opts.back ?? 0.25;
    this.prev = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.has = false;
    this.ang = segs.map(() => new THREE.Vector2()); this.angV = segs.map(() => new THREE.Vector2());
    this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._d = new THREE.Vector3();
    this.t = Math.random() * 10;
  }
  update(dt) {
    if (dt <= 0) return;
    this.t += dt;
    const a = this.anchor;
    a.getWorldPosition(this._v);
    if (!this.has) { this.prev.copy(this._v); this.has = true; }
    this.vel.copy(this._v).sub(this.prev).divideScalar(Math.max(dt, 1e-3));
    if (this.vel.lengthSq() > 400) this.vel.set(0, 0, 0);
    this.prev.copy(this._v);
    // dirección deseada en el espacio del ancla: gravedad + arrastre por velocidad (con espejo incluido)
    this._d.set(-this.vel.x * this.drag, -this.gravity - Math.max(0, this.vel.y) * this.drag * 0.5, -this.vel.z * this.drag).add(this._v);
    a.worldToLocal(this._d);
    this._d.z -= this.back;
    this._d.normalize();
    // ángulos objetivo (rotación x/z que lleva el eje -y a _d)
    const tx = Math.atan2(this._d.z, -this._d.y);
    const tz = Math.atan2(this._d.x, -this._d.y);
    const sp = Math.min(1, this.vel.length() / 4);
    for (let i = 0; i < this.segs.length; i++) {
      const s = this.segs[i];
      const w = i === 0 ? 1 : 0.35;
      const fl = Math.sin(this.t * 9 + i * 1.3) * this.flutter * sp;
      const gx = (i === 0 ? tx : (tx - this.ang[0].x) * 0.3) * w + fl;
      const gz = (i === 0 ? tz : (tz - this.ang[0].y) * 0.3) * w + fl * 0.5;
      const A = this.ang[i], V = this.angV[i];
      V.x += ((gx - A.x) * this.stiff - V.x * this.damp) * dt;
      V.y += ((gz - A.y) * this.stiff - V.y * this.damp) * dt;
      A.x += V.x * dt; A.y += V.y * dt;
      A.x = clamp(A.x, -2.6, 2.6); A.y = clamp(A.y, -2.6, 2.6);
      s.rotation.set(-A.x, 0, A.y);
    }
  }
}

function chain(parent, n, len, width, mat, opts = {}) {
  const segs = [];
  let p = parent;
  const geo = new THREE.PlaneGeometry(width, len);
  geo.translate(0, -len / 2, 0);
  for (let i = 0; i < n; i++) {
    const j = joint(p, 0, i === 0 ? 0 : -len, 0);
    const m = new THREE.Mesh(geo, mat);
    m.scale.x = 1 - (i / n) * (opts.taper ?? 0.3);
    m.castShadow = true;
    j.add(m);
    segs.push(j);
    p = j;
  }
  return segs;
}

// ------------------------------------------------------------------ esqueleto base
const SPECS = {
  prince: { h: 1.0, skin: 0xc8895a, hair: 0x16100c },
  guard: { h: 1.03, skin: 0xa8714a, hair: 0x120d0a },
  fat: { h: 1.04, skin: 0xa16a44, hair: 0x120d0a },
  jaffar: { h: 1.07, skin: 0xb07a50, hair: 0x0e0a08 },
  princess: { h: 0.94, skin: 0xd8a07a, hair: 0x1a0f0a },
  skeleton: { h: 1.02, skin: 0xd8cfb4, hair: 0 },
  shadow: { h: 1.0, skin: 0x08080c, hair: 0x020203 },
};

export const GUARD_COLORS = {
  green: { tunic: 0x2d5a2a, turban: 0xe6dcc0, pants: 0x3b3428, trim: 0xb8923e },
  red: { tunic: 0x8a1b1b, turban: 0xd9c38a, pants: 0x2f2a24, trim: 0xc9a14a },
  blue: { tunic: 0x23407c, turban: 0xefefe8, pants: 0x2e2c30, trim: 0xc9a14a },
  purple: { tunic: 0x582a70, turban: 0xd4af37, pants: 0x2a2430, trim: 0xd4af37 },
  yellow: { tunic: 0xb0841c, turban: 0x6b1d1d, pants: 0x3a2e22, trim: 0x6b1d1d },
  black: { tunic: 0x1c1c22, turban: 0x8a1010, pants: 0x18181c, trim: 0xb0b0b8 },
  white: { tunic: 0xd8d2c4, turban: 0xb01818, pants: 0x403830, trim: 0xb01818 },
};

export class Character {
  constructor(kind, opts = {}) {
    this.kind = kind;
    this.opts = opts;
    const spec = SPECS[kind] || SPECS.prince;
    this.uni = {
      rimColor: { value: new THREE.Color(opts.rimColor ?? 0x8aa4ff) },
      rimStr: { value: opts.rimStr ?? 0.28 },
      flash: { value: 0 },
      flashColor: { value: new THREE.Color(1, 0.15, 0.1) },
    };
    this.root = new THREE.Group();
    this.flip = new THREE.Group(); this.root.add(this.flip);
    this.yaw = new THREE.Group(); this.flip.add(this.yaw);
    this.scaleG = new THREE.Group(); this.yaw.add(this.scaleG);
    this.scaleG.scale.setScalar(spec.h);
    this.body = new THREE.Group(); this.scaleG.add(this.body);
    this.chains = [];
    this.mats = [];
    const H = 0.93;
    const J = this.j = {};
    J.pelvis = joint(this.body, 0, H, 0);
    J.spine = joint(J.pelvis, 0, 0.08, 0);
    J.chest = joint(J.spine, 0, 0.18, 0);
    J.neck = joint(J.chest, 0, 0.255, 0.0);
    J.head = joint(J.neck, 0, 0.075, 0.01);
    J.ls = joint(J.chest, 0.17, 0.2, -0.01);
    J.rs = joint(J.chest, -0.17, 0.2, -0.01);
    J.le = joint(J.ls, 0, -0.28, 0);
    J.re = joint(J.rs, 0, -0.28, 0);
    J.lw = joint(J.le, 0, -0.25, 0);
    J.rw = joint(J.re, 0, -0.25, 0);
    J.lh = joint(J.pelvis, 0.088, -0.035, 0);
    J.rh = joint(J.pelvis, -0.088, -0.035, 0);
    J.lk = joint(J.lh, 0, -0.43, 0);
    J.rk = joint(J.rh, 0, -0.43, 0);
    J.la = joint(J.lk, 0, -0.43, 0);
    J.ra = joint(J.rk, 0, -0.43, 0);
    // empuñadura en la mano derecha
    J.grip = joint(J.rw, 0, -0.06, 0.012);
    J.grip.rotation.x = Math.PI / 2;
    J.gripL = joint(J.lw, 0, -0.06, 0.012);
    J.gripL.rotation.x = Math.PI / 2;
    this.buildBody(kind, spec, opts);
    if (this.skirt) this.skirt.userData.keep = true;
    mergeParts(this.root);
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    this.pose = new Float32Array(NCH);
    this._v = new THREE.Vector3();
    this.facing = 1;
    this.yawAngle = 0;
  }

  m(color, opts) { const mm = charMat(color, opts || {}, this.uni); this.mats.push(mm); return mm; }

  buildBody(kind, spec, o) {
    const J = this.j;
    const skel = kind === 'skeleton';
    const isShadow = kind === 'shadow';
    const skin = this.m(spec.skin, { rough: 0.55, emissive: isShadow ? 0x120820 : 0 });
    this.skinMat = skin;
    // -------------------------------------------------- piezas comunes según tipo
    let C;
    if (kind === 'prince' || kind === 'shadow') {
      const sh = isShadow;
      C = {
        shirt: this.m(sh ? 0x0c0c12 : 0xf2ede2, { fabric: true, rough: 0.85, emissive: sh ? 0x0a0614 : 0 }),
        vest: this.m(sh ? 0x101018 : 0x21407c, { fabric: true, rough: 0.7, emissive: sh ? 0x0a0614 : 0 }),
        trim: this.m(sh ? 0x2a2040 : 0xd3a94e, { rough: 0.35, metal: sh ? 0 : 0.8 }),
        sash: this.m(sh ? 0x18101e : 0xa3171d, { fabric: true, rough: 0.8 }),
        pants: this.m(sh ? 0x0c0c12 : 0xebe3d1, { fabric: true, rough: 0.9, emissive: sh ? 0x0a0614 : 0 }),
        shoes: this.m(sh ? 0x050508 : 0x5b3a21, { rough: 0.6 }),
        hair: this.m(spec.hair, { rough: 0.55 }),
        band: this.m(sh ? 0x2a1030 : 0xb3161e, { fabric: true, rough: 0.8 }),
        bracer: this.m(sh ? 0x08080c : 0x5b3a21, { rough: 0.5 }),
      };
    } else if (kind === 'guard' || kind === 'fat') {
      const col = GUARD_COLORS[o.variant || 'red'];
      C = {
        shirt: this.m(col.tunic, { fabric: true, rough: 0.8 }),
        vest: this.m(new THREE.Color(col.tunic).multiplyScalar(0.7).getHex(), { fabric: true, rough: 0.8 }),
        trim: this.m(col.trim, { rough: 0.35, metal: 0.8 }),
        sash: this.m(0x2a1c12, { rough: 0.6 }),
        pants: this.m(col.pants, { fabric: true, rough: 0.9 }),
        shoes: this.m(0x231610, { rough: 0.5 }),
        hair: this.m(spec.hair, { rough: 0.6 }),
        band: this.m(col.turban, { fabric: true, rough: 0.85 }),
        bracer: this.m(0x3a2618, { rough: 0.5 }),
      };
    } else if (kind === 'jaffar') {
      C = {
        shirt: this.m(0x3a1450, { fabric: true, rough: 0.6 }),
        vest: this.m(0x1a0a22, { fabric: true, rough: 0.6 }),
        trim: this.m(0xd4af37, { rough: 0.3, metal: 1 }),
        sash: this.m(0x8a1010, { fabric: true, rough: 0.7 }),
        pants: this.m(0x2a0e38, { fabric: true, rough: 0.7 }),
        shoes: this.m(0x1a0a10, { rough: 0.5 }),
        hair: this.m(spec.hair, { rough: 0.6 }),
        band: this.m(0xf2ecdc, { fabric: true, rough: 0.8 }),
        bracer: this.m(0xd4af37, { rough: 0.3, metal: 1 }),
      };
    } else if (kind === 'princess') {
      C = {
        shirt: this.m(0xf4d6dc, { fabric: true, rough: 0.7 }),
        vest: this.m(0xd06a8a, { fabric: true, rough: 0.6 }),
        trim: this.m(0xe8c870, { rough: 0.3, metal: 1 }),
        sash: this.m(0xe8c870, { rough: 0.3, metal: 1 }),
        pants: this.m(0xf2c4d0, { fabric: true, rough: 0.7 }),
        shoes: this.m(0xd06a8a, { rough: 0.5 }),
        hair: this.m(spec.hair, { rough: 0.5 }),
        band: this.m(0xe8c870, { rough: 0.3, metal: 1 }),
        bracer: this.m(0xe8c870, { rough: 0.3, metal: 1 }),
      };
    } else {
      const bone = this.m(0xddd3b8, { rough: 0.75 });
      C = { bone };
    }
    this.C = C;
    if (skel) { this.buildSkeleton(C.bone); return; }

    this.buildSculpted(kind, spec, C, skin);
  }

  // cuerpo esculpido con piel deformable + accesorios
  buildSculpted(kind, spec, C, skin) {
    const J = this.j;
    const isShadow = kind === 'shadow';
    const fem = kind === 'princess';
    setBindPose(J);
    this.root.updateMatrixWorld(true);
    const P = jointPositions(J, this.body);
    const G = getBodyGeometry(kind, P, this.opts.quality || 'medium');
    this.skeleton = new THREE.Skeleton(BONES.map((n) => J[n]));
    const skinV = this.m(spec.skin, { rough: 0.5, emissive: isShadow ? 0x120820 : 0x1a0a06, emissiveIntensity: isShadow ? 1 : 0.35 });
    skinV.vertexColors = true;
    skin.emissive = new THREE.Color(isShadow ? 0x120820 : 0x1a0a06); skin.emissiveIntensity = isShadow ? 1 : 0.35;
    const eyeW = this.m(isShadow ? 0xffffff : 0xf2eee6, { rough: 0.25, emissive: isShadow ? 0xffffff : 0x000000, emissiveIntensity: isShadow ? 3 : 1 });
    const iris = isShadow ? eyeW : this.m(kind === 'jaffar' ? 0x1a2a10 : 0x2a1608, { rough: 0.15 });
    const mats = {
      skin, skinV, eyeW, iris, hair: C.hair, shirt: C.shirt, vest: C.vest, sash: C.sash, pants: C.pants,
      shoes: C.shoes, band: C.band, robe: C.shirt, dress: C.shirt,
    };
    for (const part of G.skinned) {
      const mesh = new THREE.SkinnedMesh(part.geo, mats[part.mat] || C.shirt);
      this.body.add(mesh);
      mesh.updateMatrixWorld(true);
      mesh.bind(this.skeleton);
      // esfera envolvente fija (en el espacio del cuerpo) para poder descartar personajes fuera de cámara
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.7);
      mesh.castShadow = true;
    }
    for (const part of G.rigid) {
      const mesh = new THREE.Mesh(part.geo, part.mat === 'skin' && part.bone === 'head' ? skinV : mats[part.mat]);
      mesh.castShadow = true;
      J[part.bone].add(mesh);
    }
    for (const n of BONES) J[n].rotation.set(0, 0, 0);
    const head = J.head;
    this.headG = head;
    // ---------------------------------------------- accesorios
    if (kind === 'prince' || kind === 'shadow') {
      add(head, new THREE.TorusGeometry(0.1, 0.012, 8, 28), C.band, [0, 0.17, -0.014], [Math.PI / 2 - 0.3, 0, 0], [0.97, 1.1, 1]);
      const knot = joint(head, 0, 0.142, -0.118);
      add(knot, new THREE.SphereGeometry(0.019, 8, 6), C.band);
      const bandMat = C.band; bandMat.side = THREE.DoubleSide;
      const tail1 = chain(knot, 4, 0.075, 0.03, bandMat, { taper: 0.4 });
      const knot2 = joint(head, 0.02, 0.142, -0.118);
      const tail2 = chain(knot2, 3, 0.07, 0.028, bandMat, { taper: 0.4 });
      this.chains.push(new SpringChain(knot, tail1, { stiff: 26, damp: 4, drag: 0.22, flutter: 0.35 }));
      this.chains.push(new SpringChain(knot2, tail2, { stiff: 30, damp: 4, drag: 0.2, flutter: 0.3 }));
      for (const sd of ['l', 'r']) {
        add(J[sd + 'k'], new THREE.TorusGeometry(0.05, 0.011, 6, 16), C.trim, [0, -0.375, 0], [Math.PI / 2, 0, 0]);
        add(J[sd + 'a'], new THREE.SphereGeometry(0.011, 6, 4), C.trim, [0, -0.018, 0.192]);
      }
    }
    if (kind !== 'princess' && kind !== 'jaffar') {
      for (const sd of ['l', 'r']) add(J[sd + 'e'], new THREE.CylinderGeometry(0.049, 0.043, 0.1, 14), C.bracer, [0, -0.19, 0.0]);
    }
    if (kind !== 'princess') {
      const sashAnchor = joint(J.spine, 0.1 * (kind === 'fat' ? 1.3 : 1), -0.03, 0.07);
      const segs = chain(sashAnchor, 3, 0.09, 0.07, C.sash, { taper: 0.2 });
      C.sash.side = THREE.DoubleSide;
      this.chains.push(new SpringChain(sashAnchor, segs, { stiff: 40, damp: 7, drag: 0.1 }));
    }
    if (kind === 'guard' || kind === 'fat' || kind === 'jaffar') {
      const jewel = add(head, new THREE.OctahedronGeometry(0.022), this.m(kind === 'jaffar' ? 0x20d060 : 0xc02020, { rough: 0.1, metal: 0.3, emissive: kind === 'jaffar' ? 0x0a6a2a : 0x400000 }), [0, kind === 'jaffar' ? 0.2 : 0.185, 0.118]);
      jewel.scale.set(1, 1.3, 0.6);
      if (kind === 'jaffar') {
        add(head, new THREE.ConeGeometry(0.018, 0.2, 8), this.m(0xf8f4ec, { rough: 0.8 }), [0, 0.32, 0.06], [-0.3, 0, 0]);
        const capeAnchor = joint(J.chest, 0, 0.22, -0.12);
        const capeMat = this.m(0x6a0f1a, { fabric: true, rough: 0.7 });
        capeMat.side = THREE.DoubleSide;
        const segs = chain(capeAnchor, 4, 0.3, 0.3, capeMat, { taper: -0.35 });
        this.chains.push(new SpringChain(capeAnchor, segs, { stiff: 22, damp: 5, drag: 0.18, flutter: 0.08 }));
      } else {
        const tailAnchor = joint(head, 0.07, 0.17, -0.1);
        C.band.side = THREE.DoubleSide;
        const segs = chain(tailAnchor, 3, 0.09, 0.07, C.band, { taper: 0.4 });
        this.chains.push(new SpringChain(tailAnchor, segs, { stiff: 30, damp: 5, drag: 0.15 }));
      }
    }
    if (fem) {
      const hairAnchor = joint(head, 0, 0.1, -0.08);
      const hm = C.hair; hm.side = THREE.DoubleSide;
      const segs = chain(hairAnchor, 4, 0.13, 0.17, hm, { taper: 0.2 });
      this.chains.push(new SpringChain(hairAnchor, segs, { stiff: 24, damp: 5, drag: 0.12, flutter: 0.1 }));
      add(head, new THREE.TorusGeometry(0.099, 0.008, 6, 24, Math.PI), C.band, [0, 0.19, 0.0], [-0.35, 0, 0]);
      add(head, new THREE.OctahedronGeometry(0.018), this.m(0x40a0ff, { rough: 0.1, emissive: 0x103060 }), [0, 0.215, 0.075]);
    }
    if (isShadow) for (const mm of this.mats) { mm.transparent = true; mm.opacity = 0.93; }
  }

  buildSkeleton(bone) {
    const J = this.j;
    const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 3, 6);
    for (const side of ['l', 'r']) {
      add(J[side + 'h'], capsule(0.024, 0.38), bone, [0, -0.215, 0]);
      add(J[side + 'k'], new THREE.SphereGeometry(0.035, 8, 6), bone);
      add(J[side + 'k'], capsule(0.02, 0.38), bone, [0, -0.215, 0]);
      add(J[side + 'a'], new RoundedBoxGeometry(0.07, 0.035, 0.18, 1, 0.01), bone, [0, -0.04, 0.04]);
      add(J[side + 's'], new THREE.SphereGeometry(0.04, 8, 6), bone);
      add(J[side + 's'], capsule(0.02, 0.24), bone, [0, -0.14, 0]);
      add(J[side + 'e'], capsule(0.016, 0.22), bone, [0, -0.125, 0]);
      const hand = new THREE.Group(); J[side + 'w'].add(hand);
      add(hand, new RoundedBoxGeometry(0.05, 0.07, 0.02, 1, 0.008), bone, [0, -0.04, 0]);
      this[side + 'Hand'] = hand;
    }
    // pelvis
    add(J.pelvis, new THREE.TorusGeometry(0.1, 0.03, 6, 12), bone, [0, -0.02, 0], [Math.PI / 2 - 0.3, 0, 0], [1.1, 1, 0.8]);
    // columna y costillas
    add(J.spine, capsule(0.022, 0.2), bone, [0, 0.1, -0.03]);
    add(J.chest, capsule(0.022, 0.22), bone, [0, 0.11, -0.04]);
    for (let i = 0; i < 5; i++) {
      add(J.chest, new THREE.TorusGeometry(0.12 - Math.abs(i - 2) * 0.012, 0.013, 5, 16, Math.PI * 1.6), bone, [0, 0.03 + i * 0.045, 0], [Math.PI / 2, 0, Math.PI * 0.7], [1, 0.75, 1]);
    }
    add(J.chest, capsule(0.015, 0.3), bone, [0, 0.22, -0.02], [0, 0, Math.PI / 2]);
    add(J.neck, capsule(0.018, 0.06), bone, [0, 0.03, 0]);
    const head = new THREE.Group(); J.head.add(head);
    this.headG = head;
    add(head, new THREE.SphereGeometry(0.1, 16, 12), bone, [0, 0.12, 0], [0, 0, 0], [0.9, 1.0, 1.1]);
    add(head, new RoundedBoxGeometry(0.11, 0.05, 0.09, 1, 0.015), bone, [0, 0.045, 0.04]);
    const eyeMat = this.m(0x000000, { emissive: 0xff5a20, emissiveIntensity: 2.5 });
    for (const sx of [-1, 1]) add(head, new THREE.SphereGeometry(0.024, 8, 6), eyeMat, [sx * 0.035, 0.125, 0.085]);
    // jirones de tela
    const rag = this.m(0x3a3028, { fabric: true, rough: 0.9 });
    rag.side = THREE.DoubleSide;
    const ragAnchor = joint(J.pelvis, 0, 0.0, 0.08);
    const segs = chain(ragAnchor, 3, 0.12, 0.2, rag, { taper: 0.5 });
    this.chains.push(new SpringChain(ragAnchor, segs, { stiff: 30, damp: 5, drag: 0.15 }));
  }

  // ------------------------------------------------------------------ espada
  giveSword(opts) {
    if (this.sword) return this.sword;
    this.sword = makeScimitar(opts);
    this.sword.rotation.y = Math.PI / 2;   // la cara plana de la hoja mira de lado (se ve su curva)
    this.j.grip.add(this.sword);
    this.sword.visible = false;
    // vaina curva de cimitarra en la cadera, con la punta hacia atrás
    const sc = new THREE.Group();
    const sheathMat = this.m(0x3a2214, { rough: 0.45 });
    const gold = this.m(0xc9a14a, { metal: 1, rough: 0.35 });
    const path = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.36, 0.02), new THREE.Vector3(0, -0.62, -0.13));
    const sh = new THREE.Mesh(new THREE.TubeGeometry(path, 14, 0.026, 8, false), sheathMat);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), gold);
    tip.position.copy(path.getPoint(1)); tip.scale.set(1, 1.3, 1);
    const bands = [0.06, 0.5].map((t) => {
      const b = new THREE.Mesh(new THREE.TorusGeometry(0.027, 0.007, 6, 14), gold);
      b.position.copy(path.getPoint(t));
      b.lookAt(path.getPoint(t).add(path.getTangent(t)));
      return b;
    });
    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.12, 8), this.m(0x2a1a10, { rough: 0.8 }));
    hilt.position.y = 0.07;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.022, 0.03), gold);
    guard.position.y = 0.01;
    sc.add(sh, tip, ...bands, hilt, guard);
    sc.position.set(0.17, -0.02, 0.03);
    sc.rotation.set(0.55, 0, 0.16);
    sc.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.j.pelvis.add(sc);
    this.sheath = sc;
    this.sheathHilt = [hilt, guard];
    return this.sword;
  }
  setSwordDrawn(drawn) {
    if (!this.sword) return;
    this.sword.visible = drawn;
    if (this.sheathHilt) for (const h of this.sheathHilt) h.visible = !drawn;
  }

  // ------------------------------------------------------------------ pose
  applyPose(p) {
    const J = this.j, D = DEG;
    this.body.position.set(0, p[CH.ry], p[CH.rz]);
    this.body.rotation.set(p[CH.rx] * D, 0, p[CH.rr] * D);
    J.pelvis.position.y = 0.93;
    J.pelvis.rotation.set(p[CH.pel] * D, p[CH.pel + 1] * D, p[CH.pel + 2] * D);
    J.spine.rotation.set(p[CH.sp] * D, p[CH.sp + 1] * D, p[CH.sp + 2] * D);
    J.chest.rotation.set(p[CH.ch] * D, p[CH.ch + 1] * D, p[CH.ch + 2] * D);
    J.neck.rotation.set(p[CH.nk] * D, p[CH.nk + 1] * D, p[CH.nk + 2] * D);
    J.head.rotation.set(p[CH.hd] * D, p[CH.hd + 1] * D, p[CH.hd + 2] * D);
    J.ls.rotation.set(-p[CH.ls] * D, p[CH.ls + 1] * D, p[CH.ls + 2] * D);
    J.rs.rotation.set(-p[CH.rs] * D, -p[CH.rs + 1] * D, -p[CH.rs + 2] * D);
    J.le.rotation.x = -p[CH.le] * D;
    J.re.rotation.x = -p[CH.re] * D;
    J.lw.rotation.set(-p[CH.lw] * D, 0, p[CH.lw + 1] * D);
    J.rw.rotation.set(-p[CH.rw] * D, 0, -p[CH.rw + 1] * D);
    J.lh.rotation.set(-p[CH.lh] * D, p[CH.lh + 1] * D, p[CH.lh + 2] * D);
    J.rh.rotation.set(-p[CH.rh] * D, -p[CH.rh + 1] * D, -p[CH.rh + 2] * D);
    J.lk.rotation.x = p[CH.lk] * D;
    J.rk.rotation.x = p[CH.rk] * D;
    // pie nivelado automático (af): compensa la inclinación acumulada de cadera y rodilla
    const af = p[CH.af];
    const base = p[CH.rx] + p[CH.pel];
    J.la.rotation.x = (p[CH.la] - af * (base - p[CH.lh] + p[CH.lk])) * D;
    J.ra.rotation.x = (p[CH.ra] - af * (base - p[CH.rh] + p[CH.rk])) * D;
    // falda: sigue la media de los muslos
    if (this.skirt) {
      const avg = (p[CH.lh] + p[CH.rh]) * 0.5;
      this.skirt.rotation.x = -avg * D * 0.45;
      const spread = Math.abs(p[CH.lh] - p[CH.rh]);
      this.skirt.scale.z = (this.kind === 'jaffar' ? 0.85 : this.kind === 'princess' ? 0.9 : 0.8) * (1 + spread / 220);
    }
    const g = p[CH.g];
    this.root.updateMatrixWorld(true);
    if (g > 0.001) {
      // apoyar los pies en el suelo (y=0 del root)
      const minY = this.lowestFoot();
      this.body.position.y -= minY * g;
      this.root.updateMatrixWorld(true);
    }
  }

  lowestFoot() {
    const v = this._v;
    let min = Infinity;
    const pts = [[0, -0.075, -0.05], [0, -0.075, 0.15]];
    for (const side of ['la', 'ra']) {
      const a = this.j[side];
      for (const pt of pts) {
        v.set(pt[0], pt[1], pt[2]).applyMatrix4(a.matrixWorld);
        this.root.worldToLocal(v);
        if (v.y < min) min = v.y;
      }
    }
    return min;
  }

  handsY() {
    const v = this._v;
    let s = 0;
    for (const h of [this.j.lw, this.j.rw]) {
      v.set(0, -0.05, 0).applyMatrix4(h.matrixWorld);
      this.root.worldToLocal(v);
      s += v.y;
    }
    return s / 2;
  }

  // ajusta el cuerpo para que las manos queden a la altura dada (en el espacio del root)
  anchorHands(y, w = 1) {
    const hy = this.handsY();
    this.body.position.y += (y - hy) * w;
    this.root.updateMatrixWorld(true);
  }

  setFacing(f, yaw) {
    // f: 1 derecha, -1 izquierda. yaw: giro adicional (0 = perfil 3/4 hacia cámara)
    this.flip.scale.x = f;
    this.yaw.rotation.y = yaw;
  }

  updateChains(dt) { for (const c of this.chains) c.update(dt); }

  setFlash(v) { this.uni.flash.value = v; }

  dispose() {
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of this.mats) m.dispose();
  }
}
