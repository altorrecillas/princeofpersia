// Sistema de partículas en CPU con dos capas (aditiva y normal) dibujadas como puntos con shader propio.
import * as THREE from 'three';
import { mulberry32 } from '../core/utils.js';

const VERT = /* glsl */`
  attribute float aSize; attribute vec4 aColor; attribute float aSpin;
  varying vec4 vColor; varying float vSpin;
  uniform float uScale;
  void main(){
    vColor = aColor; vSpin = aSpin;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = /* glsl */`
  varying vec4 vColor; varying float vSpin;
  uniform float uSoft;
  void main(){
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p);
    float a;
    if (vSpin > 0.5) {
      // estrella (destello)
      float s = max(1.0 - abs(p.x) * 9.0, 0.0) * (1.0 - abs(p.y)*2.0) + max(1.0 - abs(p.y) * 9.0, 0.0) * (1.0 - abs(p.x)*2.0);
      a = clamp(s + smoothstep(0.25, 0.0, d), 0.0, 1.0);
    } else {
      a = smoothstep(0.5, 0.5 - uSoft, d);
    }
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor.rgb, vColor.a * a);
  }`;

class Layer {
  constructor(max, additive) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.spin = new Float32Array(max);
    // estado
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.rgba = new Float32Array(max * 4);
    this.floor = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aSpin = new THREE.BufferAttribute(this.spin, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('aColor', this.aCol); g.setAttribute('aSize', this.aSize); g.setAttribute('aSpin', this.aSpin);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 300 }, uSoft: { value: additive ? 0.5 : 0.25 } },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 8 : 7;
  }
  spawn(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, grav = 0, drag = 0, star = 0, floorY = -1e9) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.size0[i] = s0; this.size1[i] = s1;
    this.rgba[i * 4] = r; this.rgba[i * 4 + 1] = g; this.rgba[i * 4 + 2] = b; this.rgba[i * 4 + 3] = a;
    this.grav[i] = grav; this.drag[i] = drag; this.spin[i] = star; this.floor[i] = floorY;
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.kill(i); continue; }
      const k = i * 3;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[k] *= dr; this.vel[k + 1] = this.vel[k + 1] * dr - this.grav[i] * dt; this.vel[k + 2] *= dr;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < this.floor[i]) { this.pos[k + 1] = this.floor[i]; this.vel[k + 1] *= -0.25; this.vel[k] *= 0.5; this.vel[k + 2] *= 0.5; }
      const t = 1 - this.life[i] / this.maxLife[i];
      this.size[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      const fade = t < 0.1 ? t / 0.1 : 1 - Math.max(0, (t - 0.55) / 0.45);
      this.col[i * 4] = this.rgba[i * 4]; this.col[i * 4 + 1] = this.rgba[i * 4 + 1]; this.col[i * 4 + 2] = this.rgba[i * 4 + 2];
      this.col[i * 4 + 3] = this.rgba[i * 4 + 3] * fade;
      i++;
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = this.aSpin.needsUpdate = true;
  }
  kill(i) {
    const j = --this.n;
    if (i === j) return;
    const c3 = (a) => { a[i * 3] = a[j * 3]; a[i * 3 + 1] = a[j * 3 + 1]; a[i * 3 + 2] = a[j * 3 + 2]; };
    const c4 = (a) => { a[i * 4] = a[j * 4]; a[i * 4 + 1] = a[j * 4 + 1]; a[i * 4 + 2] = a[j * 4 + 2]; a[i * 4 + 3] = a[j * 4 + 3]; };
    c3(this.pos); c3(this.vel); c4(this.rgba); c4(this.col);
    for (const a of [this.life, this.maxLife, this.grav, this.drag, this.size0, this.size1, this.size, this.spin, this.floor]) a[i] = a[j];
  }
  clear() { this.n = 0; this.points.geometry.setDrawRange(0, 0); }
}

export class FX {
  constructor(scene, quality) {
    this.q = quality;
    this.add = new Layer(2500, true);
    this.norm = new Layer(1500, false);
    scene.add(this.add.points, this.norm.points);
    this.rng = mulberry32(99);
    this.emitters = [];   // antorchas
    this.dustBox = null;
    this.t = 0;
    this.level = null;
  }
  r() { return this.rng(); }
  setScale(h) { this.add.mat.uniforms.uScale.value = h * 0.9; this.norm.mat.uniforms.uScale.value = h * 0.9; }
  clear() { this.add.clear(); this.norm.clear(); }

  setLevel(level) {
    this.level = level;
    this.emitters = (level.lightSources || []).filter((s) => s.torch).map((s) => ({ x: s.pos.x, y: s.pos.y - 0.12, z: -1.5, acc: 0 }));
    this.clear();
  }

  update(dt, cam) {
    this.t += dt;
    const k = this.q.particles;
    // brasas de antorcha
    for (const e of this.emitters) {
      if (Math.abs(e.x - cam.x) > 14 || Math.abs(e.y - cam.y) > 8) continue;
      e.acc += dt * 9 * k;
      while (e.acc > 1) {
        e.acc -= 1;
        this.add.spawn(e.x + (this.r() - 0.5) * 0.1, e.y + 0.1, e.z + (this.r() - 0.5) * 0.1,
          (this.r() - 0.5) * 0.3, 0.5 + this.r() * 0.8, (this.r() - 0.2) * 0.2,
          0.8 + this.r() * 1.2, 0.05, 0.015, 2.4, 1.0, 0.3, 1, -0.4, 0.6);
      }
    }
    // motas de polvo que flotan ante la cámara
    const nd = this.q.dust;
    this.dustAcc = (this.dustAcc || 0) + dt * nd / 8;
    while (this.dustAcc > 1) {
      this.dustAcc -= 1;
      const x = cam.x + (this.r() - 0.5) * 18, y = cam.y + (this.r() - 0.5) * 9, z = -1.6 + this.r() * 3.6;
      const warm = this.r();
      this.norm.spawn(x, y, z, (this.r() - 0.5) * 0.08, (this.r() - 0.5) * 0.06, 0, 6 + this.r() * 4, 0.035, 0.035,
        0.9, 0.82 * (0.9 + warm * 0.1), 0.7, 0.35, -0.002, 0.05);
    }
    this.add.update(dt);
    this.norm.update(dt);
  }

  // ---------------------------------------------------------------- efectos puntuales
  dust(x, y, amt = 1) {
    const n = Math.round(14 * amt * this.q.particles);
    for (let i = 0; i < n; i++) {
      const s = this.r() < 0.5 ? -1 : 1;
      this.norm.spawn(x + (this.r() - 0.5) * 0.4, y + 0.05, (this.r() - 0.5) * 1.2, s * (0.6 + this.r() * 1.4) * amt, 0.2 + this.r() * 0.5, (this.r() - 0.5) * 0.6,
        0.6 + this.r() * 0.7, 0.18, 0.55 + amt * 0.2, 0.52, 0.46, 0.4, 0.4, 0.2, 2.5);
    }
  }
  sparks(x, y, z = 0.2, dir = 1) {
    const n = Math.round(26 * this.q.particles + 8);
    for (let i = 0; i < n; i++) {
      const a = (this.r() - 0.5) * Math.PI * 1.2 + (dir > 0 ? 0 : Math.PI);
      const sp = 2 + this.r() * 5;
      this.add.spawn(x, y, z, Math.cos(a) * sp, Math.sin(a) * sp + 1.5, (this.r() - 0.5) * 2,
        0.25 + this.r() * 0.35, 0.07, 0.02, 3.2, 2.4, 1.2, 1, 9, 1.5);
    }
    this.add.spawn(x, y, z + 0.05, 0, 0, 0, 0.16, 1.1, 0.4, 3, 2.6, 1.8, 1, 0, 0, 1);
  }
  blood(x, y, amt = 1) {
    const n = Math.round(16 * amt * this.q.particles + 4);
    const fy = this.level ? this.level.floorY(this.level.rowOfFeet(y - 0.9)) : y - 1;
    for (let i = 0; i < n; i++) {
      this.norm.spawn(x + (this.r() - 0.5) * 0.2, y + (this.r() - 0.5) * 0.3, 0.1, (this.r() - 0.5) * 2.4, this.r() * 2.2, (this.r() - 0.5) * 1,
        0.6 + this.r() * 0.5, 0.06, 0.05, 0.42, 0.02, 0.02, 0.95, 9, 0.5, 0, fy + 0.01);
    }
  }
  // gravilla que cae de una baldosa que tiembla
  grit(x, y) {
    const n = Math.round(10 * this.q.particles + 3);
    for (let i = 0; i < n; i++) {
      this.norm.spawn(x + (this.r() - 0.5) * 1.0, y, (this.r() - 0.5) * 2.0, (this.r() - 0.5) * 0.3, -this.r() * 0.5, 0,
        0.9 + this.r() * 0.5, 0.04, 0.03, 0.5, 0.46, 0.4, 0.9, 9, 0.2);
    }
  }
  debris(x, y) {
    const n = Math.round(28 * this.q.particles + 8);
    for (let i = 0; i < n; i++) {
      this.norm.spawn(x + (this.r() - 0.5) * 1.0, y + 0.1, (this.r() - 0.5) * 2.2, (this.r() - 0.5) * 3.2, 1 + this.r() * 3, (this.r() - 0.5) * 1.5,
        0.7 + this.r() * 0.6, 0.06 + this.r() * 0.06, 0.05, 0.42, 0.4, 0.38, 1, 12, 0.5, 0, y + 0.02);
    }
    this.dust(x, y, 1.6);
    this.dust(x, y, 1.0);
  }
  bones(x, y) {
    for (let i = 0; i < 40; i++) {
      this.norm.spawn(x + (this.r() - 0.5) * 0.5, y + 0.2 + this.r() * 1.4, (this.r() - 0.5) * 0.5, (this.r() - 0.5) * 4, 1 + this.r() * 3, (this.r() - 0.5) * 2,
        1.2 + this.r(), 0.09, 0.07, 0.86, 0.82, 0.7, 1, 12, 0.6, 0, y + 0.03);
    }
    this.dust(x, y, 1.8);
  }
  smoke(x, y) {
    for (let i = 0; i < 30; i++) {
      this.norm.spawn(x + (this.r() - 0.5) * 0.6, y + (this.r() - 0.5) * 1.4, (this.r() - 0.5) * 0.5, (this.r() - 0.5) * 0.8, 0.3 + this.r() * 0.6, 0,
        1 + this.r(), 0.3, 1.0, 0.18, 0.1, 0.25, 0.6, -0.2, 1.2);
    }
  }
  glint(actor) {
    const tip = actor.char.sword;
    if (!tip) return;
    const v = new THREE.Vector3(0, 0.85, 0);
    tip.localToWorld(v);
    this.add.spawn(v.x, v.y, v.z + 0.1, 0, 0, 0, 0.22, 0.9, 0.1, 3, 2.8, 2.2, 1, 0, 0, 1);
  }
  sparkle(x, y, color, n = 40) {
    for (let i = 0; i < n * this.q.particles; i++) {
      const a = this.r() * Math.PI * 2, r = 0.3 + this.r() * 0.4;
      this.add.spawn(x + Math.cos(a) * r, y + this.r() * 1.8, 0.2 + Math.sin(a) * r, -Math.sin(a) * 0.8, 0.4 + this.r() * 0.8, Math.cos(a) * 0.8,
        0.8 + this.r() * 0.8, 0.09, 0.02, color.r * 2.5, color.g * 2.5, color.b * 2.5, 1, -0.3, 0.5, this.r() < 0.2 ? 1 : 0);
    }
  }
  shards(x, y) {
    for (let i = 0; i < 60; i++) {
      this.add.spawn(x + (this.r() - 0.5) * 0.9, y + this.r() * 2, 0.1, (this.r() - 0.5) * 5, this.r() * 3, (this.r() - 0.2) * 3,
        0.8 + this.r() * 0.7, 0.08, 0.04, 1.2, 1.5, 2.4, 1, 10, 0.4, this.r() < 0.3 ? 1 : 0);
    }
  }
}
