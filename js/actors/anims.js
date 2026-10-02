// Biblioteca de poses y clips de animación + reproductor con mezcla.
// Ángulos en grados con sentido "anatómico": flexión hacia delante positiva, rodilla doblada positiva,
// abducción (separar el brazo/pierna) positiva, tobillo positivo = punta hacia abajo.
import { poseFrom, mirrorPose, NCH, CH } from './rig.js';

const P = poseFrom;

// ------------------------------------------------------------------ poses básicas
export const POSES = {};
const def = (name, o) => { POSES[name] = P(o); return POSES[name]; };

def('idle', { pel: [2], sp: [1], ch: [-3], nk: [2], hd: [-2], ls: [3, 0, 8], le: 14, rs: [3, 0, 8], re: 16, lh: [3, 0, 3], lk: 4, rh: [-1, 0, 3], rk: 3, g: 1, af: 1 });
def('idle2', { pel: [2], sp: [1], ch: [-5], nk: [3], hd: [-3, 4], ls: [1, 0, 9], le: 12, rs: [1, 0, 9], re: 14, lh: [3, 0, 3], lk: 5, rh: [-1, 0, 3], rk: 4, g: 1, af: 1 });
def('crouch', { pel: [32], sp: [12], ch: [6], nk: [-8], hd: [-24], lh: [92, 0, 9], lk: 128, rh: [80, 0, 9], rk: 122, ls: [42, 0, 14], le: 38, rs: [48, 0, 14], re: 32, g: 1, af: 1 });
def('crouchLite', { pel: [20], sp: [8], hd: [-12], lh: [55, 0, 5], lk: 75, rh: [55, 0, 5], rk: 75, ls: [-30, 0, 14], le: 22, rs: [-30, 0, 14], re: 22, g: 1, af: 1 });
def('jumpReach', { pel: [0], sp: [-4], ch: [-6], hd: [-18], ls: [172, 0, 10], le: 4, rs: [172, 0, 10], re: 4, lh: [10], lk: 14, la: 40, rh: [2], rk: 8, ra: 40, g: 0 });
def('hang', { pel: [-4], sp: [-2], ch: [-4], nk: [-6], hd: [-22], ls: [176, 0, 13], le: 4, rs: [176, 0, 13], re: 4, lh: [14, 0, 4], lk: 24, la: 32, rh: [4, 0, 4], rk: 14, ra: 36, g: 0 });
def('hang2', { pel: [3], sp: [1], ch: [-2], nk: [-6], hd: [-20], ls: [176, 0, 13], le: 6, rs: [176, 0, 13], re: 6, lh: [4, 0, 4], lk: 12, la: 36, rh: [16, 0, 4], rk: 28, ra: 30, g: 0 });
def('pull', { pel: [6], ch: [10], hd: [-8], ls: [150, 0, 22], le: 100, rs: [150, 0, 22], re: 100, lh: [26], lk: 55, la: 30, rh: [10], rk: 30, ra: 30, g: 0 });
def('kneeUp', { pel: [36], sp: [16], ch: [6], hd: [-22], ls: [58, 0, 22], le: 18, rs: [58, 0, 22], re: 18, rh: [112, 0, 8], rk: 128, ra: 20, lh: [28], lk: 62, la: 40, g: 0 });
def('fall1', { pel: [-10], sp: [-6], ch: [-10], hd: [-20], ls: [140, 0, 45], le: 40, rs: [118, 0, 55], re: 52, lh: [32, 0, 10], lk: 52, la: 22, rh: [8, 0, 10], rk: 30, ra: 30, g: 0 });
def('fall2', { pel: [-6], sp: [-4], ch: [-12], hd: [-16], ls: [120, 0, 55], le: 55, rs: [146, 0, 42], re: 36, lh: [10, 0, 10], lk: 34, la: 30, rh: [30, 0, 10], rk: 54, ra: 22, g: 0 });
def('landHard', { pel: [42], sp: [22], ch: [12], nk: [-10], hd: [-30], lh: [96, 0, 12], lk: 112, rh: [-8, 0, 12], rk: 112, ra: 55, ls: [62, 0, 22], le: 8, rs: [66, 0, 22], re: 8, g: 1 });
def('bump', { pel: [-14], sp: [-8], ch: [-8], hd: [12], ls: [40, 0, 32], le: 30, rs: [52, 0, 32], re: 30, lh: [22], lk: 24, rh: [-10], rk: 14, g: 1, af: 1 });
def('skid', { pel: [-6], sp: [-4], ch: [-6], hd: [4], rh: [46, 0, 4], rk: 8, ra: -15, lh: [-4, 0, 4], lk: 58, la: 10, ls: [32, 0, 42], le: 40, rs: [22, 0, 42], re: 40, g: 1 });
def('turnMid', { pel: [8], lh: [14], lk: 26, rh: [14], rk: 26, ls: [12, 0, 15], le: 34, rs: [12, 0, 15], re: 34, hd: [-4], g: 1, af: 1 });
// saltos
def('leapPrep', { pel: [26], sp: [10], hd: [-12], lh: [60, 0, 5], lk: 88, rh: [52, 0, 5], rk: 82, ls: [-50, 0, 16], le: 26, rs: [-55, 0, 16], re: 26, g: 1, af: 1 });
def('leapLaunch', { pel: [24], sp: [10], ch: [0], hd: [-14], ls: [105, 0, 22], le: 20, rs: [112, 0, 22], re: 18, rh: [70, 0, 4], rk: 92, ra: 20, lh: [-12, 0, 4], lk: 40, la: 45, g: 0 });
def('leapAir', { pel: [14], sp: [6], hd: [-10], ls: [72, 0, 34], le: 32, rs: [82, 0, 34], re: 30, rh: [64, 0, 5], rk: 64, ra: 15, lh: [-22, 0, 5], lk: 70, la: 35, g: 0 });
def('leapLand', { pel: [30], sp: [12], hd: [-16], ls: [46, 0, 28], le: 28, rs: [56, 0, 28], re: 28, rh: [62, 0, 6], rk: 86, lh: [34, 0, 6], lk: 96, g: 1, af: 1 });
def('runLeap', { pel: [18], sp: [6], hd: [-10], rh: [78, 0, 3], rk: 22, ra: 10, lh: [-46, 0, 3], lk: 48, la: 42, ls: [72, 0, 26], le: 30, rs: [-52, 0, 26], re: 32, g: 0 });
def('runLeap2', { pel: [12], sp: [4], hd: [-8], rh: [62, 0, 3], rk: 38, ra: 15, lh: [-30, 0, 3], lk: 62, la: 40, ls: [55, 0, 34], le: 40, rs: [-25, 0, 34], re: 38, g: 0 });
// paso con cuidado
def('stepMid', { pel: [4], rh: [26, 0, 3], rk: 30, ra: 22, lh: [-6, 0, 3], lk: 10, ls: [12, 0, 26], le: 34, rs: [12, 0, 26], re: 34, hd: [-10], g: 1 });
def('teeter', { pel: [10], sp: [6], rh: [20, 0, 3], rk: 6, ra: 28, lh: [0, 0, 3], lk: 12, ls: [40, 0, 70], le: 20, rs: [30, 0, 75], re: 20, hd: [-22], g: 1, af: 1 });
// beber / recoger
def('reach', { pel: [42], sp: [16], hd: [-24], rh: [82, 0, 8], rk: 104, lh: [70, 0, 8], lk: 112, rs: [72, 0, 10], re: 18, ls: [22, 0, 16], le: 30, g: 1, af: 1 });
def('drink', { pel: [-2], sp: [-2], ch: [-8], nk: [-14], hd: [-34], rs: [118, 0, 32], re: 150, rw: [28], ls: [6, 0, 12], le: 22, lh: [2, 0, 3], lk: 4, rh: [-2, 0, 3], rk: 3, g: 1, af: 1, hold: 1 });
def('drink2', { pel: [-4], sp: [-4], ch: [-10], nk: [-20], hd: [-40], rs: [126, 0, 30], re: 146, rw: [40], ls: [8, 0, 14], le: 24, lh: [2, 0, 3], lk: 4, rh: [-2, 0, 3], rk: 3, g: 1, af: 1, hold: 1 });
def('swordHigh', { pel: [-2], sp: [-3], ch: [-8], hd: [-16], rs: [176, 0, 12], re: 6, rw: [0], ls: [12, 0, 30], le: 22, lh: [4, 0, 6], lk: 6, rh: [-4, 0, 6], rk: 4, g: 1, af: 1 });
// combate
def('engarde', { pel: [8, -12, 0], sp: [2, -6], ch: [-4, 12], nk: [0, 4], hd: [-6, 6], rs: [52, 0, 8], re: 52, rw: [-18], ls: [-22, 0, 42], le: 88, lh: [-14, 0, 8], lk: 26, la: 14, rh: [28, 0, 6], rk: 32, g: 1, af: 1 });
def('engarde2', { pel: [9, -12, 0], sp: [3, -6], ch: [-2, 12], nk: [0, 4], hd: [-5, 6], rs: [50, 0, 8], re: 56, rw: [-14], ls: [-20, 0, 44], le: 92, lh: [-14, 0, 8], lk: 30, la: 14, rh: [28, 0, 6], rk: 36, g: 1, af: 1 });
def('advA', { pel: [10, -12, 0], sp: [2, -6], ch: [-4, 12], hd: [-6, 6], rs: [52, 0, 8], re: 52, rw: [-18], ls: [-22, 0, 42], le: 88, lh: [-22, 0, 8], lk: 20, la: 18, rh: [44, 0, 6], rk: 26, g: 1, af: 1 });
def('retA', { pel: [6, -12, 0], sp: [2, -6], ch: [-4, 12], hd: [-6, 6], rs: [52, 0, 8], re: 52, rw: [-18], ls: [-22, 0, 42], le: 88, lh: [-30, 0, 8], lk: 30, la: 25, rh: [18, 0, 6], rk: 30, g: 1, af: 1 });
def('windup', { pel: [2, -22, 0], sp: [0, -8], ch: [-10, 22], hd: [-4, 10], rs: [132, 0, 34], re: 112, rw: [30], ls: [-28, 0, 40], le: 70, lh: [-12, 0, 8], lk: 24, la: 12, rh: [22, 0, 6], rk: 28, g: 1, af: 1 });
def('lunge', { pel: [20, -8, 0], sp: [8, -2], ch: [4, 2], hd: [-6, 2], rs: [90, 0, 4], re: 6, rw: [-12], ls: [-42, 0, 32], le: 30, rh: [56, 0, 6], rk: 46, lh: [-32, 0, 8], lk: 14, la: 18, g: 1, af: 1, rz: 0.1 });
def('parry', { pel: [4, -8, 0], sp: [1, -4], ch: [-6, 16], hd: [-8, 6], rs: [98, 0, -6], re: 82, rw: [55, 25], ls: [-20, 0, 44], le: 86, lh: [-16, 0, 8], lk: 28, la: 14, rh: [24, 0, 6], rk: 32, g: 1, af: 1 });
def('recoil', { pel: [-14, 12, 0], sp: [-8], ch: [-12], hd: [14], rs: [30, 0, 34], re: 44, ls: [30, 0, 44], le: 42, lh: [12], lk: 34, rh: [-12], rk: 22, g: 1, af: 1, rz: -0.08 });
def('drawA', { pel: [4], ch: [0, -14], hd: [-6], rs: [26, 40, -38], re: 104, ls: [6, 0, 14], le: 18, lh: [2, 0, 4], lk: 8, rh: [6, 0, 4], rk: 10, g: 1, af: 1 });
// muertes
def('buckle', { pel: [-10], sp: [-6], hd: [22], ls: [32, 0, 42], le: 30, rs: [42, 0, 32], re: 30, lh: [32], lk: 84, rh: [22], rk: 72, g: 1 });
def('dead', { rx: -86, ry: 0.13, pel: [0], sp: [-2], hd: [-12, 20], ls: [150, 0, 42], le: 24, rs: [118, 0, 62], re: 34, lh: [10, 0, 10], lk: 14, la: 30, rh: [26, 0, 8], rk: 42, ra: 30, g: 0 });
def('deadFront', { rx: 84, ry: 0.15, pel: [0], sp: [4], hd: [20, -30], ls: [30, 0, 50], le: 60, rs: [160, 0, 30], re: 20, lh: [-4, 0, 10], lk: 20, la: 40, rh: [10, 0, 6], rk: 50, ra: 40, g: 0 });
def('impaled', { rx: 0, ry: -0.45, pel: [55], sp: [25], ch: [15], hd: [30], ls: [80, 0, 40], le: 30, rs: [70, 0, 50], re: 40, lh: [90, 0, 20], lk: 150, rh: [70, 0, 20], rk: 140, g: 0 });
def('crumple', { rx: 70, ry: 0.22, pel: [10], sp: [10], hd: [30, 40], ls: [80, 0, 70], le: 80, rs: [20, 0, 40], re: 100, lh: [60, 0, 15], lk: 100, rh: [20, 0, 10], rk: 60, g: 0 });
// celebración / final
def('arms', { pel: [-2], ch: [-10], hd: [-12], ls: [80, 0, 70], le: 20, rs: [80, 0, 70], re: 20, lh: [3, 0, 3], lk: 4, rh: [-1, 0, 3], rk: 3, g: 1, af: 1 });
def('embrace', { pel: [4], ch: [2], hd: [-4, 0, 8], ls: [70, 30, 30], le: 90, rs: [70, 30, 30], re: 90, lh: [3, 0, 3], lk: 6, rh: [-1, 0, 3], rk: 5, g: 1, af: 1 });
def('princessWait', { pel: [2], ch: [-2], hd: [8, 0, 6], ls: [30, 50, 10], le: 90, rs: [30, 50, 10], re: 90, lh: [2, 0, 2], lk: 3, rh: [2, 0, 2], rk: 3, g: 1, af: 1 });
def('guardIdle', { pel: [2], sp: [0], ch: [-4], hd: [-2], ls: [10, 0, 20], le: 50, rs: [20, 0, 14], re: 30, lh: [2, 0, 6], lk: 4, rh: [-1, 0, 6], rk: 3, g: 1, af: 1 });

