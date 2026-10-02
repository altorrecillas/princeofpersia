// Anatomía esculpida de los personajes: cuerpos continuos con piel deformable (SkinnedMesh) y
// cabeza, manos y pies de alta resolución unidos a sus huesos. Las geometrías se cachean por tipo.
import * as THREE from 'three';
import { Shape, roundCone, sphere, ellipsoid, roundBox, torus, plane, polygonize, skinWeights } from './sculpt.js';

export const BONES = ['pelvis', 'spine', 'chest', 'neck', 'head', 'ls', 'le', 'lw', 'rs', 're', 'rw', 'lh', 'lk', 'la', 'rh', 'rk', 'ra'];
const BI = Object.fromEntries(BONES.map((b, i) => [b, i]));

// pose de enlace (radianes, rotación directa de las articulaciones)
const BIND = {
  ls: [0, 0, 0.3], rs: [0, 0, -0.3], le: [-0.14, 0, 0], re: [-0.14, 0, 0],
  lh: [0, 0, 0.15], rh: [0, 0, -0.15], lk: [0.05, 0, 0], rk: [0.05, 0, 0],
};

export function setBindPose(J) {
  for (const n of BONES) J[n].rotation.set(0, 0, 0);
  for (const [n, r] of Object.entries(BIND)) J[n].rotation.set(r[0], r[1], r[2]);
}

const cache = new Map();

// utilidades vectoriales
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scaleZ = (f, s) => (x, y, z) => f(x, y, z / s) * s;
const inflate = (shape, r) => (x, y, z) => shape.eval(x, y, z) - r;
const fn = (shape) => (x, y, z) => shape.eval(x, y, z);

// límites aproximados de una forma (para la rejilla de muestreo)
function bbox(points, pad) {
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const p of points) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], p[i]); mx[i] = Math.max(mx[i], p[i]); }
  return [mn.map((v) => v - pad), mx.map((v) => v + pad)];
}

