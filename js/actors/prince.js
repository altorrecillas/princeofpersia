// El príncipe: máquina de estados del jugador (movimiento clásico de Prince of Persia + esgrima).
import * as THREE from 'three';
import { TW, RH, HANG_REACH, HANG_OFF, RUN_SPEED } from '../core/config.js';
import { clamp, lerp, smooth, approach } from '../core/utils.js';
import { Actor } from './actor.js';
import { makePotion } from '../world/props.js';

const G_JUMP = 14, G_FALL = 19;
const SAFE_DROP = 3.25, HURT_DROP = 5.95;
const STEP_LEN = 0.42;
const CLIMB_DUR = 0.98;
const CLIMB_X = [[0, -HANG_OFF], [0.3, -0.25], [0.55, -0.04], [0.78, 0.2], [0.98, 0.36]];

function pathX(t) {
  for (let i = 0; i < CLIMB_X.length - 1; i++) {
    const [t0, x0] = CLIMB_X[i], [t1, x1] = CLIMB_X[i + 1];
    if (t <= t1) return lerp(x0, x1, smooth(clamp((t - t0) / (t1 - t0), 0, 1)));
  }
  return CLIMB_X[CLIMB_X.length - 1][1];
}

export class Prince extends Actor {
  constructor(game, opts = {}) {
    super(game, opts.shadow ? 'shadow' : 'prince', { hp: opts.hp ?? 3 });
    this.isPlayer = true;
    this.hasSword = false;
    this.inCombat = false;
    this.target = null;
    this.parrying = false;
    this.floatT = 0;
    this.sheathedByChoice = false;
    this.lastCol = -99; this.lastRow = -99;
    this.G = null;
    this.handPotion = null;
  }

  fwd(I) { return this.face > 0 ? I.state.right : I.state.left; }
  back(I) { return this.face > 0 ? I.state.left : I.state.right; }
  height() { return this.state === 'crouch' ? 1.1 : 1.72; }
  airHeight() { return this.state === 'jumpUp' ? 2.12 : 1.5; }

  spawn(x, y, face, hasSword) {
    this.x = x; this.y = y; this.vx = this.vy = 0;
    this.snapFace(face);
    this.alive = true; this.onGround = true;
    this.hasSword = !!hasSword;
    if (this.hasSword) { this.char.giveSword(); this.char.setSwordDrawn(false); }
    this.inCombat = false; this.parrying = false;
    this.anchorW = 0; this.anchorY = null; this.renderOff.x = this.renderOff.y = 0; this.z = 0;
    this.yawOverride = null; this.visible = true;
    this.setState('stand');
    this.play('idle', { blend: 0 });
  }

  // ====================================================================== bucle
  update(dt, I) {
    this.st += dt;
    if (this.floatT > 0) this.floatT -= dt;
    if (this.riposteT > 0) this.riposteT -= dt;
    if (!this.alive) { this.s_dead(dt); return; }
    this.checkCombat(I);
    const fn = this['s_' + this.state];
    if (fn) fn.call(this, dt, I);
    if (this.alive) this.postUpdate(dt);
  }

  idleClip() { return 'idle'; }
  isSwinging() { const t = this.st * (this.strikeSpeed || 1); return this.state === 'strike' && t > 0.11 && t < 0.34; }
  s_cutscene() { /* controlado por el guion */ }

  // ---------------------------------------------------------------------- de pie
  s_stand(dt, I) {
    this.onGround = true; this.vx = 0;
    if (!this.supported()) return this.startFall();
    this.play(this.idleClip(), { blend: 0.2 });
    const fwd = this.fwd(I), back = this.back(I);
    if (I.hit('up')) {
      I.consume('up');
      const door = this.game.exitDoorNear(this);
      if (door) return this.enterExit(door);
      if (fwd) return this.startLeap();
      return this.startJumpUp();
    }
    if (I.hit('jump')) {
      I.consume('jump');
      if (back && !fwd) { this.queueLeap = true; return this.startTurn(); }
      return this.startLeap();
    }
    if (I.hit('down') || I.state.down) {
      I.consume('down');
      const e = this.findClimbDownEdge();
      if (e) return this.startClimbDown(e);
      return this.startCrouch();
    }
    if (I.hit('action') && !fwd && !back) {
      const it = this.game.itemNear(this);
      if (it) { I.consume('action'); return this.startPickup(it); }
      if (this.hasSword && this.game.findFoe(this, 6)) { I.consume('action'); this.sheathedByChoice = false; return this.startDraw(); }
    }
    if (fwd) { if (I.state.action) return this.startStep(); return this.startRun(); }
    if (back) return this.startTurn();
  }

