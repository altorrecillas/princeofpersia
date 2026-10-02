// Guiones de nivel: título, introducción, final y momentos especiales (espejo, sombra, Jaffar).
import * as THREE from 'three';
import { TW, RH } from '../core/config.js';
import { clamp, lerp, smooth, damp } from '../core/utils.js';
import { Actor } from '../actors/actor.js';
import { makeHourglass } from '../world/props.js';
import { IS_TOUCH } from '../core/config.js';

// personaje no jugable para escenas
class NPC extends Actor {
  constructor(game, kind, opts) {
    super(game, kind, opts);
    this.target = null; this.speed = 1.3;
    game.actors.push(this);
  }
  walkTo(x, speed = 1.3, run = false) { this.target = x; this.speed = speed; this.play(run ? 'run' : 'walk', { blend: 0.2 }); this.turnTo(Math.sign(x - this.x) || this.face); }
  update(dt) {
    if (this.target !== null) {
      const d = this.target - this.x;
      if (Math.abs(d) < 0.03) { this.target = null; this.play(this.idleClip || 'idle', { blend: 0.3 }); }
      else this.x += Math.sign(d) * Math.min(Math.abs(d), this.speed * dt);
    }
  }
}

// el ratón blanco de la princesa (nivel 8)
class Mouse {
  constructor(g, x, y) {
    this.g = g; this.x = x; this.y = y; this.face = -1; this.phase = 0; this.t = 0;
    const grp = this.mesh = new THREE.Group();
    const fur = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.85 });
    const pink = new THREE.MeshStandardMaterial({ color: 0xe6a0a8, roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x120808, roughness: 0.2 });
    this.body = new THREE.Group(); grp.add(this.body);
    const b = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), fur); b.scale.set(0.07, 0.055, 0.11); b.position.y = 0.065;
    const hd = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), fur); hd.scale.set(0.045, 0.04, 0.055); hd.position.set(0, 0.08, 0.1);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), pink); nose.position.set(0, 0.078, 0.155);
    this.body.add(b, hd, nose);
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), pink); ear.scale.set(0.022, 0.026, 0.006); ear.position.set(sx * 0.03, 0.12, 0.085);
      const ey = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 4), dark); ey.position.set(sx * 0.022, 0.092, 0.138);
      this.body.add(ear, ey);
    }
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.06, -0.1), new THREE.Vector3(0, 0.04, -0.2), new THREE.Vector3(0.03, 0.06, -0.3), new THREE.Vector3(0, 0.1, -0.37)]);
    this.tail = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.007, 5), pink);
    this.body.add(this.tail);
    this.legs = [];
    for (const [lx, lz] of [[-0.035, 0.06], [0.035, 0.06], [-0.035, -0.05], [0.035, -0.05]]) {
      const l = new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.02, 2, 5), pink); l.position.set(lx, 0.018, lz);
      grp.add(l); this.legs.push(l);
    }
    grp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    grp.position.set(x, y, 0.35);
    g.scene.add(grp);
  }
  // devuelve true al terminar; onPos(x) se llama mientras corre (pisa la placa)
  update(dt, onPos, turnX, endX) {
    this.t += dt;
    if (this.phase === 0) { this.x -= 2.2 * dt; onPos(this.x); if (this.x <= turnX) { this.phase = 1; this.t = 0; } }
    else if (this.phase === 1) { this.body.rotation.x = -Math.sin(Math.min(1, this.t / 0.3) * Math.PI) * 0.7; if (this.t > 1.0) { this.phase = 2; this.face = 1; this.body.rotation.x = 0; } }
    else { this.x += 2.4 * dt; onPos(this.x); if (this.x >= endX) return true; }
    const run = this.phase !== 1;
    this.mesh.position.set(this.x, this.y + (run ? Math.abs(Math.sin(this.t * 28)) * 0.012 : 0), 0.35);
    this.mesh.rotation.y = this.face > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.tail.rotation.y = Math.sin(this.t * 9) * 0.35;
    this.legs.forEach((l, i) => { l.rotation.x = run ? Math.sin(this.t * 28 + i * 1.6) * 0.8 : 0; });
    return false;
  }
  dispose() { this.mesh.removeFromParent(); }
}