// ======================================================================= definición por tipo
// P: posiciones de las articulaciones en la pose de enlace (espacio del cuerpo)
function buildParts(kind, P, res) {
  const H = res.body, HH = res.head;
  const fat = kind === 'fat', fem = kind === 'princess';
  const wide = fat ? 1.3 : fem ? 0.9 : 1;
  const parts = { skinned: [], rigid: [] };

  // ---------------------------------------------------------------- torso (camisa / túnica)
  const torso = new Shape()
    .add(ellipsoid([0, 0.985, 0.0], [0.122 * wide, 0.1, 0.09 * wide]))
    .add(scaleZ(roundCone([0, 0.97, 0], [0, 1.3, -0.005], 0.118 * wide, 0.148 * wide), 0.68), 0.05)
    .add(ellipsoid([0, 1.29, 0.0], [0.168 * wide, 0.12, 0.11]), 0.05)
    .add(roundCone([0, 1.43, -0.025], [0.155 * wide, 1.385, -0.015], 0.05, 0.058), 0.05)
    .add(roundCone([0, 1.43, -0.025], [-0.155 * wide, 1.385, -0.015], 0.05, 0.058), 0.05);
  if (!fem) torso.add(ellipsoid([0.058, 1.3, 0.065], [0.07, 0.058, 0.045]), 0.04).add(ellipsoid([-0.058, 1.3, 0.065], [0.07, 0.058, 0.045]), 0.04);
  else torso.add(sphere([0.05, 1.29, 0.075], 0.05), 0.03).add(sphere([-0.05, 1.29, 0.075], 0.05), 0.03);
  if (fat) torso.add(ellipsoid([0, 1.08, 0.07], [0.2, 0.2, 0.18]), 0.08);
  torso.sub(sphere([0, 1.475, 0.035], 0.07), 0.02);           // escote
  torso.and(plane([0, -1, 0], 0.9), 0.02);                      // corte inferior (y > 0.9)
  const torsoBones = ['pelvis', 'spine', 'chest', 'neck'];

  const clothTop = kind === 'jaffar' ? 'robe' : kind === 'princess' ? 'dress' : 'shirt';
  parts.skinned.push({ mat: clothTop, shape: torso, min: [-0.27 * wide, 0.86, -0.2 * wide], max: [0.27 * wide, 1.53, 0.26 * wide], h: H, bones: torsoBones });

  // chaleco abierto (príncipe, sombra, guardias) o corpiño (princesa)
  if (kind === 'prince' || kind === 'shadow' || kind === 'guard' || kind === 'fat' || kind === 'princess') {
    const open = fem ? 0.0 : 0.05;
    const vest = new Shape().add(inflate(torso, fem ? 0.008 : 0.016));
    vest.and(plane([0, 1, 0], -(fem ? 1.36 : 1.455)), 0.02);     // por debajo de los hombros
    vest.and(plane([0, -1, 0], fem ? 1.02 : 0.98), 0.02);
    if (!fem) {
      // abertura en V por delante
      vest.sub((x, y, z) => {
        const w = open + Math.max(0, 1.46 - y) * 0.09;
        return Math.max(Math.abs(x) - w, -(z - 0.02));
      }, 0.025);
      // sisas
      vest.sub(sphere([0.175 * wide, 1.37, -0.01], 0.08), 0.03).sub(sphere([-0.175 * wide, 1.37, -0.01], 0.08), 0.03);
    }
    parts.skinned.push({ mat: 'vest', shape: vest, min: [-0.28 * wide, 0.95, -0.21 * wide], max: [0.28 * wide, 1.5, 0.27 * wide], h: H * 0.72, bones: torsoBones });
  }

  // fajín / cinturón
  const belt = new Shape().add(torus([0, 1.0, 0.005], 0.128 * wide, 0.033, 1.03, 0.8 * (fat ? 1.25 : 1)));
  if (fat) belt.add(torus([0, 0.98, 0.05], 0.15, 0.03, 1.2, 1.15), 0.02);
  parts.skinned.push({ mat: 'sash', shape: belt, min: [-0.22 * wide, 0.93, -0.2 * wide], max: [0.22 * wide, 1.07, 0.28 * wide], h: H, bones: ['pelvis', 'spine'] });

  // ---------------------------------------------------------------- piernas (pantalón bombacho)
  const legs = new Shape().add(ellipsoid([0, 0.905, 0.0], [0.155 * wide, 0.115, 0.118 * wide])).and(plane([0, 1, 0], -1.0), 0.02);
  const skirted = kind === 'guard' || kind === 'fat' || kind === 'jaffar' || kind === 'princess';
  const baggy = kind === 'prince' || kind === 'shadow' ? 1.06 : skirted ? 0.78 : 0.95;
  for (const s of ['l', 'r']) {
    const hip = P[s + 'h'], knee = P[s + 'k'], ank = P[s + 'a'];
    const mid = lerp3(knee, ank, 0.55);
    legs.add(roundCone(add(hip, [0, 0.03, 0]), knee, 0.1 * baggy * wide, 0.078 * baggy), 0.05);
    legs.add(roundCone(knee, mid, 0.078 * baggy, 0.1 * baggy), 0.04);
    legs.add(roundCone(mid, add(ank, [0, 0.055, 0]), 0.1 * baggy, 0.046), 0.05);
  }
  // pliegues del tejido en la parte baja
  legs.displace((x, y, z) => (y < 0.4 ? Math.sin(Math.atan2(x - Math.sign(x) * 0.1, z) * 7 + y * 55) * 0.0035 * (0.4 - y) / 0.4 : 0));
  legs.and(plane([0, -1, 0], 0.055), 0.01);
  const legBones = ['pelvis', 'lh', 'lk', 'la', 'rh', 'rk', 'ra'];
  const boots = kind === 'guard' || kind === 'fat' || kind === 'jaffar';
  parts.skinned.push({ mat: 'pants', shape: legs, min: [-0.36, 0.03, -0.2], max: [0.36, 1.03, 0.22], h: H, bones: legBones });

  if (boots) {
    const bt = new Shape();
    for (const s of ['l', 'r']) {
      const knee = P[s + 'k'], ank = P[s + 'a'];
      bt.add(roundCone(add(lerp3(knee, ank, 0.12), [0, 0, 0]), add(ank, [0, 0.03, 0]), 0.078, 0.06), 0.02);
      bt.add(torus(lerp3(knee, ank, 0.12), 0.07, 0.016), 0.01);
    }
    parts.skinned.push({ mat: 'shoes', shape: bt, min: [-0.3, 0.02, -0.15], max: [0.3, 0.5, 0.15], h: H, bones: ['lk', 'la', 'rk', 'ra'] });
  }

  // faldón de túnica / túnica larga / vestido
  if (kind === 'guard' || kind === 'fat' || kind === 'jaffar' || kind === 'princess') {
    const long = kind === 'jaffar' || kind === 'princess';
    const bottom = long ? 0.06 : 0.52;
    const rTop = 0.155 * wide, rBot = (long ? 0.36 : 0.27) * wide * (fem ? 1.2 : 1);
    const skirt = new Shape()
      .add(scaleZ(roundCone([0, 1.02, 0.005], [0, bottom + 0.04, 0.0], rTop, rBot), long ? 0.85 : 0.78))
      .and(plane([0, -1, 0], bottom + 0.02), 0.02)
      .and(plane([0, 1, 0], -1.04), 0.02)
      .displace((x, y, z) => Math.sin(Math.atan2(x, z) * (long ? 11 : 9)) * 0.009 * Math.max(0, Math.min(1, 1 - (y - bottom) / 0.7)));
    parts.skinned.push({ mat: long ? (fem ? 'pants' : 'robe') : 'shirt', shape: skirt, min: [-0.5, bottom - 0.05, -0.42], max: [0.5, 1.08, 0.45], h: H * (long ? 1.25 : 1), bones: ['pelvis', 'lh', 'lk', 'rh', 'rk'], skirt: true });
  }

  // ---------------------------------------------------------------- brazos
  for (const s of ['l', 'r']) {
    const sh = P[s + 's'], el = P[s + 'e'], wr = P[s + 'w'];
    const dirOut = s === 'l' ? 1 : -1;
    const puff = kind === 'prince' || kind === 'shadow' || fem ? 1.08 : 1;
    const sleeve = new Shape()
      .add(sphere(add(sh, [-dirOut * 0.012, 0.0, 0]), 0.06 * (fat ? 1.25 : 1)))
      .add(roundCone(sh, lerp3(sh, el, 0.55), 0.056 * puff, 0.056 * puff), 0.03)
      .add(roundCone(lerp3(sh, el, 0.55), lerp3(el, wr, kind === 'jaffar' ? 0.95 : 0.06), 0.056 * puff, kind === 'jaffar' ? 0.11 : 0.058), 0.03);
    if (kind === 'jaffar') sleeve.sub(roundCone(lerp3(el, wr, 0.2), lerp3(el, wr, 1.05), 0.03, 0.1), 0.01);
    parts.skinned.push({ mat: kind === 'jaffar' ? 'robe' : clothTop, shape: sleeve, min: bbox([sh, el, wr], 0.13)[0], max: bbox([sh, el, wr], 0.13)[1], h: H * 0.85, bones: [s + 's', s + 'e', s + 'w'] });
    const fore = new Shape()
      .add(roundCone(add(el, [0, 0.01, 0]), lerp3(el, wr, 0.45), 0.047, 0.043))
      .add(roundCone(lerp3(el, wr, 0.45), add(wr, [0, -0.005, 0]), 0.043, 0.032), 0.03);
    parts.skinned.push({ mat: 'skin', shape: fore, min: bbox([el, wr], 0.08)[0], max: bbox([el, wr], 0.08)[1], h: H * 0.75, bones: [s + 'e', s + 'w'] });
  }

  // ---------------------------------------------------------------- cabeza (rígida, en coordenadas del hueso)
  parts.rigid.push({ bone: 'head', mat: 'skin', geo: () => headGeo(kind, HH) });
  parts.rigid.push({ bone: 'head', mat: 'eyeW', geo: () => eyesGeo(HH, false) });
  parts.rigid.push({ bone: 'head', mat: 'iris', geo: () => eyesGeo(HH, true) });
  parts.rigid.push({ bone: 'head', mat: 'hair', geo: () => browsGeo(kind, HH) });
  if (kind === 'prince' || kind === 'shadow' || fem) parts.rigid.push({ bone: 'head', mat: 'hair', geo: () => hairGeo(kind, HH) });
  if (kind === 'guard' || kind === 'fat' || kind === 'jaffar') {
    parts.rigid.push({ bone: 'head', mat: 'hair', geo: () => beardGeo(kind, HH) });
    parts.rigid.push({ bone: 'head', mat: 'band', geo: () => turbanGeo(kind, HH) });
  }
  // manos y pies
  for (const s of ['l', 'r']) {
    parts.rigid.push({ bone: s + 'w', mat: 'skin', geo: () => handGeo(HH * 0.9) });
    parts.rigid.push({ bone: s + 'a', mat: 'shoes', geo: () => footGeo(kind, HH * 1.4) });
  }
  return parts;
}

