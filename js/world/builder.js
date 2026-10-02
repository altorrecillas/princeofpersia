// Construcción de la geometría estática del nivel (paredes, suelos, techo, márgenes).
// Las caras se generan sólo cuando son visibles y con UV en coordenadas del mundo para que
// las texturas continúen sin costuras de una baldosa a otra.
import * as THREE from 'three';
import { TW, RH, SLAB, ZB, ZF } from '../core/config.js';
import { hash2 } from '../core/utils.js';

export class GeoBuilder {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; this.vc = 0; }
  // a,b,c,d en sentido antihorario visto desde el lado de la normal
  quad(a, b, c, d, n, ua, ub, uc, ud, ca = 1, cb = 1, cc = 1, cd = 1) {
    this.p.push(...a, ...b, ...c, ...d);
    for (let k = 0; k < 4; k++) this.n.push(...n);
    this.u.push(...ua, ...ub, ...uc, ...ud);
    this.c.push(ca, ca, ca, cb, cb, cb, cc, cc, cc, cd, cd, cd);
    const v = this.vc;
    this.i.push(v, v + 1, v + 2, v, v + 2, v + 3);
    this.vc += 4;
  }
  get empty() { return this.vc === 0; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.vc > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// --- caras con UV del mundo. su/sv = metros por repetición de textura
export function faceFront(gb, x0, x1, y0, y1, z, su, sv, shade = [1, 1, 1, 1], vOff = 0) {
  gb.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [0, 0, 1],
    [x0 / su, (y0 - vOff) / sv], [x1 / su, (y0 - vOff) / sv], [x1 / su, (y1 - vOff) / sv], [x0 / su, (y1 - vOff) / sv], ...shade);
}
export function faceTop(gb, x0, x1, z0, z1, y, su, shade = [1, 1, 1, 1]) {
  gb.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0],
    [x0 / su, z1 / su], [x1 / su, z1 / su], [x1 / su, z0 / su], [x0 / su, z0 / su], ...shade);
}
export function faceBottom(gb, x0, x1, z0, z1, y, su, shade = [1, 1, 1, 1]) {
  gb.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, -1, 0],
    [x0 / su, z0 / su], [x1 / su, z0 / su], [x1 / su, z1 / su], [x0 / su, z1 / su], ...shade);
}
export function faceRight(gb, x, y0, y1, z0, z1, su, sv, shade = [1, 1, 1, 1], vOff = 0) { // normal +x
  gb.quad([x, y0, z1], [x, y0, z0], [x, y1, z0], [x, y1, z1], [1, 0, 0],
    [-z1 / su, (y0 - vOff) / sv], [-z0 / su, (y0 - vOff) / sv], [-z0 / su, (y1 - vOff) / sv], [-z1 / su, (y1 - vOff) / sv], ...shade);
}
export function faceLeft(gb, x, y0, y1, z0, z1, su, sv, shade = [1, 1, 1, 1], vOff = 0) { // normal -x
  gb.quad([x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0], [-1, 0, 0],
    [z0 / su, (y0 - vOff) / sv], [z1 / su, (y0 - vOff) / sv], [z1 / su, (y1 - vOff) / sv], [z0 / su, (y1 - vOff) / sv], ...shade);
}

// losa de suelo completa (para baldosas sueltas): geometría local centrada en x, base en y=0
export function slabGeometry(w) {
  const gTop = new GeoBuilder(), gEdge = new GeoBuilder();
  const x0 = -w / 2, x1 = w / 2, y0 = -SLAB, y1 = 0;
  faceTop(gTop, x0, x1, ZB, ZF, y1, 2.4);
  faceFront(gEdge, x0, x1, y0, y1, ZF, 2.4, SLAB, [1, 1, 1, 1], y0);
  faceLeft(gEdge, x0, y0, y1, ZB, ZF, 2.4, SLAB, [1, 1, 1, 1], y0);
  faceRight(gEdge, x1, y0, y1, ZB, ZF, 2.4, SLAB, [1, 1, 1, 1], y0);
  faceBottom(gEdge, x0, x1, ZB, ZF, y0, 2.4, [0.5, 0.5, 0.5, 0.5]);
  return { top: gTop.build(), edge: gEdge.build() };
}

const MARGIN_X = 14, MARGIN_TOP = 3, MARGIN_BOTTOM = 3;