  // ---------------------------------------------------------------------- correr
  startRun() {
    this.setState('run');
    this.vx = this.face * Math.max(Math.abs(this.vx), 1.4);
    this.play('run', { blend: 0.16 });
    this.stepPhase = 0;
  }
  s_run(dt, I) {
    const d = this.face;
    if (this.autoRun > 0) this.autoRun -= dt;
    if (!this.fwd(I) && !(this.autoRun > 0)) return this.startSkid();
    if (this.back(I) && I.hit(this.face > 0 ? 'left' : 'right')) return this.startRunTurn();
    if (I.hit('jump') || I.hit('up')) {
      I.consume('jump'); I.consume('up');
      if (Math.abs(this.vx) > 2.4) return this.startRunLeap();
      return this.startLeap();
    }
    if (I.hit('down')) { I.consume('down'); return this.startCrouch(); }
    this.vx = approach(this.vx, d * RUN_SPEED, 13 * dt);
    this.anim.speed = clamp(Math.abs(this.vx) / RUN_SPEED, 0.55, 1.1);
    const blocked = this.moveGround(this.vx * dt);
    if (blocked) {
      if (Math.abs(this.vx) > 2.2) return this.startBump();
      this.vx = 0; this.setState('stand'); return;
    }
    if (!this.supported()) return this.startFall(true);
    // pasos
    const ph = (this.anim.t % 0.64) / 0.64;
    const half = ph < 0.5 ? 0 : 1;
    if (half !== this.stepPhase) { this.stepPhase = half; this.game.sfx('step', this); this.game.fx.dust(this.x - this.face * 0.15, this.y, 0.22); }
  }

  startSkid() {
    this.setState('skid');
    this.play('skid', { blend: 0.1, restart: true });
    this.game.sfx('skid', this);
  }
  s_skid(dt, I) {
    this.vx = approach(this.vx, 0, 13 * dt);
    if (this.moveGround(this.vx * dt)) this.vx = 0;
    if (!this.supported()) return this.startFall(true);
    if (I.hit('jump') && Math.abs(this.vx) > 2.4) { I.consume('jump'); return this.startRunLeap(); }
    if (this.st > 0.4 || Math.abs(this.vx) < 0.05 && this.st > 0.2) {
      this.vx = 0;
      if (this.fwd(I)) return this.startRun();
      this.setState('stand');
    }
  }

  startRunTurn() { this.setState('runTurn'); this.play('skid', { blend: 0.1, restart: true }); this.game.sfx('skid', this); this.turned = false; }
  s_runTurn(dt, I) {
    this.vx = approach(this.vx, 0, 15 * dt);
    if (this.moveGround(this.vx * dt)) this.vx = 0;
    if (!this.supported()) return this.startFall(true);
    if (!this.turned && (Math.abs(this.vx) < 0.4 || this.st > 0.32)) {
      this.turned = true; this.vx = 0; this.turnTo(-this.face, 0.24); this.play('turn', { restart: true }); this.tTurn = this.st;
    }
    if (this.turned && this.st - this.tTurn > 0.24) {
      if (this.fwd(I)) return this.startRun();
      this.setState('stand');
    }
  }

  startTurn() { this.turnTo(-this.face, 0.24); this.setState('turn'); this.play('turn', { restart: true, blend: 0.08 }); }
  s_turn(dt, I) {
    if (!this.supported()) return this.startFall();
    if (this.st >= 0.25) {
      if (this.queueLeap) { this.queueLeap = false; return this.startLeap(); }
      if (this.fwd(I)) { if (I.state.action) return this.startStep(); return this.startRun(); }
      this.setState('stand');
    }
  }