// ciclos
const runA = P({ ry: -0.02, pel: [14, -6, 0], sp: [4, -4], ch: [0, 8], nk: [-8], hd: [-6], rh: [44, 0, 3], rk: 14, ra: -6, lh: [-28, 0, 3], lk: 42, la: 32, ls: [46, 0, 10], le: 78, rs: [-42, 0, 12], re: 34, g: 1 });
const runB = P({ ry: 0.07, pel: [13, 0, 0], sp: [4], ch: [0], nk: [-8], hd: [-6], rh: [-14, 0, 3], rk: 24, ra: 28, lh: [62, 0, 3], lk: 104, la: 20, ls: [6, 0, 10], le: 72, rs: [4, 0, 10], re: 60, g: 0.35 });
const walkA = P({ pel: [3, -3, 0], ch: [-2, 4], rh: [24, 0, 3], rk: 6, ra: -8, lh: [-16, 0, 3], lk: 16, la: 18, ls: [20, 0, 7], le: 18, rs: [-16, 0, 7], re: 12, g: 1 });
const walkB = P({ ry: 0.02, pel: [3, 0, 0], ch: [-2], rh: [-6, 0, 3], rk: 8, ra: 6, lh: [22, 0, 3], lk: 48, la: 6, ls: [2, 0, 7], le: 16, rs: [2, 0, 7], re: 16, g: 1 });
const fallA = POSES.fall1, fallB = POSES.fall2;