// ---------------------------------------------------------------- cabeza
function headGeo(kind, h) {
  const fem = kind === 'princess';
  const male = !fem;
  const S = new Shape()
    .add(ellipsoid([0, 0.118, -0.012], [0.086, 0.104, 0.098]))
    .add(ellipsoid([0, 0.062, 0.028], [fem ? 0.062 : 0.068, 0.064, 0.07]), 0.04)
    .add(sphere([0, 0.026, 0.066], fem ? 0.022 : 0.027), 0.025)
    .add(ellipsoid([0.047, 0.09, 0.058], [0.028, 0.02, 0.028]), 0.025)
    .add(ellipsoid([-0.047, 0.09, 0.058], [0.028, 0.02, 0.028]), 0.025)
    .add(roundCone([-0.044, 0.132, 0.077], [0.044, 0.132, 0.077], male ? 0.015 : 0.012, male ? 0.015 : 0.012), 0.022)
    // nariz
    .add(roundCone([0, 0.126, 0.088], [0, 0.088, fem ? 0.106 : 0.112], 0.01, fem ? 0.011 : 0.013), 0.012)
    .add(sphere([0, 0.085, fem ? 0.104 : 0.11], fem ? 0.012 : 0.0145), 0.008)
    .add(sphere([0.012, 0.081, 0.101], 0.0095), 0.006)
    .add(sphere([-0.012, 0.081, 0.101], 0.0095), 0.006)
    // cuencas de los ojos y párpados
    .sub(sphere([0.034, 0.112, 0.1], 0.02), 0.012)
    .sub(sphere([-0.034, 0.112, 0.1], 0.02), 0.012)
    .add(ellipsoid([0.034, 0.121, 0.093], [0.019, 0.0075, 0.013]), 0.004)
    .add(ellipsoid([-0.034, 0.121, 0.093], [0.019, 0.0075, 0.013]), 0.004)
    // labios y boca
    .add(ellipsoid([0, 0.06, 0.1], [0.023, 0.0085, 0.012]), 0.006)
    .add(ellipsoid([0, 0.0475, 0.097], [0.02, 0.009, 0.012]), 0.006)
    .sub(roundBox([0, 0.0535, 0.109], [0.021, 0.0012, 0.012], 0.001), 0.002)
    // orejas
    .add(ellipsoid([0.087, 0.104, -0.006], [0.011, 0.03, 0.021]), 0.008)
    .add(ellipsoid([-0.087, 0.104, -0.006], [0.011, 0.03, 0.021]), 0.008)
    .sub(ellipsoid([0.094, 0.104, -0.002], [0.006, 0.017, 0.011]), 0.004)
    .sub(ellipsoid([-0.094, 0.104, -0.002], [0.006, 0.017, 0.011]), 0.004)
    // cuello
    .add(roundCone([0, -0.07, -0.012], [0, 0.04, -0.01], 0.047, 0.05), 0.03);
  const skinCol = (x, y, z) => {
    let r = 1, g = 1, b = 1;
    // labios
    const ld = Math.hypot((x) / 0.03, (y - 0.054) / 0.014, (z - 0.1) / 0.03);
    if (ld < 1) { const k = (1 - ld) * 1.6; r -= 0.05 * k; g -= 0.28 * k; b -= 0.24 * k; }
    // mejillas
    for (const sx of [-1, 1]) {
      const cd = Math.hypot((x - sx * 0.05) / 0.03, (y - 0.08) / 0.025, (z - 0.065) / 0.04);
      if (cd < 1) { const k = (1 - cd) * (fem ? 0.5 : 0.25); g -= 0.12 * k; b -= 0.1 * k; }
    }
    // sombra de barba (hombres)
    if (male && kind !== 'shadow' && y < 0.075 && z > 0.02) { const k = Math.min(1, (0.075 - y) / 0.03) * 0.18; r -= k; g -= k; b -= k * 0.9; }
    return [r, g, b];
  };
  return polygonize(S, [-0.115, -0.08, -0.125], [0.115, 0.235, 0.14], h, skinCol);
}

