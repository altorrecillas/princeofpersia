// Mallas de los objetos del escenario: antorchas, rastrillos, puertas, trampas, pociones, espada...
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TW, RH, SLAB, ZB, ZF, HEADROOM } from '../core/config.js';
import { mulberry32 } from '../core/utils.js';

export const sharedUniforms = { uTime: { value: 0 } };

// ---------------------------------------------------------------- llama (shader procedural, HDR)
const NOISE_GLSL = /* glsl */`
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p*=2.03; a*=.5; } return s; }
`;

let flameMat = null;
export function getFlameMaterial() {
  if (flameMat) return flameMat;
  flameMat = new THREE.ShaderMaterial({
    uniforms: { uTime: sharedUniforms.uTime, uIntensity: { value: 1.0 } },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying float vSeed;
      void main(){
        vUv = uv;
        vec4 wp = modelMatrix * vec4(0.,0.,0.,1.);
        vSeed = fract(sin(dot(wp.xy, vec2(12.9898,78.233)))*43758.5453);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.);
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uIntensity;
      varying vec2 vUv; varying float vSeed;
      ${NOISE_GLSL}
      void main(){
        float t = uTime*1.7 + vSeed*31.0;
        vec2 uv = vUv;
        float n = fbm(vec2(uv.x*4.0 + vSeed*7.0, uv.y*3.2 - t*2.2));
        float n2 = fbm(vec2(uv.x*7.0 - vSeed*3.0, uv.y*5.0 - t*3.1));
        float y = uv.y;
        float sway = (n - 0.5) * 0.35 * y + sin(t*1.3 + y*4.0)*0.03*y;
        float x = uv.x - 0.5 - sway;
        float width = 0.30 * pow(max(1.0 - y, 0.0), 0.9) * smoothstep(0.0, 0.18, y) + 0.001;
        float d = abs(x) / width;
        float body = 1.0 - d;
        float tipCut = smoothstep(0.95, 0.45 + n2*0.25, y);
        float I = clamp(body * 1.6, 0.0, 1.0) * tipCut;
        I *= 0.75 + n2*0.5;
        vec3 cOuter = vec3(0.9, 0.22, 0.03);
        vec3 cMid = vec3(1.0, 0.55, 0.12);
        vec3 cCore = vec3(1.0, 0.92, 0.7);
        vec3 col = mix(cOuter, cMid, smoothstep(0.1, 0.5, I));
        col = mix(col, cCore, smoothstep(0.55, 0.95, I) * (1.0 - y));
        float a = smoothstep(0.02, 0.35, I);
        gl_FragColor = vec4(col * (1.1 + I*2.1) * uIntensity, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  return flameMat;
}

let glowTex = null;
export function getGlowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

// destello en estrella (cuatro puntas finas y núcleo brillante) para objetos que hay que ver de lejos
let starTex = null;
export function getStarTexture() {
  if (starTex) return starTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.globalCompositeOperation = 'lighter';
  const core = ctx.createRadialGradient(64, 64, 0, 64, 64, 30);
  core.addColorStop(0, 'rgba(255,255,255,1)'); core.addColorStop(0.3, 'rgba(255,245,220,0.55)'); core.addColorStop(1, 'rgba(255,230,180,0)');
  ctx.fillStyle = core; ctx.fillRect(0, 0, 128, 128);
  const ray = (ang, len, w, a) => {
    ctx.save(); ctx.translate(64, 64); ctx.rotate(ang);
    const g = ctx.createLinearGradient(-len, 0, len, 0);
    g.addColorStop(0, 'rgba(255,240,210,0)'); g.addColorStop(0.5, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,240,210,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(0, -w); ctx.lineTo(len, 0); ctx.lineTo(0, w); ctx.closePath(); ctx.fill();
    ctx.restore();
  };
  ray(0, 62, 3.2, 1); ray(Math.PI / 2, 62, 3.2, 1); ray(Math.PI / 4, 34, 2, 0.6); ray(-Math.PI / 4, 34, 2, 0.6);
  starTex = new THREE.CanvasTexture(c);
  starTex.colorSpace = THREE.SRGBColorSpace;
  return starTex;
}
export function makeSparkle(color, size) {
  const m = new THREE.SpriteMaterial({ map: getStarTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const sp = new THREE.Sprite(m);
  sp.scale.setScalar(size);
  sp.renderOrder = 7;
  return sp;
}
// columna de luz suave que se desvanece hacia arriba (baliza de objeto importante)
let beamTex = null;
export function getBeamTexture() {
  if (beamTex) return beamTex;
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const ctx = c.getContext('2d');
  const v = ctx.createLinearGradient(0, 128, 0, 0);
  v.addColorStop(0, 'rgba(255,255,255,1)'); v.addColorStop(0.25, 'rgba(255,255,255,0.45)'); v.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, 64, 128);
  ctx.globalCompositeOperation = 'destination-in';
  const h = ctx.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, 'rgba(0,0,0,0)'); h.addColorStop(0.5, 'rgba(0,0,0,1)'); h.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = h; ctx.fillRect(0, 0, 64, 128);
  beamTex = new THREE.CanvasTexture(c);
  beamTex.colorSpace = THREE.SRGBColorSpace;
  return beamTex;
}

export function makeGlow(color, size, opacity = 1) {
  const m = new THREE.MeshBasicMaterial({
    map: getGlowTexture(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), m);
  mesh.renderOrder = 5;
  return mesh;
}

// ---------------------------------------------------------------- antorcha
export function makeTorch(mats, palace) {
  const g = new THREE.Group();
  const parts = [];
  // soporte de hierro en la pared
  const plate = new THREE.BoxGeometry(0.12, 0.22, 0.03); plate.translate(0, -0.12, 0.015);
  const arm = new THREE.CylinderGeometry(0.018, 0.018, 0.26, 8); arm.rotateX(Math.PI / 2 - 0.5); arm.translate(0, -0.06, 0.12);
  const cup = new THREE.CylinderGeometry(0.075, 0.045, 0.1, 12, 1, true); cup.translate(0, 0.02, 0.22);
  const ring = new THREE.TorusGeometry(0.075, 0.012, 6, 16); ring.rotateX(Math.PI / 2); ring.translate(0, 0.07, 0.22);
  parts.push(plate, arm, cup, ring);
  const iron = new THREE.Mesh(mergeGeometries(parts), mats.metal);
  iron.castShadow = false;
  g.add(iron);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.028, 0.32, 8), mats.wood);
  stick.position.set(0, 0.0, 0.22); stick.rotation.x = 0.12;
  g.add(stick);
  const embers = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 1.0, 0.25) }));
  embers.position.set(0, 0.14, 0.23); embers.scale.y = 0.6;
  g.add(embers);
  const flame = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.62), getFlameMaterial());
  flame.position.set(0, 0.42, 0.25);
  flame.renderOrder = 6;
  g.add(flame);
  const flame2 = flame.clone(); flame2.rotation.y = Math.PI / 2; flame2.scale.set(0.8, 0.92, 1);
  g.add(flame2);
  const glowCol = palace ? new THREE.Color(1.0, 0.62, 0.3) : new THREE.Color(1.0, 0.5, 0.2);
  const wallGlow = makeGlow(glowCol, 3.6, 0.3);
  wallGlow.position.set(0, 0.3, 0.02);
  g.add(wallGlow);
  const halo = makeGlow(new THREE.Color(1.0, 0.6, 0.25), 1.3, 0.42);
  halo.position.set(0, 0.36, 0.3);
  g.add(halo);
  g.userData = { flame, flame2, wallGlow, halo };
  return g;
}

