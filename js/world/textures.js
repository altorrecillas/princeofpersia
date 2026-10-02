// Fábrica de texturas procedurales (albedo + normal + ORM) generadas en canvas.
// Todo se crea en tiempo de carga: no hay imágenes externas.
import * as THREE from 'three';
import { TileNoise, mulberry32, clamp, smooth } from '../core/utils.js';

const cache = new Map();

class Tex {
  constructor(w, h) {
    this.w = w; this.h = h;
    const n = w * h;
    this.H = new Float32Array(n);
    this.R = new Float32Array(n); this.G = new Float32Array(n); this.B = new Float32Array(n);
    this.rough = new Float32Array(n).fill(0.85);
    this.metal = new Float32Array(n);
    this.aoExtra = new Float32Array(n).fill(1);
  }
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Máscara dibujada con la API 2D (grietas, motivos...). Devuelve Float32 0..1
function drawMask(w, h, fn) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  fn(ctx, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const m = new Float32Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4] / 255;
  return m;
}

function drawRGB(w, h, fn) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  fn(ctx, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[y * w + ((k + w) % w)];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc * inv;
      acc += src[y * w + ((x + r + 1) % w)] - src[y * w + ((x - r + w) % w)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[((k + h) % h) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc * inv;
      acc += tmp[((y + r + 1) % h) * w + x] - tmp[((y - r + h) % h) * w + x];
    }
  }
  return out;
}

function finalize(t, { normal = 3, cavity = 1.2, wrap = true, anisotropy = 8 } = {}) {
  const { w, h } = t;
  const n = w * h;
  const blur = boxBlur(t.H, w, h, Math.max(2, Math.round(w / 90)));
  const cA = canvas(w, h), cN = canvas(w, h), cO = canvas(w, h);
  const iA = cA.getContext('2d').createImageData(w, h);
  const iN = cN.getContext('2d').createImageData(w, h);
  const iO = cO.getContext('2d').createImageData(w, h);
  const A = iA.data, N = iN.data, O = iO.data;
  const s = normal * (w / 512);
  for (let y = 0; y < h; y++) {
    const yu = (y - 1 + h) % h, yd = (y + 1) % h;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const xl = (x - 1 + w) % w, xr = (x + 1) % w;
      const dx = (t.H[y * w + xr] - t.H[y * w + xl]) * s;
      const dy = (t.H[yd * w + x] - t.H[yu * w + x]) * s;
      let nx = -dx, ny = dy, nz = 1;
      const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= l; ny *= l; nz *= l;
      const cav = clamp(1 - Math.max(0, blur[i] - t.H[i]) * cavity * 2.2, 0.25, 1) * t.aoExtra[i];
      const k = i * 4;
      A[k] = clamp(t.R[i] * (0.55 + 0.45 * cav), 0, 1) * 255;
      A[k + 1] = clamp(t.G[i] * (0.55 + 0.45 * cav), 0, 1) * 255;
      A[k + 2] = clamp(t.B[i] * (0.55 + 0.45 * cav), 0, 1) * 255;
      A[k + 3] = 255;
      N[k] = (nx * 0.5 + 0.5) * 255; N[k + 1] = (ny * 0.5 + 0.5) * 255; N[k + 2] = (nz * 0.5 + 0.5) * 255; N[k + 3] = 255;
      O[k] = cav * 255; O[k + 1] = clamp(t.rough[i], 0.04, 1) * 255; O[k + 2] = clamp(t.metal[i], 0, 1) * 255; O[k + 3] = 255;
    }
  }
  cA.getContext('2d').putImageData(iA, 0, 0);
  cN.getContext('2d').putImageData(iN, 0, 0);
  cO.getContext('2d').putImageData(iO, 0, 0);
  const mk = (c, srgb) => {
    const tx = new THREE.CanvasTexture(c);
    tx.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tx.wrapS = tx.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    tx.anisotropy = anisotropy;
    tx.generateMipmaps = true;
    tx.minFilter = THREE.LinearMipmapLinearFilter;
    return tx;
  };
  return { map: mk(cA, true), normalMap: mk(cN, false), orm: mk(cO, false) };
}

