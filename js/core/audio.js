// Audio 100% sintetizado con WebAudio: efectos y música de inspiración persa (modo Hijaz).

const HIJAZ = [0, 1, 4, 5, 7, 8, 10];      // D Eb F# G A Bb C
const ROOT = 50;                           // D3
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
// refuerzo por efecto (medido renderizando cada sonido: los más débiles se suben)
const SFX_GAIN = 2.2;
const BOOST = {
  step: 2, jump: 5, landSoft: 2, hurt: 5, gateTick: 4, pick: 6, swing: 2, vanish: 3,
  looseRattle: 3, skid: 1.5, climb: 2, looseShake: 2, spikes: 1.5, chop: 1.6, bones: 1.5, plate: 1.5,
};
const deg = (d, oct = 0) => ROOT + 12 * (oct + Math.floor(d / 7)) + HIJAZ[((d % 7) + 7) % 7];

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.musicVol = 0.6; this.sfxVol = 0.85;
    this.pluckCache = new Map();
    this.musicMode = null;
    this.combat = 0; this.combatTarget = 0;
    this.listenerX = 0; this.listenerY = 0;
    this.lastPlay = {};
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = ctx.createGain(); this.master.gain.value = 1.0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = this.sfxVol; this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.musicVol; this.musicBus.connect(this.master);
    // reverberación de mazmorra
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.6, 2.4);
    this.revSend = ctx.createGain(); this.revSend.gain.value = 0.5;
    this.revSend.connect(this.reverb).connect(this.master);
    this.noiseBuf = this.makeNoise(2);
    this.startScheduler();
  }

  setVolumes(music, sfx) {
    this.musicVol = music; this.sfxVol = sfx;
    if (this.ctx) {
      this.musicBus.gain.setTargetAtTime(music, this.ctx.currentTime, 0.1);
      this.sfxBus.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.1);
    }
  }
  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }

  impulse(dur, decay) {
    const ctx = this.ctx, rate = ctx.sampleRate, len = Math.floor(rate * dur);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < rate * 0.02 ? i / (rate * 0.02) : 1);
      }
    }
    return buf;
  }
  makeNoise(dur) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ---------------------------------------------------------------- utilidades de síntesis
  out(pan = 0, rev = 0.2, vol = 1) {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = vol * SFX_GAIN;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p).connect(this.sfxBus); } else g.connect(this.sfxBus);
    if (rev > 0) { const s = ctx.createGain(); s.gain.value = rev; g.connect(s).connect(this.revSend); }
    return g;
  }
  noise(dest, t, dur, { type = 'bandpass', f0 = 1000, f1 = null, q = 1, a = 0.002, vol = 1, curve = 'exp' } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    else g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }
  tone(dest, t, dur, { type = 'sine', f0 = 440, f1 = null, a = 0.003, vol = 0.5, detune = 0 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type; o.detune.value = detune;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }
  metal(dest, t, base, dur, vol = 0.3) {
    const ratios = [1, 1.52, 2.07, 2.76, 3.41, 4.53];
    ratios.forEach((r, i) => this.tone(dest, t, dur * (1 - i * 0.12), { f0: base * r * (1 + (Math.random() - 0.5) * 0.01), vol: vol / (1 + i * 0.6), a: 0.001 }));
  }

  // ---------------------------------------------------------------- efectos
  play(name, x = null, y = null, opts = {}) {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    // limitar repeticiones exactas en el mismo instante
    if (this.lastPlay[name] && now - this.lastPlay[name] < (opts.minGap ?? 0.03)) return;
    this.lastPlay[name] = now;
    let pan = 0, att = 1;
    if (x !== null) {
      const dx = x - this.listenerX, dy = (y ?? this.listenerY) - this.listenerY;
      pan = Math.max(-0.8, Math.min(0.8, dx / 9));
      att = 1 / (1 + Math.max(0, Math.hypot(dx, dy * 1.3) - 5) * 0.18);
      if (att < 0.05) return;
    }
    const t = now + 0.005;
    const fn = SFX[name];
    if (fn) fn.call(this, t, pan, att * (BOOST[name] || 1), opts);
  }

  // ---------------------------------------------------------------- música
  pluckBuffer(midi, bright = 0.5, dur = 1.8) {
    const key = midi + ':' + bright;
    if (this.pluckCache.has(key)) return this.pluckCache.get(key);
    const ctx = this.ctx, rate = ctx.sampleRate;
    const f = midiHz(midi);
    const N = Math.max(2, Math.round(rate / f));
    const len = Math.floor(rate * dur);
    const buf = ctx.createBuffer(1, len, rate);
    const d = buf.getChannelData(0);
    const ring = new Float32Array(N);
    for (let i = 0; i < N; i++) ring[i] = (Math.random() * 2 - 1) * (0.6 + 0.4 * Math.sin(i / N * Math.PI));
    let idx = 0, prev = 0;
    const damp = 0.996 - (1 - bright) * 0.004;
    for (let i = 0; i < len; i++) {
      const cur = ring[idx];
      const nxt = ring[(idx + 1) % N];
      const v = (cur * (0.5 + bright * 0.2) + nxt * (0.5 - bright * 0.2)) * damp;
      ring[idx] = v;
      d[i] = cur * 0.9 + prev * 0.1;
      prev = cur;
      idx = (idx + 1) % N;
    }
    this.pluckCache.set(key, buf);
    return buf;
  }
  pluck(t, midi, vol = 0.3, pan = 0, bright = 0.55) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.pluckBuffer(midi, bright);
    const g = ctx.createGain(); g.gain.value = vol;
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    src.connect(g).connect(p).connect(this.musicBus);
    const s = ctx.createGain(); s.gain.value = 0.35; g.connect(s).connect(this.revSend);
    src.start(t);
  }
  ney(t, midi, dur, vol = 0.12) {
    const ctx = this.ctx;
    const f = midiHz(midi);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 2.001;
    const vib = ctx.createOscillator(); vib.frequency.value = 5.2;
    const vg = ctx.createGain(); vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * 0.012, t + Math.min(0.6, dur * 0.5));
    vib.connect(vg); vg.connect(o.frequency); vg.connect(o2.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.12);
    g.gain.setValueAtTime(vol, t + dur - 0.15);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    const g2 = ctx.createGain(); g2.gain.value = 0.18;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    o.connect(g); o2.connect(g2).connect(g);
    g.connect(lp).connect(this.musicBus);
    const s = ctx.createGain(); s.gain.value = 0.6; lp.connect(s).connect(this.revSend);
    // aliento
    this.noiseTo(this.musicBus, t, dur, f * 2, 0.02 * vol / 0.12);
    o.start(t); o2.start(t); vib.start(t);
    o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05); vib.stop(t + dur + 0.05);
  }
  noiseTo(dest, t, dur, freq, vol) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.1); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }
  drum(t, kind, vol = 0.4) {
    const ctx = this.ctx;
    const dest = ctx.createGain(); dest.gain.value = vol; dest.connect(this.musicBus);
    const s = ctx.createGain(); s.gain.value = 0.25; dest.connect(s).connect(this.revSend);
    if (kind === 'dum') {
      this.tone(dest, t, 0.45, { f0: 110, f1: 52, vol: 0.9, a: 0.002 });
      this.noise(dest, t, 0.12, { type: 'lowpass', f0: 500, vol: 0.4 });
    } else if (kind === 'tak') {
      this.noise(dest, t, 0.09, { type: 'bandpass', f0: 2600, q: 1.5, vol: 0.6 });
      this.tone(dest, t, 0.06, { f0: 420, vol: 0.2 });
    } else {
      // sonajas del daf
      this.noise(dest, t, 0.18, { type: 'highpass', f0: 6000, vol: 0.25 });
    }
  }
  drone(on) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (on && !this.droneNodes) {
      const g = ctx.createGain(); g.gain.value = 0.0001;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.7;
      const oscs = [deg(0, -1), deg(4, -1), deg(0, 0)].map((m, i) => {
        const o = ctx.createOscillator(); o.type = i === 2 ? 'triangle' : 'sawtooth'; o.frequency.value = midiHz(m); o.detune.value = (i - 1) * 4;
        o.connect(lp); o.start(); return o;
      });
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
      const lg = ctx.createGain(); lg.gain.value = 180; lfo.connect(lg).connect(lp.frequency); lfo.start();
      lp.connect(g).connect(this.musicBus);
      const s = ctx.createGain(); s.gain.value = 0.4; g.connect(s).connect(this.revSend);
      g.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 3);
      this.droneNodes = { g, oscs: [...oscs, lfo] };
    } else if (!on && this.droneNodes) {
      const dn = this.droneNodes; this.droneNodes = null;
      dn.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.6);
      setTimeout(() => dn.oscs.forEach((o) => o.stop()), 3000);
    }
  }

  setMusic(mode) {
    if (this.musicMode === mode) return;
    this.musicMode = mode;
    this.seqStep = 0;
    this.nextNote = this.ctx ? this.ctx.currentTime + 0.2 : 0;
    if (this.ctx) this.drone(mode === 'level' || mode === 'title' || mode === 'tower');
  }
  setCombat(on) { this.combatTarget = on ? 1 : 0; }

  startScheduler() {
    const tick = () => {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const ahead = this.ctx.currentTime + 0.3;
      while (this.nextNote < ahead) this.scheduleStep(this.nextNote);
    };
    this.seqStep = 0; this.nextNote = this.ctx.currentTime + 0.3;
    setInterval(tick, 90);
  }

  scheduleStep(t) {
    const mode = this.musicMode;
    const step = this.seqStep++;
    const beat = 0.22;               // corchea
    this.nextNote = t + beat;
    this.combat += (this.combatTarget - this.combat) * 0.08;
    if (!mode || mode === 'silent') return;
    const r = Math.random;
    if (mode === 'title') {
      const bar = Math.floor(step / 16) % 8, s = step % 16;
      const MEL = [
        [0, 4, 2, 0], [3, 2, 1, 0], [4, 5, 4, 2], [3, 1, 0, -1],
        [4, 6, 7, 6], [5, 4, 3, 4], [2, 1, 2, 0], [1, 0, -1, 0],
      ];
      if (s % 4 === 0) {
        const n = MEL[bar][s / 4];
        this.ney(t, deg(n, 1), beat * (s === 12 ? 4.5 : 3.8), 0.09);
      }
      if (s % 2 === 0) this.pluck(t, deg([0, 4, 7, 4, 2, 4, 7, 9][(s / 2) % 8] + (bar % 4 === 3 ? -1 : 0), 0), 0.12, (r() - 0.5) * 0.6, 0.45);
      if (s === 0) this.drum(t, 'dum', 0.3);
      if (s === 6 || s === 10) this.drum(t, 'tak', 0.18);
      if (s === 8) this.drum(t, 'dum', 0.22);
      return;
    }
    if (mode === 'level' || mode === 'tower') {
      // ambiente: notas sueltas de santur y algún suspiro de ney
      if (step % 4 === 0 && r() < 0.22) {
        const n = Math.floor(r() * 8);
        this.pluck(t, deg(n, mode === 'tower' ? 1 : 0), 0.07 + r() * 0.04, (r() - 0.5) * 0.8, 0.4);
        if (r() < 0.35) this.pluck(t + beat, deg(n - 1, mode === 'tower' ? 1 : 0), 0.05, (r() - 0.5) * 0.8, 0.4);
      }
      if (step % 64 === 0 && r() < 0.4) {
        const n = [0, 4, 2, 7][Math.floor(r() * 4)];
        this.ney(t, deg(n, 1), beat * 10, 0.045);
      }
      // percusión de combate
      if (this.combat > 0.3) {
        const s = step % 8;
        const v = this.combat;
        if (s === 0 || s === 3) this.drum(t, 'dum', 0.42 * v);
        if (s === 2 || s === 6) this.drum(t, 'tak', 0.26 * v);
        if (s === 5 || s === 7) this.drum(t, 'tak', 0.16 * v);
        if (s % 2 === 1) this.drum(t, 'jingle', 0.15 * v);
        if (s === 0 && step % 32 === 0) this.pluck(t, deg(0, -1), 0.22 * v, 0, 0.7);
        if (s === 4 && r() < 0.5) this.pluck(t, deg(Math.floor(r() * 4) + 3, 0), 0.12 * v, 0.2, 0.7);
      }
    }
  }

  // estribillos cortos
  sting(name) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.03;
    const b = 0.13;
    const seqs = {
      start: [[0, 0], [1, 4], [2, 5], [3, 7], [5, 9]],
      sword: [[0, 7], [1, 9], [2, 11], [3, 14], [4, 11], [5, 14], [6.5, 16]],
      potion: [[0, 7], [0.6, 11], [1.2, 14], [1.8, 18], [2.4, 21]],
      life: [[0, 0], [1, 4], [2, 7], [3, 11], [4, 14], [5, 18], [6, 21]],
      poison: [[0, 8], [1, 5], [2, 1], [3, -2]],
      death: [[0, 7], [1.5, 6], [3, 5], [4.5, 4], [6, 1], [8, 0]],
      victory: [[0, 0], [1, 4], [2, 7], [3, 11], [4, 9], [5, 11], [6, 14], [8, 14]],
      warn: [[0, 1], [1, 0], [2, 1], [3, 0]],
    };
    const s = seqs[name];
    if (!s) return;
    for (const [k, n] of s) {
      this.pluck(t + k * b, deg(n, 0), 0.4, (Math.random() - 0.5) * 0.4, 0.6);
      if (name === 'death' || name === 'victory' || name === 'start') this.pluck(t + k * b, deg(n - 7, 0), 0.22, 0, 0.5);
    }
    if (name === 'death') this.ney(t + 0.2, deg(0, 1), 2.2, 0.08);
    if (name === 'victory') { this.ney(t + 0.9, deg(7, 1), 1.6, 0.1); this.drum(t, 'dum', 0.5); this.drum(t + b * 6, 'dum', 0.5); }
    if (name === 'sword') { this.drum(t, 'dum', 0.4); }
  }
}

