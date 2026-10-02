// Escena: luces (ambiente, luz principal con sombras, reserva de luces de antorcha), niebla y entorno.
import * as THREE from 'three';
import { RoomEnvironment } from './roomenv.js';

export class Stage {
  constructor(renderer, quality) {
    this.renderer = renderer;
    this.q = quality;
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x030305);
    scene.fog = new THREE.FogExp2(0x07080d, 0.035);

    this.hemi = new THREE.HemisphereLight(0x5a6c94, 0x2a1d14, 0.9);
    scene.add(this.hemi);

    // luz principal suave desde delante-arriba (da volumen y proyecta sombras de los personajes)
    this.key = new THREE.DirectionalLight(0xc8d4ff, 0.55);
    this.key.position.set(-3, 7, 9);
    this.key.target.position.set(0, 0, 0);
    scene.add(this.key, this.key.target);
    if (quality.shadows) {
      this.key.castShadow = true;
      const s = this.key.shadow;
      s.mapSize.set(quality.shadowSize, quality.shadowSize);
      s.camera.left = -9; s.camera.right = 9; s.camera.top = 6; s.camera.bottom = -6;
      s.camera.near = 1; s.camera.far = 30;
      s.bias = -0.0006; s.normalBias = 0.03;
      s.radius = 3;
    }

    // luz de antorcha con sombra (sigue a la antorcha más cercana al príncipe)
    this.torchSpot = null;
    if (quality.shadows) {
      const sp = new THREE.SpotLight(0xff9a4a, 0, 12, 1.2, 0.9, 1.6);
      sp.castShadow = true;
      sp.shadow.mapSize.set(quality.shadowSize / 2, quality.shadowSize / 2);
      sp.shadow.camera.near = 0.3; sp.shadow.camera.far = 12;
      sp.shadow.bias = -0.0008; sp.shadow.normalBias = 0.02;
      scene.add(sp, sp.target);
      this.torchSpot = { light: sp, src: null, w: 0, pending: null };
    }

    // reserva de luces puntuales para antorchas y lámparas
    this.pool = [];
    for (let i = 0; i < quality.lights; i++) {
      const l = new THREE.PointLight(0xff8a3a, 0, 12, 1.75);
      scene.add(l);
      this.pool.push({ light: l, src: null, w: 0 });
    }
    this.sources = [];
    this.reassignT = 0;
    this.time = 0;

    // entorno para reflejos (metales, mármol, cristal)
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = this.envMap;
    scene.environmentIntensity = 0.25;
    pmrem.dispose();
  }

  setTheme(theme) {
    const s = this.scene;
    if (theme === 'palace') {
      s.fog.color.set(0x0a0c18); s.fog.density = 0.028;
      this.hemi.color.set(0x7d8cc4); this.hemi.groundColor.set(0x3a2a1a); this.hemiBase = 1.15;
      this.key.color.set(0xb4c4ff); this.key.intensity = 0.8;
      s.environmentIntensity = 0.45;
    } else {
      s.fog.color.set(0x080a12); s.fog.density = 0.03;
      this.hemi.color.set(0x7482a6); this.hemi.groundColor.set(0x3a2c20); this.hemiBase = 1.45;
      this.key.color.set(0xb8c6ff); this.key.intensity = 0.75;
      s.environmentIntensity = 0.22;
    }
    this.setBrightness(this.brightness ?? 1, this.ambientGain ?? 0.8);
  }

  // brillo del jugador: sube la luz ambiente (en calidad baja, sin posprocesado, es lo que más aclara)
  setBrightness(b, gain) {
    this.brightness = b; this.ambientGain = gain;
    this.hemi.intensity = (this.hemiBase ?? 0.9) * Math.max(0.5, 1 + (b - 1) * gain);
  }

  setSources(list) {
    this.sources = list || [];
    for (const p of this.pool) { p.src = null; p.w = 0; p.light.intensity = 0; }
    if (this.torchSpot) { this.torchSpot.src = null; this.torchSpot.w = 0; this.torchSpot.light.intensity = 0; }
    this.reassignT = 0;
  }

  flicker(src, t) {
    const s = src.seed;
    return 0.86 + Math.sin(t * 8.7 + s) * 0.06 + Math.sin(t * 17.3 + s * 2.1) * 0.05 + Math.sin(t * 31.1 + s * 0.7) * 0.03;
  }

  update(dt, focus, playerPos) {
    this.time += dt;
    const t = this.time;
    // luz principal y su sombra siguen a la cámara
    this.key.position.set(focus.x - 3, focus.y + 7, 9);
    this.key.target.position.set(focus.x, focus.y, 0);

    // sombra de antorcha: la fuente más cercana al jugador (dentro de 5.5 m)
    const ts = this.torchSpot;
    if (ts && playerPos) {
      let best = null, bd = 5.5 * 5.5;
      for (const s of this.sources) {
        const dx = s.pos.x - playerPos.x, dy = s.pos.y - (playerPos.y + 1);
        const d = dx * dx + dy * dy * 2.5;
        if (d < bd) { bd = d; best = s; }
      }
      if (best !== ts.src) {
        ts.w = Math.max(0, ts.w - dt * 4);
        if (ts.w <= 0) { ts.src = best; }
      } else if (best) ts.w = Math.min(1, ts.w + dt * 3);
      if (ts.src) {
        ts.light.position.copy(ts.src.pos).add(new THREE.Vector3(0, 0.1, 0.15));
        ts.light.target.position.set(playerPos.x, playerPos.y + 0.6, 0);
        ts.light.color.copy(ts.src.color);
        ts.light.intensity = ts.src.intensity * 0.75 * ts.w * this.flicker(ts.src, t);
      } else ts.light.intensity = 0;
    }

    // reasignar las luces de la reserva a las fuentes más cercanas al foco
    this.reassignT -= dt;
    if (this.reassignT <= 0) {
      this.reassignT = 0.2;
      const cand = this.sources
        .map((s) => ({ s, d: (s.pos.x - focus.x) ** 2 + ((s.pos.y - focus.y) * 1.4) ** 2 }))
        .filter((o) => o.d < 15 * 15)
        .sort((a, b) => a.d - b.d)
        .slice(0, this.pool.length)
        .map((o) => o.s);
      this.desired = new Set(cand);
      for (const p of this.pool) if (p.src && !this.desired.has(p.src)) p.leaving = true; else p.leaving = false;
      for (const s of cand) {
        if (this.pool.some((p) => p.src === s)) continue;
        const free = this.pool.find((p) => !p.src);
        if (free) { free.src = s; free.w = 0; free.leaving = false; }
      }
    }
    for (const p of this.pool) {
      if (!p.src) { p.light.intensity = 0; continue; }
      if (p.leaving) {
        p.w -= dt * 3;
        if (p.w <= 0) { p.w = 0; p.src = null; p.light.intensity = 0; continue; }
      } else p.w = Math.min(1, p.w + dt * 3);
      const s = p.src;
      p.light.color.copy(s.color);
      p.light.position.set(s.pos.x + Math.sin(t * 5.3 + s.seed) * 0.04, s.pos.y + Math.sin(t * 7.1 + s.seed) * 0.03, s.pos.z);
      const share = s === ts?.src ? 1 - 0.45 * ts.w : 1;
      p.light.intensity = s.intensity * p.w * share * this.flicker(s, t);
    }
  }
}
