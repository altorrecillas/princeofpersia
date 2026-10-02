// Nivel: lectura del mapa, consultas de colisión y objetos dinámicos (trampas, puertas, objetos).
import * as THREE from 'three';
import { TW, RH, SLAB, ZB, ZF, HEADROOM } from '../core/config.js';
import { clamp, hash2, mulberry32, smooth } from '../core/utils.js';
import { getTextures } from './textures.js';
import { buildStatic, makeLevelMaterials, slabGeometry } from './builder.js';
import * as P from './props.js';
import { mergeParts } from '../core/merge.js';
import { autoDecorate } from './decor.js';
import { buildArchitecture, updateArchitecture } from './architecture.js';

// Códigos del mapa. Cada celda son 2 caracteres: estructura + contenido.
const TYPES = {
  '#': 'wall', '.': 'empty', '_': 'floor', '|': 'pillar', 'I': 'pillarfg', 'L': 'loose', '^': 'spikes',
  'X': 'chopper', 'G': 'gate', 'g': 'gate', 'P': 'plate', 'D': 'drop', 'E': 'exit', 'S': 'start',
  'M': 'mirror', 'B': 'rubble', '~': 'ghost', '=': 'carpet',
};
const SLAB_TYPES = new Set(['floor', 'pillar', 'pillarfg', 'spikes', 'chopper', 'gate', 'plate', 'drop', 'exit', 'start', 'mirror', 'rubble', 'carpet']);
const LINKED = new Set(['G', 'g', 'P', 'D', 'E']);
const POTIONS = { h: 'heal', j: 'life', p: 'poison', f: 'float', u: 'flip' };

export class Level {
  constructor(def, ctx) {
    this.def = def;
    this.ctx = ctx;
    this.theme = def.theme || 'dungeon';
    this.palace = this.theme === 'palace';
    this.group = new THREE.Group();
    this.dynamic = new THREE.Group();
    this.group.add(this.dynamic);
    this.time = 0;
    this.events = [];       // eventos para el juego (sonidos, temblores...)
    this.parse(def);
  }

