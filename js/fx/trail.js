// Estela de la espada: cinta aditiva que sigue a la hoja durante la estocada.
import * as THREE from 'three';

const N = 12;

export class SwordTrail {
  constructor(scene, color = 0xcfe0ff) {
    this.pts = [];     // [{tip, base}]
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * 2 * 3);
    this.alpha = new Float32Array(N * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) } },
      vertexShader: `attribute float aAlpha; varying float vA; void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor * 1.4 * vA, vA); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    scene.add(this.mesh);
    this._t = new THREE.Vector3(); this._b = new THREE.Vector3();
  }
  update(sword, active) {
    if (active && sword && sword.visible) {
      this._t.set(0.03, 0.88, 0); sword.localToWorld(this._t);
      this._b.set(0.02, 0.52, 0); sword.localToWorld(this._b);
      this.pts.unshift({ t: this._t.clone(), b: this._b.clone() });
      if (this.pts.length > N) this.pts.length = N;
    } else if (this.pts.length) {
      this.pts.pop();
      if (this.pts.length) this.pts.pop();
    }
    const n = this.pts.length;
    for (let i = 0; i < n; i++) {
      const p = this.pts[i];
      this.pos.set([p.t.x, p.t.y, p.t.z], i * 6);
      this.pos.set([p.b.x, p.b.y, p.b.z], i * 6 + 3);
      const k = 1 - i / N;
      const a = k * k * 0.32;
      this.alpha[i * 2] = a; this.alpha[i * 2 + 1] = 0;
    }
    this.mesh.geometry.setDrawRange(0, n > 1 ? (n - 1) * 6 : 0);
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.aAlpha.needsUpdate = true;
  }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mat.dispose(); }
}
