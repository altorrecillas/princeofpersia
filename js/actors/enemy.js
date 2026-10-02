// Enemigos: guardias (varios colores), guardia gordo, esqueleto, Jaffar y la sombra del príncipe.
import { TW } from '../core/config.js';
import { clamp, lerp, smooth, approach } from '../core/utils.js';
import { Actor } from './actor.js';

const G_FALL = 19;

export class Enemy extends Actor {
  constructor(game, spec) {
    const type = spec.type || 'guard';
    const kind = { skeleton: 'skeleton', jaffar: 'jaffar', fat: 'fat', shadow: 'shadow' }[type] || 'guard';
    super(game, kind, { variant: spec.variant || 'red', hp: spec.hp ?? 3, rimColor: type === 'shadow' ? 0xb070ff : undefined, rimStr: type === 'shadow' ? 0.8 : undefined });
    this.type = type;
    this.spec = spec;
    this.skill = clamp(spec.skill ?? 0.35, 0, 1);
    this.immortal = type === 'skeleton';
    this.char.giveSword({ hilt: type === 'jaffar' ? 0xd4af37 : type === 'skeleton' ? 0x8a8070 : 0x9a7a40, length: type === 'fat' ? 0.78 : 0.82 });
    this.char.setSwordDrawn(type !== 'shadow');
    this.alert = false;
    this.thinkT = 0.3;
    this.parrying = false;
    this.parryAt = -1;
    this.isFoe = true;
    this.mode = spec.mode || 'fight';
    this.deadT = 0;
    if (type === 'fat') this.half = 0.34;
  }

  isSwinging() {
    if (this.state !== 'strike' || this.st < this.tele) return false;
    const t = 0.13 + (this.st - this.tele) * this.strikeSpeed;
    return t > 0.12 && t < 0.34;
  }
  get thinkInterval() { return lerp(0.5, 0.16, this.skill); }
  get parryChance() { return lerp(0.12, 0.88, this.skill); }
  get reactDelay() { return lerp(0.17, 0.03, this.skill); }
  get strikeSpeed() { return lerp(0.82, 1.18, this.skill) * (this.type === 'fat' ? 0.85 : 1); }

  spawn(x, y, face) {
    this.x = x; this.y = y; this.snapFace(face);
    this.homeX = x;
    if (this.spec.sleep) {
      // esqueleto tendido en el suelo hasta que despierta
      this.setState('sleep'); this.isFoe = false;
      this.play('dead', { blend: 0 });
      return;
    }
    this.setState('idle');
    this.play(this.type === 'shadow' ? 'idle' : 'guardIdle', { blend: 0 });
  }
  s_sleep() { /* lo despierta el guion del nivel */ }
  wake() {
    if (this.state !== 'sleep') return;
    this.setState('rising');
    this.play('rise', { restart: true, blend: 0.1 });
    this.game.sfx('bones', this);
  }
  s_rising() {
    if (this.st > 1.4) { this.isFoe = true; this.alert = true; this.setState('engarde'); this.game.sfx('draw', this); }
  }

  visibleTarget() {
    const p = this.game.player;
    if (!p || !p.alive || !p.visible) return null;
    if (this.mode === 'flee') return null;
    const sameRow = p.onGround ? p.row() === this.row() : (p.state === 'hang' || p.state === 'climbUp') && p.G && p.G.r === this.row();
    if (!sameRow) return null;
    const dist = Math.abs(p.x - this.x);
    if (dist > 7.5 * TW) return null;
    if (!this.game.lineClear(this, p)) return null;
    return p;
  }

  canStepTo(nx) {
    const lv = this.level, r = this.row();
    const c = lv.colOf(nx + Math.sign(nx - this.x) * this.half * 0.5);
    if (!lv.hasFloor(c, r)) return false;
    if (lv.spikesAt(c, r) || lv.chopperAt(c, r)) return false;
    if (lv.looseAt(c, r) && this.type !== 'shadow') return false;
    const lim = lv.limitX(this.x, nx, r, this.half);
    return Math.abs(lim - nx) < 1e-4;
  }

  update(dt) {
    this.st += dt;
    if (this.defensiveT > 0) this.defensiveT -= dt;
    if (!this.alive) { this.s_deadUpdate(dt); return; }
    if (!this.onGround && this.state !== 'air') this.setState('air');
    const fn = this['s_' + this.state];
    if (fn) fn.call(this, dt);
    // parada reactiva programada
    if (this.parryAt >= 0) {
      this.parryAt -= dt;
      if (this.parryAt < 0 && ['engarde', 'advance', 'retreat', 'idle', 'recoil'].includes(this.state)) this.startParry();
    }
    if (this.alive && this.onGround && this.state !== 'air') {
      const lv = this.level;
      lv.stepOn(this.col(), this.row(), this, false);
      if (!this.supported()) this.startFall();
    }
  }