  // ------------------------------------------------------------------ lectura
  parse(def) {
    // filas escritas como fichas separadas por espacios ("## __ _t L. ...") o como pares de caracteres
    const map = def.map.map((line) => (line.includes(' ')
      ? line.trim().split(/\s+/).map((tk) => (tk.length === 1 ? tk + '.' : tk.slice(0, 2))).join('')
      : line));
    this.rows = map.length;
    this.cols = Math.floor(map[0].length / 2);
    this.t = []; this.aux = [];
    this.gates = []; this.plates = []; this.doors = []; this.looses = []; this.spikes = []; this.choppers = [];
    this.items = []; this.torches = []; this.decor = []; this.enemySpawns = []; this.mirrors = []; this.checkpoints = [];
    this.lamps = []; this.ghosts = [];
    this.start = { c: 1, r: 0, face: 1 };
    for (let r = 0; r < this.rows; r++) {
      const line = map[r];
      if (line.length !== this.cols * 2) console.warn(`Nivel ${def.id}: fila ${r} mide ${line.length} (esperado ${this.cols * 2})`);
      const tr = [], ar = [];
      for (let c = 0; c < this.cols; c++) {
        const a = line[c * 2] || '#', b = line[c * 2 + 1] || ' ';
        const type = TYPES[a] || 'floor';
        tr.push(type); ar.push(b);
      }
      this.t.push(tr); this.aux.push(ar);
    }
    // vacío encima de muro = suelo
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      if (this.t[r][c] === 'empty' && (r + 1 >= this.rows || this.t[r + 1][c] === 'wall')) this.t[r][c] = 'floor';
    }
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      const ch = map[r][c * 2], b = this.aux[r][c];
      const type = this.t[r][c];
      if (LINKED.has(ch)) {
        if (type === 'gate') this.gates.push({ c, r, id: b, startOpen: ch === 'g' });
        else if (type === 'plate') this.plates.push({ c, r, id: b, raise: true });
        else if (type === 'drop') this.plates.push({ c, r, id: b, raise: false });
        else if (type === 'exit') this.doors.push({ c, r, id: b, exit: true });
        continue;
      }
      if (type === 'start') this.doors.push({ c, r, id: '-', exit: false });
      if (type === 'loose') this.looses.push({ c, r });
      if (type === 'spikes') this.spikes.push({ c, r });
      if (type === 'chopper') this.choppers.push({ c, r });
      if (type === 'mirror') this.mirrors.push({ c, r });
      if (type === 'ghost') this.ghosts.push({ c, r });
      if (b === 't') this.torches.push({ c, r });
      else if (b === 'l') this.lamps.push({ c, r });
      else if (POTIONS[b]) this.items.push({ c, r, kind: POTIONS[b] });
      else if (b === 's') this.items.push({ c, r, kind: 'sword' });
      else if (b === '>' || b === '<') this.start = { c, r, face: b === '>' ? 1 : -1 };
      else if (b === '!') this.checkpoints.push({ c, r });
      else if (b >= 'A' && b <= 'Z') this.enemySpawns.push({ c, r, key: b, ...(def.enemies?.[b] || { type: 'guard' }) });
      else if ('wacbkvrno'.includes(b) && b !== ' ' && b !== '.') this.decor.push({ c, r, kind: b });
    }
    // campos explícitos (niveles originales): inicio, enemigos y enlaces placa -> rastrillos/puertas
    if (def.start) this.start = { ...def.start };
    if (def.spawns) for (const sp of def.spawns) this.enemySpawns.push({ ...sp });
    this.plateTargets = new Map();
    if (def.links) for (const [c, r, t] of def.links) this.plateTargets.set(c + ',' + r, t);
    this.rooms = def.rooms || null;
  }

  // origen (columna, fila) de una sala del nivel original
  roomCell(room, col = 0, row = 0) {
    const o = this.rooms && this.rooms[room];
    return o ? { c: o[0] + col, r: o[1] + row } : null;
  }
  roomOf(x, y) {
    if (!this.rooms) return 0;
    const c = this.colOf(x), r = this.rowOfFeet(y);
    for (const [k, o] of Object.entries(this.rooms)) if (c >= o[0] && c < o[0] + 10 && r >= o[1] && r < o[1] + 3) return +k;
    return 0;
  }

  // ------------------------------------------------------------------ geometría
  B(r) { return (this.rows - 1 - r) * RH; }
  floorY(r) { return this.B(r) + SLAB; }
  cx(c) { return (c + 0.5) * TW; }
  colOf(x) { return Math.floor(x / TW); }
  rowOfY(y) { return this.rows - 1 - Math.floor((y + 1e-4) / RH); }
  // fila en la que está alguien con los pies en y (los pies sobre el suelo de esa fila)
  rowOfFeet(y) { return this.rows - 1 - Math.floor((y - SLAB + 0.05) / RH); }

  inBounds(c, r) { return c >= 0 && c < this.cols && r >= 0 && r < this.rows; }
  type(c, r) {
    if (r >= this.rows) return 'wall';
    if (!this.inBounds(c, r)) return 'wall';
    return this.t[r][c];
  }
  isSolidStatic(c, r) { return this.type(c, r) === 'wall'; }
  hasSlabStatic(c, r) { return this.inBounds(c, r) && SLAB_TYPES.has(this.t[r][c]); }
  isSolid(c, r) { return this.type(c, r) === 'wall'; }
  hasFloor(c, r) {
    if (r >= this.rows) return true;
    const t = this.type(c, r);
    if (t === 'wall') return false;
    if (t === 'ghost') return this.ghostActive !== false;
    return SLAB_TYPES.has(t) || t === 'loose';
  }
  isOpen(c, r) { return !this.isSolid(c, r) && !this.hasFloor(c, r); }

  gateAt(c, r) { return this.gateMap?.get(c + ',' + r) || null; }
  looseAt(c, r) { return this.looseMap?.get(c + ',' + r) || null; }
  spikesAt(c, r) { return this.spikeMap?.get(c + ',' + r) || null; }
  chopperAt(c, r) { return this.chopMap?.get(c + ',' + r) || null; }
  plateAt(c, r) { return this.plateMap?.get(c + ',' + r) || null; }
  mirrorAt(c, r) { return this.mirrorMap?.get(c + ',' + r) || null; }
  doorAt(c, r) { return this.doorMap?.get(c + ',' + r) || null; }

  // ¿Bloquea la celda el paso horizontal a la altura de la fila r? (muro o rastrillo cerrado)
  // Devuelve el límite de x para quien se mueve desde x en dirección d, o null.
  limitX(x, nx, r, half, opts = {}) {
    const d = nx > x ? 1 : -1;
    let lim = nx;
    const c0 = this.colOf(x);
    const c1 = this.colOf(nx + d * half);
    for (let c = c0; d > 0 ? c <= c1 : c >= c1; c += d) {
      if (c !== c0 && this.isSolid(c, r)) {
        const wx = d > 0 ? c * TW - half : (c + 1) * TW + half;
        lim = d > 0 ? Math.min(lim, wx) : Math.max(lim, wx);
        break;
      }
      const g = this.gateAt(c, r);
      if (g && g.blocks() && !opts.ignoreGates) {
        const gx = this.cx(c);
        if (d > 0 && x <= gx - 0.02) lim = Math.min(lim, gx - half * 0.75);
        if (d < 0 && x >= gx + 0.02) lim = Math.max(lim, gx + half * 0.75);
      }
      const m = this.mirrorAt(c, r);
      if (m && m.blocks() && !opts.throughMirror) {
        const gx = m.x;
        if (d > 0 && x <= gx - 0.02) lim = Math.min(lim, gx - half);
        if (d < 0 && x >= gx + 0.02) lim = Math.max(lim, gx + half);
      }
    }
    return lim;
  }

  // ------------------------------------------------------------------ construcción
  build(quality) {
    const tex = getTextures(this.theme, quality.tex);
    this.tex = tex;
    const mats = makeLevelMaterials(tex, this.theme);
    this.mats = mats;
    this.group.add(buildStatic(this, mats));
    this.gateMap = new Map(); this.looseMap = new Map(); this.spikeMap = new Map(); this.chopMap = new Map();
    this.plateMap = new Map(); this.mirrorMap = new Map(); this.doorMap = new Map();

    for (const g of this.gates) { const e = new Gate(this, g); this.gateMap.set(g.c + ',' + g.r, e); g.ent = e; }
    for (const p of this.plates) { const e = new Plate(this, p); this.plateMap.set(p.c + ',' + p.r, e); p.ent = e; }
    for (const d of this.doors) { const e = new Door(this, d); this.doorMap.set(d.c + ',' + d.r, e); d.ent = e; }
    for (const l of this.looses) { const e = new Loose(this, l); this.looseMap.set(l.c + ',' + l.r, e); l.ent = e; }
    for (const s of this.spikes) { const e = new Spikes(this, s); this.spikeMap.set(s.c + ',' + s.r, e); s.ent = e; }
    for (const s of this.choppers) { const e = new Chopper(this, s); this.chopMap.set(s.c + ',' + s.r, e); s.ent = e; }
    for (const m of this.mirrors) { const e = new Mirror(this, m); this.mirrorMap.set(m.c + ',' + m.r, e); m.ent = e; }
    this.ghostEnts = this.ghosts.map((g) => new Ghost(this, g));
    this.itemEnts = this.items.map((it) => new Item(this, it));
    this.rubbles = [];
    this.buildDecor();
    this.buildPillars();
    const carpets = [];
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      if (this.t[r][c] === 'rubble') this.addRubble(c, r, hash2(c, r, 7) * 1000);
      if (this.t[r][c] === 'carpet') carpets.push([c, r]);
    }
    this.addCarpets(carpets);
    autoDecorate(this);
    buildArchitecture(this);
    mergeParts(this.group);
    return this.group;
  }

  buildPillars() {
    this.fgPillars = [];
    const prof = [];
    const p = this.palace;
    const H = HEADROOM;
    const rad = p ? 0.15 : 0.19;
    const pts = [[0, 0], [rad + 0.11, 0], [rad + 0.11, 0.1], [rad + 0.06, 0.14], [rad + 0.03, 0.22], [rad, 0.26],
      [rad * 0.93, H * 0.5], [rad, H - 0.36], [rad + 0.04, H - 0.3], [rad + 0.03, H - 0.26], [rad + 0.13, H - 0.14], [rad + 0.16, H - 0.12], [rad + 0.16, H], [0, H]];
    for (const [r, y] of pts) prof.push(new THREE.Vector2(r, y));
    const geo = new THREE.LatheGeometry(prof, 18);
    const mat = p
      ? new THREE.MeshStandardMaterial({ color: 0xe9dfcf, roughness: 0.32, normalMap: this.tex.floorTop.normalMap, normalScale: new THREE.Vector2(0.3, 0.3) })
      : new THREE.MeshStandardMaterial({ map: this.tex.wallSolid.map, normalMap: this.tex.wallSolid.normalMap, roughness: 0.9, color: 0xbab4ac });
    const ringMat = new THREE.MeshStandardMaterial({ color: p ? 0xc39a48 : 0x4e4a46, metalness: p ? 1 : 0.2, roughness: 0.35 });
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      const t = this.t[r][c];
      if (t !== 'pillar' && t !== 'pillarfg') continue;
      const fg = t === 'pillarfg';
      const m = new THREE.Mesh(geo, fg ? mat.clone() : mat);
      m.position.set(this.cx(c), this.floorY(r), fg ? ZF - 0.32 : ZB + 0.42);
      m.castShadow = !fg; m.receiveShadow = true;
      if (p) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(rad + 0.01, 0.025, 6, 18), ringMat);
        ring.rotation.x = Math.PI / 2; ring.position.y = H * 0.62; m.add(ring);
        const ring2 = ring.clone(); ring2.position.y = H * 0.3; m.add(ring2);
      }
      this.group.add(m);
      if (fg) { m.material.transparent = true; this.fgPillars.push({ mesh: m, c, r, op: 1 }); }
    }
  }

  buildDecor() {
    const mats = this.mats;
    // antorchas
    this.lightSources = [];
    this.torchMeshes = [];
    for (const t of this.torches) {
      const m = P.makeTorch(mats, this.palace);
      const y = this.floorY(t.r) + 1.5;
      m.position.set(this.cx(t.c), y, ZB + 0.01);
      this.group.add(m);
      this.torchMeshes.push(m);
      this.lightSources.push({
        pos: new THREE.Vector3(this.cx(t.c), y + 0.45, ZB + 0.75), intensity: this.palace ? 13 : 27,
        color: new THREE.Color(1.0, 0.56, 0.24), seed: hash2(t.c, t.r) * 100, torch: m, row: t.r,
      });
    }
    for (const l of this.lamps) {
      const m = P.makeLantern();
      const y = this.floorY(l.r) + 1.75;
      m.position.set(this.cx(l.c), y, -0.6);
      this.group.add(m);
      this.lightSources.push({
        pos: new THREE.Vector3(this.cx(l.c), y, -0.3), intensity: 16,
        color: new THREE.Color(1.0, 0.68, 0.36), seed: hash2(l.c, l.r) * 100, row: l.r, lamp: m,
      });
    }
    this.shafts = [];
    for (const d of this.decor) {
      const x = this.cx(d.c), y = this.floorY(d.r);
      let m = null;
      switch (d.kind) {
        case 'w': {
          m = P.makeWindow(mats, this.tex.sky || getTextures('palace', 512).sky);
          m.position.set(x, y + 0.45, ZB + 0.005);
          const shaft = P.makeLightShaft(0x8fa8ff, 3.2, 1.0);
          shaft.position.set(x + 0.35, y + 1.9, ZB + 0.9);
          shaft.rotation.z = 0.38;
          this.group.add(shaft);
          this.shafts.push(shaft);
          break;
        }
        case 'a': m = P.makeArch(mats); m.position.set(x, y, ZB + 0.005); break;
        case 'c': m = P.makeChains(mats); m.position.set(x, y + 1.75, ZB + 0.05); break;
        case 'k': m = P.makeBones(mats); m.position.set(x, y, ZB + 0.7); m.rotation.y = hash2(d.c, d.r) * 3; break;
        case 'b': m = P.makeBanner(this.palace ? 0x7a1018 : 0x3a2a40); m.position.set(x, y + 2.0, ZB + 0.06); break;
        case 'v': m = P.makeVase(d.c * 31 + d.r); m.position.set(x + (hash2(d.c, d.r) - 0.5) * 0.4, y, ZB + 0.4); break;
        case 'r': this.addRubble(d.c, d.r, d.c * 7 + d.r); break;
        default: break;
      }
      if (m) this.group.add(m);
    }
  }

  addRubble(c, r, seed) {
    const rng = mulberry32(Math.floor(seed) + 3);
    const geos = [];
    for (let i = 0; i < 9; i++) {
      const s = 0.06 + rng() * 0.12;
      const g = new THREE.DodecahedronGeometry(s, 0);
      g.scale(1.4, 0.6, 1.1);
      g.rotateY(rng() * 3);
      g.translate((rng() - 0.5) * TW * 0.85, s * 0.3, ZB + 0.3 + rng() * (ZF - ZB - 0.5));
      geos.push(g);
    }
    const slabBits = new THREE.BoxGeometry(0.5, 0.08, 0.7); slabBits.rotateZ(0.15); slabBits.translate(-0.15, 0.06, -0.3);
    const slabBits2 = new THREE.BoxGeometry(0.4, 0.07, 0.6); slabBits2.rotateZ(-0.2); slabBits2.rotateY(0.4); slabBits2.translate(0.2, 0.05, 0.4);
    geos.push(slabBits, slabBits2);
    const merged = mergeSafe(geos);
    const m = new THREE.Mesh(merged, this.mats.stoneTrim);
    m.position.set(this.cx(c), this.floorY(r), 0);
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m);
    this.rubbles.push({ c, r, mesh: m });
  }

  addCarpets(list) {
    if (!this.tex.carpet || !list.length) return;
    const geos = list.map(([c, r]) => {
      const geo = new THREE.BoxGeometry(TW + 0.002, 0.02, 1.3).toNonIndexed();
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, (uv.getX(i) + c) * TW / 2.4);
      geo.translate(this.cx(c), this.floorY(r) + 0.01, -0.05);
      return geo;
    });
    const mat = new THREE.MeshStandardMaterial({ map: this.tex.carpet.map, normalMap: this.tex.carpet.normalMap, roughness: 0.95 });
    const m = new THREE.Mesh(mergeGeometriesLocal(geos), mat);
    m.receiveShadow = true;
    this.group.add(m);
  }

  // ------------------------------------------------------------------ actualización
  update(dt, game) {
    this.time += dt;
    for (const g of this.gateMap.values()) g.update(dt, game);
    for (const p of this.plateMap.values()) p.update(dt, game);
    for (const d of this.doorMap.values()) d.update(dt, game);
    for (const l of this.looseMap.values()) l.update(dt, game);
    for (const s of this.spikeMap.values()) s.update(dt, game);
    for (const s of this.chopMap.values()) s.update(dt, game);
    for (const m of this.mirrorMap.values()) m.update(dt, game);
    for (const g of this.ghostEnts) g.update(dt, game);
    for (const it of this.itemEnts) it.update(dt, game);
    updateArchitecture(this, game, dt);
    // columnas en primer plano: se vuelven translúcidas cuando tapan al príncipe
    const pl = game.player;
    for (const f of this.fgPillars) {
      const near = pl && Math.abs(pl.x - this.cx(f.c)) < 0.75 && Math.abs(pl.y - this.floorY(f.r)) < 2.2;
      f.op += ((near ? 0.28 : 1) - f.op) * Math.min(1, dt * 8);
      f.mesh.material.opacity = f.op;
      f.mesh.material.depthWrite = f.op > 0.95;
    }
    for (const tm of this.torchMeshes) {
      const u = tm.userData;
      const fl = 0.85 + Math.sin(this.time * 9 + tm.position.x) * 0.08 + Math.sin(this.time * 23 + tm.position.y) * 0.05;
      u.wallGlow.material.opacity = 0.32 * fl;
      u.halo.material.opacity = 0.5 * fl;
    }
  }

  emit(type, data = {}) { this.events.push({ type, ...data }); }

  // pisadas: llamado por los personajes al apoyarse en una celda
  stepOn(c, r, actor, hard) {
    const l = this.looseAt(c, r);
    if (l) l.touch(hard);
    const p = this.plateAt(c, r);
    if (p && !(actor && actor.isFoe)) p.press(actor);
    if (hard) {
      // sacudir baldosas sueltas cercanas
      for (const ll of this.looseMap.values()) if (Math.abs(ll.r - r) <= 1 && Math.abs(ll.c - c) <= 3) ll.wobble();
    }
  }
  bumpCeiling(c, r) {
    // golpe con la cabeza en el techo: r es la fila del personaje; la losa de arriba es (c, r-1).
    // Suelta la baldosa de encima y también las contiguas (así se pueden tirar sin que caigan encima).
    const l = this.looseAt(c, r - 1);
    if (l) l.touch(true, true);
    for (const dc of [-1, 1]) { const n = this.looseAt(c + dc, r - 1); if (n) n.touch(true, true, 0.35); }
    for (const ll of this.looseMap.values()) if (ll.r === r - 1 && Math.abs(ll.c - c) <= 3) ll.wobble();
  }
  triggerLinks(id, raise, permanent) {
    for (const g of this.gateMap.values()) if (g.id === id) g.trigger(raise, permanent);
    for (const d of this.doorMap.values()) if (d.id === id && d.exit && raise) d.open();
  }
  // una placa acciona sus objetivos explícitos (niveles originales) o los de su número de enlace
  triggerPlate(pl, raise, permanent) {
    if (!pl.targets) return this.triggerLinks(pl.id, raise, permanent);
    for (const [c, r] of pl.targets) {
      const g = this.gateAt(c, r);
      if (g) g.trigger(raise, permanent);
      const d = this.doorAt(c, r);
      if (d && d.exit && raise) d.open();
    }
  }
  plateGates(pl) {
    if (!pl.targets) return [...this.gateMap.values()].filter((g) => g.id === pl.id);
    return pl.targets.map(([c, r]) => this.gateAt(c, r)).filter(Boolean);
  }
  addMirror(c, r) {
    if (this.mirrorMap.has(c + ',' + r)) return this.mirrorMap.get(c + ',' + r);
    const e = new Mirror(this, { c, r });
    this.mirrorMap.set(c + ',' + r, e);
    this.mirrors.push({ c, r, ent: e });
    return e;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) if (!m.userData.shared) m.dispose();
      }
    });
  }
}

