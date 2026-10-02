// Decoración procedural extra: telarañas, grietas, rejillas con haces de luz, cadenas y objetos por el suelo.
import * as THREE from 'three';
import { TW, RH, SLAB, ZB, ZF, HEADROOM } from '../core/config.js';
import { hash2, mulberry32 } from '../core/utils.js';
import * as P from './props.js';

let webTex = null, crackTex = null, plaqueTex = null;

function webTexture() {
  if (webTex) return webTex;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(235,235,240,0.55)'; ctx.lineWidth = 1.2;
  const r = mulberry32(3);
  // telaraña anclada en la esquina superior izquierda
  const rays = 9;
  const ang = [];
  for (let i = 0; i < rays; i++) ang.push((i / (rays - 1)) * Math.PI / 2 + (r() - 0.5) * 0.08);
  for (const a of ang) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 250, Math.sin(a) * 250); ctx.stroke(); }
  for (let k = 1; k < 9; k++) {
    const rad = k * 27 + r() * 6;
    ctx.beginPath();
    for (let i = 0; i < rays; i++) {
      const a = ang[i];
      const sag = i > 0 ? 4 : 0;
      const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(x, y); else {
        const pa = ang[i - 1];
        ctx.quadraticCurveTo(Math.cos((a + pa) / 2) * (rad - sag), Math.sin((a + pa) / 2) * (rad - sag), x, y);
      }
    }
    ctx.stroke();
  }
  webTex = new THREE.CanvasTexture(c); webTex.colorSpace = THREE.SRGBColorSpace;
  return webTex;
}

function crackTexture() {
  if (crackTex) return crackTex;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const r = mulberry32(8);
  const branch = (x, y, a, len, w) => {
    if (len < 6 || w < 0.4) return;
    ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x, y);
    let cx = x, cy = y;
    for (let i = 0; i < 6; i++) { a += (r() - 0.5) * 0.8; cx += Math.cos(a) * len / 6; cy += Math.sin(a) * len / 6; ctx.lineTo(cx, cy); }
    ctx.stroke();
    if (r() < 0.7) branch(cx, cy, a + (r() - 0.5) * 1.6, len * 0.6, w * 0.7);
    if (r() < 0.5) branch(cx, cy, a + (r() - 0.5) * 1.6, len * 0.5, w * 0.6);
  };
  ctx.strokeStyle = 'rgba(10,8,8,0.85)';
  for (let k = 0; k < 3; k++) branch(128 + (r() - 0.5) * 40, 20 + r() * 40, Math.PI / 2 + (r() - 0.5), 120, 2.6);
  // mancha de humedad
  const g = ctx.createRadialGradient(128, 160, 10, 128, 160, 120);
  g.addColorStop(0, 'rgba(20,30,20,0.35)'); g.addColorStop(1, 'rgba(20,30,20,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  crackTex = new THREE.CanvasTexture(c); crackTex.colorSpace = THREE.SRGBColorSpace;
  return crackTex;
}