  faceTo(p) {
    const d = Math.sign(p.x - this.x) || this.face;
    if (d !== this.face) this.turnTo(d, 0.22);
  }

  // ---------------------------------------------------------------- estados
  s_idle(dt) {
    if (this.type === 'shadow' && this.mode === 'flee') return this.s_flee(dt);
    const p = this.visibleTarget();
    this.play(this.alert && this.type !== 'shadow' ? 'engarde' : this.type === 'shadow' ? 'idle' : 'guardIdle', { blend: 0.25 });
    if (p) {
      const dist = Math.abs(p.x - this.x);
      if (dist < 4.6 * TW || this.alert) {
        this.alert = true;
        this.faceTo(p);
        if (this.type === 'shadow' && this.mode === 'duel' && !p.inCombat) return; // la sombra imita al príncipe
        this.setState('engarde');
        this.char.setSwordDrawn(true);
        this.game.sfx('draw', this);
      }
    }
  }

  s_engarde(dt) {
    const p = this.visibleTarget();
    this.play('engarde', { blend: 0.15 });
    this.parrying = false;
    if (!p) { this.thinkT -= dt; if (this.thinkT < -1.5) { this.alert = false; this.setState('idle'); } return; }
    this.faceTo(p);
    if (this.type === 'shadow' && this.mode === 'duel' && !p.inCombat) {
      // la sombra envaina si el príncipe envaina
      this.char.setSwordDrawn(false); this.setState('idle'); return;
    }
    this.thinkT -= dt;
    if (this.thinkT > 0) return;
    this.thinkT = this.thinkInterval * (0.7 + Math.random() * 0.6);
    const dist = Math.abs(p.x - this.x);
    const reach = 1.42;
    const pBusy = !p.alive || p.state === 'hang' || p.state === 'climbUp' || p.state === 'dead';
    if (pBusy) return;
    const armed = p.inCombat && p.char.sword?.visible;
    if (dist > reach) {
      const nx = this.x + this.face * 0.38;
      if (this.canStepTo(nx)) return this.startMove(1);
      return;
    }
    if (dist < 0.8) {
      if (Math.random() < 0.6 && this.canStepTo(this.x - this.face * 0.38)) return this.startMove(-1);
      return this.startStrike();
    }
    const aggro = armed ? lerp(0.32, 0.7, this.skill) : 0.85;
    if (Math.random() < aggro) return this.startStrike();
    if (Math.random() < 0.18 && this.canStepTo(this.x - this.face * 0.38)) return this.startMove(-1);
  }

  startMove(dir) {
    this.setState(dir > 0 ? 'advance' : 'retreat');
    this.play(dir > 0 ? 'advance' : 'retreat', { restart: true, blend: 0.06 });
    this.advDir = dir; this.advDone = 0;
  }
  s_advance(dt) { this.moveStep(dt); }
  s_retreat(dt) { this.moveStep(dt); }
  moveStep(dt) {
    const p = clamp(this.st / 0.32, 0, 1);
    const want = smooth(p) * 0.38;
    let dx = (want - this.advDone) * this.face * this.advDir;
    const pl = this.game.player;
    if (this.advDir > 0 && pl) {
      const gap = (pl.x - this.x) * this.face;
      if (gap - Math.abs(dx) < 0.85) dx = Math.max(0, gap - 0.85) * this.face;
    }
    this.advDone = want;
    if (!this.canStepTo(this.x + dx * 3)) dx = 0;
    this.moveGround(dx);
    if (p >= 1) this.setState('engarde');
  }