export function buildStatic(level, mats) {
  const { cols, rows } = level;
  const gBack = new GeoBuilder(), gSolid = new GeoBuilder(), gTop = new GeoBuilder(), gEdge = new GeoBuilder();
  const B = (r) => (rows - 1 - r) * RH;
  const solid = (c, r) => level.isSolidStatic(c, r);
  const slab = (c, r) => level.hasSlabStatic(c, r);

  // distancia de cada celda maciza al hueco más cercano (para oscurecer la roca profunda)
  const depth = [];
  for (let r = -MARGIN_TOP - 1; r <= rows + MARGIN_BOTTOM; r++) {
    for (let c = -MARGIN_X - 1; c <= cols + MARGIN_X; c++) {
      let d = 9;
      for (let dr = -3; dr <= 3; dr++) for (let dc = -3; dc <= 3; dc++) {
        if (!solid(c + dc, r + dr)) d = Math.min(d, Math.max(Math.abs(dr), Math.abs(dc) * 0.8));
      }
      depth[(r + 50) * 1000 + c + 500] = d;
    }
  }
  const dShade = (c, r) => { const d = depth[(r + 50) * 1000 + c + 500] ?? 9; return Math.max(0.1, 0.95 - d * 0.3); };
  // sombra en cada vértice = media de las 4 celdas que lo rodean
  const vShade = (c, r) => (dShade(c - 1, r - 1) + dShade(c, r - 1) + dShade(c - 1, r) + dShade(c, r)) / 4;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = c * TW, x1 = x0 + TW, y0 = B(r), y1 = y0 + RH;
      if (solid(c, r)) {
        // bloque macizo
        const f = 0.94 + hash2(c, r, 3) * 0.08;
        faceFront(gSolid, x0, x1, y0, y1, ZF, 2.4, 2.6,
          [vShade(c, r + 1) * f, vShade(c + 1, r + 1) * f, vShade(c + 1, r) * f, vShade(c, r) * f]);
        if (!solid(c - 1, r)) faceLeft(gSolid, x0, y0, y1, ZB, ZF, 2.4, 2.6, [0.8, 0.8, 0.8, 0.8]);
        if (!solid(c + 1, r)) faceRight(gSolid, x1, y0, y1, ZB, ZF, 2.4, 2.6, [0.8, 0.8, 0.8, 0.8]);
        if (!solid(c, r + 1) && !(r + 1 >= rows)) faceBottom(gSolid, x0, x1, ZB, ZF, y0, 2.4, [0.45, 0.45, 0.45, 0.45]);
        if (!solid(c, r - 1) && !slab(c, r - 1) && r - 1 >= 0) faceTop(gTop, x0, x1, ZB, ZF, y1, 2.4);
        continue;
      }
      // pared del fondo con oclusión en el encuentro con suelo y techo
      const yf = y0 + SLAB;
      const hasCeil = r === 0 || slab(c, r - 1) || solid(c, r - 1);
      const s1 = 0.42, s2 = 0.9, sc = hasCeil ? 0.55 : 1;
      faceFront(gBack, x0, x1, y0, yf, ZB, 2.4, 2.6, [0.3, 0.3, 0.3, 0.3]);
      faceFront(gBack, x0, x1, yf, yf + 0.55, ZB, 2.4, 2.6, [s1, s1, s2, s2]);
      faceFront(gBack, x0, x1, yf + 0.55, y1 - 0.5, ZB, 2.4, 2.6, [s2, s2, 1, 1]);
      faceFront(gBack, x0, x1, y1 - 0.5, y1, ZB, 2.4, 2.6, [1, 1, sc, sc]);
      if (slab(c, r)) {
        // losa: cara superior con oclusión cerca del fondo, borde frontal y laterales
        const zm = ZB + 0.5;
        faceTop(gTop, x0, x1, ZB, zm, yf, 2.4, [0.55, 0.55, 0.92, 0.92]);
        faceTop(gTop, x0, x1, zm, ZF, yf, 2.4, [0.92, 0.92, 1, 1]);
        faceFront(gEdge, x0, x1, y0, yf, ZF, 2.4, SLAB, [0.85, 0.85, 1, 1], y0);
        if (!slab(c - 1, r) && !solid(c - 1, r)) faceLeft(gEdge, x0, y0, yf, ZB, ZF, 2.4, SLAB, [0.7, 0.7, 0.85, 0.85], y0);
        if (!slab(c + 1, r) && !solid(c + 1, r)) faceRight(gEdge, x1, y0, yf, ZB, ZF, 2.4, SLAB, [0.7, 0.7, 0.85, 0.85], y0);
        if (r + 1 < rows && !solid(c, r + 1)) faceBottom(gSolid, x0, x1, ZB, ZF, y0, 2.4, [0.4, 0.4, 0.4, 0.4]);
      }
    }
  }
  // márgenes: roca maciza alrededor del nivel (celda a celda para la oclusión)
  const W = cols * TW, Htot = rows * RH;
  for (let r = -MARGIN_TOP; r < rows + MARGIN_BOTTOM; r++) {
    for (let c = -MARGIN_X; c < cols + MARGIN_X; c++) {
      if (c >= 0 && c < cols && r >= 0 && r < rows) continue;
      const x0 = c * TW, x1 = x0 + TW, y0 = B(r), y1 = y0 + RH;
      faceFront(gSolid, x0, x1, y0, y1, ZF, 2.4, 2.6, [vShade(c, r + 1), vShade(c + 1, r + 1), vShade(c + 1, r), vShade(c, r)]);
    }
  }
  // caras laterales/inferiores en el contorno donde haya hueco
  for (let r = 0; r < rows; r++) {
    const y0 = B(r), y1 = y0 + RH;
    if (!solid(0, r)) faceRight(gSolid, 0, y0, y1, ZB, ZF, 2.4, 2.6, [0.8, 0.8, 0.8, 0.8]);
    if (!solid(cols - 1, r)) faceLeft(gSolid, W, y0, y1, ZB, ZF, 2.4, 2.6, [0.8, 0.8, 0.8, 0.8]);
  }
  for (let c = 0; c < cols; c++) {
    if (!solid(c, 0) && !slab(c, -1)) faceBottom(gSolid, c * TW, (c + 1) * TW, ZB, ZF, Htot, 2.4, [0.4, 0.4, 0.4, 0.4]);
  }

  const group = new THREE.Group();
  const add = (gb, mat) => {
    if (gb.empty) return;
    const m = new THREE.Mesh(gb.build(), mat);
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
  };
  add(gBack, mats.wallBackMat);
  add(gSolid, mats.wallSolidMat);
  add(gTop, mats.floorMat);
  add(gEdge, mats.edgeMat);
  return group;
}

