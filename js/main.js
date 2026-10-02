// Arranque de la aplicación: carga, menús, opciones, guardado y bucle principal.
import * as THREE from 'three';
import { QUALITY, defaultQuality, IS_TOUCH, IS_MOBILE, DEBUG } from './core/config.js';
import { Renderer } from './core/renderer.js';
import { clamp } from './core/utils.js';
import { input } from './core/input.js';
import { audio } from './core/audio.js';
import { Stage } from './game/stage.js';
import { Game } from './game/game.js';
import { FX } from './fx/particles.js';
import { HUD } from './ui/hud.js';
import { TouchControls } from './ui/touch.js';
import { getTextures } from './world/textures.js';
import { LEVELS, CAMPAIGN } from './world/levels.js';

const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'pop_remastered_save_v1';
const SET_KEY = 'pop_remastered_settings_v1';

function loadJSON(k, def) { try { const v = localStorage.getItem(k); return v ? { ...def, ...JSON.parse(v) } : def; } catch (e) { return def; } }
function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } }

class App {
  constructor() {
    this.settings = loadJSON(SET_KEY, {
      quality: defaultQuality(), music: 0.6, sfx: 0.85, timer: true, zoom: 'normal', vibrate: true, autoGrab: IS_TOUCH, touch: 'auto', assist: IS_TOUCH, brightness: 1,
    });
    if (!QUALITY[this.settings.quality]) this.settings.quality = defaultQuality();
    const qp = new URLSearchParams(location.search).get('q');
    if (qp && QUALITY[qp]) this.settings.quality = qp;
    this.quality = QUALITY[this.settings.quality];
    this.screen = null;
    this.input = input;
    this.audio = audio;
    window.__vibrate = this.settings.vibrate;
  }