  // ---------------------------------------------------------------------- paso con cuidado
  startStep() {
    const d = this.face;
    const edge = this.edgeAhead(d, 1.2);
    const wallLim = this.level.limitX(this.x, this.x + d * STEP_LEN, this.row(), this.half);
    let dist = Math.min(STEP_LEN, Math.abs(wallLim - this.x));
    if (edge !== Infinity) dist = Math.min(dist, edge - 0.03);
    if (dist < 0.05) {
      if (edge !== Infinity && edge < 0.2) { this.setState('teeter'); this.play('teeter', { restart: true }); this.game.hint('edge'); return; }
      this.setState('stand'); return;
    }
    this.setState('step');
    this.stepFrom = this.x; this.stepTo = this.x + d * dist;
    this.play('step', { restart: true, blend: 0.08 });
  }
  s_step(dt) {
    const p = clamp(this.st / 0.55, 0, 1);
    this.x = lerp(this.stepFrom, this.stepTo, smooth(p));
    if (p > 0.45 && !this.stepSnd) { this.stepSnd = true; this.game.sfx('stepSoft', this); }
    if (p >= 1) { this.stepSnd = false; this.setState('stand'); }
  }
  s_teeter() { if (this.st > 0.8) this.setState('stand'); }

  // ---------------------------------------------------------------------- agacharse
  startCrouch() { this.setState('crouch'); this.play('crouchDown', { restart: true, blend: 0.08 }); }
  s_crouch(dt, I) {
    this.vx = approach(this.vx, 0, 10 * dt);
    if (this.vx) if (this.moveGround(this.vx * dt)) this.vx = 0;
    if (!this.supported()) return this.startFall();
    if (!I.state.down && this.st > 0.25) { this.setState('standUp'); this.play('standUp', { restart: true }); }
  }
  s_standUp() { if (this.st > 0.25) this.setState('stand'); }

  // ---------------------------------------------------------------------- bajar por un borde
  findClimbDownEdge() {
    const lv = this.level, r = this.row();
    for (const e of [-this.face, this.face]) {
      const dist = this.edgeAhead(e, 0.8);
      if (dist === Infinity || dist > 0.8) continue;
      const bx = this.x + e * dist;
      const cO = lv.colOf(bx + e * 0.01);
      if (!lv.isOpen(cO, r) || lv.isSolid(cO, r + 1)) continue;
      const ex = Math.round(bx / TW) * TW;
      return { bx: ex, d: -e, cL: cO - e, cO, r, y: lv.floorY(r), hangX: ex + e * HANG_OFF };
    }
    return null;
  }
  startClimbDown(G) {
    this.G = G;
    this.setState('climbDown');
    this.cdTurned = this.face !== G.d;
    if (this.cdTurned) this.turnTo(G.d, 0.22);
    this.cdFromX = this.x;
    this.play('idle', { blend: 0.1 });
  }
  s_climbDown(dt) {
    const G = this.G;
    const prep = 0.22;
    if (this.st < prep) {
      this.x = lerp(this.cdFromX, G.bx + G.d * 0.36, smooth(this.st / prep));
      return;
    }
    const t = CLIMB_DUR - (this.st - prep) * 1.25;
    if (this.anim.name !== 'climb') this.play('climb', { blend: 0.12, t: CLIMB_DUR });
    this.anim.setTime(Math.max(0, t));
    this.anim.speed = 0;
    this.applyClimb(Math.max(0, t));
    if (t <= 0) { this.anim.speed = 1; this.startHang(G); }
  }

  // ---------------------------------------------------------------------- saltar hacia arriba
  startJumpUp() {
    const G = this.findLedge({ dirs: [this.face, -this.face], xReach: 0.8, yMin: 2.2, yMax: 3.0 });
    this.G = G;
    if (G && G.d !== this.face) this.turnTo(G.d, 0.18);
    this.setState('jumpUp');
    this.launched = false;
    this.play('jumpUp', { restart: true, blend: 0.08 });
  }
  s_jumpUp(dt) {
    const G = this.G;
    if (!this.launched) {
      if (G) this.x = approach(this.x, G.hangX, 3.2 * dt);
      if (this.st >= 0.2) {
        this.launched = true; this.vy = 3.8; this.onGround = false; this.startY = this.y;
        this.game.sfx('jump', this);
      }
      return;
    }
    const res = this.airStep(dt, G_JUMP);
    if (G && this.y + HANG_REACH >= G.y - 0.03 && this.level.hasFloor(G.cL, G.r)) {
      this.y = G.y - HANG_REACH;
      return this.startHang(G);
    }
    if (res.ceiling) {
      this.level.bumpCeiling(res.ceiling.c, res.ceiling.r);
      this.game.sfx('bump', this); this.game.shake(0.12);
    }
    if (res.landed) { this.onGround = true; this.land(res.row, true); return; }
    if (this.st > 1.6) this.startFall();
  }

