// Partida: carga de niveles, cámara, combate, trampas, pociones, muerte y progreso.
import * as THREE from 'three';
import { TW, RH, START_MINUTES, HANG_REACH } from '../core/config.js';
import { clamp, damp, lerp, smooth } from '../core/utils.js';
import { Level } from '../world/level.js';
import { LEVELS } from '../world/levels.js';
import { sharedUniforms, potionColor } from '../world/props.js';
import { Prince } from '../actors/prince.js';
import { Enemy } from '../actors/enemy.js';
import { SCRIPTS } from './scripts.js';

export class Game {
  constructor(app) {
    this.app = app;
    this.stage = app.stage;
    this.scene = app.stage.scene;
    this.fx = app.fx;
    this.audio = app.audio;
    this.input = app.input;
    this.hud = app.hud;
    this.settings = app.settings;
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 120);
    this.camState = { x: 0, y: 0, lookX: 0, shake: 0, roll: 0, rollTarget: 0, zoom: 1 };
    this.level = null;
    this.player = null;
    this.enemies = [];
    this.actors = [];
    this.time = 0;
    this.paused = false;
    this.run = null;
    this.state = 'idle';
    this.deadT = 0;
    this.msgQueue = [];
  }

  // ---------------------------------------------------------------- partida
  newRun() {
    this.run = { level: 1, timeLeft: START_MINUTES * 60, maxHp: 3, hasSword: false, deaths: 0, started: Date.now(), checkpoint: null };
  }
  loadRun(saved) { this.run = { ...saved, checkpoint: null }; }
  levelDef(id) { return LEVELS.find((l) => l.id === id); }

  loadLevel(id, opts = {}) {
    this.unload();
    if (!this.run) this.newRun();
    const def = this.levelDef(id);
    this.def = def;
    this.level = new Level(def, {});
    this.scene.add(this.level.build(this.app.quality));
    this.stage.setTheme(this.level.theme);
    this.stage.setSources(this.level.lightSources);
    this.fx.setLevel(this.level);
    this.script = SCRIPTS[def.script || def.id] || {};
    this.ss = {}; this.camFocus = null;                 // estado de los guiones del nivel
    this.timerStopped = false;
    for (const k of ['thief', 'thiefDone', 'wellHint', 'merged', 'shadow', 'shadowSeen', 'jaffarTalk', 'jaffarDeadT', 'exitOpened', 'princess', 'jaffar', 'hourglass', 'endShown']) delete this[k];
    this.scriptCamInit = false;
    // príncipe
    const lv = this.level;
    if (this.run.checkpoint && this.run.checkpoint.level !== def.id) this.run.checkpoint = null;
    const st = (opts.useCheckpoint && this.run.checkpoint) ? this.run.checkpoint : lv.start;
    this.player = new Prince(this, { hp: this.run.maxHp });
    this.player.maxHp = this.run.maxHp; this.player.hp = this.run.maxHp;
    this.player.spawn(lv.cx(st.c) + (st.face || 1) * -0.1, lv.floorY(st.r), st.face || lv.start.face, this.run.hasSword);
    this.actors = [this.player];
    // entradas especiales del original: caer desde el nivel anterior o llegar corriendo
    const entry = (opts.useCheckpoint && this.run.checkpoint) ? null : def.entry;
    if ((entry === 'fall' || entry === 'wake') && !this.player.supported()) this.player.safeLanding = true;
    if (entry === 'run') {
      const p = this.player;
      p.setState('run'); p.vx = p.face * 4.3; p.play('run', { blend: 0 }); p.autoRun = 0.9;
    }
    // enemigos
    this.enemies = [];
    for (const sp of lv.enemySpawns) {
      if (sp.spawn === 'script') continue;
      this.spawnEnemy(sp);
    }
    // puerta de entrada: se cierra tras el príncipe
    this.startDoor = [...lv.doorMap.values()].find((d) => !d.exit && d.c === st.c && d.r === st.r) || null;
    this.startDoorT = 0;
    this.state = 'play';
    this.levelTime = 0;
    this.deadT = 0;
    this.combatOn = false;
    this.camState.roll = this.camState.rollTarget = 0;
    this.flipT = 0;
    this.script.start?.(this);
    this.snapCamera();
    this.audio.setMusic(def.music || (this.level.palace ? 'tower' : 'level'));
    this.hud.setLevel(def);
    if (!opts.silent) {
      this.hud.banner(`NIVEL ${def.num ?? def.id}`, def.name);
      this.audio.sting('start');
      this.later(2.8, () => this.announceTime(true));
    }
    this.hud.update(this);
  }

  spawnEnemy(sp) {
    const lv = this.level;
    const e = new Enemy(this, sp);
    e.spawn(lv.cx(sp.c), lv.floorY(sp.r), sp.face ?? -1);
    this.enemies.push(e); this.actors.push(e);
    return e;
  }

  unload() {
    this.timers = [];
    for (const a of this.actors) a.dispose();
    this.actors = []; this.enemies = []; this.player = null;
    if (this.level) { this.level.group.removeFromParent(); this.level.dispose(); this.level = null; }
    this.fx.clear();
  }

  restartLevel() {
    this.run.deaths++;
    this.loadLevel(this.def.id, { useCheckpoint: true, silent: true });
    this.hud.banner(`NIVEL ${this.def.num ?? this.def.id}`, this.def.name);
    this.later(2.8, () => this.announceTime(true));
  }

  // tareas diferidas en tiempo de juego (se detienen con la pausa)
  later(t, fn) { (this.timers || (this.timers = [])).push({ t, fn }); }

  // ---------------------------------------------------------------- bucle
  update(dt) {
    if (!this.level || this.paused) return;
    this.time += dt;
    this.levelTime += dt;
    if (this.timers && this.timers.length) {
      for (const tm of this.timers) tm.t -= dt;
      const due = this.timers.filter((tm) => tm.t <= 0);
      this.timers = this.timers.filter((tm) => tm.t > 0);
      for (const tm of due) tm.fn();
    }
    sharedUniforms.uTime.value = this.time;
    const I = this.input;
    // tiempo de la partida
    if ((this.state === 'play' || this.state === 'dead') && !this.script.noTimer && !this.timerStopped && !this.run.clockStopped && this.settings.timer && this.run.timeLeft > 0) {
      const before = this.run.timeLeft;
      this.run.timeLeft = Math.max(0, this.run.timeLeft - dt);
      this.checkTimeMessages(before, this.run.timeLeft);
      if (this.run.timeLeft <= 0 && before > 0 && this.player.alive) this.timeUp();
    }
    // puerta de entrada
    if (this.startDoor && this.startDoorT >= 0) {
      this.startDoorT += dt;
      if (this.startDoorT > 0.9) { this.startDoor.close(); this.startDoorT = -1; }
    }
    if (this.state === 'play' || this.state === 'dead' || this.state === 'exit') {
      this.player.update(dt, I);
      for (const e of this.enemies) e.update(dt);
      this.script.update?.(this, dt);
      this.separateActors();
    }
    this.level.update(dt, this);
    this.processEvents();
    for (const a of this.actors) a.updateVisual(dt);
    // música de combate
    const fighting = this.player.alive && this.player.inCombat && this.enemies.some((e) => e.alive && e.isFoe && Math.abs(e.x - this.player.x) < 6 && e.row() === this.player.row());
    if (fighting !== this.combatOn) { this.combatOn = fighting; this.audio.setCombat(fighting); }
    // muerte
    if (this.state === 'dead') {
      this.deadT += dt;
      if (this.deadT > 2.2 && !this.deadPrompt) { this.deadPrompt = true; this.hud.showDead(true, this.deathMsg); }
      if (this.deadPrompt && (I.hit('action') || I.hit('jump') || this.hud.consumeTap())) {
        I.consume('action'); I.consume('jump');
        this.hud.showDead(false);
        this.deadPrompt = false;
        if (this.run.timeLeft <= 0) { this.app.gameOver(); return; }
        this.restartLevel();
        return;
      }
    }
    // latido con la vida al mínimo
    const pl = this.player;
    if (pl.alive && pl.hp === 1 && this.state === 'play') {
      this.hbT = (this.hbT ?? 0) - dt;
      if (this.hbT <= 0) { this.hbT = 1.15; this.audio.play('heartbeat'); }
    } else this.hbT = 0;
    // poción del revés
    if (this.flipT > 0) { this.flipT -= dt; if (this.flipT <= 0) this.camState.rollTarget = 0; }
    this.updateCamera(dt);
    this.stage.update(dt, new THREE.Vector3(this.camState.x, this.camState.y, 0), this.player.alive ? new THREE.Vector3(this.player.x, this.player.y, 0) : null);
    this.fx.update(dt, this.camState);
    this.audio.listenerX = this.camState.x; this.audio.listenerY = this.camState.y;
    this.hud.update(this);
    this.updatePrompt();
  }

  // el príncipe no puede atravesar a un enemigo vivo
  separateActors() {
    const p = this.player;
    if (!p || !p.alive) return;
    for (const e of this.enemies) {
      if (!e.alive || !e.isFoe || !e.visible) continue;
      if (Math.abs(e.y - p.y) > 1.2) continue;
      const dx = p.x - e.x;
      const min = 0.62;
      if (Math.abs(dx) < min) {
        const s = Math.sign(dx) || -e.face;
        const push = min - Math.abs(dx);
        const nx = this.level.limitX(p.x, p.x + s * push, p.row(), p.half);
        p.x = nx;
        if (p.state === 'air' && Math.sign(p.vx) === -s) p.vx = 0;
      }
    }
  }

  // ---------------------------------------------------------------- cámara
  camDistance() {
    const fov = this.camera.fov * Math.PI / 180;
    const rows = this.settings.zoom === 'near' ? 2.0 : this.settings.zoom === 'far' ? 3.0 : 2.4;
    let d = (rows * RH / 2) / Math.tan(fov / 2);
    const minW = 8.5 * TW;
    d = Math.max(d, (minW / 2) / (Math.tan(fov / 2) * this.camera.aspect));
    return d;
  }
  cameraTarget() {
    const p = this.player;
    let y = p.y;
    if (p.state === 'hang' || p.state === 'climbUp' || p.state === 'climbDown') y = p.G ? p.G.y - 1.1 : p.y;
    // un guion puede pedir encuadrar también otro punto (el ladrón, el ratón…)
    const f = this.camFocus && this.camFocus();
    if (f) return { x: (p.x + f.x) / 2, y: (y + 1.25 + f.y) / 2 };
    return { x: p.x, y: y + 1.25 };
  }
  snapCamera() {
    const t = this.cameraTarget();
    this.camState.x = t.x; this.camState.y = t.y; this.camState.lookX = 0;
    this.updateCamera(0, true);
  }
  updateCamera(dt, snap) {
    const cs = this.camState, p = this.player;
    const cam = this.camera;
    cam.aspect = this.app.renderer.width / this.app.renderer.height;
    if (this.script.camera) {
      const c = this.script.camera(this);
      const minW = 7 * TW;
      const fov = cam.fov * Math.PI / 180;
      const dist = Math.max(c.dist, (minW / 2) / (Math.tan(fov / 2) * cam.aspect));
      if (snap || !this.scriptCamInit) { cs.x = c.x; cs.y = c.y; this.scriptCamInit = true; }
      cs.x = damp(cs.x, c.x, 3, dt); cs.y = damp(cs.y, c.y, 3, dt);
      cam.position.set(cs.x, cs.y + (c.lift ?? 0.5), dist);
      cam.up.set(0, 1, 0);
      cam.lookAt(cs.x, cs.y, 0);
      cam.updateProjectionMatrix();
      this.fx.setScale(this.app.renderer.height * this.app.renderer.renderer.getPixelRatio());
      return;
    }
    const f = this.camFocus && this.camFocus();
    const zt = f ? clamp(Math.max(Math.abs(f.x - p.x) / (6 * TW), Math.abs(f.y - p.y - 1.25) / (1.4 * RH)) + 0.75, 1, 1.45) : p.inCombat && p.alive ? 0.86 : 1;
    cs.zoom = snap ? 1 : damp(cs.zoom, zt, 2, dt);
    const dist = this.camDistance() * cs.zoom;
    const t = this.cameraTarget();
    const look = (p.state === 'run' || p.state === 'air' ? 1.4 : p.inCombat ? 0.8 : 0.5) * p.face;
    cs.lookX = snap ? look : damp(cs.lookX, look, 1.6, dt);
    let tx = t.x + cs.lookX, ty = t.y;
    const halfH = Math.tan(cam.fov * Math.PI / 360) * dist, halfW = halfH * cam.aspect;
    const W = this.level.cols * TW, Hh = this.level.rows * RH;
    // se permite asomar un poco fuera del mapa (roca maciza) para centrar mejor al príncipe
    const mx = 1.2 * TW, my = 0.85 * RH;
    tx = W + mx * 2 < halfW * 2 ? W / 2 : clamp(tx, halfW - mx, W - halfW + mx);
    ty = Hh + my * 2 < halfH * 2 ? Hh / 2 : clamp(ty, halfH - my, Hh - halfH + my);
    if (snap) { cs.x = tx; cs.y = ty; } else {
      cs.x = damp(cs.x, tx, 4.2, dt);
      const fast = p.state === 'air' && p.vy < -4;
      cs.y = damp(cs.y, ty, fast ? 6 : 2.6, dt);
    }
    cs.shake = Math.max(0, cs.shake - dt * 1.8);
    const sh = cs.shake * cs.shake;
    const sx = (Math.random() - 0.5) * sh * 0.5, sy = (Math.random() - 0.5) * sh * 0.5;
    cs.roll = snap ? cs.rollTarget : damp(cs.roll, cs.rollTarget, 3, dt);
    cam.position.set(cs.x + sx, cs.y + 0.95 + sy, dist);
    cam.up.set(Math.sin(cs.roll), Math.cos(cs.roll), 0);
    cam.lookAt(cs.x + sx * 0.5, cs.y + sy * 0.5, 0);
    cam.updateProjectionMatrix();
    this.fx.setScale(this.app.renderer.height * this.app.renderer.renderer.getPixelRatio());
  }
  shake(a) { this.camState.shake = Math.min(1, this.camState.shake + a); }

  // ---------------------------------------------------------------- eventos del nivel
  processEvents() {
    const lv = this.level;
    for (const e of lv.events) {
      const x = e.x ?? lv.cx(e.c), y = e.y ?? lv.floorY(e.r);
      switch (e.type) {
        case 'gateTick': this.audio.play('gateTick', x, y, { up: e.up, minGap: 0.05 }); break;
        case 'gateShut': this.audio.play('gateShut', x, y, { soft: e.soft }); this.shake(e.soft ? 0.05 : 0.15); if (!e.soft) this.fx.dust(x, y, 0.7); break;
        case 'gateOpen': break;
        case 'plate': this.audio.play('plate', x, y); break;
        case 'looseShake': this.audio.play('looseShake', x, y); this.fx.grit(x, y - 0.45); break;
        case 'looseRattleFx': break;
        case 'looseRattle': this.audio.play('looseRattle', x, y, { minGap: 0.2 }); break;
        case 'looseCrash': this.audio.play('looseCrash', x, y); this.fx.debris(x, y); this.shake(0.25); break;
        case 'spikes': this.audio.play('spikes', x, y); break;
        case 'chop': this.audio.play('chop', x, y); break;
        case 'doorOpen': this.audio.play('doorOpen', x, y); this.shake(0.08); break;
        case 'mirror': this.audio.play('mirror', x, y); this.fx.shards(x, y); break;
        default: break;
      }
    }
    lv.events.length = 0;
  }
  sfx(name, actor, opts) { this.audio.play(name, actor ? actor.x : null, actor ? actor.y : null, opts); }

  // ---------------------------------------------------------------- consultas para los actores
  lineClear(a, b) {
    const lv = this.level, r = a.row();
    const c0 = Math.min(a.col(), b.col()), c1 = Math.max(a.col(), b.col());
    for (let c = c0; c <= c1; c++) {
      if (lv.isSolid(c, r)) return false;
      const g = lv.gateAt(c, r);
      if (g && g.blocks()) {
        const gx = lv.cx(c);
        if ((a.x - gx) * (b.x - gx) < 0) return false;
      }
    }
    return true;
  }
  findFoe(actor, maxTiles) {
    let best = null, bd = maxTiles * TW;
    for (const e of this.enemies) {
      if (!e.alive || !e.isFoe || !e.onGround) continue;
      if (e.type === 'shadow' && e.mode !== 'duel') continue;
      if (e.row() !== actor.row()) continue;
      const d = Math.abs(e.x - actor.x);
      if (d < bd && this.lineClear(actor, e)) { bd = d; best = e; }
    }
    return best;
  }
  onStrikeStart(attacker) {
    for (const e of this.enemies) if (e.alive && e.onThreat) e.onThreat(attacker);
  }
  resolveStrike(a, t) {
    if (!t || !t.alive || !a.alive) return 'miss';
    if (Math.abs(t.y - a.y) > 0.5) return 'miss';
    const dx = (t.x - a.x) * a.face;
    if (dx < 0.1 || dx > 1.6) return 'miss';
    const tipX = a.x + a.face * Math.min(dx, 1.2), tipY = a.y + 1.25;
    // ayuda en combate: el príncipe en guardia a veces para solo
    if (t.isPlayer && !t.parrying && this.settings.assist && t.face === -a.face && ['engarde', 'advance', 'retreat'].includes(t.state) && Math.random() < 0.45) {
      t.startParry();
    }
    if (t.parrying && t.face === -a.face) {
      this.fx.sparks(tipX, tipY, 0.3, -a.face);
      this.sfx('clang', a);
      this.shake(0.08);
      a.onBlocked?.(); t.onParried?.();
      return 'blocked';
    }
    t.takeHit(1, a);
    this.sfx('hit', t);
    if (t.type === 'skeleton') this.fx.sparks(tipX, tipY, 0.3, a.face);
    else this.fx.blood(t.x - a.face * 0.05, tipY, t.alive ? 0.7 : 1.2);
    this.shake(0.12);
    this.hitStop = 0.05;
    return 'hit';
  }
  itemNear(actor) {
    const lv = this.level;
    let best = null, bd = 0.7;
    for (const it of lv.itemEnts) {
      if (it.taken || it.r !== actor.row()) continue;
      const ix = it.mesh.position.x + (it.kind === 'sword' ? 0.15 : 0);
      const d = Math.abs(ix - actor.x);
      if (d < bd) { bd = d; best = it; best.x = ix; }
    }
    return best;
  }
  exitDoorNear(actor) {
    const lv = this.level;
    for (const d of lv.doorMap.values()) {
      if (!d.exit || d.r !== actor.row()) continue;
      if (Math.abs(d.x - actor.x) < 0.75) {
        if (d.isOpen()) return d;
        this.hud.toast('La puerta está cerrada');
      }
    }
    return null;
  }
  setCheckpoint(cp) {
    if (this.run.checkpoint && this.run.checkpoint.c === cp.c && this.run.checkpoint.r === cp.r && this.run.checkpoint.level === this.def.id) return;
    this.run.checkpoint = { c: cp.c, r: cp.r, face: cp.face ?? this.player.face, level: this.def.id };
    this.hud.toast('Punto de control');
  }
  checkMirror(p) {
    const lv = this.level;
    const m = lv.mirrorAt(p.col(), p.row());
    if (m && !m.broken && p.airType === 'runleap' && Math.abs(p.x - m.x) < 0.45) {
      m.shatter();
      this.script.onMirror?.(this, m);
    }
  }

  // ---------------------------------------------------------------- reacciones
  applyPotion(p, kind) {
    const col = potionColor(kind);
    this.fx.sparkle(p.x, p.y, col, kind === 'life' ? 80 : 45);
    this.sfx('drink', p);
    const flash = (c, a) => { this.app.renderer.flash.color.setRGB(c.r, c.g, c.b); this.app.renderer.flash.amt = a; };
    switch (kind) {
      case 'heal':
        p.hp = Math.min(p.maxHp, p.hp + 1);
        flash(col, 0.25); this.audio.sting('potion'); this.hud.toast('Recuperas fuerzas'); break;
      case 'life':
        p.maxHp = Math.min(10, p.maxHp + 1); p.hp = p.maxHp; this.run.maxHp = p.maxHp;
        flash(col, 0.45); this.audio.sting('life'); this.hud.toast('¡Tu vida aumenta!'); this.shake(0.2); break;
      case 'poison':
        flash(col, 0.4); this.audio.sting('poison'); this.hud.toast('¡Veneno!');
        p.hurt(1, 'poison');
        break;
      case 'float':
        p.floatT = 24; flash(col, 0.3); this.audio.sting('potion'); this.hud.toast('Te sientes ligero como una pluma'); break;
      case 'flip':
        this.camState.rollTarget = this.camState.rollTarget ? 0 : Math.PI; this.flipT = this.camState.rollTarget ? 30 : 0;
        flash(col, 0.4); this.audio.sting('potion'); this.hud.toast('El mundo se pone del revés'); break;
      default: break;
    }
  }
  onSwordPickup(p) {
    this.run.hasSword = true;
    if (this.script.onSwordPickup?.(this, p)) return;
    this.audio.sting('sword');
    this.fx.sparkle(p.x, p.y + 0.6, new THREE.Color(1, 0.85, 0.5), 60);
    this.hud.toast('¡Has encontrado una espada!');
    this.hint('sword');
  }
  onPlayerHurt(p, n, cause) {
    this.app.renderer.flash.color.setRGB(0.8, 0.05, 0.02);
    this.app.renderer.flash.amt = 0.45;
    this.sfx('hurt', p);
    if (navigator.vibrate && this.settings.vibrate) navigator.vibrate(60);
  }
  onPlayerDeath(p, kind) {
    this.state = 'dead';
    this.slowmo = 0.9;
    this.deadT = 0;
    this.sfx('death', p);
    this.audio.sting('death');
    this.audio.setCombat(false);
    if (navigator.vibrate && this.settings.vibrate) navigator.vibrate([80, 60, 160]);
    const msgs = {
      sword: 'Has caído en combate', fall: 'La caída ha sido fatal', spikes: 'Atravesado por los pinchos',
      chop: 'Las cuchillas no perdonan', debris: 'Aplastado por las piedras', poison: 'El veneno te ha vencido', shadow: 'Tu propia sombra te ha vencido',
    };
    this.deathMsg = msgs[kind] || 'Has muerto';
    this.deadPrompt = false;
  }
  onEnemyHurt(e) { if (e.alive) this.hud.flashEnemy(); this.script.onEnemyHurt?.(this, e); }
  onEnemyDeath(e) {
    this.sfx('death', e);
    this.script.onEnemyDeath?.(this, e);
    if (e.type === 'jaffar') return;
  }
  onExitStart() { this.state = 'exit'; this.audio.setCombat(false); }
  levelComplete() {
    this.audio.sting('victory');
    this.app.levelComplete();
  }
  timeUp() {
    this.hud.toast('¡Se acabó el tiempo!');
    this.player.die('time');
    this.deathMsg = 'Se acabó el tiempo: Jaffar se ha salido con la suya';
  }
  hint(key) { this.app.hint?.(key); }

  // ---------------------------------------------------------------- mensajes de tiempo (como el original)
  announceTime(force) {
    if (!this.settings.timer) return;
    const m = Math.ceil(this.run.timeLeft / 60);
    this.hud.message(`QUEDAN ${m} MINUTO${m === 1 ? '' : 'S'}`);
  }
  checkTimeMessages(before, now) {
    const mb = Math.ceil(before / 60), mn = Math.ceil(now / 60);
    if (mn !== mb && (mn % 5 === 0 || mn <= 5)) {
      this.hud.message(`QUEDAN ${mn} MINUTO${mn === 1 ? '' : 'S'}`);
      if (mn <= 5) this.audio.sting('warn');
    }
    if (now < 60 && Math.ceil(before) !== Math.ceil(now) && Math.ceil(now) % 10 === 0) this.hud.message(`QUEDAN ${Math.ceil(now)} SEGUNDOS`);
  }

  // ---------------------------------------------------------------- indicaciones contextuales
  updatePrompt() {
    const p = this.player;
    let txt = '';
    if (p.alive && this.state === 'play') {
      if (p.state === 'stand') {
        const it = this.itemNear(p);
        if (it) txt = it.kind === 'sword' ? 'ACCIÓN: coger la espada' : 'ACCIÓN: beber';
        else {
          const lv = this.level;
          for (const d of lv.doorMap.values()) if (d.exit && d.isOpen() && d.r === p.row() && Math.abs(d.x - p.x) < 0.75) txt = '↑: salir';
        }
      } else if (p.state === 'hang') txt = '↑ trepar · ↓ soltarse';
    }
    this.hud.prompt(txt);
  }
}