  async boot() {
    const canvas = $('gl');
    this.renderer = new Renderer(canvas, this.settings.quality);
    document.body.classList.toggle('lowq', !this.quality.post);
    this.stage = new Stage(this.renderer.renderer, this.quality);
    this.fx = new FX(this.stage.scene, this.quality);
    this.hud = new HUD();
    this.touch = new TouchControls($('touch'));
    this.game = new Game(this);
    addEventListener('resize', () => this.onResize());
    addEventListener('orientationchange', () => setTimeout(() => this.onResize(), 250));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (this.screen === 'play') this.pause(true); audio.suspend(); } else audio.resume();
    });
    this.onResize();
    this.bindUI();
    audio.setVolumes(this.settings.music, this.settings.sfx);
    this.applyBrightness();

    // carga: texturas procedurales de los dos ambientes
    const steps = [
      ['Tallando la piedra de las mazmorras…', () => getTextures('dungeon', this.quality.tex)],
      ['Puliendo el mármol del palacio…', () => getTextures('palace', this.quality.tex)],
      ['Encendiendo las antorchas…', () => this.game.loadLevel('title', { silent: true })],
      ['Afilando las cimitarras…', () => this.renderer.renderer.compile(this.stage.scene, this.game.camera)],
    ];
    for (let i = 0; i < steps.length; i++) {
      $('loadText').textContent = steps[i][0];
      $('loadBar').style.width = `${(i / steps.length) * 100}%`;
      await new Promise((r) => setTimeout(r, 30));
      steps[i][1]();
    }
    $('loadBar').style.width = '100%';
    await new Promise((r) => setTimeout(r, 150));
    this.showScreen('title');
    $('fade').classList.remove('on');
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
    if (DEBUG) window.app = this;
    if (new URLSearchParams(location.search).has('test')) this.setupTest();
    const lvParam = new URLSearchParams(location.search).get('level');
    if (lvParam !== null) this.startLevel(isNaN(+lvParam) ? lvParam : +lvParam, true);
  }

  // ---------------------------------------------------------------- pantallas
  showScreen(name) {
    this.screen = name;
    for (const el of document.querySelectorAll('.screen')) el.classList.toggle('on', el.id === name);
    const playing = name === 'play';
    this.hud.show(playing);
    const touchOn = this.settings.touch === 'on' || (this.settings.touch === 'auto' && IS_TOUCH);
    this.touch.show(playing && touchOn);
    $('btnPause').style.display = playing ? '' : 'none';
    input.enabled = playing || name === 'cutscene';
    this.updateRotate();
    if (name === 'title') {
      this.refreshTitle();
      audio.setMusic('title');
    }
  }
  refreshTitle() {
    const save = loadJSON(SAVE_KEY, null);
    $('btnContinue').style.display = save && save.level ? '' : 'none';
    if (save && save.level) {
      const def = LEVELS.find((l) => l.id === save.level);
      $('btnContinue').querySelector('small').textContent = def ? `Nivel ${def.num} · ${Math.ceil(save.timeLeft / 60)} min` : '';
    }
  }

  bindUI() {
    const click = (id, fn) => $(id).addEventListener('click', (e) => { e.preventDefault(); audio.unlock(); audio.play('ui'); fn(); });
    click('btnNew', () => this.newGame());
    click('btnContinue', () => this.continueGame());
    click('btnLevels', () => this.openLevels());
    click('btnOptions', () => this.openOptions('title'));
    click('btnHelp', () => this.openHelp('title'));
    click('btnCredits', () => this.showScreen('credits'));
    click('btnCreditsBack', () => this.showScreen('title'));
    click('btnLevelsBack', () => this.showScreen('title'));
    click('btnPause', () => this.pause(true));
    click('btnResume', () => this.pause(false));
    click('btnRestart', () => { this.pause(false); this.game.restartLevel(); });
    click('btnPauseOptions', () => this.openOptions('pause'));
    click('btnPauseHelp', () => this.openHelp('pause'));
    click('btnQuit', () => { this.pause(false); this.toTitle(); });
    click('btnOptionsBack', () => { this.saveSettings(); this.showScreen(this.optionsFrom); });
    click('btnHelpBack', () => this.showScreen(this.helpFrom));
    click('btnStorySkip', () => this.endStory());
    click('btnEndBack', () => this.toTitle());
    click('btnOverBack', () => this.toTitle());
    // primer toque: audio y pantalla completa
    const unlock = () => { audio.unlock(); };
    addEventListener('pointerdown', unlock, { once: false });
    addEventListener('keydown', (e) => {
      audio.unlock();
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (this.screen === 'play') this.pause(true);
        else if (this.screen === 'pause') this.pause(false);
      }
      if (e.code === 'KeyM') { this.settings.music = this.settings.music > 0 ? 0 : 0.6; audio.setVolumes(this.settings.music, this.settings.sfx); }
    });
    // opciones
    for (const el of document.querySelectorAll('[data-set]')) {
      const k = el.dataset.set;
      // el brillo se ve en directo mientras se arrastra el deslizador
      if (k === 'brightness') el.addEventListener('input', () => { this.settings.brightness = parseFloat(el.value); this.applyBrightness(); });
      el.addEventListener('change', () => {
        let v = el.type === 'checkbox' ? el.checked : el.type === 'range' ? parseFloat(el.value) : el.value;
        this.settings[k] = v;
        if (k === 'music' || k === 'sfx') audio.setVolumes(this.settings.music, this.settings.sfx);
        if (k === 'quality') this.applyQuality(v);
        if (k === 'vibrate') window.__vibrate = v;
        if (k === 'brightness') this.applyBrightness();
        this.saveSettings();
      });
    }
  }

  saveSettings() { saveJSON(SET_KEY, this.settings); }

  // gradación de color del fotograma (ambiente del nivel, brillo elegido, desaturar al morir)
  grade() {
    const g = this.game;
    const grade = g.level?.palace ? { exposure: 1.0, warm: 0.15, bloom: 0.5 } : { exposure: 1.0, warm: 0.1, bloom: 0.55 };
    grade.bright = clamp(+this.settings.brightness || 1, 0.6, 2);
    if (g.player && !g.player.alive && g.state === 'dead') grade.sat = Math.max(0.25, 1 - g.deadT * 0.5);
    return grade;
  }

  applyBrightness() {
    const b = clamp(+this.settings.brightness || 1, 0.6, 2);
    // con posprocesado la curva del shader hace casi todo; sin él, la luz ambiente y la exposición
    this.stage?.setBrightness(b, this.renderer.composer ? 0.5 : 1.3);
    const vig = document.getElementById('vigCss');
    if (vig) vig.style.opacity = String(clamp(1.6 - b * 0.6, 0.35, 1));
    const lab = document.getElementById('brightVal');
    if (lab) lab.textContent = Math.round(b * 100) + '%';
  }

  applyQuality(q) {
    if (!QUALITY[q]) return;
    // el cambio de luces/sombras requiere recargar la página para rehacer la escena
    this.saveSettings();
    location.reload();
  }

  openOptions(from) {
    this.optionsFrom = from;
    for (const el of document.querySelectorAll('[data-set]')) {
      const v = this.settings[el.dataset.set];
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    }
    this.showScreen('options');
  }
  openHelp(from) { this.helpFrom = from; this.showScreen('help'); }

  openLevels() {
    const save = loadJSON(SAVE_KEY, null);
    const best = loadJSON('pop_remastered_unlocked', { max: 1 }).max;
    const list = $('levelList');
    list.innerHTML = '';
    for (const id of CAMPAIGN) {
      const def = LEVELS.find((l) => l.id === id);
      const b = document.createElement('button');
      const locked = def.num > best && !DEBUG;
      b.className = 'lvl' + (locked ? ' locked' : '');
      b.innerHTML = `<b>${def.num}</b><span>${locked ? '???' : def.name}</span>`;
      if (!locked) b.addEventListener('click', () => { audio.unlock(); this.game.newRun(); this.game.run.level = id; this.game.run.hasSword = def.num > 1; this.game.run.timeLeft = save?.timeLeft && def.num > 1 ? Math.max(save.timeLeft, 15 * 60) : 3600; this.startLevel(id); });
      list.appendChild(b);
    }
    this.showScreen('levels');
  }

  async goFullscreen() {
    if (!IS_TOUCH) return;
    try {
      const el = document.documentElement;
      if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      if (screen.orientation?.lock) await screen.orientation.lock('landscape').catch(() => {});
    } catch (e) { /* no soportado (iPhone) */ }
  }

  newGame() {
    this.goFullscreen();
    this.game.newRun();
    this.playStory();
  }
  continueGame() {
    const save = loadJSON(SAVE_KEY, null);
    if (!save) return this.newGame();
    this.goFullscreen();
    this.game.loadRun(save);
    this.startLevel(save.level);
  }

  playStory() {
    this.showScreen('story');
    this.game.loadLevel('intro', { silent: true });
    this.storyActive = true;
    audio.setMusic('title');
  }
  endStory() {
    if (!this.storyActive) return;
    this.storyActive = false;
    this.startLevel(CAMPAIGN[0]);
  }

  startLevel(id, debugJump) {
    if (!this.game.run) this.game.newRun();
    if (debugJump) { this.game.run.level = id; const def = LEVELS.find((l) => l.id === id); if (def && def.num > 1) this.game.run.hasSword = true; }
    this.game.run.level = id;
    this.fadeTo(() => {
      this.game.loadLevel(id);
      this.showScreen('play');
      const def = LEVELS.find((l) => l.id === id);
      if (def && def.num) {
        saveJSON(SAVE_KEY, { level: id, timeLeft: this.game.run.timeLeft, maxHp: this.game.run.maxHp, hasSword: this.game.run.hasSword, deaths: this.game.run.deaths, started: this.game.run.started, clockStopped: !!this.game.run.clockStopped });
        const u = loadJSON('pop_remastered_unlocked', { max: 1 });
        if (def.num > u.max) saveJSON('pop_remastered_unlocked', { max: def.num });
      }
    });
  }

  levelComplete() {
    const idx = CAMPAIGN.indexOf(this.game.def.id);
    const next = CAMPAIGN[idx + 1];
    this.game.run.checkpoint = null;
    this.game.run.maxHp = Math.max(this.game.run.maxHp, this.game.player.maxHp);
    if (next === undefined) { this.finishGame(); return; }
    this.startLevel(next);
  }

  finishGame() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* */ }
    saveJSON('pop_remastered_unlocked', { max: 99 });
    this.fadeTo(() => {
      this.game.loadLevel('ending', { silent: true });
      this.showScreen('cutscene');
      this.endingActive = true;
    });
  }
  showEnding() {
    const r = this.game.run;
    const used = 3600 - r.timeLeft;
    $('endStats').innerHTML = `Tiempo empleado: <b>${Math.floor(used / 60)} min ${Math.floor(used % 60)} s</b><br>Muertes: <b>${r.deaths}</b>`;
    this.showScreen('ending');
  }
  gameOver() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* */ }
    this.showScreen('over');
  }

  toTitle() {
    this.fadeTo(() => {
      this.game.loadLevel('title', { silent: true });
      this.showScreen('title');
    });
  }

  pause(on) {
    if (on && this.screen === 'play') {
      this.game.paused = true; this.showScreen('pause'); this.touch.reset(); input.clear();
    } else if (!on && this.screen === 'pause') {
      this.game.paused = false; this.showScreen('play'); input.clear();
    }
  }

  fadeTo(fn) {
    if (this.fading) { fn(); return; }
    this.fading = true;
    const el = $('fade');
    el.classList.add('on');
    setTimeout(() => {
      try { fn(); } catch (e) { console.error(e); }
      this.game.snapCamera?.();
      setTimeout(() => { el.classList.remove('on'); this.fading = false; }, 120);
    }, 420);
  }

  hint(key) {
    const H = {
      sword: IS_TOUCH ? 'Cerca de un guardia desenvainas solo. ACCIÓN ataca, ↑ para, ↓ envaina.' : 'Junto a un guardia desenvainas solo. Mayús ataca, ↑ para, ↓ envaina.',
      edge: 'Estás al borde. Salta, o pulsa ↓ para descolgarte.',
    };
    if (H[key] && !this['hinted_' + key]) { this['hinted_' + key] = true; this.hud.toast(H[key], 5); }
  }

  onResize() {
    this.renderer.resize();
    this.updateRotate();
  }
  // aviso para girar el móvil (solo jugando en vertical)
  updateRotate() {
    const portrait = innerHeight > innerWidth * 1.05;
    const on = portrait && IS_MOBILE && this.screen === 'play';
    $('rotate').classList.toggle('on', on);
    // mientras se ve el aviso, el juego se detiene (que no te maten sin ver nada)
    if (on !== !!this.rotPaused) {
      this.rotPaused = on;
      if (this.screen === 'play' && this.game) { this.game.paused = on; if (on) { this.touch.reset(); input.clear(); } }
    }
  }

  // ---------------------------------------------------------------- modo de pruebas (deterministas)
  setupTest() {
    this.testMode = true;
    const g = this.game;
    window.__test = {
      step: (n, keys = {}) => {
        for (const k of Object.keys(keys)) input.keys[k] = keys[k];
        for (let i = 0; i < n; i++) { input.update(1 / 60); g.update(1 / 60); }
        return window.__test.state();
      },
      release: () => { input.keys = {}; },
      state: () => {
        const p = g.player;
        return { x: +p.x.toFixed(3), y: +p.y.toFixed(3), col: p.col(), row: p.row(), st: p.state, hp: p.hp, max: p.maxHp, face: p.face, alive: p.alive, sword: p.hasSword, combat: p.inCombat,
          enemies: g.enemies.map((e) => ({ x: +e.x.toFixed(2), st: e.state, hp: e.hp, alive: e.alive })), gstate: g.state, level: g.def.id };
      },
      teleport: (c, r, face = 1) => { const lv = g.level; g.player.x = lv.cx(c); g.player.y = lv.floorY(r); g.player.setState('stand'); g.player.onGround = true; g.player.snapFace(face); g.snapCamera(); },
      render: () => { this.renderer.render(this.stage.scene, g.camera, g.time, this.grade()); },
    };
  }

  // ---------------------------------------------------------------- bucle
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    if (this.testMode && this.screen === 'play') {
      this.renderer.render(this.stage.scene, this.game.camera, this.game.time, this.grade());
      window.__frames = (window.__frames || 0) + 1;
      return;
    }
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, 1 / 20);
    input.update(dt);
    if (input.pressed.pause) { if (this.screen === 'play') this.pause(true); else if (this.screen === 'pause') this.pause(false); }
    const g = this.game;
    if (g.hitStop > 0) { g.hitStop -= dt; dt *= 0.15; }
    else if (g.slowmo > 0) { g.slowmo -= dt; dt *= 0.4; }
    if (this.screen !== 'pause') g.update(dt);
    // etiqueta contextual del botón de acción
    if (this.screen === 'play' && g.player) {
      const p = g.player;
      this.touch.setActionLabel(p.inCombat ? 'ATACAR' : g.itemNear(p) && p.state === 'stand' ? (g.itemNear(p).kind === 'sword' ? 'COGER' : 'BEBER') : 'ACCIÓN');
      this.touch.setJumpLabel(p.inCombat ? 'PARAR' : 'SALTAR');
    }
    // flash y fundidos
    const R = this.renderer;
    R.flash.amt = Math.max(0, R.flash.amt - dt * 1.6);
    R.render(this.stage.scene, g.camera, g.time, this.grade());
    if (!R.composer) $('flashCss').style.opacity = R.flash.amt * 0.6;
    R.adapt(dt);
    window.__frames = (window.__frames || 0) + 1;
  }
}

const app = new App();
window.__app = app;
app.boot().catch((e) => {
  console.error(e);
  $('loadText').textContent = 'Error al iniciar: ' + e.message;
});