function eyesGeo(h, iris) {
  const S = new Shape();
  for (const sx of [-1, 1]) {
    if (iris) S.add(sphere([sx * 0.034, 0.1125, 0.0975], 0.0078));
    else S.add(sphere([sx * 0.034, 0.112, 0.087], 0.0135));
  }
  return polygonize(S, [-0.06, 0.09, 0.065], [0.06, 0.135, 0.115], h * 0.6);
}

function browsGeo(kind, h) {
  const S = new Shape();
  const thick = kind === 'jaffar' ? 0.006 : 0.0045;
  for (const sx of [-1, 1]) S.add(roundCone([sx * 0.016, 0.1355, 0.095], [sx * 0.052, kind === 'jaffar' ? 0.142 : 0.137, 0.084], thick, thick * 0.6));
  return polygonize(S, [-0.07, 0.12, 0.07], [0.07, 0.155, 0.11], h * 0.6);
}

function hairGeo(kind, h) {
  const fem = kind === 'princess';
  const S = new Shape()
    .add(ellipsoid([0, 0.126, -0.016], [0.095, 0.113, 0.106]))
    .add(ellipsoid([0, 0.07, -0.058], [0.084, 0.085, 0.07]), 0.03)
    // flequillo
    .add(roundCone([0.0, 0.2, 0.04], [0.03, 0.165, 0.092], 0.022, 0.012), 0.015)
    .add(roundCone([0.0, 0.2, 0.04], [-0.025, 0.162, 0.094], 0.022, 0.011), 0.015)
    .add(roundCone([0.03, 0.19, 0.04], [0.068, 0.14, 0.072], 0.02, 0.01), 0.015)
    .add(roundCone([-0.03, 0.19, 0.04], [-0.07, 0.14, 0.07], 0.02, 0.01), 0.015);
  if (fem) S.add(ellipsoid([0, 0.04, -0.07], [0.09, 0.12, 0.06]), 0.03);
  // recorte de la cara
  S.and((x, y, z) => -((y - 0.112) * 0.62 - (z - 0.035) * 0.78 + Math.abs(x) * 0.12 + 0.012), 0.02);
  S.and((x, y, z) => -(y - (fem ? -0.06 : 0.0)), 0.02);
  // mechones
  S.displace((x, y, z) => Math.sin(Math.atan2(x, z + 0.02) * 22 + y * 18) * 0.0028);
  return polygonize(S, [-0.12, -0.08, -0.15], [0.12, 0.25, 0.12], h * 1.25);
}