// ---------------------------------------------------------------- rastrillo (puerta de barrotes)
export function makeGateMesh(mats, clipPlane) {
  // rastrillo como en el original: atraviesa el pasillo de la pared del fondo al borde delantero
  // (plano YZ), así que se ve de perfil y en perspectiva en lugar de como una ventana
  const g = new THREE.Group();
  const h = HEADROOM;
  const z0 = ZB + 0.1, z1 = ZF - 0.06, depth = z1 - z0, zc = (z0 + z1) / 2;
  const bars = [];
  // doble fila de barrotes (con grosor), para que también se lea de frente como en el original
  const nb = Math.round(depth / 0.3);
  for (const [bx, off] of [[-0.065, 0], [0.065, 0.5]]) {
    for (let i = 0; i <= nb; i++) {
      const z = z0 + Math.min(1, (i + off * (i < nb ? 1 : 0)) / nb) * depth;
      const b = new THREE.CylinderGeometry(0.022, 0.022, h - 0.08, 6); b.translate(bx, h / 2 + 0.04, z);
      const tip = new THREE.ConeGeometry(0.034, 0.12, 6); tip.rotateX(Math.PI); tip.translate(bx, 0.02, z);
      bars.push(b, tip);
    }
  }
  const nBands = 8;
  for (let j = 0; j < nBands; j++) {
    const y = 0.18 + j * (h - 0.34) / (nBands - 1);
    const band = new THREE.BoxGeometry(0.19, 0.045, depth + 0.04); band.translate(0, y, zc);
    bars.push(band);
    for (let i = 0; i <= nb; i += 2) {
      const rivet = new THREE.SphereGeometry(0.02, 6, 4); rivet.translate(0.1, y, z0 + (i / nb) * depth);
      const rivet2 = rivet.clone(); rivet2.translate(-0.2, 0, 0);
      bars.push(rivet, rivet2);
    }
  }
  // travesaño inferior reforzado
  const foot = new THREE.BoxGeometry(0.2, 0.08, depth + 0.04); foot.translate(0, 0.1, zc);
  bars.push(foot);
  const mat = mats.metal.clone();
  mat.clippingPlanes = [clipPlane];
  mat.clipShadows = true;
  const grid = new THREE.Mesh(mergeGeometries(bars), mat);
  grid.castShadow = true;
  g.add(grid);
  // viga superior por la que sube la reja, guías de hierro y ranura en el suelo
  const frameMat = mats.stoneTrim;
  const beam = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.26, depth + 0.16, 2, 0.04), frameMat);
  beam.position.set(0, h - 0.13, zc);
  const guideBack = new THREE.Mesh(new RoundedBoxGeometry(0.36, h, 0.16, 2, 0.03), frameMat);
  guideBack.position.set(0, h / 2, ZB + 0.06);
  const railMat = mats.metal;
  const railG = new THREE.BoxGeometry(0.03, h - 0.26, 0.05);
  const railF1 = new THREE.Mesh(railG, railMat); railF1.position.set(0.12, (h - 0.26) / 2, z1 + 0.03);
  const railF2 = railF1.clone(); railF2.position.x = -0.12;
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.012, depth), new THREE.MeshStandardMaterial({ color: 0x0c0a08, roughness: 1 }));
  slot.position.set(0, 0.006, zc);
  for (const m of [beam, guideBack]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
  g.add(railF1, railF2, slot);
  g.userData = { grid, h };
  return g;
}

