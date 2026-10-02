// Base de los personajes: posición, física sobre la rejilla, salientes y presentación visual.
import { TW, RH, SLAB, HEADROOM, BODY_HALF, HANG_OFF, MAX_FALL } from '../core/config.js';
import { Character } from './rig.js';
import { Animator } from './anims.js';
import { clamp } from '../core/utils.js';
import { SwordTrail } from '../fx/trail.js';
import * as THREE from 'three';
import { getGlowTexture } from '../world/props.js';

let blobMat = null;
function blobMaterial() {
  if (!blobMat) blobMat = new THREE.MeshBasicMaterial({ map: getGlowTexture(), color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false });
  return blobMat;
}

export const BASE_YAW = 1.2;   // perfil 3/4: girado ~69º hacia el lado, un poco hacia la cámara

export class Actor {
  constructor(game, kind, opts = {}) {
    this.game = game;
    this.kind = kind;
    this.char = new Character(kind, { ...opts, quality: game.app?.settings?.quality });
    this.anim = new Animator();
    this.x = 0; this.y = 0; this.z = 0; this.vx = 0; this.vy = 0;
    this.face = 1;
    this.alive = true; this.onGround = true;
    this.hp = opts.hp ?? 3; this.maxHp = this.hp;
    this.state = 'stand'; this.st = 0;
    this.visFace = 1; this.turnFrom = 1; this.turnT = 1; this.turnDur = 0.25;
    this.yawOverride = null;
    this.anchorY = null; this.anchorW = 0;
    this.renderOff = { x: 0, y: 0 };
    this.flash = 0;
    this.half = BODY_HALF;
    this.startY = 0;          // altura desde la que empezó a caer
    this.airType = 'fall';
    this.visible = true;
    game.scene.add(this.char.root);
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.75), blobMaterial().clone());
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.renderOrder = 1;
    game.scene.add(this.blob);
  }
  get level() { return this.game.level; }
  height() { return 1.72; }
  airHeight() { return 1.5; }
  row() { return this.level.rowOfFeet(this.y); }
  col() { return this.level.colOf(this.x); }
  feetFloorY() { return this.level.floorY(this.row()); }

  setState(s) { this.prevState = this.state; this.state = s; this.st = 0; }
  play(name, opts) { this.anim.play(name, opts); }

  // giro con media vuelta pasando de frente a la cámara
  turnTo(f, dur = 0.24) {
    if (f === this.face) return false;
    this.turnFrom = this.visFace; this.face = f; this.turnT = 0; this.turnDur = dur;
    return true;
  }
  snapFace(f) { this.face = f; this.visFace = f; this.turnT = 1; }

  // ---------------------------------------------------------------- consultas de suelo
  supported(x = this.x) {
    return this.level.hasFloor(this.level.colOf(x), this.row());
  }
  // distancia hasta el borde (fin del suelo) en la dirección d; Infinity si no lo hay cerca
  edgeAhead(d, maxDist = 3) {
    const lv = this.level, r = this.row();
    let c = lv.colOf(this.x);
    for (let i = 0; i < 4; i++) {
      const bx = d > 0 ? (c + 1) * TW : c * TW;
      const dist = (bx - this.x) * d;
      if (dist > maxDist) return Infinity;
      const nc = c + d;
      if (lv.isSolid(nc, r)) return Infinity;
      if (!lv.hasFloor(nc, r)) return dist;
      c = nc;
    }
    return Infinity;
  }

  moveGround(dx, opts) {
    const want = this.x + dx;
    const nx = this.level.limitX(this.x, want, this.row(), this.half, opts);
    this.x = nx;
    return Math.abs(nx - want) > 1e-5;
  }

  // ---------------------------------------------------------------- física aérea
  // devuelve { landed, row, hitWall }
  airStep(dt, grav, opts = {}) {
    const lv = this.level;
    const res = { landed: false, row: -1, hitWall: false, ceiling: false };
    const prevY = this.y;
    this.vy = Math.max(-MAX_FALL, this.vy - grav * dt);
    let ny = this.y + this.vy * dt;
    const h = this.airHeight();
    // techo
    if (this.vy > 0) {
      const r = lv.rowOfFeet(this.y);
      const c = lv.colOf(this.x);
      const ceil = lv.floorY(r) + HEADROOM;
      if ((lv.hasFloor(c, r - 1) || lv.isSolid(c, r - 1) || r - 1 < 0) && ny + h > ceil) {
        ny = Math.min(ny, ceil - h);
        if (this.vy > 0.5) res.ceiling = { c, r };
        this.vy = Math.min(this.vy, 0);
      }
    }
    this.y = ny;
    // horizontal
    if (this.vx !== 0) {
      const d = this.vx > 0 ? 1 : -1;
      const want = this.x + this.vx * dt;
      let lim = want;
      const rTop = lv.rowOfFeet(this.y + h), rBot = lv.rowOfFeet(this.y + 0.1);
      for (let rr = rTop; rr <= rBot; rr++) {
        lim = d > 0 ? Math.min(lim, lv.limitX(this.x, lim, rr, this.half, opts)) : Math.max(lim, lv.limitX(this.x, lim, rr, this.half, opts));
      }
      // lateral de una losa (al quedarse corto en un salto)
      const c0 = lv.colOf(this.x), cA = lv.colOf(lim + d * this.half);
      if (cA !== c0) {
        for (let rr = rTop - 1; rr <= rBot + 1; rr++) {
          if (!lv.hasFloor(cA, rr) || lv.isSolid(cA, rr)) continue;
          const top = lv.floorY(rr), bot = top - SLAB;
          if (this.y + 0.03 < top && this.y + h - 0.1 > bot) {
            // pequeño escalón: subir si los pies están casi a la altura del suelo
            if (top - this.y < 0.2 && this.vy <= 0.5) { this.y = top; this.vy = 0; res.landed = true; res.row = rr; continue; }
            const wx = d > 0 ? cA * TW - this.half : (cA + 1) * TW + this.half;
            lim = d > 0 ? Math.min(lim, wx) : Math.max(lim, wx);
          }
        }
      }
      if (Math.abs(lim - want) > 1e-5) res.hitWall = true;
      this.x = lim;
    }
    if (res.landed) return res;
    // aterrizaje
    if (this.vy <= 0) {
      const c = lv.colOf(this.x);
      const r0 = lv.rowOfFeet(prevY + 0.06), r1 = lv.rowOfFeet(this.y);
      for (let r = r0; r <= r1; r++) {
        const fy = lv.floorY(r);
        if (prevY >= fy - 0.02 && this.y <= fy + 1e-4 && lv.hasFloor(c, r)) {
          this.y = fy; this.vy = 0; res.landed = true; res.row = r;
          break;
        }
      }
    }
    return res;
  }

  // ---------------------------------------------------------------- salientes
  findLedge({ dirs, xReach = 0.6, yMin = 1.1, yMax = 2.35, from = this.y }) {
    const lv = this.level;
    let best = null;
    const rA = lv.rowOfFeet(from + yMax + 0.1), rB = lv.rowOfFeet(from + yMin - 0.1);
    for (const d of dirs) {
      const k0 = Math.floor((this.x - xReach - HANG_OFF) / TW), k1 = Math.ceil((this.x + xReach + HANG_OFF) / TW);
      for (let k = k0; k <= k1; k++) {
        const bx = k * TW;
        const cL = d > 0 ? k : k - 1;
        const cO = d > 0 ? k - 1 : k;
        const hangX = bx - d * HANG_OFF;
        const dx = Math.abs(hangX - this.x);
        if (dx > xReach) continue;
        for (let r = Math.max(0, rA); r <= rB; r++) {
          const ly = lv.floorY(r);
          const rel = ly - from;
          if (rel < yMin || rel > yMax) continue;
          if (!lv.hasFloor(cL, r) || lv.isSolid(cL, r)) continue;
          if (!lv.isOpen(cO, r)) continue;
          if (lv.isSolid(cO, r + 1)) continue;
          const g = lv.gateAt(cL, r);
          void g;
          const score = dx + (d === this.face ? 0 : 0.6) + Math.abs(rel - 2.0) * 0.1;
          if (!best || score < best.score) best = { bx, d, cL, cO, r, y: ly, hangX, score };
        }
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- presentación
  updateVisual(dt) {
    let flip = this.face, yaw = this.baseYaw ?? BASE_YAW;
    if (this.turnT < 1) {
      this.turnT = Math.min(1, this.turnT + dt / this.turnDur);
      const k = this.turnT;
      const e = k < 0.5 ? 1 - k * 2 : k * 2 - 1;
      yaw = (this.baseYaw ?? BASE_YAW) * e * e * (3 - 2 * e);
      flip = k < 0.5 ? this.turnFrom : this.face;
    }
    this.visFace = this.turnT >= 0.5 ? this.face : this.turnFrom;
    if (this.yawOverride !== null) { yaw = this.yawOverride; }
    this.char.setFacing(flip, yaw);
    const pose = this.anim.update(dt);
    this.char.root.position.set(this.x + this.renderOff.x, this.y + this.renderOff.y, this.z);
    this.char.applyPose(pose);
    if (this.anchorY !== null && this.anchorW > 0) this.char.anchorHands(this.anchorY, this.anchorW);
    this.char.updateChains(dt);
    if (this.char.sword) {
      const sw = this.isSwinging ? this.isSwinging() : false;
      if (sw && !this.trail) this.trail = new SwordTrail(this.game.scene, this.kind === 'shadow' ? 0xb080ff : this.isPlayer ? 0xd8e6ff : 0xffd6a8);
      if (this.trail) this.trail.update(this.char.sword, sw);
    }
    if (this.flash > 0) { this.flash = Math.max(0, this.flash - dt * 2.5); this.char.setFlash(this.flash); }
    this.char.root.visible = this.visible;
    this.updateBlob();
  }

  // sombra de contacto: mancha oscura en el suelo que hay bajo el personaje
  updateBlob() {
    const b = this.blob, lv = this.level;
    if (!lv || !this.visible) { b.visible = false; return; }
    const c = lv.colOf(this.x);
    let fy = null;
    const base = this.anchorW > 0 ? this.y : this.y + this.renderOff.y;
    const top = base + 0.3;
    for (let r = lv.rowOfFeet(top); r <= lv.rows; r++) {
      if (lv.hasFloor(c, r) && lv.floorY(r) <= top) { fy = lv.floorY(r); break; }
    }
    if (fy === null) { b.visible = false; return; }
    const h = Math.max(0, base - fy);
    const k = Math.max(0, 1 - h / 2.6);
    b.visible = k > 0.02;
    b.position.set(this.x, fy + 0.012, this.z + 0.05);
    const s = (this.alive ? 1 : 1.6) * (0.7 + k * 0.3);
    b.scale.set(s * (this.kind === 'fat' ? 1.3 : 1), s, 1);
    b.material.opacity = (this.game.app.quality.shadows ? 0.32 : 0.55) * k;
  }

  flashHit(c = [1, 0.15, 0.1]) {
    this.flash = 1;
    this.char.uni.flashColor.value.setRGB(c[0], c[1], c[2]);
  }

  dispose() {
    this.trail?.dispose();
    this.blob.removeFromParent(); this.blob.geometry.dispose(); this.blob.material.dispose();
    this.char.root.removeFromParent();
    this.char.dispose();
  }
}

export { clamp };