function mergeSafe(geos) {
  // fusionar geometrías con distintos atributos (índices/uv)
  const ng = geos.map((g) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k); return n; });
  return mergeGeometriesLocal(ng);
}
function mergeGeometriesLocal(geos) {
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  const r = new THREE.BufferGeometry();
  r.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  r.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  r.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return r;
}

// ====================================================================== entidades

class Gate {
  constructor(level, g) {
    this.level = level; this.c = g.c; this.r = g.r; this.id = g.id;
    this.amt = g.startOpen ? 1 : 0;      // 0 cerrado .. 1 abierto
    this.mode = g.startOpen ? 'open' : 'closed';
    this.hold = 0; this.permanent = g.startOpen && false;
    this.pressedNow = false;
    const yf = level.floorY(g.r);
    this.clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), yf + HEADROOM - 0.2);
    this.mesh = P.makeGateMesh(level.mats, this.clip);
    this.mesh.position.set(level.cx(g.c), yf, 0.12);
    level.dynamic.add(this.mesh);
    this.lastSound = 0;
    this.apply();
  }
  openHeight() { return this.amt * (HEADROOM - 0.25); }
  blocks() { return this.openHeight() < 1.72; }
  trigger(raise, permanent) {
    if (raise) {
      if (this.mode === 'closed' || this.mode === 'closing' || this.mode === 'slam') {
        this.mode = 'opening';
        this.level.emit('gateOpen', { c: this.c, r: this.r });
      }
      this.hold = this.level.def.gateHold ?? 6;
      if (permanent) this.permanent = true;
    } else if (!this.permanent) {
      if (this.amt > 0) { this.mode = 'slam'; this.level.emit('gateSlamStart', { c: this.c, r: this.r }); }
    }
  }
  update(dt) {
    const prev = this.amt;
    switch (this.mode) {
      case 'opening':
        this.amt = Math.min(1, this.amt + dt * 0.75);
        if (this.amt >= 1) this.mode = 'open';
        break;
      case 'open':
        if (!this.permanent && this.level.def.gateHold !== -1) {
          this.hold -= dt;
          if (this.hold <= 0) { this.mode = 'closing'; }
        }
        break;
      case 'closing':
        this.amt = Math.max(0, this.amt - dt * 0.16);
        if (this.amt <= 0) { this.mode = 'closed'; this.level.emit('gateShut', { c: this.c, r: this.r, soft: true }); }
        break;
      case 'slam':
        this.amt = Math.max(0, this.amt - dt * 6);
        if (this.amt <= 0) { this.mode = 'closed'; this.level.emit('gateShut', { c: this.c, r: this.r }); }
        break;
      default: break;
    }
    if (this.amt !== prev) {
      this.lastSound -= dt;
      if (this.lastSound <= 0 && this.mode !== 'slam') {
        this.level.emit('gateTick', { c: this.c, r: this.r, up: this.amt > prev });
        this.lastSound = this.mode === 'closing' ? 0.32 : 0.1;
      }
      this.apply();
    }
  }
  apply() { this.mesh.userData.grid.position.y = this.openHeight(); }
}