// ---------------------------------------------------------------- puerta de salida / entrada
export function makeDoorMesh(mats, clipPlane, palace, isExit) {
  const g = new THREE.Group();
  const w = 1.2, h = 1.82, rise = 0.3;
  const stone = mats.stoneTrim;
  const jambG = new RoundedBoxGeometry(0.22, h, 0.3, 2, 0.04);
  const j1 = new THREE.Mesh(jambG, stone); j1.position.set(-w / 2 - 0.11, h / 2, 0.1);
  const j2 = j1.clone(); j2.position.x = w / 2 + 0.11;
  g.add(j1, j2);
  // arco apuntado bajo
  const archShape = new THREE.Shape();
  const ow = w / 2 + 0.22, iw = w / 2;
  archShape.moveTo(-ow, 0);
  archShape.lineTo(-ow, rise * 0.4);
  archShape.quadraticCurveTo(-ow * 0.6, rise + 0.02, 0, rise + 0.06);
  archShape.quadraticCurveTo(ow * 0.6, rise + 0.02, ow, rise * 0.4);
  archShape.lineTo(ow, 0);
  archShape.lineTo(iw, 0);
  archShape.quadraticCurveTo(iw * 0.55, rise - 0.08, 0, rise - 0.06);
  archShape.quadraticCurveTo(-iw * 0.55, rise - 0.08, -iw, 0);
  archShape.lineTo(-ow, 0);
  const archG = new THREE.ExtrudeGeometry(archShape, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 2, curveSegments: 12 });
  const arch = new THREE.Mesh(archG, stone);
  arch.position.set(0, h, -0.05);
  g.add(arch);
  // interior oscuro y escalones que suben hacia el fondo
  const inner = new THREE.Mesh(new THREE.PlaneGeometry(w, h + rise),
    new THREE.MeshStandardMaterial({ color: 0x07050a, roughness: 1 }));
  inner.position.set(0, (h + rise) / 2, -0.6);
  g.add(inner);
  const steps = [];
  for (let i = 0; i < 6; i++) {
    const st = new THREE.BoxGeometry(w, 0.16, 0.3);
    st.translate(0, 0.08 + i * 0.16, -0.12 - i * 0.085);
    steps.push(st);
  }
  const stairs = new THREE.Mesh(mergeGeometries(steps), stone);
  stairs.receiveShadow = true;
  g.add(stairs);
  const stairLight = makeGlow(palace ? new THREE.Color(1.0, 0.8, 0.5) : new THREE.Color(0.9, 0.7, 0.45), 1.6, 0.0);
  stairLight.position.set(0, 1.3, -0.5);
  g.add(stairLight);
  // hoja de la puerta (sube)
  const leafMat = mats.wood.clone();
  leafMat.clippingPlanes = [clipPlane];
  const board = new THREE.BoxGeometry(w, h + rise, 0.08); board.translate(0, (h + rise) / 2, 0);
  const leaf = new THREE.Mesh(board, leafMat);
  const bandsMat = mats.metal.clone(); bandsMat.clippingPlanes = [clipPlane];
  const bandsG = [];
  for (let k = 0; k < 4; k++) { const b = new THREE.BoxGeometry(w + 0.02, 0.06, 0.1); b.translate(0, 0.25 + k * 0.52, 0); bandsG.push(b); }
  for (let k = 0; k < 12; k++) { const r = new THREE.SphereGeometry(0.025, 6, 4); r.translate(-w / 2 + 0.12 + (k % 6) * (w - 0.24) / 5, 0.25 + Math.floor(k / 6) * 1.04, 0.05); bandsG.push(r); }
  const bands = new THREE.Mesh(mergeGeometries(bandsG), bandsMat);
  leaf.add(bands);
  leaf.position.z = 0.02;
  leaf.castShadow = true;
  g.add(leaf);
  g.userData = { leaf, stairLight, w, h, isExit };
  return g;
}