  startStrike() {
    this.setState('strike');
    this.play('strike', { restart: true, blend: 0.05, speed: 0 });
    // aviso: alza la espada un instante (más largo cuanto menos hábil) antes de atacar
    this.tele = lerp(0.46, 0.2, this.skill) + Math.random() * 0.12;
    this.struck = false; this.swung = false;
    this.game.fx.glint(this);
  }
  s_strike(dt) {
    const sp = this.strikeSpeed;
    // la sombra imita al príncipe: si envaina, ella también (aunque estuviera atacando)
    if (this.type === 'shadow' && this.mode === 'duel' && !this.struck && !this.game.player.inCombat) {
      this.char.setSwordDrawn(false); this.setState('idle'); return;
    }
    if (this.st < this.tele) { this.anim.setTime(Math.min(0.13, this.st * 1.4)); return; }
    const t = 0.13 + (this.st - this.tele) * sp;
    this.anim.setTime(t);
    if (!this.swung) { this.swung = true; this.game.sfx('swing', this); }
    if (!this.struck && t >= 0.2) { this.struck = true; this.game.resolveStrike(this, this.game.player); }
    if (t >= 0.56) this.setState('engarde');
  }
  startParry() {
    this.setState('parry');
    this.play('parry', { restart: true, blend: 0.03 });
    this.parrying = true;
  }
  s_parry() {
    this.parrying = this.st < 0.36;
    if (this.st > 0.45) {
      this.parrying = false;
      // contraataque tras una parada
      if (this.riposte && Math.random() < 0.4 + this.skill * 0.5) { this.riposte = false; return this.startStrike(); }
      this.setState('engarde');
    }
  }
  // el príncipe empieza una estocada: quizá parar
  onThreat(attacker) {
    if (!this.alive || this.parryAt >= 0) return;
    const defensive = this.defensiveT > 0;
    const ok = ['engarde', 'advance', 'retreat'].includes(this.state) || (defensive && this.state === 'recoil');
    if (!ok) return;
    const dist = Math.abs(attacker.x - this.x);
    if (dist > 2.2) return;
    const chance = Math.min(0.95, this.parryChance + (defensive ? 0.32 : 0));
    if (Math.random() < chance) this.parryAt = this.state === 'recoil' ? 0.03 : this.reactDelay * (0.8 + Math.random() * 0.4);
  }
  onParried() { this.riposte = true; }
  onBlocked() {
    if (this.state === 'strike') {
      this.setState('recoil'); this.play('recoil', { restart: true, blend: 0.04 });
      this.vx = -this.face * 0.9; this.recoilDur = 0.4;
    }
  }

  takeHit(dmg, from) {
    if (!this.alive) return;
    this.flashHit(this.type === 'skeleton' ? [0.9, 0.9, 1] : undefined);
    this.parryAt = -1; this.parrying = false;
    if (this.type === 'shadow' && this.mode === 'duel') {
      // herir a la sombra hiere al príncipe
      this.game.player.hurt(1, 'shadow');
    }
    if (!this.immortal) this.hp -= dmg;
    this.defensiveT = 1.2;
    this.game.onEnemyHurt(this);
    if (this.hp <= 0 && !this.immortal) return this.die();
    this.setState('recoil');
    this.recoilDur = this.type === 'skeleton' ? 0.75 : this.immortal ? 0.55 : 0.34;
    this.play('recoil', { restart: true, blend: 0.04 });
    this.vx = (from ? from.face : -this.face) * (this.type === 'skeleton' ? 3.7 : this.immortal ? 1.6 : 1.4);
  }
  s_recoil(dt) {
    this.vx = approach(this.vx, 0, 5 * dt);
    if (this.moveGround(this.vx * dt)) this.vx = 0;
    if (!this.supported()) return this.startFall();
    if (this.st > (this.recoilDur || 0.45)) this.setState('engarde');
  }

  startFall() {
    this.setState('air'); this.onGround = false; this.startY = this.y; this.vy = 0;
    this.vx *= 0.5;
    this.play('fall', { blend: 0.2 });
    this.parrying = false;
  }
  s_air(dt) {
    const res = this.airStep(dt, G_FALL);
    if (res.landed) {
      this.onGround = true;
      const drop = this.startY - this.y;
      this.game.sfx('landHard', this);
      this.game.fx.dust(this.x, this.y, 1.2);
      if (drop > 1.8 && !this.noFallDeath) {
        if (this.type === 'skeleton') { this.shatter(); return; }
        this.die('fall'); return;
      }
      this.setState('engarde');
    }
    if (res.hitWall) this.vx = 0;
    if (this.y < -20) this.die('fall');
  }

  shatter() {
    this.alive = false;
    this.visible = false;
    this.game.fx.bones(this.x, this.y);
    this.game.sfx('bones', this);
    this.game.onEnemyDeath(this);
  }

  die(kind) {
    if (!this.alive) return;
    this.alive = false;
    this.parrying = false;
    this.play(kind === 'fall' ? 'crumple' : 'die', { restart: true, blend: 0.06 });
    this.setState('dead');
    this.game.onEnemyDeath(this);
  }
  s_deadUpdate(dt) {
    this.deadT += dt;
    if (!this.onGround) {
      const res = this.airStep(dt, G_FALL);
      if (res.landed) { this.onGround = true; this.play('crumple', { restart: true }); }
    }
    if (this.type === 'shadow' && this.deadT > 1.2) this.visible = false;
  }

  // ---------------------------------------------------------------- sombra que huye (tras el espejo)
  s_flee(dt) {
    if (!this.fleeing) {
      this.fleeing = true;
      this.char.setSwordDrawn(false);
      this.play('run', { blend: 0.15 });
    }
    this.play('run', { blend: 0.15 });
    this.vx = this.face * 4.2;
    const blocked = this.moveGround(this.vx * dt);
    if (!this.supported() || blocked || this.st > 4) {
      this.visible = false; this.alive = false; this.isFoe = false;
      this.game.fx.smoke(this.x, this.y + 0.9);
      this.game.sfx('vanish', this);
    }
  }
}