class Plate {
  constructor(level, p) {
    this.level = level; this.c = p.c; this.r = p.r; this.id = p.id; this.raise = p.raise;
    this.targets = level.plateTargets.get(p.c + ',' + p.r) || null;
    this.mesh = P.makePlate(level.mats, p.raise);
    this.mesh.position.set(level.cx(p.c), level.floorY(p.r), -0.1);
    level.dynamic.add(this.mesh);
    this.pressT = 0; this.down = 0; this.permanent = false; this.wasPressed = false;
  }
  press(actor) {
    this.pressT = 0.12;
  }
  pressPermanent() { this.permanent = true; this.pressT = 1e9; }
  update(dt) {
    const pressed = this.pressT > 0 || this.permanent;
    this.pressT -= dt;
    if (pressed && !this.wasPressed) {
      this.level.triggerPlate(this, this.raise, this.permanent);
      this.level.emit('plate', { c: this.c, r: this.r });
    } else if (pressed && this.raise) {
      // mantener abierto mientras se pisa
      for (const g of this.level.plateGates(this)) if (g.mode === 'open' || g.mode === 'opening') g.hold = Math.max(g.hold, this.level.def.gateHold ?? 6);
    }
    if (this.permanent && this.raise) for (const g of this.level.plateGates(this)) g.permanent = true;
    this.wasPressed = pressed;
    const target = pressed ? -0.05 : 0;
    this.down += (target - this.down) * Math.min(1, dt * 20);
    this.mesh.userData.top.position.y = 0.04 + this.down;
  }
}