// ---------------------------------------------------------------- reloj de arena (introducción)
export function makeHourglass() {
  const g = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 1, roughness: 0.3 });
  const H = 0.9;
  const disc = new THREE.CylinderGeometry(0.26, 0.28, 0.06, 24);
  const top = new THREE.Mesh(disc, gold); top.position.y = H;
  const bot = new THREE.Mesh(disc, gold); bot.position.y = 0.03;
  g.add(top, bot);
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, H, 8), gold);
    post.position.set(Math.cos(a) * 0.22, H / 2 + 0.03, Math.sin(a) * 0.22);
    g.add(post);
  }
  const prof = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const y = 0.06 + t * (H - 0.09);
    const r = 0.025 + 0.16 * Math.pow(Math.abs(Math.cos(t * Math.PI)), 0.7);
    prof.push(new THREE.Vector2(r, y));
  }
  const glass = new THREE.Mesh(new THREE.LatheGeometry(prof, 24), new THREE.MeshStandardMaterial({
    color: 0xd8e4ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.25, depthWrite: false, envMapIntensity: 2,
  }));
  g.add(glass);
  const sandMat = new THREE.MeshStandardMaterial({ color: 0xe0b060, roughness: 0.9, emissive: 0x3a2008 });
  const topSand = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.3, 20), sandMat);
  topSand.rotation.x = Math.PI; topSand.position.y = H * 0.5 + 0.17;
  const botSand = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.22, 20), sandMat);
  botSand.position.y = 0.17;
  const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, H * 0.45, 6), sandMat);
  stream.position.y = H * 0.3;
  g.add(topSand, botSand, stream);
  const glow = makeGlow(new THREE.Color(1, 0.75, 0.4), 1.6, 0.25);
  glow.position.set(0, H * 0.5, 0.25);
  g.add(glow);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  let level = 1, flipT = 0;
  g.userData.update = (dt, flowing) => {
    if (g.userData.flip && flipT < 1) { flipT = Math.min(1, flipT + dt * 1.2); g.rotation.z = Math.PI * (1 - flipT) * (flipT < 1 ? 1 : 0); }
    if (flowing > 0) level = Math.max(0.05, level - dt * 0.03);
    topSand.scale.set(level, level, level);
    botSand.scale.set(1.05 - level * 0.6, 1.05 - level * 0.6, 1.05 - level * 0.6);
    stream.visible = flowing > 0 && flipT >= 1;
  };
  return g;
}

// ---------------------------------------------------------------- pinchos
export function makeSpikes(mats) {
  const g = new THREE.Group();
  const geos = [];
  const r = mulberry32(5);
  for (let iz = 0; iz < 4; iz++) for (let ix = 0; ix < 4; ix++) {
    const hh = 0.46 + r() * 0.18;
    const c = new THREE.ConeGeometry(0.06, hh, 7);
    c.translate(-TW * 0.36 + ix * TW * 0.24 + (r() - 0.5) * 0.05, hh / 2, ZB * 0.45 + iz * 0.42 + 0.2);
    geos.push(c);
  }
  const mat = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.32, metalness: 0.55, envMapIntensity: 2.5, emissive: 0x15120f });
  const spikes = new THREE.Mesh(mergeGeometries(geos), mat);
  spikes.castShadow = true;
  g.add(spikes);
  // ranuras del suelo
  const slots = new THREE.Mesh(new THREE.PlaneGeometry(TW * 0.95, ZF - ZB - 0.4),
    new THREE.MeshStandardMaterial({ color: 0x0a0909, roughness: 1, transparent: true, opacity: 0.55, depthWrite: false }));
  slots.rotation.x = -Math.PI / 2; slots.position.set(0, 0.005, (ZF + ZB) / 2);
  g.add(slots);
  g.userData = { spikes };
  return g;
}