function beardGeo(kind, h) {
  const jaf = kind === 'jaffar';
  const S = new Shape()
    .add(ellipsoid([0, 0.035, 0.06], [jaf ? 0.05 : 0.066, jaf ? 0.06 : 0.045, 0.05]))
    .add(roundCone([0, 0.03, 0.075], [0, jaf ? -0.09 : -0.02, 0.085], jaf ? 0.035 : 0.04, jaf ? 0.006 : 0.03), 0.02)
    // patillas
    .add(roundCone([0.07, 0.1, 0.02], [0.055, 0.04, 0.05], 0.014, 0.022), 0.02)
    .add(roundCone([-0.07, 0.1, 0.02], [-0.055, 0.04, 0.05], 0.014, 0.022), 0.02)
    // bigote
    .add(roundCone([0, 0.07, 0.106], [0.042, 0.058, 0.094], 0.008, 0.004), 0.008)
    .add(roundCone([0, 0.07, 0.106], [-0.042, 0.058, 0.094], 0.008, 0.004), 0.008)
    .sub(ellipsoid([0, 0.054, 0.1], [0.024, 0.013, 0.03]), 0.006)
    .displace((x, y, z) => Math.sin(x * 160 + y * 30) * 0.002);
  return polygonize(S, [-0.1, -0.12, -0.0], [0.1, 0.12, 0.14], h);
}

