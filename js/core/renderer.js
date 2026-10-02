// Renderizador WebGL2 + postprocesado (bloom, tonemapping, gradación, viñeta, grano).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { QUALITY } from './config.js';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uExposure: { value: 1.0 },
    uVignette: { value: 0.9 },
    uGrain: { value: 0.035 },
    uCA: { value: 0.0025 },
    uFlash: { value: new THREE.Color(1, 0, 0) },
    uFlashAmt: { value: 0 },
    uFade: { value: 0 },
    uSat: { value: 1.0 },
    uWarm: { value: 0.0 },
    uBright: { value: 1.0 },
    uLift: { value: new THREE.Vector3(0.012, 0.014, 0.024) },
    uGain: { value: new THREE.Vector3(1.04, 1.0, 0.95) },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uExposure, uVignette, uGrain, uCA, uFlashAmt, uFade, uSat, uWarm, uBright;
    uniform vec3 uFlash, uLift, uGain;
    uniform vec2 uRes;
    varying vec2 vUv;
    vec3 RRTAndODTFit(vec3 v){ vec3 a = v*(v+0.0245786)-0.000090537; vec3 b = v*(0.983729*v+0.4329510)+0.238081; return a/b; }
    vec3 aces(vec3 c){
      const mat3 ACESInputMat = mat3(vec3(0.59719,0.07600,0.02840), vec3(0.35458,0.90834,0.13383), vec3(0.04823,0.01566,0.83777));
      const mat3 ACESOutputMat = mat3(vec3(1.60475,-0.10208,-0.00327), vec3(-0.53108,1.10813,-0.07276), vec3(-0.07367,-0.00605,1.07602));
      c = ACESInputMat * c; c = RRTAndODTFit(c); c = ACESOutputMat * c; return clamp(c, 0.0, 1.0);
    }
    vec3 toSRGB(vec3 c){ return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * uCA * r2 * 4.0;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv - off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv + off).b;
      col *= uExposure * 1.35;
      col = aces(col);
      col = toSRGB(col);
      // gradación: sombras frías, luces cálidas
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = col * uGain + uLift * (1.0 - l);
      col = mix(vec3(l), col, uSat);
      col += vec3(0.05, 0.02, -0.03) * uWarm;
      // curva en S suave
      col = mix(col, col*col*(3.0-2.0*col), 0.22);
      // brillo elegido por el jugador: curva gamma que levanta las sombras y respeta las luces
      col = pow(max(col, 0.0), vec3(1.0 / uBright));
      // viñeta (más suave cuanto más brillo se pide)
      float vig = smoothstep(0.95, 0.25, length(d * vec2(1.0, 0.8)) * uVignette * 1.15);
      col *= mix(0.58 + max(uBright - 1.0, 0.0) * 0.35, 1.0, vig);
      // destello (daño, pociones)
      col = mix(col, uFlash, uFlashAmt * (0.35 + 0.65 * (1.0 - vig)));
      // grano
      float g = hash(vUv * uRes + fract(uTime) * 100.0) - 0.5;
      col += g * uGrain;
      col *= 1.0 - uFade;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Renderer {
  constructor(canvas, qualityName) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true,
    });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.localClippingEnabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.final = null;
    this.dynScale = 1;
    this.frameTimes = [];
    this.flash = { color: new THREE.Color(1, 0, 0), amt: 0 };
    this.fade = 0;
    this.setQuality(qualityName);
  }

  setQuality(name) {
    this.qname = name;
    this.q = QUALITY[name];
    const r = this.renderer;
    r.shadowMap.enabled = this.q.shadows;
    r.toneMapping = this.q.post ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.3;
    this.dynScale = 1;
    this.buildComposer();
    this.resize();
  }

  buildComposer() {
    if (this.composer) { this.composer.dispose?.(); this.composer = null; }
    if (!this.q.post) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
      type: THREE.HalfFloatType, samples: this.q.msaa,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(null, null);
    this.composer.addPass(this.renderPass);
    if (this.q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.38, 1.35);
      this.composer.addPass(this.bloom);
    } else this.bloom = null;
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
  }

  basePixelRatio() {
    return Math.min(window.devicePixelRatio || 1, this.q.pixelRatio);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.width = w; this.height = h;
    const pr = this.basePixelRatio() * this.dynScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
      if (this.bloom) this.bloom.resolution.set(w * pr * this.q.bloomRes, h * pr * this.q.bloomRes);
      this.final.uniforms.uRes.value.set(w * pr, h * pr);
    }
  }

  // escala de resolución dinámica para mantener la fluidez
  adapt(dt) {
    if (new URLSearchParams(location.search).has('nodynres')) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 45) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    let s = this.dynScale;
    if (avg > 1 / 45) s = Math.max(0.55, s - 0.1);
    else if (avg < 1 / 58 && s < 1) s = Math.min(1, s + 0.05);
    if (s !== this.dynScale) { this.dynScale = s; this.resize(); }
  }

  render(scene, camera, time, grade = {}) {
    if (this.composer) {
      this.renderPass.scene = scene; this.renderPass.camera = camera;
      const u = this.final.uniforms;
      u.uTime.value = time;
      u.uFlash.value.copy(this.flash.color);
      u.uFlashAmt.value = this.flash.amt;
      u.uFade.value = this.fade;
      u.uExposure.value = grade.exposure ?? 1.0;
      u.uSat.value = grade.sat ?? 1.0;
      u.uWarm.value = grade.warm ?? 0.0;
      u.uVignette.value = grade.vignette ?? 0.9;
      u.uBright.value = grade.bright ?? 1.0;
      if (this.bloom) {
        this.bloom.strength = grade.bloom ?? 0.55;
        this.bloom.threshold = grade.bloomThreshold ?? 1.35;
      }
      this.composer.render();
    } else {
      this.renderer.toneMappingExposure = 1.3 * (grade.exposure ?? 1.0) * Math.pow(grade.bright ?? 1.0, 0.8);
      this.renderer.render(scene, camera);
    }
  }
}