// ---------------------------------------------------------------- cuchillas (chopper)
export function makeChopper(mats, clipTop, clipBottom) {
  const g = new THREE.Group();
  const bladeShape = (dir) => {
    const s = new THREE.Shape();
    const w = 0.62;
    s.moveTo(-w / 2, 0);
    for (let i = 0; i <= 8; i++) {
      const x = -w / 2 + (i / 8) * w;
      const y = dir * (0.05 + (i % 2) * 0.07);
      s.lineTo(x, y);
    }
    s.lineTo(w / 2, dir * 1.2);
    s.lineTo(-w / 2, dir * 1.2);
    s.lineTo(-w / 2, 0);
    return s;
  };
  const mat = mats.metal.clone();
  mat.color = new THREE.Color(0.85, 0.86, 0.9); mat.roughness = 0.3; mat.metalness = 0.65; mat.envMapIntensity = 3;
  mat.emissive = new THREE.Color(0.06, 0.06, 0.07);
  mat.clippingPlanes = [clipTop, clipBottom];
  const ext = { depth: 0.06, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.014, bevelSegments: 1 };
  const upper = new THREE.Mesh(new THREE.ExtrudeGeometry(bladeShape(1), ext), mat);
  const lower = new THREE.Mesh(new THREE.ExtrudeGeometry(bladeShape(-1), ext), mat);
  upper.castShadow = lower.castShadow = true;
  upper.userData.keep = lower.userData.keep = true;
  g.add(upper, lower);
  const blood = new THREE.MeshStandardMaterial({ color: 0x5a0606, roughness: 0.3, transparent: true, opacity: 0 });
  const bl = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.25), blood);
  bl.position.z = 0.05;
  upper.add(bl);
  // guías laterales
  const guideG = new RoundedBoxGeometry(0.07, HEADROOM, 0.14, 2, 0.02);
  const gl = new THREE.Mesh(guideG, mats.metal); gl.position.set(-0.36, HEADROOM / 2, 0);
  const gr = gl.clone(); gr.position.x = 0.36;
  // ranuras oscuras en techo y suelo donde se esconden las hojas
  const slotMat = new THREE.MeshBasicMaterial({ color: 0x050405 });
  const slotT = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.04, 0.12), slotMat); slotT.position.set(0, HEADROOM - 0.01, 0.03);
  const slotB = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.012, 0.12), slotMat); slotB.position.set(0, 0.004, 0.03);
  g.add(slotT, slotB);
  g.add(gl, gr);
  g.userData = { upper, lower, blood };
  return g;
}

// ---------------------------------------------------------------- placa de presión
export function makePlate(mats, raise) {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new RoundedBoxGeometry(TW * 0.8, 0.08, 1.1, 2, 0.02), mats.plate);
  top.position.y = 0.04;
  top.receiveShadow = true;
  g.add(top);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x050404, roughness: 1 });
  const rim = new THREE.Mesh(new THREE.PlaneGeometry(TW * 0.86, 1.18), rimMat);
  rim.rotation.x = -Math.PI / 2; rim.position.y = 0.003;
  g.add(rim);
  // marca grabada que distingue las placas (abrir = rombo; cerrar = aspa)
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.18), new THREE.MeshBasicMaterial({
    color: raise ? 0x8a6a2a : 0x5a2020, transparent: true, opacity: 0.8, depthWrite: false,
  }));
  mark.rotation.x = -Math.PI / 2; mark.rotation.z = raise ? Math.PI / 4 : 0; mark.position.y = 0.082;
  top.add(mark);
  g.userData = { top };
  return g;
}

// ---------------------------------------------------------------- pociones
const POTION_COLORS = {
  heal: new THREE.Color(1.0, 0.08, 0.06),
  life: new THREE.Color(1.0, 0.1, 0.25),
  poison: new THREE.Color(0.12, 0.25, 1.0),
  float: new THREE.Color(0.15, 1.0, 0.3),
  flip: new THREE.Color(0.85, 0.3, 1.0),
};
export function potionColor(kind) { return POTION_COLORS[kind] || POTION_COLORS.heal; }

export function makePotion(kind) {
  const g = new THREE.Group();
  const big = kind === 'life';
  const s = big ? 1.35 : 1.0;
  const pts = [];
  const prof = [[0, 0], [0.05, 0.004], [0.075, 0.03], [0.082, 0.07], [0.07, 0.11], [0.04, 0.14], [0.022, 0.16], [0.02, 0.23], [0.028, 0.245], [0.026, 0.255]];
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r * s, y * s));
  const glass = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false,
    envMapIntensity: 2.0,
  }));
  const col = potionColor(kind);
  const liqPts = prof.slice(0, 6).map(([r, y]) => new THREE.Vector2(r * s * 0.86, Math.min(y, 0.12) * s + 0.004));
  const liquid = new THREE.Mesh(new THREE.LatheGeometry(liqPts, 16), new THREE.MeshStandardMaterial({
    color: col, emissive: col, emissiveIntensity: 1.4, roughness: 0.2, transparent: true, opacity: 0.92,
  }));
  const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.024 * s, 0.02 * s, 0.04 * s, 8),
    new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.9 }));
  cork.position.y = 0.26 * s;
  glass.renderOrder = 3;
  g.add(liquid, glass, cork);
  const glow = makeGlow(col, 0.9 * s, 0.6);
  glow.position.set(0, 0.08 * s, 0.05);
  g.add(glow);
  g.userData = { liquid, glow, col };
  return g;
}