// ------------------------------------------------------------------ clips
// keys: [tiempo, pose]
function clip(keys, opts = {}) {
  const dur = opts.dur ?? keys[keys.length - 1][0];
  return { keys: keys.map(([t, p]) => ({ t, p })), dur, loop: !!opts.loop };
}

export const CLIPS = {
  idle: clip([[0, POSES.idle], [1.6, POSES.idle2], [3.2, POSES.idle]], { loop: true, dur: 3.2 }),
  run: clip([[0, runA], [0.16, runB], [0.32, mirrorPose(runA)], [0.48, mirrorPose(runB)]], { loop: true, dur: 0.64 }),
  walk: clip([[0, walkA], [0.27, walkB], [0.54, mirrorPose(walkA)], [0.81, mirrorPose(walkB)]], { loop: true, dur: 1.08 }),
  fall: clip([[0, fallA], [0.22, fallB], [0.44, fallA]], { loop: true, dur: 0.44 }),
  hang: clip([[0, POSES.hang], [1.0, POSES.hang2], [2.0, POSES.hang]], { loop: true, dur: 2.0 }),
  engarde: clip([[0, POSES.engarde], [0.8, POSES.engarde2], [1.6, POSES.engarde]], { loop: true, dur: 1.6 }),
  crouch: clip([[0, POSES.crouch]]),
  // trepar: 0 colgado -> 0.3 tirón -> 0.55 rodilla arriba -> 0.78 agachado -> 0.95 de pie
  climb: clip([[0, POSES.hang], [0.3, POSES.pull], [0.55, POSES.kneeUp], [0.78, POSES.crouch], [0.98, POSES.idle]]),
  jumpUp: clip([[0, POSES.idle], [0.18, POSES.crouchLite], [0.3, POSES.jumpReach], [0.6, POSES.jumpReach]]),
  leap: clip([[0, POSES.idle], [0.26, POSES.leapPrep], [0.36, POSES.leapLaunch], [0.62, POSES.leapAir]]),
  runLeap: clip([[0, POSES.runLeap], [0.32, POSES.runLeap2]]),
  land: clip([[0, POSES.leapLand], [0.26, POSES.idle]]),
  landSoft: clip([[0, POSES.crouchLite], [0.22, POSES.idle]]),
  landHard: clip([[0, POSES.landHard], [0.7, POSES.landHard], [1.05, POSES.idle]]),
  skid: clip([[0, POSES.skid], [0.32, POSES.skid], [0.45, POSES.idle]]),
  turn: clip([[0, POSES.idle], [0.12, POSES.turnMid], [0.26, POSES.idle]]),
  bump: clip([[0, POSES.bump], [0.35, POSES.bump], [0.55, POSES.idle]]),
  step: clip([[0, POSES.idle], [0.25, POSES.stepMid], [0.55, POSES.idle]]),
  teeter: clip([[0, POSES.idle], [0.2, POSES.teeter], [0.55, POSES.teeter], [0.8, POSES.idle]]),
  crouchDown: clip([[0, POSES.idle], [0.2, POSES.crouch]]),
  standUp: clip([[0, POSES.crouch], [0.25, POSES.idle]]),
  drink: clip([[0, POSES.idle], [0.35, POSES.reach], [0.6, POSES.reach], [0.95, POSES.drink], [1.4, POSES.drink2], [1.75, POSES.idle]]),
  pickSword: clip([[0, POSES.idle], [0.35, POSES.reach], [0.55, POSES.reach], [0.95, POSES.swordHigh], [1.6, POSES.swordHigh], [1.95, POSES.idle]]),
  draw: clip([[0, POSES.idle], [0.16, POSES.drawA], [0.38, POSES.engarde]]),
  sheathe: clip([[0, POSES.engarde], [0.2, POSES.drawA], [0.4, POSES.idle]]),
  advance: clip([[0, POSES.engarde], [0.14, POSES.advA], [0.32, POSES.engarde]]),
  retreat: clip([[0, POSES.engarde], [0.14, POSES.retA], [0.32, POSES.engarde]]),
  strike: clip([[0, POSES.engarde], [0.13, POSES.windup], [0.22, POSES.lunge], [0.32, POSES.lunge], [0.55, POSES.engarde]]),
  parry: clip([[0, POSES.engarde], [0.07, POSES.parry], [0.3, POSES.parry], [0.45, POSES.engarde]]),
  recoil: clip([[0, POSES.engarde], [0.08, POSES.recoil], [0.3, POSES.recoil], [0.5, POSES.engarde]]),
  die: clip([[0, POSES.recoil], [0.3, POSES.buckle], [0.85, POSES.dead]]),
  dieFront: clip([[0, POSES.bump], [0.3, POSES.buckle], [0.85, POSES.deadFront]]),
  impaled: clip([[0, POSES.crouch], [0.12, POSES.impaled]]),
  crumple: clip([[0, POSES.landHard], [0.35, POSES.crumple]]),
  dead: clip([[0, POSES.dead]]),
  victory: clip([[0, POSES.idle], [0.4, POSES.arms], [1.4, POSES.arms]]),
  rise: clip([[0, POSES.dead], [0.5, POSES.crumple], [0.95, POSES.crouch], [1.4, POSES.engarde]]),
  embrace: clip([[0, POSES.idle], [0.6, POSES.embrace]]),
  princessWait: clip([[0, POSES.princessWait], [2.0, P({ pel: [2], ch: [-4], hd: [12, 10, 4], ls: [32, 50, 10], le: 92, rs: [30, 50, 10], re: 88, lh: [2, 0, 2], lk: 3, rh: [2, 0, 2], rk: 3, g: 1, af: 1 })], [4.0, POSES.princessWait]], { loop: true, dur: 4.0 }),
  guardIdle: clip([[0, POSES.guardIdle], [1.8, P({ pel: [2], ch: [-6], hd: [-4, 6], ls: [10, 0, 20], le: 52, rs: [20, 0, 14], re: 32, lh: [2, 0, 6], lk: 4, rh: [-1, 0, 6], rk: 3, g: 1, af: 1 })], [3.6, POSES.guardIdle]], { loop: true, dur: 3.6 }),
};