  // ---------------------------------------------------------------------- colgado
  startHang(G, fromAir) {
    this.G = G; this.setState('hang');
    this.snapFace(G.d);
    this.x = G.hangX; this.y = G.y - HANG_REACH; this.vx = this.vy = 0; this.onGround = false;
    this.renderOff.y = G.y - this.y;
    this.anchorY = 0.035; this.anchorW = 1;
    this.play('hang', { blend: fromAir ? 0.14 : 0.08 });
    this.game.sfx('grab', this);
    const l = this.level.looseAt(G.cL, G.r);
    if (l) l.touch(false);
  }
  s_hang(dt, I) {
    const G = this.G;
    this.renderOff.y = G.y - this.y;
    if (!this.level.hasFloor(G.cL, G.r)) return this.dropFromHang();
    if (I.hit('up') || I.hit('jump')) { I.consume('up'); I.consume('jump'); return this.startClimbUp(); }
    const backKey = this.face > 0 ? 'left' : 'right';
    if (I.hit('down') || I.hit(backKey) || (this.back(I) && this.st > 0.4)) { I.consume('down'); I.consume(backKey); return this.dropFromHang(); }
  }
  dropFromHang() {
    const G = this.G, lv = this.level;
    this.anchorW = 0; this.anchorY = null; this.renderOff.y = 0;
    // como en el original: si bajo el príncipe no hay suelo pero sí bajo el borde (columna de bordes
    // apilados), se suelta hacia dentro y aterriza sobre la baldosa de debajo del borde
    const under = !lv.hasFloor(G.cO, G.r + 1) && lv.hasFloor(G.cL, G.r + 1) && !lv.isSolid(G.cL, G.r + 1);
    if (!under) this.x -= G.d * 0.12;
    this.startFall(false);
    this.vx = under ? G.d * 3.0 : 0;
    this.noGrabT = 0.3;
  }

  startClimbUp() {
    this.setState('climbUp');
    this.play('climb', { restart: true, blend: 0.06 });
    this.game.sfx('climb', this);
  }
  applyClimb(t) {
    const G = this.G;
    this.x = G.bx + G.d * pathX(t);
    this.y = lerp(G.y - HANG_REACH, G.y, smooth(clamp(t / CLIMB_DUR, 0, 1)));
    this.renderOff.y = G.y - this.y;
    this.anchorY = 0.035;
    this.anchorW = t < 0.55 ? 1 : t < 0.8 ? 1 - smooth((t - 0.55) / 0.25) : 0;
  }
  s_climbUp(dt) {
    const t = Math.min(this.st, CLIMB_DUR);
    if (!this.level.hasFloor(this.G.cL, this.G.r) && t < 0.6) return this.dropFromHang();
    this.applyClimb(t);
    if (this.st >= CLIMB_DUR) {
      this.y = this.G.y; this.renderOff.y = 0; this.anchorW = 0; this.anchorY = null;
      this.onGround = true;
      this.level.stepOn(this.col(), this.row(), this, false);
      this.setState('stand');
    }
  }

  // ---------------------------------------------------------------------- saltos
  startLeap() {
    this.setState('leapPrep');
    this.play('leap', { restart: true, blend: 0.06 });
  }
  s_leapPrep(dt) {
    if (!this.supported()) return this.startFall();
    if (this.st >= 0.26) {
      this.vx = this.face * 4.9; this.vy = 3.9; this.onGround = false;
      this.airType = 'leap'; this.startY = this.y; this.setState('air');
      this.game.sfx('jump', this);
    }
  }
  startRunLeap() {
    this.vx = this.face * 6.2; this.vy = 4.4; this.onGround = false;
    this.airType = 'runleap'; this.startY = this.y; this.setState('air');
    this.play('runLeap', { restart: true, blend: 0.1 });
    this.game.sfx('jump', this);
  }
  startFall(fromRun) {
    this.airType = 'fall'; this.startY = this.y; this.vy = 0; this.onGround = false;
    // margen para saltar justo después de salir corriendo de un borde
    this.coyote = fromRun && Math.abs(this.vx) > 2.4 ? 0.13 : 0;
    this.coyoteVx = this.vx;
    this.vx *= fromRun ? 0.55 : 0.3;
    this.setState('air');
    this.play('fall', { blend: 0.22 });
  }