// ---------------------------------------------------------------- cimitarra
export function makeScimitar(opts = {}) {
  const len = opts.length || 0.82;
  const shape = new THREE.Shape();
  // hoja curva: lomo y filo
  const N = 18;
  const spine = [], edge = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const y = t * len;
    const curve = Math.pow(t, 2.2) * 0.13;
    const width = 0.038 + Math.pow(t, 3) * 0.035 - (t > 0.92 ? (t - 0.92) * 0.9 : 0);
    spine.push([-0.014 + curve * 0.9, y]);
    edge.push([-0.014 + curve + Math.max(width, 0.004), y]);
  }
  shape.moveTo(spine[0][0], spine[0][1]);
  for (const p of spine) shape.lineTo(p[0], p[1]);
  shape.lineTo(edge[N][0] - 0.02, len + 0.03);
  for (let i = N; i >= 0; i--) shape.lineTo(edge[i][0], edge[i][1]);
  shape.lineTo(spine[0][0], spine[0][1]);
  const blade = new THREE.ExtrudeGeometry(shape, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.004, bevelSegments: 1, curveSegments: 4 });
  blade.translate(0, 0.07, -0.003);
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xdfe6f0, metalness: 0.88, roughness: 0.22, envMapIntensity: 4.0, emissive: 0x1a1d22 });
  const g = new THREE.Group();
  const bm = new THREE.Mesh(blade, bladeMat);
  bm.castShadow = true;
  g.add(bm);
  const gold = new THREE.MeshStandardMaterial({ color: opts.hilt || 0xc8a050, metalness: 1, roughness: 0.3 });
  const guard = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.026, 0.03, 1, 0.01), gold);
  guard.position.y = 0.065;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.13, 8), new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.8 }));
  grip.position.y = 0;
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), gold);
  pommel.position.y = -0.07;
  g.add(guard, grip, pommel);
  g.userData = { blade: bm, bladeMat };
  return g;
}

