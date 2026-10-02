// Esculpido procedural: campos de distancia (SDF) con mezclas suaves -> malla por marching cubes
// (vértices compartidos y normales del gradiente) -> pesos de piel para animarla con huesos.
import * as THREE from 'three';
import { edgeTable, triTable } from 'three/addons/objects/MarchingCubes.js';

// ------------------------------------------------------------------ primitivas
const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);

// cono redondeado entre a y b con radios ra/rb (capsula si son iguales)
export function roundCone(a, b, ra, rb) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  return (x, y, z) => {
    const pax = x - a[0], pay = y - a[1], paz = z - a[2];
    let h = (pax * bax + pay * bay + paz * baz) / l2;
    h = h < 0 ? 0 : h > 1 ? 1 : h;
    const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * h);
  };
}
export function sphere(c, r) {
  return (x, y, z) => len3(x - c[0], y - c[1], z - c[2]) - r;
}
// elipsoide (aproximación de Inigo Quilez)
export function ellipsoid(c, r) {
  return (x, y, z) => {
    const px = (x - c[0]) / r[0], py = (y - c[1]) / r[1], pz = (z - c[2]) / r[2];
    const k0 = len3(px, py, pz);
    const k1 = len3(px / r[0], py / r[1], pz / r[2]);
    return k1 < 1e-9 ? -Math.min(r[0], r[1], r[2]) : k0 * (k0 - 1) / k1;
  };
}
export function roundBox(c, h, rad, rot) {
  // rot: ángulo opcional alrededor de y
  const cs = rot ? Math.cos(rot) : 1, sn = rot ? Math.sin(rot) : 0;
  return (x, y, z) => {
    let px = x - c[0], py = y - c[1], pz = z - c[2];
    if (rot) { const tx = px * cs - pz * sn; pz = px * sn + pz * cs; px = tx; }
    const qx = Math.abs(px) - h[0] + rad, qy = Math.abs(py) - h[1] + rad, qz = Math.abs(pz) - h[2] + rad;
    return len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - rad;
  };
}
// toro en el plano xz (anillo horizontal), escalado elíptico en x/z
export function torus(c, R, r, sx = 1, sz = 1) {
  return (x, y, z) => {
    const px = (x - c[0]) / sx, pz = (z - c[2]) / sz, py = y - c[1];
    const q = Math.sqrt(px * px + pz * pz) - R;
    return Math.sqrt(q * q + py * py) - r;
  };
}
export function plane(n, d) { // n·p + d (positivo fuera)
  return (x, y, z) => x * n[0] + y * n[1] + z * n[2] + d;
}

// ------------------------------------------------------------------ operaciones
export function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
export function smax(a, b, k) { return -smin(-a, -b, k); }

// Forma: lista de [op, sdf, k]. op: 'add' (unión suave), 'sub' (resta suave), 'and' (intersección)
export class Shape {
  constructor() { this.ops = []; this.disp = null; }
  add(f, k = 0) { this.ops.push([0, f, k]); return this; }
  sub(f, k = 0) { this.ops.push([1, f, k]); return this; }
  and(f, k = 0) { this.ops.push([2, f, k]); return this; }
  displace(fn) { this.disp = fn; return this; }
  eval(x, y, z) {
    let d = 1e9;
    const ops = this.ops;
    for (let i = 0; i < ops.length; i++) {
      const o = ops[i];
      const v = o[1](x, y, z);
      if (o[0] === 0) d = o[2] > 0 ? smin(d, v, o[2]) : (v < d ? v : d);
      else if (o[0] === 1) d = o[2] > 0 ? smax(d, -v, o[2]) : Math.max(d, -v);
      else d = o[2] > 0 ? smax(d, v, o[2]) : Math.max(d, v);
    }
    if (this.disp) d += this.disp(x, y, z);
    return d;
  }
  bounds() { return this._b; }
}