function turbanGeo(kind, h) {
  const jaf = kind === 'jaffar';
  const S = new Shape().add(ellipsoid([0, jaf ? 0.2 : 0.185, -0.012], [0.11, jaf ? 0.1 : 0.085, 0.115]));
  for (let i = 0; i < 4; i++) {
    const y = 0.15 + i * 0.026;
    S.add(torus([0, y, -0.012 + (i % 2) * 0.006], 0.092 - i * 0.008, 0.024, 1, 1.08), 0.012);
  }
  S.displace((x, y, z) => Math.sin(Math.atan2(x, z) * 3 + y * 70) * 0.004);
  return polygonize(S, [-0.15, 0.1, -0.16], [0.15, jaf ? 0.33 : 0.3, 0.15], h * 1.2);
}

function handGeo(h) {
  const S = new Shape().add(roundBox([0, -0.045, 0.004], [0.029, 0.036, 0.0135], 0.011));
  const fx = [-0.021, -0.007, 0.007, 0.02];
  fx.forEach((x, i) => {
    const l = i === 0 || i === 3 ? 0.9 : 1;
    S.add(roundCone([x, -0.078, 0.006], [x, -0.1 * l, 0.024], 0.0085, 0.0078), 0.006);
    S.add(roundCone([x, -0.1 * l, 0.024], [x * 0.9, -0.088 * l, 0.042], 0.0078, 0.0068), 0.004);
  });
  S.add(roundCone([0.0, -0.028, 0.016], [0.004, -0.058, 0.038], 0.011, 0.0085), 0.008);
  return polygonize(S, [-0.045, -0.125, -0.03], [0.045, 0.0, 0.07], h);
}

function footGeo(kind, h) {
  const boots = kind === 'guard' || kind === 'fat' || kind === 'jaffar';
  const S = new Shape()
    .add(ellipsoid([0, -0.04, 0.05], [0.046, 0.04, 0.115]))
    .add(roundCone([0, -0.05, 0.12], [0, boots ? -0.045 : -0.018, boots ? 0.17 : 0.19], 0.028, boots ? 0.02 : 0.009), 0.025)
    .add(sphere([0, -0.015, -0.005], 0.042), 0.03)
    .and(plane([0, -1, 0], -0.078), 0.008);
  return polygonize(S, [-0.07, -0.1, -0.08], [0.07, 0.03, 0.23], h * 1.3);
}