function plaqueTexture() {
  if (plaqueTex) return plaqueTex;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.translate(128, 128);
  for (let k = 0; k < 3; k++) {
    ctx.fillStyle = ['#c9a14a', '#1f4f6a', '#e8dcc0'][k];
    ctx.beginPath();
    const R = 110 - k * 30;
    for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8; const rr = i % 2 ? R * 0.72 : R; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = '#7a1018'; ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill();
  plaqueTex = new THREE.CanvasTexture(c); plaqueTex.colorSpace = THREE.SRGBColorSpace;
  return plaqueTex;
}

export function autoDecorate(level) {
  const lv = level, g = lv.group, palace = lv.palace;
  const used = new Set();
  for (const d of lv.decor) used.add(d.c + ',' + d.r);
  for (const t of lv.torches) used.add(t.c + ',' + t.r);
  for (const l of lv.lamps) used.add(l.c + ',' + l.r);
  const webMat = new THREE.MeshBasicMaterial({ map: webTexture(), transparent: true, depthWrite: false, opacity: 0.55, side: THREE.DoubleSide });
  const crackMat = new THREE.MeshBasicMaterial({ map: crackTexture(), transparent: true, depthWrite: false, opacity: 0.8 });
  const plaqueMat = new THREE.MeshStandardMaterial({ map: plaqueTexture(), transparent: true, roughness: 0.4, metalness: 0.3 });
  let lastShaft = -99;
  for (let r = 0; r < lv.rows; r++) {
    for (let c = 0; c < lv.cols; c++) {
      if (lv.isSolidStatic(c, r)) continue;
      const k = c + ',' + r;
      const x = lv.cx(c), yf = lv.floorY(r), top = lv.floorY(r) + HEADROOM;
      const ceil = r === 0 || lv.isSolidStatic(c, r - 1) || lv.hasSlabStatic(c, r - 1);
      const floor = lv.hasSlabStatic(c, r) || lv.type(c, r) === 'loose';
      const h = (s) => hash2(c, r, s);
      // telarañas en las esquinas del techo junto a un muro
      if (!palace && ceil) {
        for (const side of [-1, 1]) {
          if (lv.isSolidStatic(c + side, r) && h(11 + side) < 0.45) {
            const s = 0.9 + h(13) * 0.7;
            const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), webMat);
            m.position.set(x + side * (TW / 2 - s / 2), top - s / 2, ZB + 0.25 + h(17) * 2.2);
            if (side > 0) m.scale.x = -1;
            m.renderOrder = 2;
            g.add(m);
          }
        }
        if (h(19) < 0.18) {
          const s = 0.8 + h(21) * 0.5;
          const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), webMat);
          m.position.set(x + (h(23) - 0.5) * 0.6, top - s / 2 + 0.02, ZB + 0.02);
          m.scale.x = h(25) < 0.5 ? 1 : -1;
          g.add(m);
        }
      }
      if (used.has(k)) continue;
      // grietas y manchas en la pared del fondo
      if (!palace && h(31) < 0.16) {
        const s = 1.0 + h(33) * 0.9;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s * 1.2), crackMat);
        m.position.set(x + (h(35) - 0.5) * 0.5, yf + 0.6 + h(37) * 1.0, ZB + 0.012);
        m.rotation.z = (h(39) - 0.5) * 0.6;
        g.add(m);
      }
      // medallones de azulejo en el palacio
      if (palace && h(41) < 0.1 && floor) {
        const m = new THREE.Mesh(new THREE.CircleGeometry(0.32, 24), plaqueMat);
        m.position.set(x, yf + 1.55, ZB + 0.015);
        g.add(m);
        used.add(k);
        continue;
      }
      // rejilla en el techo con un haz de luz fría
      if (!palace && ceil && floor && r > 0 && lv.isSolidStatic(c, r - 1) && c - lastShaft > 7 && h(51) < 0.16) {
        lastShaft = c;
        const grate = new THREE.Group();
        const frame = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.62), lv.mats.metal);
        grate.add(frame);
        for (let i = -2; i <= 2; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.6), lv.mats.metal); b.position.x = i * 0.12; grate.add(b); }
        const hole = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.56), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.65, 0.9) }));
        hole.rotation.x = Math.PI / 2; hole.position.y = 0.035;
        grate.add(hole);
        grate.position.set(x, top - 0.02, -0.35);
        g.add(grate);
        const shaft = P.makeLightShaft(0x9fb6ff, HEADROOM + 0.1, 0.9);
        shaft.position.set(x, top, -0.35);
        shaft.rotation.z = 0.12;
        g.add(shaft);
        lv.shafts.push(shaft);
        const pool = P.makeGlow(new THREE.Color(0.55, 0.65, 1.0), 1.6, 0.22);
        pool.rotation.x = -Math.PI / 2; pool.position.set(x + 0.2, yf + 0.01, -0.3);
        g.add(pool);
        used.add(k);
        continue;
      }
      // objetos por el suelo junto a la pared
      if (floor && h(61) < (palace ? 0.08 : 0.12) && lv.type(c, r) !== 'spikes' && lv.type(c, r) !== 'chopper' && lv.type(c, r) !== 'loose' && lv.type(c, r) !== 'gate') {
        if (palace) {
          const v = P.makeVase(c * 13 + r);
          v.position.set(x + (h(63) - 0.5) * 0.5, yf, ZB + 0.35);
          g.add(v);
        } else if (h(65) < 0.5) {
          const b = P.makeBones(lv.mats);
          b.scale.setScalar(0.8); b.position.set(x + (h(67) - 0.5) * 0.4, yf, ZB + 0.55); b.rotation.y = h(69) * 6;
          g.add(b);
        } else {
          lv.addRubble(c, r, c * 31 + r * 3);
          lv.rubbles[lv.rubbles.length - 1].mesh.scale.set(0.6, 0.6, 0.35);
          lv.rubbles[lv.rubbles.length - 1].mesh.position.z = ZB + 0.6;
        }
        used.add(k);
        continue;
      }
      // cadenas colgando del techo
      if (!palace && ceil && h(71) < 0.06) {
        const ch = P.makeChains(lv.mats);
        ch.position.set(x, top - 0.05, -0.9 + h(73) * 0.5);
        ch.scale.setScalar(0.9);
        g.add(ch);
        used.add(k);
      }
    }
  }
}