class Door {
  constructor(level, d) {
    this.level = level; this.c = d.c; this.r = d.r; this.id = d.id; this.exit = d.exit;
    const yf = level.floorY(d.r);
    this.clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), yf + 1.84);
    this.mesh = P.makeDoorMesh(level.mats, this.clip, level.palace, d.exit);
    // en los niveles originales la puerta ocupa dos baldosas
    this.x = level.cx(d.c) + (level.def.wideDoors ? TW / 2 : 0);
    if (level.def.wideDoors) this.mesh.scale.x = 1.45;
    this.mesh.position.set(this.x, yf, ZB + 0.18);
    level.dynamic.add(this.mesh);
    this.amt = (!d.exit || d.id === '0') ? 1 : 0;
    this.opening = false; this.closing = false;
    this.apply();
  }
  isOpen() { return this.amt > 0.9; }
  open() { if (this.amt < 1 && !this.opening) { this.opening = true; this.level.emit('doorOpen', { c: this.c, r: this.r }); } }
  close() { this.closing = true; }
  update(dt) {
    if (this.opening) { this.amt = Math.min(1, this.amt + dt * 0.4); if (this.amt >= 1) this.opening = false; this.apply(); }
    if (this.closing) {
      this.amt = Math.max(0, this.amt - dt * 1.6);
      if (this.amt <= 0) { this.closing = false; this.level.emit('gateShut', { c: this.c, r: this.r }); }
      this.apply();
    }
  }
  apply() {
    const u = this.mesh.userData;
    u.leaf.position.y = this.amt * 2.15;
    u.stairLight.material.opacity = this.amt * 0.5;
  }
}