function story(text) {
  const el = document.getElementById('storyText');
  el.classList.remove('on');
  setTimeout(() => { el.innerHTML = text; el.classList.add('on'); }, 350);
}

const T = IS_TOUCH;

// ------------------------------------------------------------------ utilidades de salas (niveles originales)
function inRoom(g, room, pad = 0) {
  const lv = g.level, p = g.player, o = lv.rooms && lv.rooms[room];
  if (!o || !p) return false;
  const c = lv.colOf(p.x), r = lv.rowOfFeet(p.y + (p.state === 'hang' ? 2 : 0));
  return c >= o[0] - pad && c < o[0] + 10 + pad && r >= o[1] && r < o[1] + 3;
}
const roomX = (g, room, col) => g.level.cx(g.level.rooms[room][0]) + (col) * TW;
const roomY = (g, room, row) => g.level.floorY(g.level.rooms[room][1] + row);
const anyExitOpen = (g, k = 0.3) => [...g.level.doorMap.values()].some((d) => d.exit && d.amt > k);
function flash(g, r, gg, b, a) { g.app.renderer.flash.color.setRGB(r, gg, b); g.app.renderer.flash.amt = a; }

// ------------------------------------------------------------------ consejos para los primeros niveles
const HINTS = {
  start: T ? 'Mueve la cruceta ← → para correr' : 'Usa ← → para correr',
  gap: T ? 'Ante un hueco pulsa SALTAR; con carrerilla llegas mucho más lejos' : 'Ante un hueco pulsa ESPACIO; con carrerilla llegas mucho más lejos',
  ledge: 'Bajo un borde pulsa ↑ para saltar y agarrarte, y ↑ otra vez para trepar',
  down: 'Pulsa ↓ al borde de un hueco para descolgarte sin hacerte daño',
  loose: '¡Cuidado! Las baldosas sueltas tiemblan y se caen',
  plate: 'Las placas abren rastrillos durante unos segundos: ¡corre!',
  spikes: T ? 'Cruza los pinchos saltando, o paso a paso con ACCIÓN + dirección' : 'Cruza los pinchos saltando, o paso a paso con MAYÚS + dirección',
};
function hints(g, dt) {
  const ss = g.ss, p = g.player, lv = g.level;
  if (!p.alive || g.state !== 'play') return;
  ss.hintCool = (ss.hintCool || 0) - dt;
  if (ss.hintCool > 0) return;
  const seen = ss.seen || (ss.seen = new Set());
  const show = (k) => { if (seen.has(k)) return false; seen.add(k); g.hud.toast(HINTS[k], 5); ss.hintCool = 6; return true; };
  if (g.levelTime > 1.5 && show('start')) return;
  if (p.state === 'stand') {
    const e = p.edgeAhead(p.face, 1.1);
    if (e < 1.0) {
      const c = lv.colOf(p.x + p.face * (e + 0.3)), r = p.row();
      if (!lv.hasFloor(c, r + 1) && show('gap')) return;
      if (lv.hasFloor(c, r + 1) && show('down')) return;
    }
    if (p.findLedge({ dirs: [p.face, -p.face], xReach: 0.8, yMin: 2.2, yMax: 3.0 }) && show('ledge')) return;
    for (let k = 1; k <= 2; k++) if (lv.spikesAt(lv.colOf(p.x + p.face * k * TW), p.row()) && show('spikes')) return;
  }
  for (const l of lv.looseMap.values()) if (l.state === 'shake' && Math.abs(lv.cx(l.c) - p.x) < 4 && show('loose')) return;
  const c = p.col(), r = p.row();
  if (lv.plateAt(c, r) && lv.plateAt(c, r).raise && show('plate')) return;
}