  // ¿la caída desde aquí sería dañina? (para el agarre automático)
  dangerousBelow() {
    const lv = this.level, c = this.col();
    for (let r = lv.rowOfFeet(this.y); r <= lv.rows; r++) {
      if (lv.hasFloor(c, r) && lv.floorY(r) <= this.y + 0.01) {
        return this.startY - lv.floorY(r) >= SAFE_DROP || !!lv.spikesAt(c, r);
      }
    }
    return true;
  }

  s_air(dt, I) {
    if (this.noGrabT > 0) this.noGrabT -= dt;
    if (this.coyote > 0) {
      this.coyote -= dt;
      if (I.hit('jump') || I.hit('up')) {
        I.consume('jump'); I.consume('up');
        this.y = this.startY; this.vx = this.coyoteVx; this.coyote = 0;
        return this.startRunLeap();
      }
    }
    const jumping = this.airType !== 'fall';
    let g = jumping && this.vy > -3 ? G_JUMP : G_FALL;
    if (this.floatT > 0) g = 3.2;
    const res = this.airStep(dt, g, { throughMirror: this.airType === 'runleap' });
    if (this.floatT > 0 && this.vy < -2.2) this.vy = -2.2;
    // espejo mágico (nivel del espejo): atravesarlo en carrera
    this.game.checkMirror(this);
    if (res.landed) { this.land(res.row); return; }
    if (res.ceiling) this.level.bumpCeiling(res.ceiling.c, res.ceiling.r);
    // agarrar salientes
    const auto = jumping || I.state.action || (this.game.settings.autoGrab && this.dangerousBelow());
    if (auto && !(this.noGrabT > 0) && this.vy < 2) {
      const G = this.findLedge({
        dirs: jumping ? [this.face] : [this.face, -this.face],
        xReach: jumping ? 0.45 : 0.5, yMin: 1.0, yMax: 2.3,
      });
      if (G) { this.y = G.y - HANG_REACH; return this.startHang(G, true); }
    }
    if (res.hitWall) {
      if (Math.abs(this.vx) > 2) { this.game.sfx('bump', this); this.game.shake(0.08); }
      this.vx = 0;
    }
    if (this.vy < -5 && this.anim.name !== 'fall') this.play('fall', { blend: 0.3 });
    if (this.y < -RH * 3) this.die('fall');
  }

  land(row, soft) {
    let drop = this.startY - this.y;
    if (this.safeLanding) { this.safeLanding = false; drop = 0; }
    this.onGround = true; this.vy = 0;
    const lv = this.level, c = this.col();
    lv.stepOn(c, row, this, true);
    this.game.fx.dust(this.x, this.y, Math.min(1.5, 0.4 + drop * 0.25));
    const sp = lv.spikesAt(c, row);
    if (sp) { sp.target = 1; sp.ext = 1; sp.apply(); return this.die('spikes', sp); }
    if (this.floatT > 0 || drop < SAFE_DROP) {
      this.game.sfx(drop > 1.5 ? 'land' : 'landSoft', this);
      if (this.airType === 'runleap' && this.fwd(this.game.input)) {
        this.vx = this.face * RUN_SPEED * 0.92;
        this.setState('run'); this.play('run', { blend: 0.12 });
        return;
      }
      this.vx = 0;
      this.setState('land');
      this.play(this.airType === 'leap' || this.airType === 'runleap' ? 'land' : 'landSoft', { restart: true, blend: 0.05 });
      return;
    }
    this.vx = 0;
    if (drop < HURT_DROP) {
      this.game.sfx('landHard', this); this.game.shake(0.35);
      this.hurt(1, 'fall');
      if (!this.alive) return;
      this.setState('landHard'); this.play('landHard', { restart: true, blend: 0.04 });
      return;
    }
    this.game.sfx('landHard', this); this.game.shake(0.6);
    this.die('fall');
  }
  s_land() { if (this.st > 0.24) this.setState('stand'); if (!this.supported()) this.startFall(); }
  s_landHard() { if (this.st > 1.05) this.setState('stand'); if (!this.supported()) this.startFall(); }

  startBump() {
    this.setState('bump');
    this.play('bump', { restart: true, blend: 0.05 });
    this.vx = -this.face * 1.4;
    this.game.sfx('bump', this); this.game.shake(0.1);
  }
  s_bump(dt) {
    this.vx = approach(this.vx, 0, 5 * dt);
    if (this.moveGround(this.vx * dt)) this.vx = 0;
    if (!this.supported()) return this.startFall();
    if (this.st > 0.55) this.setState('stand');
  }