class Loose {
  constructor(level, l) {
    this.level = level; this.c = l.c; this.r = l.r;
    this.state = 'idle'; this.timer = 0; this.wob = 0; this.vy = 0; this.hitDone = new Set();
    const geo = slabGeometry(TW - 0.016);
    this.mesh = new THREE.Group();
    const top = new THREE.Mesh(geo.top, level.mats.floorMat);
    const edge = new THREE.Mesh(geo.edge, level.mats.edgeMat);
    top.receiveShadow = edge.receiveShadow = true; top.castShadow = edge.castShadow = true;
    this.mesh.add(top, edge);
    this.baseY = level.floorY(l.r);
    this.tilt = (hash2(l.c, l.r, 2) - 0.5) * 0.03;
    this.mesh.position.set(level.cx(l.c), this.baseY - 0.015, 0);
    this.mesh.rotation.z = this.tilt;
    level.dynamic.add(this.mesh);
  }
  touch(hard, fromBelow, delay) {
    if (this.state !== 'idle') return;
    this.state = 'shake';
    this.timer = delay ?? (fromBelow ? 0.3 : hard ? 0.28 : 0.5);
    this.level.emit('looseShake', { c: this.c, r: this.r });
  }
  wobble() { if (this.state === 'idle') { this.wob = 0.35; this.level.emit('looseRattle', { c: this.c, r: this.r }); } }
  update(dt, game) {
    const m = this.mesh;
    if (this.state === 'idle') {
      if (this.wob > 0) {
        this.wob -= dt;
        m.position.y = this.baseY - 0.015 + Math.abs(Math.sin(this.wob * 60)) * 0.03 * (this.wob / 0.35);
      }
      return;
    }
    if (this.state === 'shake') {
      this.timer -= dt;
      m.position.y = this.baseY - 0.015 + Math.abs(Math.sin(this.level.time * 55)) * 0.035;
      m.rotation.z = this.tilt + Math.sin(this.level.time * 47) * 0.02;
      if (this.timer <= 0) {
        this.state = 'fall';
        this.level.t[this.r][this.c] = 'empty';
        this.vy = 0;
        this.level.emit('looseFall', { c: this.c, r: this.r });
      }
      return;
    }
    if (this.state === 'fall') {
      this.vy = Math.max(-16, this.vy - 17.5 * dt);
      m.position.y += this.vy * dt;
      m.rotation.z += dt * 0.6 * (this.tilt > 0 ? 1 : -1);
      // golpear personajes
      for (const a of game.actors) {
        if (!a.alive || this.hitDone.has(a)) continue;
        if (Math.abs(a.x - m.position.x) < 0.48 && m.position.y - SLAB < a.y + a.height() && m.position.y > a.y + 0.6) {
          this.hitDone.add(a);
          a.hitByDebris?.();
        }
      }
      // aterrizar en el primer suelo por debajo
      const yBottom = m.position.y - SLAB;
      for (let rr = this.r + 1; rr <= this.level.rows; rr++) {
        const fy = rr >= this.level.rows ? this.level.floorY(this.level.rows - 1) - RH : this.level.floorY(rr);
        if (yBottom <= fy + 0.001 && m.position.y - this.vy * dt - SLAB > fy - 0.001) {
          if (this.level.hasFloor(this.c, rr)) { this.crash(rr, game); return; }
        }
      }
      if (m.position.y < -20) { this.state = 'gone'; m.visible = false; }
    }
  }
  crash(rr, game) {
    this.state = 'gone';
    this.mesh.visible = false;
    const lv = this.level;
    const l2 = lv.looseAt(this.c, rr);
    if (l2 && l2.state === 'idle') {
      // cae sobre otra baldosa suelta: se rompen las dos
      l2.touch(true, true); l2.timer = 0.02;
    }
    const p = lv.plateAt(this.c, rr);
    if (p) p.pressPermanent();
    lv.addRubble(this.c, rr, this.c * 13 + rr * 7 + 5);
    lv.emit('looseCrash', { c: this.c, r: rr, x: lv.cx(this.c), y: lv.floorY(rr) });
  }
}