// ======================================================================== catálogo de efectos
const SFX = {
  step(t, pan, a) { const o = this.out(pan, 0.12, 0.5 * a); this.noise(o, t, 0.07, { type: 'lowpass', f0: 700, vol: 0.9 }); this.tone(o, t, 0.06, { f0: 90, f1: 60, vol: 0.4 }); },
  skid(t, pan, a) { const o = this.out(pan, 0.15, 0.35 * a); this.noise(o, t, 0.32, { type: 'bandpass', f0: 1800, f1: 700, q: 0.8, vol: 0.7, curve: 'lin' }); },
  jump(t, pan, a) { const o = this.out(pan, 0.15, 0.35 * a); this.noise(o, t, 0.22, { type: 'bandpass', f0: 500, f1: 1800, q: 0.7, vol: 0.6 }); },
  land(t, pan, a) { const o = this.out(pan, 0.25, 0.7 * a); this.noise(o, t, 0.16, { type: 'lowpass', f0: 500, vol: 0.9 }); this.tone(o, t, 0.15, { f0: 110, f1: 45, vol: 0.7 }); },
  landSoft(t, pan, a) { const o = this.out(pan, 0.2, 0.45 * a); this.noise(o, t, 0.1, { type: 'lowpass', f0: 600, vol: 0.8 }); this.tone(o, t, 0.1, { f0: 100, f1: 50, vol: 0.4 }); },
  landHard(t, pan, a) { const o = this.out(pan, 0.4, 0.95 * a); this.noise(o, t, 0.35, { type: 'lowpass', f0: 380, vol: 1 }); this.tone(o, t, 0.4, { f0: 90, f1: 32, vol: 0.9 }); this.noise(o, t + 0.02, 0.2, { type: 'bandpass', f0: 1200, vol: 0.3 }); },
  grab(t, pan, a) { const o = this.out(pan, 0.15, 0.5 * a); this.noise(o, t, 0.05, { type: 'highpass', f0: 1400, vol: 0.8 }); this.noise(o, t + 0.04, 0.05, { type: 'highpass', f0: 1200, vol: 0.5 }); },
  climb(t, pan, a) { const o = this.out(pan, 0.15, 0.4 * a); this.noise(o, t, 0.35, { type: 'bandpass', f0: 700, f1: 1200, q: 0.6, vol: 0.5, curve: 'lin' }); this.noise(o, t + 0.5, 0.12, { type: 'lowpass', f0: 600, vol: 0.6 }); },
  bump(t, pan, a) { const o = this.out(pan, 0.3, 0.7 * a); this.tone(o, t, 0.18, { f0: 140, f1: 60, vol: 0.8 }); this.noise(o, t, 0.12, { type: 'lowpass', f0: 800, vol: 0.6 }); },
  draw(t, pan, a) { const o = this.out(pan, 0.35, 0.5 * a); this.noise(o, t, 0.4, { type: 'bandpass', f0: 2500, f1: 7000, q: 3, vol: 0.5, curve: 'lin' }); this.metal(o, t + 0.25, 1900, 0.6, 0.12); },
  sheathe(t, pan, a) { const o = this.out(pan, 0.3, 0.4 * a); this.noise(o, t, 0.3, { type: 'bandpass', f0: 6000, f1: 2500, q: 3, vol: 0.45, curve: 'lin' }); this.tone(o, t + 0.28, 0.08, { f0: 300, vol: 0.4 }); },
  swing(t, pan, a) { const o = this.out(pan, 0.2, 0.5 * a); this.noise(o, t + 0.1, 0.18, { type: 'bandpass', f0: 700, f1: 2600, q: 1.2, vol: 0.7 }); },
  clang(t, pan, a) { const o = this.out(pan, 0.6, 0.9 * a); this.metal(o, t, 1250 + Math.random() * 300, 0.9, 0.3); this.noise(o, t, 0.06, { type: 'highpass', f0: 3000, vol: 0.9 }); },
  hit(t, pan, a) { const o = this.out(pan, 0.3, 0.8 * a); this.noise(o, t, 0.12, { type: 'bandpass', f0: 1800, f1: 600, q: 1, vol: 0.8 }); this.tone(o, t, 0.2, { f0: 160, f1: 70, vol: 0.7 }); },
  hurt(t, pan, a) { const o = this.out(pan, 0.3, 0.6 * a); this.tone(o, t, 0.22, { type: 'sawtooth', f0: 180, f1: 120, vol: 0.18 }); this.noise(o, t, 0.2, { type: 'bandpass', f0: 650, q: 4, vol: 0.4 }); },
  death(t, pan, a) { const o = this.out(pan, 0.6, 0.9 * a); this.tone(o, t, 1.2, { f0: 120, f1: 40, vol: 0.6 }); this.noise(o, t, 0.5, { type: 'lowpass', f0: 400, vol: 0.6 }); },
  gateTick(t, pan, a, o2) { const o = this.out(pan, 0.3, 0.35 * a); this.noise(o, t, 0.025, { type: 'bandpass', f0: o2.up ? 2600 : 2000, q: 4, vol: 1 }); this.tone(o, t, 0.05, { type: 'square', f0: 140, vol: 0.12 }); },
  gateShut(t, pan, a, o2) { const o = this.out(pan, 0.6, (o2.soft ? 0.6 : 1) * a); this.tone(o, t, 0.35, { f0: 90, f1: 40, vol: 0.9 }); this.metal(o, t, 420, 0.7, 0.18); this.noise(o, t, 0.2, { type: 'lowpass', f0: 1200, vol: 0.7 }); },
  plate(t, pan, a) { const o = this.out(pan, 0.3, 0.6 * a); this.tone(o, t, 0.12, { f0: 220, f1: 120, vol: 0.5 }); this.noise(o, t, 0.08, { type: 'bandpass', f0: 900, vol: 0.5 }); },
  looseShake(t, pan, a) { const o = this.out(pan, 0.3, 0.5 * a); for (let i = 0; i < 6; i++) this.noise(o, t + i * 0.06, 0.04, { type: 'bandpass', f0: 900 + Math.random() * 600, q: 2, vol: 0.6 }); },
  looseRattle(t, pan, a) { const o = this.out(pan, 0.3, 0.3 * a); for (let i = 0; i < 3; i++) this.noise(o, t + i * 0.05, 0.035, { type: 'bandpass', f0: 1100, q: 2, vol: 0.6 }); },
  looseCrash(t, pan, a) { const o = this.out(pan, 0.7, 1.0 * a); this.noise(o, t, 0.6, { type: 'lowpass', f0: 1500, f1: 300, vol: 1 }); this.tone(o, t, 0.4, { f0: 70, f1: 35, vol: 0.9 }); for (let i = 0; i < 8; i++) this.noise(o, t + 0.05 + Math.random() * 0.4, 0.05, { type: 'bandpass', f0: 1500 + Math.random() * 2000, q: 3, vol: 0.4 }); },
  spikes(t, pan, a) { const o = this.out(pan, 0.3, 0.6 * a); this.noise(o, t, 0.12, { type: 'highpass', f0: 3500, vol: 0.8 }); this.metal(o, t, 2600, 0.25, 0.06); },
  chop(t, pan, a) { const o = this.out(pan, 0.4, 0.55 * a); this.noise(o, t, 0.1, { type: 'bandpass', f0: 1500, f1: 4000, q: 1, vol: 0.6 }); this.metal(o, t + 0.07, 900, 0.3, 0.12); },
  pick(t, pan, a) { const o = this.out(pan, 0.3, 0.4 * a); this.metal(o, t, 2400, 0.25, 0.08); },
  drink(t, pan, a) { const o = this.out(pan, 0.2, 0.5 * a); for (let i = 0; i < 3; i++) this.tone(o, t + i * 0.18, 0.12, { f0: 320 - i * 30, f1: 180, vol: 0.5 }); },
  doorOpen(t, pan, a) { const o = this.out(pan, 0.6, 0.7 * a); this.noise(o, t, 2.6, { type: 'lowpass', f0: 300, f1: 180, vol: 0.7, a: 0.3, curve: 'lin' }); for (let i = 0; i < 14; i++) this.noise(o, t + i * 0.18, 0.06, { type: 'bandpass', f0: 600, q: 3, vol: 0.4 }); },
  mirror(t, pan, a) { const o = this.out(pan, 0.7, 0.9 * a); for (let i = 0; i < 30; i++) this.tone(o, t + Math.random() * 0.4, 0.15, { f0: 2000 + Math.random() * 5000, vol: 0.06 }); this.noise(o, t, 0.6, { type: 'highpass', f0: 2500, vol: 0.6 }); this.tone(o, t, 1.5, { f0: 200, f1: 60, vol: 0.4 }); },
  bones(t, pan, a) { const o = this.out(pan, 0.5, 0.7 * a); for (let i = 0; i < 16; i++) this.noise(o, t + Math.random() * 0.6, 0.04, { type: 'bandpass', f0: 1200 + Math.random() * 1800, q: 5, vol: 0.5 }); },
  vanish(t, pan, a) { const o = this.out(pan, 0.7, 0.5 * a); this.noise(o, t, 0.8, { type: 'bandpass', f0: 3000, f1: 300, q: 2, vol: 0.5 }); },
  merge(t, pan, a) { const o = this.out(pan, 0.8, 0.8 * a); this.tone(o, t, 2.5, { f0: 110, f1: 440, vol: 0.4 }); this.tone(o, t, 2.5, { f0: 165, f1: 660, vol: 0.3 }); this.noise(o, t, 2, { type: 'bandpass', f0: 400, f1: 4000, q: 2, vol: 0.4 }); },
  heartbeat(t, pan, a) { const o = this.out(0, 0.1, 0.5 * a); this.tone(o, t, 0.12, { f0: 60, f1: 40, vol: 0.8 }); this.tone(o, t + 0.2, 0.12, { f0: 55, f1: 38, vol: 0.6 }); },
  ui(t) { const o = this.out(0, 0.2, 0.35); this.pluck(t, deg(7, 0), 0.25, 0, 0.7); void o; },
};

export const audio = new Audio();