// ---------------------------------------------------------------- ladrillos genéricos
// Genera hiladas de bloques que encajan sin costura. Devuelve info por píxel.
function brickField(t, opts) {
  const {
    worldW, worldH, courses, minW, maxW, mortar = 0.012, bevel = 0.035, seed = 1,
    erosion = 0.02, vStart = 0, vEnd = 1, vary = 0,
  } = opts;
  const { w, h } = t;
  const rng = mulberry32(seed);
  const rows = [];
  // alturas de hilada (opcionalmente irregulares)
  const ch = [];
  for (let c = 0; c < courses; c++) ch.push(1 + (rng() - 0.5) * vary);
  const chSum = ch.reduce((a, b) => a + b, 0);
  const cStart = [];
  { let a = 0; for (let c = 0; c < courses; c++) { cStart.push(a / chSum); a += ch[c]; } cStart.push(1); }
  for (let c = 0; c < courses; c++) {
    const widths = [];
    let sum = 0;
    while (sum < worldW) { const bw = minW + rng() * (maxW - minW); widths.push(bw); sum += bw; }
    const sc = worldW / sum;
    const starts = []; let acc = 0;
    const bricks = [];
    for (const bw of widths) {
      starts.push(acc / worldW);
      bricks.push({ w: bw * sc, tint: rng(), tint2: rng(), hoff: rng(), seed: rng() * 1000, rough: rng(), crack: rng() });
      acc += bw * sc;
    }
    rows.push({ off: rng(), starts, bricks });
  }
  const id = new Int32Array(w * h).fill(-1);
  const edge = new Float32Array(w * h);
  const info = [];
  rows.forEach((r, ci) => r.bricks.forEach((b, bi) => { b.course = ci; b.idx = info.length; info.push(b); }));
  const noise = new TileNoise(seed * 7 + 3);
  for (let y = 0; y < h; y++) {
    const v = 1 - (y + 0.5) / h; // v=1 arriba
    if (v < vStart || v >= vEnd) continue;
    const vn = (v - vStart) / (vEnd - vStart);
    let ci = courses - 1;
    for (let k = 0; k < courses; k++) if (vn < cStart[k + 1]) { ci = k; break; }
    const fy = (vn - cStart[ci]) / (cStart[ci + 1] - cStart[ci]);
    const courseH = worldH * (vEnd - vStart) * (cStart[ci + 1] - cStart[ci]);
    const row = rows[ci];
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      let uu = u - row.off; uu -= Math.floor(uu);
      let bi = row.starts.length - 1;
      for (let k = 1; k < row.starts.length; k++) if (uu < row.starts[k]) { bi = k - 1; break; }
      const b = row.bricks[bi];
      const s0 = row.starts[bi];
      const bwU = b.w / worldW;
      const fx = (uu - s0) / bwU;
      const dx = Math.min(fx, 1 - fx) * b.w;
      const dy = Math.min(fy, 1 - fy) * courseH;
      const er = (noise.fbm(u, v, 12, 3) - 0.5) * erosion * 2 + (noise.fbm(u, v, 48, 2) - 0.5) * erosion;
      const ex = clamp((dx - mortar + er) / bevel, 0, 1);
      const ey = clamp((dy - mortar + er) / bevel, 0, 1);
      const e = smooth(ex) * smooth(ey);
      const i = y * w + x;
      id[i] = b.idx;
      edge[i] = e;
    }
  }
  return { id, edge, info, noise };
}