export function makeLevelMaterials(tex, theme) {
  const std = (t, extra = {}) => new THREE.MeshStandardMaterial({
    map: t.map, normalMap: t.normalMap, aoMap: t.orm, roughnessMap: t.orm, metalnessMap: t.orm,
    roughness: 1, metalness: 1, vertexColors: true, ...extra,
  });
  const palace = theme === 'palace';
  const mats = {
    wallBackMat: std(tex.wallBack, { normalScale: new THREE.Vector2(1, 1) }),
    wallSolidMat: std(tex.wallSolid),
    floorMat: std(tex.floorTop, { envMapIntensity: palace ? 1.0 : 0.4 }),
    edgeMat: std(tex.edge),
    metal: new THREE.MeshStandardMaterial({
      map: tex.metal.map, normalMap: tex.metal.normalMap, roughnessMap: tex.metal.orm, metalnessMap: tex.metal.orm,
      roughness: 1, metalness: 1, color: 0xb8b0a8, envMapIntensity: 1.2,
    }),
    wood: new THREE.MeshStandardMaterial({ map: tex.wood.map, normalMap: tex.wood.normalMap, roughness: 0.8 }),
    stoneTrim: new THREE.MeshStandardMaterial({
      color: palace ? 0xd8c4a0 : 0x77736c, roughness: palace ? 0.55 : 0.9,
      normalMap: tex.floorTop.normalMap, normalScale: new THREE.Vector2(0.6, 0.6),
    }),
    plate: new THREE.MeshStandardMaterial({
      color: palace ? 0xcdb89a : 0x6d6862, roughness: 0.7, normalMap: tex.floorTop.normalMap,
    }),
  };
  // los objetos sueltos (losas) no usan colores por vértice salvo los de la geometría propia
  mats.slabTop = mats.floorMat;
  mats.slabEdge = mats.edgeMat;
  return mats;
}