  // ---------------------------------------------------------------------- objetos
  startPickup(it) {
    const dir = Math.sign(it.x - this.x) || this.face;
    if (dir !== this.face && Math.abs(it.x - this.x) > 0.15) this.turnTo(dir, 0.2);
    this.item = it;
    if (it.kind === 'sword') { this.setState('pickSword'); this.play('pickSword', { restart: true }); }
    else { this.setState('drink'); this.play('drink', { restart: true }); }
    this.taken = false; this.applied = false;
  }
  s_drink() {
    if (!this.taken && this.st > 0.42) {
      this.taken = true; this.item.take();
      this.handPotion = makePotion(this.item.kind);
      this.handPotion.scale.setScalar(0.8);
      this.handPotion.rotation.x = Math.PI;
      this.handPotion.position.set(0, -0.1, 0.05);
      this.char.rHand.add(this.handPotion);
      this.game.sfx('pick', this);
    }
    if (this.taken && this.handPotion) {
      // inclinar el frasco al beber
      const k = clamp((this.st - 0.95) / 0.3, 0, 1);
      this.handPotion.rotation.x = Math.PI - k * 0.9;
    }
    if (!this.applied && this.st > 1.05) { this.applied = true; this.game.applyPotion(this, this.item.kind); }
    if (this.st > 1.5 && this.handPotion) { this.handPotion.removeFromParent(); this.handPotion = null; }
    if (this.st > 1.78 && this.alive) this.setState('stand');
  }
  s_pickSword() {
    if (!this.taken && this.st > 0.45) {
      this.taken = true; this.item.take();
      this.hasSword = true;
      this.char.giveSword(); this.char.setSwordDrawn(true);
      this.game.onSwordPickup(this);
    }
    if (this.st > 1.75 && this.char.sword?.visible) { this.char.setSwordDrawn(false); this.game.sfx('sheathe', this); }
    if (this.st > 1.98) this.setState('stand');
  }

  // ---------------------------------------------------------------------- salida
  enterExit(door) {
    this.door = door;
    this.setState('exit');
    this.exitFromX = this.x;
    this.play('walk', { blend: 0.2 });
    this.game.onExitStart(this);
  }
  s_exit(dt) {
    const dx = this.door.x;
    if (this.st < 0.35) { this.x = lerp(this.exitFromX, dx, smooth(this.st / 0.35)); return; }
    const t = this.st - 0.35;
    this.yawOverride = lerp(this.baseYaw ?? 1.2, Math.PI, smooth(clamp(t / 0.35, 0, 1)));
    this.z = -smooth(clamp(t / 1.8, 0, 1)) * 1.15;
    this.renderOff.y = smooth(clamp(t / 1.8, 0, 1)) * 1.0;
    this.anim.speed = 0.85;
    if (t > 1.9 && !this.exitDone) { this.exitDone = true; this.game.levelComplete(); }
  }