// ---------------------------------------------------------------- espejo mágico
export function makeMirror(mats) {
  const g = new THREE.Group();
  const w = 0.95, h = 1.95;
  const frameShape = new THREE.Shape();
  frameShape.moveTo(-w / 2 - 0.1, 0); frameShape.lineTo(w / 2 + 0.1, 0); frameShape.lineTo(w / 2 + 0.1, h);
  frameShape.quadraticCurveTo(0, h + 0.5, -w / 2 - 0.1, h); frameShape.lineTo(-w / 2 - 0.1, 0);
  const hole = new THREE.Path();
  hole.moveTo(-w / 2, 0.05); hole.lineTo(w / 2, 0.05); hole.lineTo(w / 2, h - 0.03);
  hole.quadraticCurveTo(0, h + 0.36, -w / 2, h - 0.03); hole.lineTo(-w / 2, 0.05);
  frameShape.holes.push(hole);
  const frame = new THREE.Mesh(new THREE.ExtrudeGeometry(frameShape, { depth: 0.08, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2, curveSegments: 16 }),
    new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 1, roughness: 0.28 }));
  frame.castShadow = true;
  g.add(frame);
  const glassShape = new THREE.Shape();
  glassShape.moveTo(-w / 2, 0.05); glassShape.lineTo(w / 2, 0.05); glassShape.lineTo(w / 2, h - 0.03);
  glassShape.quadraticCurveTo(0, h + 0.36, -w / 2, h - 0.03); glassShape.lineTo(-w / 2, 0.05);
  const glassMat = new THREE.ShaderMaterial({
    uniforms: { uTime: sharedUniforms.uTime, uBreak: { value: 0 } },
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uBreak; varying vec2 vP;
      ${NOISE_GLSL}
      void main(){
        float n = fbm(vec2(vP.x*2.0 + uTime*0.15, vP.y*1.5 - uTime*0.1));
        float streak = smoothstep(0.75, 1.0, sin((vP.x*1.4 + vP.y*0.6)*6.0 + uTime*0.8)*0.5+0.5);
        vec3 c = mix(vec3(0.05,0.08,0.14), vec3(0.35,0.45,0.6), n) + streak*0.25;
        c += vec3(0.6,0.7,1.0) * pow(n, 4.0) * 0.8;
        gl_FragColor = vec4(c * (1.0 + uBreak*3.0), 0.9 - uBreak*0.6);
      }`,
    transparent: true,
  });
  const glass = new THREE.Mesh(new THREE.ShapeGeometry(glassShape, 16), glassMat);
  glass.position.z = 0.05;
  g.add(glass);
  g.userData = { glass, glassMat };
  return g;
}

// ---------------------------------------------------------------- decoración
export function makeChains(mats) {
  const geos = [];
  const r = mulberry32(9);
  for (let k = 0; k < 2; k++) {
    const x = (k - 0.5) * 0.5;
    const len = 6 + Math.floor(r() * 5);
    for (let i = 0; i < len; i++) {
      const t = new THREE.TorusGeometry(0.035, 0.009, 4, 8);
      if (i % 2) t.rotateY(Math.PI / 2);
      t.translate(x, -i * 0.06, 0);
      geos.push(t);
    }
    if (k === 0) {
      const cuff = new THREE.TorusGeometry(0.06, 0.015, 6, 12);
      cuff.translate(x, -len * 0.06 - 0.05, 0);
      geos.push(cuff);
    }
  }
  const ringBolt = new THREE.CylinderGeometry(0.03, 0.03, 0.06, 8); ringBolt.rotateX(Math.PI / 2); ringBolt.translate(-0.25, 0.04, 0);
  const ringBolt2 = ringBolt.clone(); ringBolt2.translate(0.5, 0, 0);
  geos.push(ringBolt, ringBolt2);
  const m = new THREE.Mesh(mergeGeometries(geos), mats.metal);
  return m;
}

export function makeBones(mats) {
  const g = new THREE.Group();
  const boneMat = new THREE.MeshStandardMaterial({ color: 0xcfc4a8, roughness: 0.8 });
  const r = mulberry32(13);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), boneMat);
  skull.scale.set(1, 0.9, 1.15); skull.position.set(0.1, 0.08, 0); skull.rotation.set(0.3, 0.6, 0.2);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.08), boneMat); jaw.position.set(0.0, -0.06, 0.06); skull.add(jaw);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x050403 });
  const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), eyeMat); e1.position.set(-0.035, 0.0, 0.088); skull.add(e1);
  const e2 = e1.clone(); e2.position.x = 0.035; skull.add(e2);
  g.add(skull);
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.25 + r() * 0.15, 3, 6), boneMat);
    b.rotation.set(Math.PI / 2 + (r() - 0.5) * 0.4, 0, r() * Math.PI);
    b.position.set(-0.25 + r() * 0.5, 0.03, (r() - 0.5) * 0.4);
    g.add(b);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

export function makeBanner(color = 0x7a1018) {
  const g = new THREE.Group();
  const w = 0.75, h = 1.5;
  const geo = new THREE.PlaneGeometry(w, h, 4, 8);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), x = pos.getX(i);
    pos.setZ(i, Math.sin((x / w) * Math.PI * 2) * 0.03);
    if (y < -h / 2 + 0.01) pos.setY(i, y - (Math.abs(x) < 0.01 ? 0.18 : 0));
  }
  geo.computeVertexNormals();
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const ctx = c.getContext('2d');
  const col = new THREE.Color(color);
  ctx.fillStyle = `#${col.getHexString()}`; ctx.fillRect(0, 0, 128, 256);
  ctx.strokeStyle = '#d4a84a'; ctx.lineWidth = 6; ctx.strokeRect(8, 8, 112, 240);
  ctx.fillStyle = '#d4a84a';
  ctx.beginPath(); ctx.moveTo(64, 70); ctx.lineTo(96, 120); ctx.lineTo(64, 170); ctx.lineTo(32, 120); ctx.fill();
  ctx.fillStyle = `#${col.getHexString()}`;
  ctx.beginPath(); ctx.arc(64, 120, 18, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#d4a84a';
  ctx.beginPath(); ctx.arc(64, 120, 8, 0, Math.PI * 2); ctx.fill();
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tx, roughness: 0.9, side: THREE.DoubleSide }));
  m.position.y = -h / 2;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, w + 0.2, 8), new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 1, roughness: 0.3 }));
  rod.rotation.z = Math.PI / 2;
  g.add(m, rod);
  return g;
}

export function makeVase(seed) {
  const r = mulberry32(seed);
  const pts = [];
  const h = 0.55 + r() * 0.35;
  const prof = [[0.0, 0], [0.12, 0.0], [0.16, 0.08], [0.22, 0.3], [0.2, 0.55], [0.1, 0.78], [0.08, 0.9], [0.12, 1.0]];
  for (const [rr, y] of prof) pts.push(new THREE.Vector2(rr * (0.8 + r() * 0.3), y * h));
  const col = [0x2d6d84, 0x9c4b22, 0x2b3f6a, 0x7b6a45][Math.floor(r() * 4)];
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 18), new THREE.MeshStandardMaterial({ color: col, roughness: 0.35, metalness: 0.1 }));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export function makeLantern() {
  const g = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: 0xb08a3e, metalness: 1, roughness: 0.35 });
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.7, 4), gold);
  chain.position.y = 0.35;
  const cage = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.8), new THREE.MeshStandardMaterial({
    color: 0xb08a3e, metalness: 1, roughness: 0.4, wireframe: true,
  }));
  const glassC = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.3, 0.5) }));
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.16, 10), gold); top.position.y = 0.18;
  g.add(chain, cage, glassC, top);
  const halo = makeGlow(new THREE.Color(1.0, 0.65, 0.3), 1.5, 0.6);
  halo.position.z = 0.1;
  g.add(halo);
  return g;
}