class Spikes {
  constructor(level, s) {
    this.level = level; this.c = s.c; this.r = s.r;
    this.mesh = P.makeSpikes(level.mats);
    this.mesh.position.set(level.cx(s.c), level.floorY(s.r), 0);
    level.dynamic.add(this.mesh);
    this.ext = 0; this.target = 0; this.idle = 0; this.bloody = false;
    this.apply();
  }
  isOut() { return this.ext > 0.4; }
  update(dt, game) {
    let near = false;
    for (const a of game.actors) {
      if (!a.alive && !a.impaledOn) continue;
      const ar = this.level.rowOfFeet(a.y);
      const dx = Math.abs(a.x - this.level.cx(this.c));
      if ((ar === this.r && dx < TW * 1.35) || (ar === this.r - 1 && dx < TW * 0.8 && a.vy < 0 && !a.onGround)) near = true;
    }
    if (near) {
      if (this.target === 0) this.level.emit('spikes', { c: this.c, r: this.r });
      this.target = 1; this.idle = 1.2;
    } else {
      this.idle -= dt;
      if (this.idle <= 0) this.target = 0;
    }
    const sp = this.target ? 14 : 2.5;
    const prev = this.ext;
    this.ext += Math.sign(this.target - this.ext) * Math.min(Math.abs(this.target - this.ext), dt * sp);
    if (prev !== this.ext) this.apply();
  }
  apply() { this.mesh.userData.spikes.position.y = -0.55 + this.ext * 0.55; this.mesh.userData.spikes.visible = this.ext > 0.01; }
}