  // ====================================================================== COMBATE
  checkCombat(I) {
    if (!this.hasSword || !this.alive) return;
    const foe = this.game.findFoe(this, 4.3);
    this.target = foe || (this.inCombat ? this.game.findFoe(this, 6.5) : null);
    if (!this.game.findFoe(this, 7)) this.sheathedByChoice = false;
    const engage = ['stand', 'run', 'skid', 'step', 'land', 'turn', 'crouch', 'standUp', 'bump', 'teeter'];
    if (foe && !this.inCombat && !this.sheathedByChoice && engage.includes(this.state) && this.onGround) {
      this.vx = 0;
      this.startDraw();
      return;
    }
    if (this.inCombat && !this.target && ['engarde', 'advance', 'retreat'].includes(this.state)) this.startSheathe();
  }
  faceTarget() {
    if (!this.target) return;
    const d = Math.sign(this.target.x - this.x) || this.face;
    if (d !== this.face) this.turnTo(d, 0.2);
  }
  startDraw() {
    this.inCombat = true;
    this.setState('draw');
    this.faceTarget();
    this.play('draw', { restart: true, blend: 0.1 });
    this.drawn = false;
  }
  s_draw() {
    if (!this.drawn && this.st > 0.13) { this.drawn = true; this.char.setSwordDrawn(true); this.game.sfx('draw', this); }
    if (this.st > 0.38) this.setState('engarde');
  }
  startSheathe() {
    this.setState('sheathe');
    this.play('sheathe', { restart: true, blend: 0.1 });
    this.sheathed = false;
  }
  s_sheathe() {
    if (!this.sheathed && this.st > 0.24) { this.sheathed = true; this.char.setSwordDrawn(false); this.game.sfx('sheathe', this); }
    if (this.st > 0.42) { this.inCombat = false; this.setState('stand'); }
  }
  s_engarde(dt, I) {
    if (!this.supported()) { this.inCombat = false; this.char.setSwordDrawn(false); return this.startFall(); }
    this.play('engarde', { blend: 0.12 });
    this.faceTarget();
    this.parrying = false;
    if (I.hit('action')) { I.consume('action'); return this.startStrike(); }
    if (I.hit('up')) { I.consume('up'); return this.startParry(); }
    if (I.hit('down')) { I.consume('down'); this.sheathedByChoice = true; return this.startSheathe(); }
    if (I.hit('jump')) { I.consume('jump'); return this.startParry(); }
    if (this.st > 0.05) {
      if (this.fwd(I)) return this.startAdvance(1);
      if (this.back(I)) return this.startAdvance(-1);
    }
  }
  startAdvance(dir) {
    this.setState(dir > 0 ? 'advance' : 'retreat');
    this.play(dir > 0 ? 'advance' : 'retreat', { restart: true, blend: 0.06 });
    this.advDir = dir; this.advFrom = this.x; this.advDone = 0;
  }
  s_advance(dt, I) { this.advanceStep(dt, I); }
  s_retreat(dt, I) { this.advanceStep(dt, I); }
  advanceStep(dt, I) {
    const total = 0.38;
    const p = clamp(this.st / 0.32, 0, 1);
    const want = smooth(p) * total;
    let dx = (want - this.advDone) * this.face * this.advDir;
    if (this.advDir > 0 && this.target) {
      const gap = (this.target.x - this.x) * this.face;
      if (gap - dx * this.face < 0.85) dx = Math.max(0, gap - 0.85) * this.face;
    }
    this.advDone = want;
    this.moveGround(dx);
    if (!this.supported()) { this.inCombat = false; this.char.setSwordDrawn(false); return this.startFall(); }
    if (I.hit('action') && this.st > 0.1) { I.consume('action'); return this.startStrike(); }
    if (I.hit('up')) { I.consume('up'); return this.startParry(); }
    if (p >= 1) this.setState('engarde');
  }
  startStrike() {
    this.setState('strike');
    const fast = this.riposteT > 0;
    this.play('strike', { restart: true, blend: 0.04, speed: fast ? 1.35 : 1.0 });
    this.strikeSpeed = fast ? 1.35 : 1.0;
    this.struck = false; this.queued = false;
    this.game.onStrikeStart(this);
    this.game.sfx('swing', this);
  }
  s_strike(dt, I) {
    const t = this.st * this.strikeSpeed;
    if (t < 0.24 && this.target) {
      // estocada con avance si el enemigo está algo lejos
      const gap = (this.target.x - this.x) * this.face;
      const v = gap > 1.35 ? 3.2 : gap > 0.85 ? 1.2 : 0;
      if (v) this.moveGround(this.face * Math.min(v * dt, gap - 0.85));
    }
    if (!this.struck && t >= 0.2) { this.struck = true; this.game.resolveStrike(this, this.target); }
    if (t > 0.3 && I.hit('action')) { I.consume('action'); this.queued = true; }
    if (t > 0.3 && I.hit('up')) { I.consume('up'); return this.startParry(); }
    if (t >= 0.55) { if (this.queued) return this.startStrike(); this.setState('engarde'); }
  }
  startParry() {
    this.setState('parry');
    this.play('parry', { restart: true, blend: 0.03 });
    this.parrying = true;
  }
  s_parry(dt, I) {
    this.parrying = this.st < 0.46;
    if (this.riposteT > 0 && I.hit('action')) { I.consume('action'); this.parrying = false; return this.startStrike(); }
    if (this.st > 0.5) { this.parrying = false; this.setState('engarde'); }
  }
  onParried() { this.riposteT = 0.5; }
  onBlocked() {
    // nuestra estocada ha sido parada: pequeño retroceso
    if (this.state === 'strike') { this.setState('recoil'); this.play('recoil', { restart: true, blend: 0.04 }); this.vx = -this.face * 1.0; this.recoilDur = 0.32; }
  }
  s_recoil(dt) {
    this.vx = approach(this.vx, 0, 5 * dt);
    if (this.moveGround(this.vx * dt)) this.vx = 0;
    if (!this.supported()) { this.inCombat = false; this.char.setSwordDrawn(false); return this.startFall(); }
    if (this.st > (this.recoilDur || 0.5)) this.setState(this.inCombat ? 'engarde' : 'stand');
  }