// ======================================================================= ensamblado
export function getBodyGeometry(kind, P, quality) {
  const key = kind + (quality === 'low' ? 'L' : 'H');
  if (cache.has(key)) return cache.get(key);
  const res = quality === 'low' ? { body: 0.034, head: 0.012 } : quality === 'medium' ? { body: 0.027, head: 0.0092 } : { body: 0.02, head: 0.0065 };
  const parts = buildParts(kind === 'shadow' ? 'prince' : kind, P, res);
  const segs = boneSegments(P);
  const out = { skinned: [], rigid: [] };
  const prof = typeof window !== 'undefined' && window.__profile;
  for (const sp of parts.skinned) {
    const t0 = performance.now();
    const geo = polygonize(sp.shape, sp.min, sp.max, sp.h);
    if (prof) console.log('skinned', sp.mat, (performance.now() - t0).toFixed(0), 'ms', geo.index.count / 3, 'tris');
    const bones = sp.bones.map((n) => ({ index: BI[n], a: segs[n][0], b: segs[n][1] }));
    let falloff = null;
    if (sp.skirt) {
      // faldas: arriba sigue a la pelvis, abajo reparte entre los muslos según el lado
      falloff = (bi, dist, hh, x, y, z) => {
        const name = sp.bones[bi];
        const down = Math.min(1, Math.max(0, (1.0 - y) / 0.6));
        if (name === 'pelvis') return 0.02 + down * 0.25;
        if (name === 'lk' || name === 'rk') return 0.4 - down * 0.15;
        const side = name === 'lh' ? 1 : -1;
        return 0.3 - down * 0.25 + Math.max(0, -x * side) * 0.9;
      };
    }
    const t1 = performance.now();
    skinWeights(geo, bones, 6, falloff);
    if (prof) console.log('  weights', (performance.now() - t1).toFixed(0), 'ms');
    out.skinned.push({ mat: sp.mat, geo });
  }
  for (const rp of parts.rigid) {
    const t0 = performance.now();
    const geo = rp.geo();
    if (prof) console.log('rigid', rp.bone, rp.mat, (performance.now() - t0).toFixed(0), 'ms', geo.index.count / 3, 'tris');
    out.rigid.push({ bone: rp.bone, mat: rp.mat, geo });
  }
  cache.set(key, out);
  return out;
}

function boneSegments(P) {
  const S = {};
  S.pelvis = [P.pelvis, P.spine];
  S.spine = [P.spine, P.chest];
  S.chest = [P.chest, add(P.chest, [0, 0.2, 0])];
  S.neck = [P.neck, P.head];
  S.head = [P.head, add(P.head, [0, 0.2, 0])];
  for (const s of ['l', 'r']) {
    S[s + 's'] = [P[s + 's'], P[s + 'e']];
    S[s + 'e'] = [P[s + 'e'], P[s + 'w']];
    S[s + 'w'] = [P[s + 'w'], lerp3(P[s + 'e'], P[s + 'w'], 1.3)];
    S[s + 'h'] = [P[s + 'h'], P[s + 'k']];
    S[s + 'k'] = [P[s + 'k'], P[s + 'a']];
    S[s + 'a'] = [P[s + 'a'], add(P[s + 'a'], [0, -0.05, 0.12])];
  }
  return S;
}

export function jointPositions(J, body) {
  const P = {};
  const v = new THREE.Vector3();
  for (const n of BONES) {
    J[n].getWorldPosition(v);
    body.worldToLocal(v);
    P[n] = [v.x, v.y, v.z];
  }
  return P;
}