export function makeWindow(mats, skyTex) {
  // ventana con arco apuntado que da al cielo nocturno + celosía
  const g = new THREE.Group();
  const w = 0.85, h = 1.45;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(w / 2, h);
  shape.quadraticCurveTo(w / 2, h + 0.35, 0, h + 0.5);
  shape.quadraticCurveTo(-w / 2, h + 0.35, -w / 2, h); shape.lineTo(-w / 2, 0);
  const skyGeo = new THREE.ShapeGeometry(shape, 12);
  // UV del cielo en espacio del objeto
  const pos = skyGeo.attributes.position, uv = skyGeo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, 0.35 + pos.getX(i) / 3.2, 0.15 + pos.getY(i) / 2.6);
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ map: skyTex, color: new THREE.Color(1.4, 1.4, 1.6) }));
  g.add(sky);
  // marco
  const outer = new THREE.Shape();
  const ow = w / 2 + 0.14;
  outer.moveTo(-ow, -0.12); outer.lineTo(ow, -0.12); outer.lineTo(ow, h);
  outer.quadraticCurveTo(ow, h + 0.45, 0, h + 0.66);
  outer.quadraticCurveTo(-ow, h + 0.45, -ow, h); outer.lineTo(-ow, -0.12);
  outer.holes.push(new THREE.Path(shape.getPoints(12)));
  const frame = new THREE.Mesh(new THREE.ExtrudeGeometry(outer, { depth: 0.14, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2, curveSegments: 12 }), mats.stoneTrim);
  frame.receiveShadow = true;
  g.add(frame);
  // celosía
  const lat = [];
  for (let i = 1; i < 4; i++) { const b = new THREE.BoxGeometry(0.025, h + 0.4, 0.025); b.translate(-w / 2 + i * w / 4, (h + 0.4) / 2, 0.06); lat.push(b); }
  for (let j = 1; j < 6; j++) { const b = new THREE.BoxGeometry(w, 0.025, 0.025); b.translate(0, j * h / 5, 0.06); lat.push(b); }
  const latM = new THREE.Mesh(mergeGeometries(lat), new THREE.MeshStandardMaterial({ color: 0x2b1d10, roughness: 0.6, metalness: 0.3 }));
  g.add(latM);
  // alféizar
  const sill = new THREE.Mesh(new RoundedBoxGeometry(w + 0.4, 0.1, 0.3, 2, 0.03), mats.stoneTrim);
  sill.position.set(0, -0.15, 0.12);
  g.add(sill);
  return g;
}

// rayo de luz de luna (cono aditivo)
export function makeLightShaft(color, len = 4, width = 1.2) {
  const geo = new THREE.PlaneGeometry(width, len, 1, 8);
  geo.translate(0, -len / 2, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: sharedUniforms.uTime },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uTime; varying vec2 vUv;
      void main(){
        float edge = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
        float fall = pow(vUv.y, 1.6);
        float flick = 0.9 + 0.1*sin(uTime*0.7 + vUv.y*6.0);
        gl_FragColor = vec4(uColor * edge * fall * 0.16 * flick, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 4;
  return m;
}

export function makeArch(mats) {
  // nicho / arco ciego en la pared del fondo
  const g = new THREE.Group();
  const w = 0.95, h = 1.5;
  const inner = new THREE.Shape();
  inner.moveTo(-w / 2, 0); inner.lineTo(w / 2, 0); inner.lineTo(w / 2, h);
  inner.absarc(0, h, w / 2, 0, Math.PI, false); inner.lineTo(-w / 2, 0);
  const recess = new THREE.Mesh(new THREE.ShapeGeometry(inner, 12), new THREE.MeshStandardMaterial({ color: 0x0c0b0d, roughness: 1 }));
  recess.position.z = 0.005;
  g.add(recess);
  const outer = new THREE.Shape();
  const ow = w / 2 + 0.13;
  outer.moveTo(-ow, 0); outer.lineTo(ow, 0); outer.lineTo(ow, h); outer.absarc(0, h, ow, 0, Math.PI, false); outer.lineTo(-ow, 0);
  outer.holes.push(new THREE.Path(inner.getPoints(12)));
  const fr = new THREE.Mesh(new THREE.ExtrudeGeometry(outer, { depth: 0.1, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1, curveSegments: 12 }), mats.stoneTrim);
  fr.receiveShadow = true;
  g.add(fr);
  return g;
}