// ------------------------------------------------------------------ muestreo
function catmull(p0, p1, p2, p3, t, out) {
  const t2 = t * t, t3 = t2 * t;
  for (let i = 0; i < NCH; i++) {
    const a = p0[i], b = p1[i], c = p2[i], d = p3[i];
    out[i] = 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  }
}

export function sampleClip(c, time, out) {
  const ks = c.keys;
  if (ks.length === 1) { out.set(ks[0].p); return out; }
  let t = time;
  if (c.loop) { t %= c.dur; if (t < 0) t += c.dur; } else t = Math.min(Math.max(t, 0), ks[ks.length - 1].t);
  const n = ks.length;
  let i = 0;
  if (c.loop) {
    // las claves cubren [0, dur); el último tramo enlaza con la primera
    while (i < n - 1 && t >= ks[i + 1].t) i++;
    const k1 = ks[i], k2 = i + 1 < n ? ks[i + 1] : { t: c.dur, p: ks[0].p };
    const k0 = ks[(i - 1 + n) % n], k3 = ks[(i + 2) % n];
    const span = k2.t - k1.t;
    const f = span > 0 ? (t - k1.t) / span : 0;
    // si la última clave coincide con la primera (cerrada), evitar duplicarla
    catmull(k0.p, k1.p, k2.p === ks[0].p && i + 1 >= n ? ks[0].p : k2.p, k3.p, f, out);
    return out;
  }
  while (i < n - 2 && t >= ks[i + 1].t) i++;
  const k1 = ks[i], k2 = ks[i + 1];
  const k0 = ks[Math.max(0, i - 1)], k3 = ks[Math.min(n - 1, i + 2)];
  const span = k2.t - k1.t;
  const f = span > 0 ? Math.min(1, Math.max(0, (t - k1.t) / span)) : 1;
  catmull(k0.p, k1.p, k2.p, k3.p, f, out);
  return out;
}