export const SCRIPTS = {
  orig1: {
    // como en el original: al caer en la mazmorra se acciona la placa de la sala 5 (el rastrillo se cierra de golpe)
    start(g) {
      const o = g.level.rooms[5];
      const pl = o && g.level.plateAt(o[0] + 2, o[1]);
      if (pl) g.later(0.4, () => g.level.triggerPlate(pl, pl.raise));
    },
    update(g, dt) { hints(g, dt); },
  },
  orig2: { update(g, dt) { hints(g, dt); } },

  // ------------------------------------------------------------------ 3: el esqueleto despierta; punto de control
  orig3: {
    update(g) {
      const p = g.player, ss = g.ss;
      const sk = g.enemies.find((e) => e.state === 'sleep');
      if (sk && anyExitOpen(g) && p.alive && p.row() === sk.row() && Math.abs(p.x - sk.x) < 3.6 * TW) {
        sk.wake();
        g.hud.toast('¡Los huesos se levantan!', 3);
      }
      if (!ss.chk && inRoom(g, 7)) {
        ss.chk = true;
        const o = g.level.rooms[2];
        g.setCheckpoint({ c: o[0] + 6, r: o[1], face: -1 });
      }
    },
  },

  // ------------------------------------------------------------------ 4: el espejo aparece al abrirse la salida
  orig4: {
    update(g) {
      const ss = g.ss, lv = g.level;
      if (!ss.mirrorUp && anyExitOpen(g, 0.05)) {
        ss.mirrorUp = true;
        const o = lv.rooms[4];
        lv.addMirror(o[0] + 4, o[1]);
        g.audio.play('merge', roomX(g, 4, 4), roomY(g, 4, 0));
        g.later(1.2, () => g.hud.toast('Un espejo mágico ha aparecido en el palacio…', 4));
      }
    },
    onMirror(g, m) {
      const lv = g.level, p = g.player;
      g.shake(0.5);
      flash(g, 0.8, 0.85, 1, 0.8);
      const sh = g.spawnEnemy({ c: m.c, r: m.r, type: 'shadow', mode: 'flee', hp: 1, face: p.face });
      sh.x = lv.cx(m.c) + p.face * 0.2;
      sh.setState('idle');
      g.fx.smoke(sh.x, sh.y + 0.9);
      g.later(0.35, () => {
        if (p.alive && p.hp > 1) { p.hp = 1; p.flashHit([0.5, 0.3, 1]); }
        g.hud.toast('Tu reflejo ha cobrado vida… y te ha robado las fuerzas', 4);
        g.audio.play('vanish');
      });
    },
  },

  // ------------------------------------------------------------------ 5: la sombra se bebe la poción de la sala 24
  orig5: {
    update(g, dt) {
      const ss = g.ss, lv = g.level;
      if (!ss.thief && !ss.thiefDone) {
        const o = lv.rooms[24];
        const gate = lv.gateAt(o[0] + 1, o[1]);
        const pot = lv.itemEnts.find((it) => it.c === o[0] + 3 && it.r === o[1]);
        if (!pot || pot.taken) { ss.thiefDone = true; return; }
        if (gate && gate.amt > 0.55 && inRoom(g, 24, 3)) {
          const t = new NPC(g, 'shadow', { rimColor: 0xb070ff, rimStr: 0.8 });
          t.x = roomX(g, 24, 0.2); t.y = roomY(g, 24, 0); t.snapFace(1); t.idleClip = 'idle';
          g.fx.smoke(t.x, t.y + 0.9); g.audio.play('vanish', t.x, t.y);
          t.walkTo(pot.mesh.position.x - 0.35, 4.0, true);
          ss.thief = { npc: t, pot, phase: 0, t: 0 };
          g.camFocus = () => (ss.thief && ss.thief.npc.visible ? { x: ss.thief.npc.x, y: ss.thief.npc.y + 1.0 } : null);
          g.hud.toast('¿Quién anda ahí?', 2);
        }
      }
      const T5 = ss.thief;
      if (!T5) return;
      T5.npc.update(dt); T5.t += dt;
      if (T5.phase === 0 && T5.npc.target === null) { T5.phase = 1; T5.t = 0; T5.npc.play('drink', { restart: true }); }
      else if (T5.phase === 1) {
        if (T5.t > 0.42 && !T5.pot.taken) { T5.pot.take(); g.audio.play('pick', T5.npc.x, T5.npc.y); }
        if (T5.t > 1.0 && !T5.drank) { T5.drank = true; g.fx.sparkle(T5.npc.x, T5.npc.y, new THREE.Color(1, 0.1, 0.3), 40); g.audio.play('drink', T5.npc.x, T5.npc.y); }
        if (T5.t > 1.8) { T5.phase = 2; T5.npc.walkTo(roomX(g, 24, -0.6), 4.4, true); g.hud.toast('¡Tu sombra se ha bebido la poción!', 3); }
      } else if (T5.phase === 2 && T5.npc.target === null) {
        g.fx.smoke(T5.npc.x, T5.npc.y + 0.9); g.audio.play('vanish', T5.npc.x, T5.npc.y);
        T5.npc.visible = false; ss.thief = null; ss.thiefDone = true;
      }
    },
  },

  // ------------------------------------------------------------------ 6: la sombra en el borde y la caída al nivel 7
  orig6: {
    update(g, dt) {
      const ss = g.ss, lv = g.level, p = g.player;
      if (!ss.sh6 && inRoom(g, 1, 2)) {
        const t = new NPC(g, 'shadow', { rimColor: 0xb070ff, rimStr: 0.8 });
        t.x = roomX(g, 1, 1.1); t.y = roomY(g, 1, 1); t.snapFace(1); t.idleClip = 'idle';
        t.play('idle', { blend: 0 });
        g.fx.smoke(t.x, t.y + 0.9); g.audio.play('vanish', t.x, t.y);
        ss.sh6 = t;
        g.camFocus = () => (ss.sh6 && ss.sh6.visible && !ss.sh6gone ? { x: ss.sh6.x, y: ss.sh6.y + 1.0 } : null);
      }
      if (ss.sh6 && !ss.sh6gone) {
        ss.sh6.update(dt);
        if (Math.abs(p.x - ss.sh6.x) < 6 * TW && p.row() === lv.rowOfFeet(ss.sh6.y)) {
          ss.sh6gone = true;
          ss.sh6.walkTo(ss.sh6.x + 0.7, 1.4);
          g.later(0.7, () => { g.fx.smoke(ss.sh6.x, ss.sh6.y + 0.9); g.audio.play('vanish', ss.sh6.x, ss.sh6.y); ss.sh6.visible = false; });
        }
      } else if (ss.sh6) ss.sh6.update(dt);
      // caer por el foso de la sala 1 lleva al nivel siguiente
      const o = lv.rooms[1];
      if (!ss.fell && p.alive && lv.colOf(p.x) >= o[0] && lv.colOf(p.x) < o[0] + 10 && p.y < lv.B(o[1] + 2) - 0.25) {
        ss.fell = true; p.safeLanding = true; g.state = 'exit';
        g.levelComplete();
      }
    },
  },

  // ------------------------------------------------------------------ 8: el ratón de la princesa
  orig8: {
    update(g, dt) {
      const ss = g.ss, lv = g.level;
      if (!ss.mouse && !ss.mouseDone && anyExitOpen(g, 0.9) && inRoom(g, 16)) {
        ss.mouseT = (ss.mouseT || 0) + dt;
        if (ss.mouseT > 12.5) {
          ss.mouse = new Mouse(g, roomX(g, 16, 9.7), roomY(g, 16, 0));
          g.camFocus = () => (ss.mouse ? { x: ss.mouse.x, y: roomY(g, 16, 0) + 0.6 } : null);
          g.hud.toast('Un ratoncito blanco… ¿lo envía la princesa?', 4);
        }
      }
      if (ss.mouse) {
        const done = ss.mouse.update(dt, (x) => {
          const pl = lv.plateAt(lv.colOf(x), lv.rooms[16][1]);
          if (pl) pl.press();
        }, roomX(g, 16, 6.6), roomX(g, 16, 10.2));
        if (done) { ss.mouse.dispose(); ss.mouse = null; ss.mouseDone = true; }
      }
    },
  },

  // ------------------------------------------------------------------ 12: duelo con la sombra, suelos ocultos y salida a la torre
  orig12: {
    start(g) { g.level.ghostActive = false; },
    // como en el original: al recoger la espada de la sala 15, la sombra cae del techo
    onSwordPickup(g, p) {
      const ss = g.ss, lv = g.level;
      if (ss.shadow || ss.merged || !inRoom(g, 15)) return false;
      let c = lv.colOf(p.x) + p.face * 2;
      if (!lv.hasFloor(c, p.row())) c = lv.colOf(p.x) - p.face * 2;
      const sh = g.spawnEnemy({ c, r: p.row(), type: 'shadow', mode: 'duel', hp: 4, skill: 0.6, face: c > lv.colOf(p.x) ? -1 : 1 });
      sh.immortal = true; sh.noFallDeath = true; sh.char.setSwordDrawn(false);
      sh.y += 2.2; sh.onGround = false; sh.startY = sh.y;
      ss.shadow = sh;
      g.audio.play('vanish', sh.x, sh.y);
      g.later(0.6, () => g.hud.toast('Tu propia sombra cae ante ti', 3));
      return true;
    },
    update(g) {
      const ss = g.ss, lv = g.level, p = g.player;
      const sh = ss.shadow;
      if (sh && !ss.merged && p.alive) {
        const near = Math.abs(p.x - sh.x) < 0.82 && p.row() === sh.row() && p.onGround && sh.onGround;
        const calm = !p.inCombat && !(p.char.sword && p.char.sword.visible);
        if (near && calm) {
          ss.merged = true;
          sh.isFoe = false; sh.alive = false; sh.visible = false;
          g.fx.sparkle(sh.x, sh.y, new THREE.Color(0.7, 0.5, 1), 120);
          g.fx.smoke(sh.x, sh.y + 0.9);
          g.audio.play('merge', sh.x, sh.y);
          flash(g, 0.9, 0.9, 1, 0.9);
          p.maxHp = Math.min(10, p.maxHp + 1); p.hp = p.maxHp; g.run.maxHp = p.maxHp;
          lv.ghostActive = true;
          g.hud.banner('Unidos', 'Ahora eres uno con tu sombra', 3.5);
          g.later(3.6, () => g.hud.toast('Ten fe… el camino aparece bajo tus pies', 5));
        }
      }
      // salida sin puerta (como en el original): basta con llegar a la sala 23
      if (!ss.out && p.alive && inRoom(g, 23)) {
        ss.out = true; g.state = 'exit'; g.levelComplete();
      }
    },
    onEnemyHurt(g, e) {
      if (e.type !== 'shadow') return;
      g.ss.hits = (g.ss.hits || 0) + 1;
      if (g.ss.hits === 1) g.hud.toast('¡Al herir a tu sombra te hieres a ti mismo!', 3.5);
      if (g.ss.hits === 2) g.hud.toast('Quizá no debas luchar contra ti mismo… (↓ envaina la espada)', 5);
    },
  },

  // ------------------------------------------------------------------ 13: el techo se derrumba y Jaffar
  orig13: {
    update(g, dt) {
      const ss = g.ss, lv = g.level;
      for (const rm of [23, 16]) {
        if (!inRoom(g, rm)) continue;
        const o = lv.rooms[rm];
        ss.fallen = ss.fallen || new Set();
        // como en el original, las losas del techo caen al azar; tiemblan antes para dar tiempo a esquivarlas
        const pc = lv.colOf(g.player.x);
        for (let col = 2; col <= 7; col++) {
          const key = rm + ':' + col;
          if (ss.fallen.has(key)) continue;
          const l = lv.looseAt(o[0] + col, o[1] - 1);
          ss.fallen.add(key);
          const near = Math.abs(o[0] + col - pc) <= 1;
          if (l) g.later((near ? 1.2 : 0.2) + Math.random() * 2.2, () => l.touch(true, true, 0.45));
        }
      }
      if (!ss.met && inRoom(g, 1)) {
        ss.met = true;
        g.audio.sting('warn');
        g.hud.toast('Jaffar: «Llegas tarde, muchacho. La princesa será mía»', 4);
      }
    },
    onEnemyDeath(g, e) {
      if (e.type !== 'jaffar') return;
      g.timerStopped = true;
      flash(g, 1, 1, 1, 1);
      g.audio.sting('victory');
      g.hitStop = 0.6;
      g.later(1.6, () => {
        const o = g.level.rooms[24];
        const pl = g.level.plateAt(o[0], o[1]);
        if (pl) g.level.triggerPlate(pl, true);
        g.hud.banner('¡Jaffar ha caído!', 'El camino hacia la princesa está libre', 4);
      });
    },
  },

  // ------------------------------------------------------------------ 14: la princesa
  orig14: {
    update(g) {
      // la sala de la princesa empieza tras el rastrillo de la sala 5 (columna 9)
      if (!g.ss.won && g.player.alive && inRoom(g, 5) && g.player.x < roomX(g, 5, 9) - 0.35) {
        g.ss.won = true; g.state = 'exit'; g.timerStopped = true;
        g.app.finishGame();
      }
    },
  },

  // ------------------------------------------------------------------ pantalla de título
  title: {
    noTimer: true,
    start(g) {
      const p = g.player;
      p.setState('cutscene');
      p.hasSword = true; p.char.giveSword(); p.char.setSwordDrawn(true);
      p.play('engarde', { blend: 0 });
      g.titleT = 0;
    },
    update(g, dt) {
      g.titleT += dt;
      const p = g.player;
      const ph = g.titleT % 14;
      if (ph < 0.05) p.play('engarde', { blend: 0.4 });
      if (ph > 5 && ph < 5.05) p.play('strike', { restart: true, blend: 0.1 });
      if (ph > 5.6 && ph < 5.65) p.play('engarde', { blend: 0.2 });
      if (ph > 9 && ph < 9.05) p.play('parry', { restart: true, blend: 0.1 });
      if (ph > 9.6 && ph < 9.65) p.play('engarde', { blend: 0.2 });
    },
    camera(g) {
      const t = g.titleT || 0;
      const p = g.player;
      const aspect = g.camera.aspect || 2;
      return { x: p.x - 1.0 - Math.min(2.4, aspect * 0.9) + Math.sin(t * 0.07) * 0.5, y: p.y + 1.35, dist: 6.0 + Math.sin(t * 0.05) * 0.4, lift: 0.35 };
    },
  },

  // ------------------------------------------------------------------ introducción
  intro: {
    noTimer: true,
    start(g) {
      const lv = g.level;
      const p = g.player; p.visible = false; p.setState('cutscene');
      const sx = lv.cx(lv.start.c), y = lv.floorY(lv.start.r);
      g.princess = new NPC(g, 'princess', {});
      g.princess.x = sx; g.princess.y = y; g.princess.snapFace(1); g.princess.idleClip = 'princessWait';
      g.princess.play('princessWait', { blend: 0 });
      g.jaffar = new NPC(g, 'jaffar', {});
      g.jaffar.x = sx + 7.5; g.jaffar.y = y; g.jaffar.snapFace(-1); g.jaffar.idleClip = 'guardIdle';
      g.jaffar.play('guardIdle', { blend: 0 });
      g.hourglass = makeHourglass();
      g.hourglass.position.set(sx + 2.3, y, -0.9);
      g.hourglass.scale.setScalar(1.2);
      lv.group.add(g.hourglass);
      g.introT = 0; g.introStep = -1;
      g.app.storyActive = true;
    },
    update(g, dt) {
      g.introT += dt;
      g.princess.update(dt); g.jaffar.update(dt);
      g.hourglass.userData.update?.(dt, g.introT > 15 ? (g.introT - 15) : 0);
      const T = [0.6, 5.5, 10.5, 15.5, 21.5, 27];
      const texts = [
        'El Sultán está lejos, librando una guerra en tierras extranjeras.',
        'En su ausencia, el Gran Visir <b>Jaffar</b>, brujo y tirano, gobierna el palacio con mano de hierro.',
        'Solo una persona se interpone entre Jaffar y el trono: <b>la hija del Sultán</b>.',
        'Jaffar le da un ultimátum: casarse con él… o morir.<br>Le concede <b>una hora</b>.',
        'Pero el corazón de la princesa pertenece a un joven aventurero, al que Jaffar ha arrojado a las mazmorras.',
        'Tienes <b>60 minutos</b> para escapar y salvarla.',
      ];
      for (let i = 0; i < T.length; i++) {
        if (g.introStep < i && g.introT >= T[i]) {
          g.introStep = i;
          story(texts[i]);
          if (i === 1) g.jaffar.walkTo(g.princess.x + 1.6, 1.0);
          if (i === 2) { g.princess.turnTo(1); }
          if (i === 3) { g.hourglass.userData.flip = true; g.audio.play('ui'); }
          if (i === 4) { g.princess.walkTo(g.princess.x - 1.2, 0.7); }
        }
      }
      if (g.introT > 33 && g.app.storyActive) g.app.endStory();
    },
    camera(g) {
      const t = g.introT || 0;
      const x = g.princess.x + 1.4 + Math.sin(t * 0.08) * 0.4 + clamp((t - 4) * 0.12, 0, 0.8);
      return { x, y: g.princess.y + 1.25, dist: 5.6 - clamp(t * 0.03, 0, 0.9), lift: 0.3 };
    },
  },

  // ------------------------------------------------------------------ final
  ending: {
    noTimer: true,
    start(g) {
      const lv = g.level;
      const p = g.player; p.setState('cutscene');
      p.hasSword = true; p.char.giveSword(); p.char.setSwordDrawn(false);
      const y = lv.floorY(lv.start.r);
      p.x = lv.cx(lv.start.c) - 2.5; p.y = y; p.snapFace(1);
      g.princess = new NPC(g, 'princess', {});
      g.princess.x = p.x + 6.5; g.princess.y = y; g.princess.snapFace(1); g.princess.idleClip = 'princessWait';
      g.princess.play('princessWait', { blend: 0 });
      g.endT = 0; g.endStep = 0;
      g.audio.setMusic('title');
      story('');
    },
    update(g, dt) {
      g.endT += dt;
      const p = g.player, pr = g.princess;
      pr.update(dt);
      if (g.endStep === 0) {
        // el príncipe entra corriendo
        p.play('run', { blend: 0.2 });
        p.x += 3.2 * dt;
        if (g.endT > 0.8 && pr.face > 0) { pr.turnTo(-1); }
        if (p.x >= pr.x - 2.4) { g.endStep = 1; p.play('idle', { blend: 0.3 }); pr.walkTo(p.x + 0.75, 1.5); pr.anim.speed = 1.7; }
      } else if (g.endStep === 1 && pr.target === null) {
        g.endStep = 2; g.endT2 = 0;
        p.play('embrace', { blend: 0.4 }); pr.play('embrace', { blend: 0.4 });
        g.audio.sting('victory');
        g.fx.sparkle((p.x + pr.x) / 2, p.y + 0.4, new THREE.Color(1, 0.6, 0.7), 120);
      } else if (g.endStep === 2) {
        g.endT2 += dt;
        if (g.endT2 > 6 && !g.endShown) { g.endShown = true; g.app.showEnding(); }
      }
    },
    camera(g) {
      const p = g.player, pr = g.princess;
      const mid = pr ? (p.x + pr.x) / 2 : p.x;
      const close = g.endStep === 2 ? smooth(clamp((g.endT2 || 0) / 4, 0, 1)) : 0;
      return { x: mid, y: p.y + 1.3 - close * 0.1, dist: 7.5 - close * 3.2, lift: 0.5 - close * 0.3 };
    },
  },
};