  // ====================================================================== daño y muerte
  takeHit(dmg, from) {
    if (!this.alive) return;
    this.hurt(dmg, 'sword');
    if (!this.alive) return;
    this.parrying = false;
    this.setState('recoil');
    this.recoilDur = 0.5;
    this.play('recoil', { restart: true, blend: 0.04 });
    this.vx = (from ? from.face : -this.face) * 1.3;
    if (this.inCombat === false && this.hasSword) { /* sigue sin desenvainar */ }
  }
  hitByDebris() {
    if (!this.alive) return;
    this.game.shake(0.25);
    this.hurt(1, 'debris');
    if (!this.alive) return;
    if (this.onGround && ['stand', 'run', 'skid', 'step', 'turn', 'land', 'engarde', 'advance', 'retreat', 'crouch'].includes(this.state)) {
      this.vx = 0; this.setState('crouch'); this.play('crouchDown', { restart: true });
    }
  }
  hurt(n, cause) {
    this.hp = Math.max(0, this.hp - n);
    this.flashHit();
    this.game.onPlayerHurt(this, n, cause);
    if (this.hp <= 0) this.die(cause);
  }
  die(kind, trap) {
    if (!this.alive) return;
    this.alive = false; this.hp = 0;
    this.inCombat = false; this.parrying = false;
    this.anchorW = 0; this.renderOff.y = 0;
    this.deathKind = kind;
    this.vx = 0;
    const clip = { sword: 'die', fall: 'crumple', spikes: 'impaled', chop: 'dieFront', debris: 'crumple', poison: 'die' }[kind] || 'die';
    this.play(clip, { restart: true, blend: 0.08 });
    this.setState('dead');
    if (trap) trap.bloody = 1;
    this.game.onPlayerDeath(this, kind);
  }
  s_dead(dt) {
    // si muere en el aire, sigue cayendo
    if (!this.onGround && this.deathKind !== 'spikes') {
      const res = this.airStep(dt, G_FALL);
      if (res.landed) { this.onGround = true; this.game.sfx('landHard', this); this.play('crumple', { restart: true }); }
    }
  }

  // ====================================================================== tras cada paso
  postUpdate(dt) {
    const lv = this.level;
    const c = this.col(), r = this.row();
    if (this.onGround && !['hang', 'climbUp', 'climbDown', 'jumpUp'].includes(this.state)) {
      lv.stepOn(c, r, this, false);
      // entrar en pinchos corriendo
      if ((c !== this.lastCol || r !== this.lastRow)) {
        const sp = lv.spikesAt(c, r);
        if (sp && ['run', 'skid', 'bump', 'runTurn', 'land', 'landHard'].includes(this.state)) {
          sp.target = 1; sp.ext = Math.max(sp.ext, 0.8); sp.apply();
          this.die('spikes', sp); return;
        }
        const cp = lv.checkpoints.find((k) => k.c === c && k.r === r);
        if (cp) this.game.setCheckpoint(cp);
      }
    }
    // cuchillas
    for (const cc of [c, lv.colOf(this.x + this.half * 0.8), lv.colOf(this.x - this.half * 0.8)]) {
      const ch = lv.chopperAt(cc, r);
      if (ch && ch.isClosed() && Math.abs(this.x - lv.cx(cc)) < 0.3 && this.state !== 'hang') { this.die('chop', ch); this.game.fx.blood(lv.cx(cc), this.y + 1.1, 1.2); return; }
    }
    // rastrillo que se cierra encima
    const g = lv.gateAt(c, r);
    if (g && g.blocks()) {
      const gx = lv.cx(c);
      if (Math.abs(this.x - gx) < this.half * 0.75) this.x = gx + (this.x < gx ? -1 : 1) * this.half * 0.75;
    }
    this.lastCol = c; this.lastRow = r;
  }
}