export class Animator {
  constructor() {
    this.clip = CLIPS.idle; this.name = 'idle';
    this.t = 0; this.speed = 1;
    this.out = new Float32Array(NCH);
    this.from = new Float32Array(NCH);
    this.tmp = new Float32Array(NCH);
    this.blend = 1; this.blendDur = 0;
    sampleClip(this.clip, 0, this.out);
    this.override = null;   // pose fija externa
  }
  play(name, opts = {}) {
    const c = CLIPS[name];
    if (!c) { console.warn('clip?', name); return; }
    if (this.name === name && !opts.restart) { if (opts.speed) this.speed = opts.speed; return; }
    this.from.set(this.out);
    this.clip = c; this.name = name;
    this.t = opts.t ?? 0;
    this.speed = opts.speed ?? 1;
    this.blendDur = opts.blend ?? 0.12;
    this.blend = this.blendDur > 0 ? 0 : 1;
  }
  get done() { return !this.clip.loop && this.t >= this.clip.dur; }
  setTime(t) { this.t = t; }
  update(dt) {
    this.t += dt * this.speed;
    sampleClip(this.clip, this.t, this.tmp);
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / this.blendDur);
      const b = this.blend * this.blend * (3 - 2 * this.blend);
      for (let i = 0; i < NCH; i++) this.out[i] = this.from[i] + (this.tmp[i] - this.from[i]) * b;
    } else this.out.set(this.tmp);
    return this.out;
  }
}

export { CH };