// ---------------------------------------------------------------- MAZMORRA
function genDungeonWall(size, seed, solid) {
  const t = new Tex(size, size);
  const { id, edge, info, noise } = brickField(t, {
    worldW: 2.4, worldH: 2.6, courses: solid ? 5 : 6, minW: 0.45, maxW: 1.15, seed, mortar: 0.02, bevel: 0.08, erosion: 0.055, vary: 0.6,
  });
  const n2 = new TileNoise(seed + 11);
  const cracks = drawMask(size, size, (ctx, w, h) => {
    const r = mulberry32(seed + 5);
    ctx.strokeStyle = '#fff';
    for (let k = 0; k < 14; k++) {
      let x = r() * w, y = r() * h;
      ctx.lineWidth = 0.6 + r() * 1.4;
      ctx.beginPath(); ctx.moveTo(x, y);
      const ang = r() * Math.PI * 2;
      for (let s = 0; s < 8; s++) {
        x += Math.cos(ang + (r() - 0.5) * 1.6) * w * 0.018;
        y += Math.sin(ang + (r() - 0.5) * 1.6) * h * 0.018;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
  for (let y = 0; y < size; y++) {
    const v = 1 - (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const i = y * size + x;
      const b = info[id[i]];
      const e = edge[i];
      const det = noise.fbm(u, v, 32, 4);
      const big = n2.fbm(u, v, 3, 3);
      const damp = clamp((big - 0.45) * 2.5, 0, 1);
      // altura
      let hh = e * (0.7 + 0.18 * b.hoff) + det * 0.22 * e + (noise.fbm(u, v, 96, 2) - 0.5) * 0.08;
      hh -= cracks[i] * 0.35 * e;
      t.H[i] = hh;
      // color: piedra gris azulada con variaciones cálidas
      const tone = 0.9 + b.tint * 0.16;
      const warm = (b.tint2 - 0.5) * 0.1;
      let r = 0.50 * tone + warm, g = 0.48 * tone + warm * 0.55, bl = 0.45 * tone - warm * 0.1;
      const big2 = noise.fbm(u + b.seed, v, 6, 3);
      const spots = 0.72 + det * 0.38 + (noise.fbm(u, v, 64, 2) - 0.5) * 0.22 + (big2 - 0.5) * 0.3;
      r *= spots; g *= spots; bl *= spots;
      // mortero
      const m = 1 - e;
      r = r * e + 0.27 * m; g = g * e + 0.26 * m; bl = bl * e + 0.24 * m;
      // humedad y verdín
      const moss = damp * clamp(m * 1.5 + (1 - v) * 0.4 - 0.2, 0, 1) * (solid ? 0.6 : 1);
      r *= 1 - damp * 0.28; g *= 1 - damp * 0.18; bl *= 1 - damp * 0.25;
      r = r * (1 - moss * 0.5) + 0.16 * moss * 0.5; g = g * (1 - moss * 0.5) + 0.24 * moss * 0.5; bl = bl * (1 - moss * 0.5) + 0.12 * moss * 0.5;
      // manchas de hollín en la parte alta
      const soot = clamp((v - 0.7) * 2.2, 0, 1) * clamp(big * 1.4 - 0.3, 0, 1) * (solid ? 0.3 : 0.55);
      r *= 1 - soot * 0.5; g *= 1 - soot * 0.5; bl *= 1 - soot * 0.48;
      r *= 1 - cracks[i] * 0.5; g *= 1 - cracks[i] * 0.5; bl *= 1 - cracks[i] * 0.5;
      t.R[i] = r; t.G[i] = g; t.B[i] = bl;
      t.rough[i] = 0.82 + 0.15 * (1 - e) - damp * 0.25 + b.rough * 0.05;
    }
  }
  return finalize(t, { normal: 9, cavity: 1.6 });
}

function genDungeonFloor(size, seed) {
  const t = new Tex(size, size);
  // vista superior: losas grandes (u = x/2.4, v = z/2.4)
  const { id, edge, info, noise } = brickField(t, {
    worldW: 2.4, worldH: 2.4, courses: 4, minW: 0.5, maxW: 1.1, seed, mortar: 0.012, bevel: 0.06, erosion: 0.04,
  });
  const n2 = new TileNoise(seed + 21);
  for (let y = 0; y < size; y++) {
    const v = 1 - (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const i = y * size + x;
      const b = info[id[i]];
      const e = edge[i];
      const det = noise.fbm(u, v, 24, 4);
      const wear = n2.fbm(u, v, 4, 3);
      t.H[i] = e * (0.75 + b.hoff * 0.1) + det * 0.18 * e;
      const tone = 0.74 + b.tint * 0.3;
      let r = 0.39 * tone, g = 0.37 * tone, bl = 0.35 * tone;
      const sp = 0.85 + det * 0.3;
      r *= sp; g *= sp; bl *= sp;
      const m = 1 - e;
      r = r * e + 0.13 * m; g = g * e + 0.12 * m; bl = bl * e + 0.11 * m;
      const dirt = clamp((wear - 0.5) * 2, 0, 1);
      r *= 1 - dirt * 0.3; g *= 1 - dirt * 0.32; bl *= 1 - dirt * 0.35;
      t.R[i] = r; t.G[i] = g; t.B[i] = bl;
      t.rough[i] = 0.7 + 0.2 * m + dirt * 0.1 - (1 - wear) * 0.12;
    }
  }
  return finalize(t, { normal: 6, cavity: 1.3 });
}

// borde frontal de los suelos (u = x/2.4, v = 0..1 sobre el grosor)
function genEdge(w, h, seed, palace) {
  const t = new Tex(w, h);
  const noise = new TileNoise(seed);
  const rng = mulberry32(seed + 3);
  // 2 hiladas: moldura superior + bloques
  const joints = [];
  let acc = rng() * 0.2;
  while (acc < 1) { joints.push(acc); acc += 0.2 + rng() * 0.18; }
  for (let y = 0; y < h; y++) {
    const v = 1 - (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const i = y * w + x;
      const det = noise.fbm(u, v * 0.25, 24, 4);
      let hh, r, g, b;
      // moldura: v en [0.78, 1]
      if (v > 0.78) {
        const k = (v - 0.78) / 0.22;
        const prof = Math.sin(k * Math.PI) * 0.9 + 0.1;
        hh = 0.6 + prof * 0.4 + det * 0.08;
        const tone = palace ? [0.86, 0.76, 0.58] : [0.47, 0.46, 0.46];
        r = tone[0] * (0.9 + det * 0.2); g = tone[1] * (0.9 + det * 0.2); b = tone[2] * (0.9 + det * 0.2);
        if (Math.abs(v - 0.78) < 0.02) { hh = 0.2; r *= 0.5; g *= 0.5; b *= 0.5; }
      } else {
        let dj = 1;
        for (const j of joints) { const d = Math.abs(u - j); dj = Math.min(dj, d, 1 - d); }
        const djm = dj * 2.4;
        const ev = Math.min(v, 0.78 - v) * 0.42;
        const e = smooth(clamp((djm - 0.01) / 0.04, 0, 1)) * smooth(clamp((ev - 0.006) / 0.025, 0, 1));
        hh = e * 0.7 + det * 0.2 * e;
        const tone = palace ? [0.80, 0.68, 0.52] : [0.38, 0.37, 0.37];
        const sp = 0.8 + det * 0.35;
        r = tone[0] * sp * e + 0.15 * (1 - e); g = tone[1] * sp * e + 0.14 * (1 - e); b = tone[2] * sp * e + 0.13 * (1 - e);
        // sombra inferior
        const sh = 0.55 + 0.45 * clamp(v / 0.5, 0, 1);
        r *= sh; g *= sh; b *= sh;
      }
      t.H[i] = hh; t.R[i] = r; t.G[i] = g; t.B[i] = b;
      t.rough[i] = palace ? 0.55 : 0.85;
    }
  }
  return finalize(t, { normal: 5, cavity: 1.0 });
}

// ---------------------------------------------------------------- PALACIO
function zelligeMask(size, seed) {
  // motivo de estrellas de 8 puntas: devuelve RGB
  return drawRGB(size, size, (ctx, w, h) => {
    ctx.fillStyle = '#e9e1cf'; ctx.fillRect(0, 0, w, h);
    const n = 8, cs = w / n;
    for (let j = -1; j <= n; j++) for (let i = -1; i <= n; i++) {
      const cx = (i + 0.5) * cs, cy = (j + 0.5) * cs;
      const star = (r, rot, col) => {
        ctx.fillStyle = col; ctx.beginPath();
        for (let k = 0; k < 16; k++) {
          const a = rot + k * Math.PI / 8;
          const rr = k % 2 === 0 ? r : r * 0.62;
          const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath(); ctx.fill();
      };
      star(cs * 0.47, Math.PI / 8, '#1d5d78');
      star(cs * 0.34, Math.PI / 8, '#2f8fa6');
      star(cs * 0.17, 0, '#d9b45a');
      // pequeñas cruces entre estrellas
      ctx.fillStyle = '#123f57';
      ctx.save(); ctx.translate(cx + cs / 2, cy + cs / 2); ctx.rotate(Math.PI / 4);
      ctx.fillRect(-cs * 0.11, -cs * 0.11, cs * 0.22, cs * 0.22); ctx.restore();
    }
    ctx.strokeStyle = '#2a2219'; ctx.lineWidth = Math.max(1, w / 400);
    for (let j = -1; j <= n; j++) for (let i = -1; i <= n; i++) {
      const cx = (i + 0.5) * cs, cy = (j + 0.5) * cs;
      ctx.beginPath();
      for (let k = 0; k < 16; k++) {
        const a = Math.PI / 8 + k * Math.PI / 8;
        const rr = k % 2 === 0 ? cs * 0.47 : cs * 0.47 * 0.62;
        const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.stroke();
    }
  });
}

function genPalaceWall(size, seed, solid) {
  const t = new Tex(size, size);
  // sillares grandes arriba; zócalo de azulejos abajo (sólo en la pared del fondo)
  const floorV = 0.42 / 2.6;               // altura del suelo dentro de la fila
  const dadoTop = floorV + 1.05 / 2.6;     // zócalo de ~1 m
  const { id, edge, info, noise } = brickField(t, {
    worldW: 2.4, worldH: 2.6, courses: 6, minW: 0.7, maxW: 1.25, seed, mortar: 0.006, bevel: 0.03, erosion: 0.008,
  });
  const zel = solid ? null : zelligeMask(size, seed);
  const n2 = new TileNoise(seed + 9);
  for (let y = 0; y < size; y++) {
    const v = 1 - (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const i = y * size + x;
      const det = noise.fbm(u, v, 20, 4);
      const big = n2.fbm(u, v, 3, 3);
      let r, g, b, hh, ro;
      const inDado = !solid && v > floorV && v < dadoTop;
      if (inDado) {
        // azulejos: escala x2 dentro de la banda
        const uz = (u * 2.4 / 1.05) % 1, vz = (v - floorV) / (dadoTop - floorV);
        const zx = Math.floor(uz * size) % size, zy = Math.floor((1 - vz) * size * 0.999);
        const k = (zy * size + zx) * 4;
        r = zel[k] / 255; g = zel[k + 1] / 255; b = zel[k + 2] / 255;
        const lum = (r + g + b) / 3;
        hh = lum < 0.2 ? 0.3 : 0.9 + det * 0.04;
        ro = 0.22 + det * 0.1;
        // remates del zócalo
        const tb = Math.min(v - floorV, dadoTop - v);
        if (tb < 0.018) { r = 0.55; g = 0.42; b = 0.22; hh = 1.0; ro = 0.35; t.metal[i] = 0.5; }
      } else {
        const bI = info[id[i]];
        const e = edge[i];
        hh = e * 0.6 + det * 0.12;
        const tone = 0.86 + bI.tint * 0.18;
        r = 0.80 * tone; g = 0.69 * tone; b = 0.53 * tone;
        const sp = 0.9 + det * 0.2;
        r *= sp; g *= sp; b *= sp;
        const m = 1 - e;
        r = r * e + 0.48 * m; g = g * e + 0.40 * m; b = b * e + 0.30 * m;
        const stain = clamp((big - 0.55) * 2, 0, 1) * 0.25;
        r *= 1 - stain; g *= 1 - stain; b *= 1 - stain * 1.1;
        ro = 0.7 + m * 0.2;
        // friso pintado bajo el techo
        if (!solid && v > 0.9 && v < 0.96) {
          const f = Math.sin(u * Math.PI * 2 * 24) * 0.5 + 0.5;
          r = 0.55 + f * 0.25; g = 0.36 + f * 0.2; b = 0.2 + f * 0.1; hh = 0.5 + f * 0.3; ro = 0.5;
        }
      }
      t.H[i] = hh; t.R[i] = r; t.G[i] = g; t.B[i] = b; t.rough[i] = ro;
    }
  }
  return finalize(t, { normal: 6, cavity: 1.0 });
}

function genPalaceFloor(size, seed) {
  const t = new Tex(size, size);
  const noise = new TileNoise(seed);
  const n2 = new TileNoise(seed + 4);
  const tiles = 4; // 0.6 m por baldosa sobre 2.4 m
  for (let y = 0; y < size; y++) {
    const v = 1 - (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const i = y * size + x;
      const tu = u * tiles, tv = v * tiles;
      const ix = Math.floor(tu), iy = Math.floor(tv);
      const fx = tu - ix, fy = tv - iy;
      const d = Math.min(fx, 1 - fx, fy, 1 - fy) * 0.6;
      const e = smooth(clamp((d - 0.004) / 0.012, 0, 1));
      const checker = (ix + iy) % 2;
      // vetas del mármol
      const vn = n2.fbm(u + ix * 0.13, v + iy * 0.29, 6, 5);
      const vein = Math.pow(1 - Math.abs(Math.sin((u * 7 + v * 3 + vn * 4) * Math.PI)), 12);
      // rombo central
      const cx = fx - 0.5, cy = fy - 0.5;
      const dia = Math.abs(cx) + Math.abs(cy);
      let r, g, b;
      if (checker) { r = 0.86; g = 0.83; b = 0.76; } else { r = 0.22; g = 0.33; b = 0.40; }
      if (dia < 0.16) { if (checker) { r = 0.25; g = 0.42; b = 0.48; } else { r = 0.82; g = 0.66; b = 0.36; } }
      const vv = vein * 0.35;
      r = r * (1 - vv) + (checker ? 0.55 : 0.75) * vv; g = g * (1 - vv) + (checker ? 0.52 : 0.78) * vv; b = b * (1 - vv) + (checker ? 0.48 : 0.8) * vv;
      const det = noise.fbm(u, v, 32, 3);
      r *= 0.94 + det * 0.12; g *= 0.94 + det * 0.12; b *= 0.94 + det * 0.12;
      const m = 1 - e;
      r = r * e + 0.45 * m; g = g * e + 0.36 * m; b = b * e + 0.2 * m;
      t.H[i] = e * 0.8 + (dia < 0.16 && Math.abs(dia - 0.16) < 0.012 ? -0.2 : 0);
      t.R[i] = r; t.G[i] = g; t.B[i] = b;
      t.rough[i] = 0.16 + det * 0.12 + m * 0.4;
      t.metal[i] = m * 0.6;
    }
  }
  return finalize(t, { normal: 1.6, cavity: 0.6 });
}

// ---------------------------------------------------------------- materiales pequeños
function genMetal(size, seed) {
  const t = new Tex(size, size);
  const noise = new TileNoise(seed);
  const n2 = new TileNoise(seed + 2);
  for (let y = 0; y < size; y++) {
    const v = 1 - (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const i = y * size + x;
      const rust = clamp((n2.fbm(u, v, 5, 4) - 0.48) * 3, 0, 1);
      const det = noise.fbm(u, v, 40, 3);
      const scratch = Math.pow(Math.abs(Math.sin((u * 60 + det * 3) * 3.1)), 40) * 0.3;
      t.H[i] = det * 0.3 + rust * 0.25;
      const base = 0.2 + det * 0.08 + scratch;
      t.R[i] = base * (1 - rust) + 0.36 * rust; t.G[i] = base * (1 - rust) + 0.18 * rust; t.B[i] = base * 1.05 * (1 - rust) + 0.09 * rust;
      t.rough[i] = 0.45 + rust * 0.45 + det * 0.1;
      t.metal[i] = 0.85 * (1 - rust);
    }
  }
  return finalize(t, { normal: 1.5, cavity: 0.5 });
}

function genWood(size, seed) {
  const t = new Tex(size, size);
  const noise = new TileNoise(seed);
  const planks = 5;
  for (let y = 0; y < size; y++) {
    const v = 1 - (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const i = y * size + x;
      const p = Math.floor(u * planks);
      const fx = u * planks - p;
      const e = smooth(clamp(Math.min(fx, 1 - fx) / 0.05, 0, 1));
      const grain = noise.fbm(u * 0.3 + p * 0.37, v * 3, 8, 4);
      const ring = Math.sin((grain * 9 + u * 40) * Math.PI) * 0.5 + 0.5;
      t.H[i] = e * 0.7 + ring * 0.1;
      const tone = 0.8 + (p * 0.37 % 1) * 0.3;
      t.R[i] = (0.36 + ring * 0.08) * tone * (0.4 + 0.6 * e); t.G[i] = (0.22 + ring * 0.05) * tone * (0.4 + 0.6 * e); t.B[i] = (0.12 + ring * 0.03) * tone * (0.4 + 0.6 * e);
      t.rough[i] = 0.7;
    }
  }
  return finalize(t, { normal: 1.8, cavity: 0.8 });
}

function genCarpet(w, h, seed) {
  const rgb = drawRGB(w, h, (ctx) => {
    const R = mulberry32(seed);
    ctx.fillStyle = '#6e1016'; ctx.fillRect(0, 0, w, h);
    const bw = h * 0.16;
    ctx.fillStyle = '#1f2a4d'; ctx.fillRect(0, 0, w, bw); ctx.fillRect(0, h - bw, w, bw);
    ctx.fillStyle = '#c99a3c'; ctx.fillRect(0, bw - 3, w, 3); ctx.fillRect(0, h - bw, w, 3);
    // motivos de la cenefa
    for (let x = 0; x < w; x += bw) {
      ctx.fillStyle = '#c99a3c';
      ctx.beginPath(); ctx.moveTo(x + bw / 2, bw * 0.2); ctx.lineTo(x + bw * 0.8, bw / 2); ctx.lineTo(x + bw / 2, bw * 0.8); ctx.lineTo(x + bw * 0.2, bw / 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + bw / 2, h - bw * 0.8); ctx.lineTo(x + bw * 0.8, h - bw / 2); ctx.lineTo(x + bw / 2, h - bw * 0.2); ctx.lineTo(x + bw * 0.2, h - bw / 2); ctx.fill();
    }
    // medallones
    const n = 4;
    for (let k = 0; k < n; k++) {
      const cx = (k + 0.5) * w / n, cy = h / 2;
      for (let r = h * 0.28, c = 0; r > 4; r -= h * 0.06, c++) {
        ctx.fillStyle = ['#d8b45c', '#1f3d6b', '#a8242c', '#efe2c0', '#2b5b45'][c % 5];
        ctx.beginPath();
        for (let a = 0; a < 16; a++) {
          const ang = a / 16 * Math.PI * 2;
          const rr = r * (a % 2 ? 0.75 : 1);
          ctx.lineTo(cx + Math.cos(ang) * rr * 1.4, cy + Math.sin(ang) * rr);
        }
        ctx.fill();
      }
    }
    // ruido de lana
    const img = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const f = 0.85 + R() * 0.25;
      img.data[i] *= f; img.data[i + 1] *= f; img.data[i + 2] *= f;
    }
    ctx.putImageData(img, 0, 0);
  });
  const t = new Tex(w, h);
  for (let i = 0; i < w * h; i++) {
    t.R[i] = rgb[i * 4] / 255; t.G[i] = rgb[i * 4 + 1] / 255; t.B[i] = rgb[i * 4 + 2] / 255;
    t.H[i] = ((i * 7919) % 13) / 13 * 0.3 + 0.5;
    t.rough[i] = 0.95;
  }
  return finalize(t, { normal: 0.8, cavity: 0.2, wrap: true });
}

function genSky(w, h) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#060b1f'); g.addColorStop(0.55, '#14224a'); g.addColorStop(1, '#3a3f6b');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const r = mulberry32(77);
  for (let i = 0; i < 260; i++) {
    const x = r() * w, y = r() * h * 0.8, s = r() * 1.3 + 0.2;
    ctx.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.7})`;
    ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
  }
  // luna
  const mx = w * 0.72, my = h * 0.28, mr = h * 0.11;
  const mg = ctx.createRadialGradient(mx, my, mr * 0.2, mx, my, mr * 3);
  mg.addColorStop(0, 'rgba(255,250,225,0.5)'); mg.addColorStop(1, 'rgba(255,250,225,0)');
  ctx.fillStyle = mg; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fbf3d8'; ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#0b1430'; ctx.beginPath(); ctx.arc(mx + mr * 0.45, my - mr * 0.15, mr * 0.95, 0, Math.PI * 2); ctx.fill();
  // siluetas de cúpulas y minaretes
  ctx.fillStyle = '#05070f';
  const base = h * 0.82;
  ctx.fillRect(0, base, w, h - base);
  const dome = (x, rw, rh) => { ctx.beginPath(); ctx.ellipse(x, base, rw, rh, 0, Math.PI, 0); ctx.fill(); ctx.fillRect(x - 1, base - rh - 10, 2, 10); };
  dome(w * 0.15, 40, 46); dome(w * 0.42, 70, 80); dome(w * 0.85, 34, 40);
  ctx.fillRect(w * 0.28, base - 120, 10, 120); ctx.beginPath(); ctx.arc(w * 0.28 + 5, base - 120, 9, Math.PI, 0); ctx.fill();
  ctx.fillRect(w * 0.6, base - 95, 9, 95); ctx.beginPath(); ctx.arc(w * 0.6 + 4.5, base - 95, 8, Math.PI, 0); ctx.fill();
  const tx = new THREE.CanvasTexture(c);
  tx.colorSpace = THREE.SRGBColorSpace;
  return tx;
}

// tela: normal map pequeño con trama para la ropa
function genFabric(size) {
  const t = new Tex(size, size);
  const noise = new TileNoise(5);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const u = x / size, v = y / size;
    const wv = (Math.sin(u * Math.PI * 2 * 48) * Math.sin(v * Math.PI * 2 * 48));
    t.H[i] = wv * 0.25 + noise.fbm(u, v, 16, 3) * 0.4;
    t.R[i] = t.G[i] = t.B[i] = 0.9 + noise.fbm(u, v, 8, 3) * 0.1;
    t.rough[i] = 0.9;
  }
  return finalize(t, { normal: 1.2, cavity: 0.3 });
}

// ---------------------------------------------------------------- API
export function getTextures(theme, size) {
  const key = theme + size;
  if (cache.has(key)) return cache.get(key);
  const small = Math.max(256, size / 2);
  let set;
  if (theme === 'palace') {
    set = {
      wallBack: genPalaceWall(size, 31, false),
      wallSolid: genPalaceWall(size, 37, true),
      floorTop: genPalaceFloor(size, 41),
      edge: genEdge(size, size / 4, 43, true),
      metal: genMetal(small, 47),
      wood: genWood(small, 53),
      carpet: genCarpet(size, size / 2, 59),
      sky: genSky(1024, 512),
    };
  } else {
    set = {
      wallBack: genDungeonWall(size, 11, false),
      wallSolid: genDungeonWall(size, 13, true),
      floorTop: genDungeonFloor(size, 17),
      edge: genEdge(size, size / 4, 19, false),
      metal: genMetal(small, 23),
      wood: genWood(small, 29),
    };
  }
  cache.set(key, set);
  return set;
}

let fabricTex = null;
export function getFabric() {
  if (!fabricTex) fabricTex = genFabric(256);
  return fabricTex;
}
