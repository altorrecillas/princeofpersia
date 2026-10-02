// Arquitectura procedural: pilastras, arcos, cornisas, zócalos, vigas, bordes de losa biselados,
// columnas en primer plano (profundidad) y reflejos de las llamas en el mármol del palacio.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TW, RH, SLAB, ZB, ZF, HEADROOM } from '../core/config.js';
import { hash2 } from '../core/utils.js';
import { makeGlow } from './props.js';

function clean(g) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
  return n;
}
function box(w, h, d, x, y, z) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return clean(g); }

export function buildArchitecture(level) {
  const lv = level, g = lv.group, palace = lv.palace;
  const stone = [], trim = [], wood = [], gold = [], lips = [], recess = [];
  const busy = new Set();
  for (const t of lv.torches) busy.add(t.c + ',' + t.r);
  for (const l of lv.lamps) busy.add(l.c + ',' + l.r);
  for (const d of lv.decor) if (d.kind === 'w' || d.kind === 'a' || d.kind === 'b') busy.add(d.c + ',' + d.r);
  for (const d of lv.doors) busy.add(d.c + ',' + d.r);
  const open = (c, r) => !lv.isSolidStatic(c, r);
  const corridor = (c, r) => open(c, r) && (lv.hasSlabStatic(c, r) || lv.type(c, r) === 'loose');
  const ceilingAt = (c, r) => r === 0 || lv.isSolidStatic(c, r - 1) || lv.hasSlabStatic(c, r - 1) || lv.type(c, r - 1) === 'loose';

  for (let r = 0; r < lv.rows; r++) {
    const yf = lv.floorY(r), top = yf + HEADROOM;
    // ------------------------------------------------ pilastras (cada 3 baldosas) + arcos entre ellas
    const pil = [];
    for (let k = 1; k < lv.cols; k++) {
      if (k % 3 !== 0) continue;
      if (!corridor(k - 1, r) || !corridor(k, r)) continue;
      if (busy.has((k - 1) + ',' + r) && busy.has(k + ',' + r)) continue;
      pil.push(k);
      const x = k * TW;
      const w = palace ? 0.3 : 0.36;
      stone.push(box(w, HEADROOM, 0.16, x, yf + HEADROOM / 2, ZB + 0.08));
      trim.push(box(w + 0.1, 0.16, 0.24, x, yf + 0.08, ZB + 0.12));
      trim.push(box(w + 0.12, 0.12, 0.26, x, yf + 1.12, ZB + 0.13));
      trim.push(box(w + 0.06, 0.05, 0.22, x, yf + 1.03, ZB + 0.11));
      if (palace) gold.push(box(w + 0.02, 0.03, 0.2, x, yf + 0.98, ZB + 0.11));
      // viga de madera en el techo de las mazmorras
      if (!palace && ceilingAt(k, r) && ceilingAt(k - 1, r)) {
        wood.push(box(0.24, 0.22, ZF - ZB - 0.05, x, top - 0.11, (ZF + ZB) / 2));
        wood.push(box(0.3, 0.08, 0.3, x, top - 0.26, ZB + 0.2));
      }
    }
    // arcos entre pilastras consecutivas a 3 baldosas
    for (let i = 0; i + 1 < pil.length; i++) {
      const a = pil[i], b = pil[i + 1];
      if (b - a !== 3) continue;
      let blocked = false;
      for (let c = a; c < b; c++) if (!corridor(c, r) || !ceilingAt(c, r)) blocked = true;
      if (blocked) continue;
      const x0 = a * TW + 0.18, x1 = b * TW - 0.18, cx = (x0 + x1) / 2, half = (x1 - x0) / 2;
      const spring = yf + 1.18, apex = top - 0.06;
      const rise = apex - spring;
      const shape = new THREE.Shape();
      const t = 0.18;
      if (palace) {
        // arco apuntado persa
        shape.moveTo(-half, 0);
        shape.quadraticCurveTo(-half, rise * 0.75, 0, rise);
        shape.quadraticCurveTo(half, rise * 0.75, half, 0);
        shape.lineTo(half - t, 0);
        shape.quadraticCurveTo(half - t, rise * 0.7, 0, rise - t * 1.1);
        shape.quadraticCurveTo(-half + t, rise * 0.7, -half + t, 0);
      } else {
        // arco rebajado (segmental) de mazmorra que cabe bajo el techo
        const Ro = (half * half + rise * rise) / (2 * rise), cyo = rise - Ro;
        const ao = Math.atan2(-cyo, half);
        shape.moveTo(-half, 0);
        shape.absarc(0, cyo, Ro, Math.PI - ao, ao, true);
        const hi = half - t, ri = rise - t;
        const Ri = (hi * hi + ri * ri) / (2 * ri), cyi = ri - Ri;
        const ai = Math.atan2(-cyi, hi);
        shape.lineTo(hi, 0);
        shape.absarc(0, cyi, Ri, ai, Math.PI - ai, false);
        shape.lineTo(-half, 0);
      }
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 1, curveSegments: 14 });
      geo.translate(cx, spring, ZB + 0.01);
      trim.push(clean(geo));
      // panel rehundido bajo el arco (más oscuro)
      const inner = new THREE.Shape();
      if (palace) {
        inner.moveTo(-half + t, -1.2);
        inner.lineTo(-half + t, 0);
        inner.quadraticCurveTo(-half + t, rise * 0.7, 0, rise - t * 1.1);
        inner.quadraticCurveTo(half - t, rise * 0.7, half - t, 0);
        inner.lineTo(half - t, -1.2);
      } else {
        const hi = half - t, ri = rise - t;
        const Ri = (hi * hi + ri * ri) / (2 * ri), cyi = ri - Ri;
        const ai = Math.atan2(-cyi, hi);
        inner.moveTo(-hi, -1.2);
        inner.lineTo(-hi, 0);
        inner.absarc(0, cyi, Ri, Math.PI - ai, ai, true);
        inner.lineTo(hi, -1.2);
      }
      const ig = new THREE.ShapeGeometry(inner, 12);
      ig.translate(cx, spring, ZB + 0.004);
      recess.push(clean(ig));
    }
    // ------------------------------------------------ cornisa, zócalo y labio biselado del suelo
    let runStart = -1;
    for (let c = 0; c <= lv.cols; c++) {
      const ok = c < lv.cols && corridor(c, r);
      if (ok && runStart < 0) runStart = c;
      if (!ok && runStart >= 0) {
        const x0 = runStart * TW, x1 = c * TW, w = x1 - x0, xm = (x0 + x1) / 2;
        trim.push(box(w, 0.1, 0.07, xm, yf + 0.05, ZB + 0.035));
        trim.push(box(w, 0.03, 0.1, xm, yf + 0.115, ZB + 0.05));
        let ceil = true;
        for (let k = runStart; k < c; k++) if (!ceilingAt(k, r)) ceil = false;
        if (ceil) {
          trim.push(box(w, 0.16, 0.1, xm, top - 0.08, ZB + 0.05));
          trim.push(box(w, 0.04, 0.16, xm, top - 0.18, ZB + 0.08));
        }
        runStart = -1;
      }
    }
    // labio redondeado en el borde delantero de cada tramo de suelo
    let ls = -1;
    for (let c = 0; c <= lv.cols; c++) {
      const ok = c < lv.cols && lv.hasSlabStatic(c, r);
      if (ok && ls < 0) ls = c;
      if (!ok && ls >= 0) {
        const x0 = ls * TW, x1 = c * TW;
        const cyl = new THREE.CylinderGeometry(0.055, 0.055, x1 - x0, 10, 1);
        cyl.rotateZ(Math.PI / 2);
        cyl.translate((x0 + x1) / 2, yf - 0.05, ZF - 0.03);
        lips.push(clean(cyl));
        ls = -1;
      }
    }
  }

  const mk = (geos, mat) => {
    if (!geos.length) return;
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.receiveShadow = true;
    m.castShadow = false;
    g.add(m);
  };
  const stoneMat = palace
    ? new THREE.MeshStandardMaterial({ color: 0xd9c7a6, roughness: 0.6, normalMap: lv.tex.wallSolid.normalMap, normalScale: new THREE.Vector2(0.35, 0.35) })
    : new THREE.MeshStandardMaterial({ map: lv.tex.wallSolid.map, normalMap: lv.tex.wallSolid.normalMap, roughness: 0.92, color: 0xb0a99f });
  mk(stone, stoneMat);
  mk(trim, lv.mats.stoneTrim);
  mk(wood, lv.mats.wood);
  mk(gold, new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 1, roughness: 0.32 }));
  mk(lips, lv.mats.stoneTrim);
  if (recess.length) {
    const m = new THREE.Mesh(mergeGeometries(recess), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: palace ? 0.18 : 0.32, depthWrite: false }));
    m.renderOrder = 1;
    g.add(m);
  }

  // ------------------------------------------------ columnas en primer plano (profundidad y paralaje)
  lv.fgColumns = [];
  const colMat = new THREE.MeshStandardMaterial({
    color: palace ? 0x5a4a3a : 0x24211f, roughness: 0.85, normalMap: lv.tex.wallSolid.normalMap,
    transparent: true, opacity: 1,
  });
  const H = (lv.rows + 4) * RH;
  const prof = [];
  const R = palace ? 0.32 : 0.4;
  const pts = [[R + 0.12, 0], [R + 0.12, 0.25], [R, 0.4], [R * 0.94, H * 0.5], [R, H - 0.4], [R + 0.12, H - 0.25], [R + 0.12, H]];
  for (const [rr, y] of pts) prof.push(new THREE.Vector2(rr, y));
  const colGeo = new THREE.LatheGeometry(prof, palace ? 20 : 12);
  for (let c = 6; c < lv.cols - 3; c += 11) {
    const cc = c + Math.floor(hash2(c, 3, 9) * 3);
    const x = cc * TW;
    const m = new THREE.Mesh(colGeo, colMat.clone());
    m.position.set(x, -2 * RH, 2.6);
    m.renderOrder = 10;
    g.add(m);
    lv.fgColumns.push({ mesh: m, x, op: 1 });
  }

  // ------------------------------------------------ reflejos de llamas en el mármol pulido (palacio)
  if (palace) {
    for (const s of lv.lightSources) {
      const r = lv.rowOfFeet(s.pos.y - 1.0);
      const fy = lv.floorY(r);
      if (!lv.hasSlabStatic(lv.colOf(s.pos.x), r)) continue;
      const refl = makeGlow(new THREE.Color(1.0, 0.6, 0.3), 1, 0.22);
      refl.scale.set(0.7, 1.9, 1);
      refl.rotation.x = -Math.PI / 2;
      refl.position.set(s.pos.x, fy + 0.008, ZB + 1.0);
      g.add(refl);
    }
  }
}

// actualización: las columnas de primer plano se aclaran cuando tapan al príncipe
export function updateArchitecture(level, game, dt) {
  const p = game.player;
  if (!level.fgColumns || !p) return;
  const cam = game.camera.position;
  for (const f of level.fgColumns) {
    // posición del príncipe proyectada en el plano de la columna
    const px = cam.x + (p.x - cam.x) * ((cam.z - f.mesh.position.z) / cam.z);
    const near = Math.abs(px - f.x) < 0.9;
    f.op += ((near ? 0.22 : 1) - f.op) * Math.min(1, dt * 6);
    f.mesh.material.opacity = f.op;
    f.mesh.material.depthWrite = f.op > 0.95;
  }
}