class Chopper {
  constructor(level, s) {
    this.level = level; this.c = s.c; this.r = s.r;
    const yf = level.floorY(s.r);
    this.clipTop = new THREE.Plane(new THREE.Vector3(0, -1, 0), yf + HEADROOM - 0.02);
    this.clipBottom = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(yf + 0.0));
    this.mesh = P.makeChopper(level.mats, this.clipTop, this.clipBottom);
    this.mesh.position.set(level.cx(s.c), yf, 0.18);
    level.dynamic.add(this.mesh);
    this.period = level.def.chopperPeriod || 1.6;
    this.t = (s.c * 0.37) % 1 * this.period;
    this.close = 0; this.active = false; this.bloody = 0;
    this.apply();
  }
  isClosed() { return this.close > 0.55; }
  update(dt, game) {
    const pl = game.player;
    this.active = pl && Math.abs(pl.x - this.level.cx(this.c)) < TW * 9 && Math.abs(this.level.rowOfFeet(pl.y) - this.r) <= 1;
    if (!this.active && this.close <= 0) return;
    const prevT = this.t;
    this.t = (this.t + dt) % this.period;
    const ph = this.t / this.period;
    // cierre rápido 0..0.07, cerrado hasta 0.14, apertura hasta 0.4
    let cl;
    if (ph < 0.07) cl = smooth(ph / 0.07);
    else if (ph < 0.14) cl = 1;
    else if (ph < 0.4) cl = 1 - smooth((ph - 0.14) / 0.26);
    else cl = 0;
    if (!this.active && cl < this.close) cl = Math.max(0, this.close - dt * 3);
    if (prevT / this.period > 0.9 && ph < 0.1 && this.active) this.level.emit('chop', { c: this.c, r: this.r });
    this.close = cl;
    this.apply();
  }
  apply() {
    const u = this.mesh.userData;
    // la cuchilla superior baja desde el techo; la inferior sube desde el suelo
    u.upper.position.y = 1.06 + (1 - this.close) * 0.8;
    u.lower.position.y = 1.0 - (1 - this.close) * 0.72;
    u.blood.opacity = this.bloody;
  }
}

class Mirror {
  constructor(level, m) {
    this.level = level; this.c = m.c; this.r = m.r;
    // como en el original, el espejo se alza en el borde de la baldosa que da al vacío
    const open = (cc) => !level.hasSlabStatic(cc, m.r) && !level.isSolidStatic(cc, m.r);
    this.x = open(m.c - 1) ? m.c * TW + 0.16 : open(m.c + 1) ? (m.c + 1) * TW - 0.16 : level.cx(m.c);
    this.mesh = P.makeMirror(level.mats);
    this.mesh.position.set(this.x, level.floorY(m.r), 0.0);
    level.dynamic.add(this.mesh);
    this.broken = false; this.flash = 0;
  }
  blocks() { return !this.broken; }
  shatter() {
    this.broken = true; this.flash = 1;
    this.level.emit('mirror', { c: this.c, r: this.r, x: this.x, y: this.level.floorY(this.r) });
  }
  update(dt) {
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 1.2);
      this.mesh.userData.glassMat.uniforms.uBreak.value = this.flash;
      if (this.flash <= 0.5) this.mesh.userData.glass.visible = false;
    }
  }
}

class Ghost {
  // suelo invisible (puente de la fe): aparece al pisarlo
  constructor(level, g) {
    this.level = level; this.c = g.c; this.r = g.r; this.vis = 0; this.target = 0;
    const geo = slabGeometry(TW - 0.01);
    this.mat = new THREE.MeshStandardMaterial({
      color: 0x9fd8ff, emissive: 0x3b8cff, emissiveIntensity: 1.5, transparent: true, opacity: 0, roughness: 0.2, depthWrite: false,
    });
    this.mesh = new THREE.Group();
    this.mesh.add(new THREE.Mesh(geo.top, this.mat), new THREE.Mesh(geo.edge, this.mat));
    this.mesh.position.set(level.cx(g.c), level.floorY(g.r), 0);
    level.dynamic.add(this.mesh);
  }
  update(dt, game) {
    const pl = game.player;
    const on = pl && this.level.ghostActive !== false && Math.abs(pl.x - this.level.cx(this.c)) < TW * 1.6 && Math.abs(pl.y - this.level.floorY(this.r)) < 0.6;
    if (on) this.target = 1;
    this.vis += (this.target - this.vis) * Math.min(1, dt * 4);
    this.mat.opacity = this.vis * 0.55 + Math.sin(this.level.time * 3 + this.c) * 0.04 * this.vis;
  }
}

class Item {
  constructor(level, it) {
    this.level = level; this.c = it.c; this.r = it.r; this.kind = it.kind; this.taken = false;
    const x = level.cx(it.c) + 0.18, y = level.floorY(it.r);
    if (it.kind === 'sword') {
      this.mesh = P.makeScimitar();
      this.mesh.rotation.set(-Math.PI / 2, 0, Math.PI / 2 + 0.25);
      this.mesh.position.set(x - 0.15, y + 0.03, 0.45);
      const glow = P.makeGlow(new THREE.Color(1.0, 0.9, 0.6), 1.2, 0.35);
      glow.rotation.x = -Math.PI / 2; glow.position.set(0.3, 0, 0);
      this.glow = glow;
      this.mesh.add(glow);
    } else {
      this.mesh = P.makePotion(it.kind);
      this.mesh.position.set(x, y, 0.45);
    }
    this.baseY = this.mesh.position.y;
    this.mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    level.dynamic.add(this.mesh);
    this.phase = hash2(it.c, it.r) * 10;
  }
  take() { this.taken = true; this.mesh.visible = false; }
  update(dt) {
    if (this.taken) return;
    const t = this.level.time + this.phase;
    if (this.kind === 'sword') { if (this.glow) this.glow.material.opacity = 0.25 + Math.sin(t * 2.5) * 0.12; return; }
    const u = this.mesh.userData;
    u.glow.material.opacity = 0.45 + Math.sin(t * 3) * 0.15;
    u.liquid.material.emissiveIntensity = 1.2 + Math.sin(t * 4) * 0.3;
  }
}