// ------------------------------------------------------------------ marching cubes con vértices compartidos
export function polygonize(shape, min, max, h, colorFn) {
  const nx = Math.ceil((max[0] - min[0]) / h) + 1, ny = Math.ceil((max[1] - min[1]) / h) + 1, nz = Math.ceil((max[2] - min[2]) / h) + 1;
  const field = new Float32Array(nx * ny * nz);
  const sx = 1, sy = nx, sz = nx * ny;
  for (let k = 0; k < nz; k++) {
    const z = min[2] + k * h;
    for (let j = 0; j < ny; j++) {
      const y = min[1] + j * h;
      let idx = k * sz + j * sy;
      for (let i = 0; i < nx; i++, idx++) field[idx] = shape.eval(min[0] + i * h, y, z);
    }
  }
  // bordes del volumen: forzar "fuera" para cerrar la malla
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) field[k * sz + j * sy + i] = Math.max(field[k * sz + j * sy + i], h * 0.5);
  }
  const pos = [], idxs = [];
  const edgeMap = new Map();
  const vert = (i, j, k, axis) => {
    const key = ((k * ny + j) * nx + i) * 3 + axis;
    let v = edgeMap.get(key);
    if (v !== undefined) return v;
    const a = field[k * sz + j * sy + i];
    const i2 = i + (axis === 0 ? 1 : 0), j2 = j + (axis === 1 ? 1 : 0), k2 = k + (axis === 2 ? 1 : 0);
    const b = field[k2 * sz + j2 * sy + i2];
    const t = Math.abs(a - b) < 1e-12 ? 0.5 : a / (a - b);
    pos.push(min[0] + (i + (axis === 0 ? t : 0)) * h, min[1] + (j + (axis === 1 ? t : 0)) * h, min[2] + (k + (axis === 2 ? t : 0)) * h);
    v = pos.length / 3 - 1;
    edgeMap.set(key, v);
    return v;
  };
  const ev = new Int32Array(12);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const q = k * sz + j * sy + i;
    const f0 = field[q], f1 = field[q + 1], f3 = field[q + sy], f2 = field[q + sy + 1];
    const f4 = field[q + sz], f5 = field[q + sz + 1], f7 = field[q + sz + sy], f6 = field[q + sz + sy + 1];
    let ci = 0;
    if (f0 < 0) ci |= 1; if (f1 < 0) ci |= 2; if (f2 < 0) ci |= 4; if (f3 < 0) ci |= 8;
    if (f4 < 0) ci |= 16; if (f5 < 0) ci |= 32; if (f6 < 0) ci |= 64; if (f7 < 0) ci |= 128;
    const bits = edgeTable[ci];
    if (bits === 0) continue;
    if (bits & 1) ev[0] = vert(i, j, k, 0);
    if (bits & 2) ev[1] = vert(i + 1, j, k, 1);
    if (bits & 4) ev[2] = vert(i, j + 1, k, 0);
    if (bits & 8) ev[3] = vert(i, j, k, 1);
    if (bits & 16) ev[4] = vert(i, j, k + 1, 0);
    if (bits & 32) ev[5] = vert(i + 1, j, k + 1, 1);
    if (bits & 64) ev[6] = vert(i, j + 1, k + 1, 0);
    if (bits & 128) ev[7] = vert(i, j, k + 1, 1);
    if (bits & 256) ev[8] = vert(i, j, k, 2);
    if (bits & 512) ev[9] = vert(i + 1, j, k, 2);
    if (bits & 1024) ev[10] = vert(i + 1, j + 1, k, 2);
    if (bits & 2048) ev[11] = vert(i, j + 1, k, 2);
    const o = ci << 4;
    for (let t = 0; triTable[o + t] !== -1; t += 3) idxs.push(ev[triTable[o + t]], ev[triTable[o + t + 1]], ev[triTable[o + t + 2]]);
  }
  // normales por gradiente del campo analítico
  const n = pos.length / 3;
  const nor = new Float32Array(n * 3);
  const e = h * 0.35;
  for (let v = 0; v < n; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    let gx = shape.eval(x + e, y, z) - shape.eval(x - e, y, z);
    let gy = shape.eval(x, y + e, z) - shape.eval(x, y - e, z);
    let gz = shape.eval(x, y, z + e) - shape.eval(x, y, z - e);
    const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    nor[v * 3] = gx / l; nor[v * 3 + 1] = gy / l; nor[v * 3 + 2] = gz / l;
  }
  // orientar los triángulos según el gradiente
  if (idxs.length) {
    let agree = 0;
    for (let t = 0; t < Math.min(idxs.length, 600); t += 3) {
      const a = idxs[t] * 3, b = idxs[t + 1] * 3, c = idxs[t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const wx = pos[c] - pos[a], wy = pos[c + 1] - pos[a + 1], wz = pos[c + 2] - pos[a + 2];
      const cx = uy * wz - uz * wy, cy = uz * wx - ux * wz, cz = ux * wy - uy * wx;
      agree += cx * nor[a] + cy * nor[a + 1] + cz * nor[a + 2] > 0 ? 1 : -1;
    }
    if (agree < 0) for (let t = 0; t < idxs.length; t += 3) { const tmp = idxs[t + 1]; idxs[t + 1] = idxs[t + 2]; idxs[t + 2] = tmp; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  // uv cilíndrica simple (para la trama de la tela)
  const uv = new Float32Array(n * 2);
  for (let v = 0; v < n; v++) { uv[v * 2] = Math.atan2(pos[v * 3], pos[v * 3 + 2]) / (Math.PI * 2) + 0.5; uv[v * 2 + 1] = pos[v * 3 + 1] * 2; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (colorFn) {
    const col = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) { const c = colorFn(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); col[v * 3] = c[0]; col[v * 3 + 1] = c[1]; col[v * 3 + 2] = c[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(idxs, 1) : new THREE.Uint16BufferAttribute(idxs, 1));
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------ pesos de piel
// bones: [{ index, a:[x,y,z], b:[x,y,z] }] segmentos de hueso en el espacio de la malla (pose de enlace)
export function skinWeights(geo, bones, power = 6, falloff = null) {
  const p = geo.attributes.position;
  const n = p.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const d = new Float32Array(bones.length);
  for (let v = 0; v < n; v++) {
    const x = p.getX(v), y = p.getY(v), z = p.getZ(v);
    for (let b = 0; b < bones.length; b++) {
      const B = bones[b];
      const bax = B.b[0] - B.a[0], bay = B.b[1] - B.a[1], baz = B.b[2] - B.a[2];
      const pax = x - B.a[0], pay = y - B.a[1], paz = z - B.a[2];
      const l2 = bax * bax + bay * bay + baz * baz || 1;
      let h = (pax * bax + pay * bay + paz * baz) / l2;
      h = h < 0 ? 0 : h > 1 ? 1 : h;
      let dist = len3(pax - bax * h, pay - bay * h, paz - baz * h);
      if (falloff) dist = falloff(b, dist, h, x, y, z);
      d[b] = dist;
    }
    // 4 huesos más cercanos
    const order = [...d.keys()].sort((a, b) => d[a] - d[b]).slice(0, 4);
    let tot = 0;
    const w = order.map((b) => { const ww = 1 / Math.pow(d[b] + 0.012, power); tot += ww; return ww; });
    for (let k = 0; k < 4; k++) {
      si[v * 4 + k] = order[k] !== undefined ? bones[order[k]].index : 0;
      sw[v * 4 + k] = order[k] !== undefined ? w[k] / tot : 0;
    }
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return geo;
}
