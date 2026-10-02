// Controles táctiles: cruceta de 8 direcciones a la izquierda y botones de SALTO y ACCIÓN a la derecha.
import { input } from '../core/input.js';

export class TouchControls {
  constructor(root) {
    this.root = root;
    this.pad = root.querySelector('#dpad');
    this.knob = root.querySelector('#knob');
    this.btns = [...root.querySelectorAll('[data-act]')];
    this.padTouch = null;
    this.dirs = { left: false, right: false, up: false, down: false };
    const opt = { passive: false };
    this.pad.addEventListener('pointerdown', (e) => this.padDown(e), opt);
    addEventListener('pointermove', (e) => this.padMove(e), opt);
    addEventListener('pointerup', (e) => this.padUp(e), opt);
    addEventListener('pointercancel', (e) => this.padUp(e), opt);
    for (const b of this.btns) {
      const act = b.dataset.act;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture?.(e.pointerId);
        b.classList.add('down');
        input.setTouch(act, true);
        if (navigator.vibrate && window.__vibrate) navigator.vibrate(8);
      }, opt);
      const up = (e) => { e.preventDefault(); b.classList.remove('down'); input.setTouch(act, false); };
      b.addEventListener('pointerup', up, opt);
      b.addEventListener('pointercancel', up, opt);
      b.addEventListener('lostpointercapture', up, opt);
    }
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.addEventListener('touchstart', (e) => { if (e.cancelable) e.preventDefault(); }, opt);
  }

  padDown(e) {
    e.preventDefault();
    this.padTouch = e.pointerId;
    this.pad.setPointerCapture?.(e.pointerId);
    this.padMove(e, true);
  }
  padMove(e, force) {
    if (e.pointerId !== this.padTouch) return;
    if (!force) e.preventDefault();
    const r = this.pad.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const rad = r.width / 2;
    let dx = (e.clientX - cx) / rad, dy = (e.clientY - cy) / rad;
    const len = Math.hypot(dx, dy);
    const dead = 0.2;
    const d = { left: false, right: false, up: false, down: false };
    if (len > dead) {
      const a = Math.atan2(-dy, dx) * 180 / Math.PI;   // 0 = derecha, 90 = arriba
      // sectores de 8 direcciones con diagonales estrechas (25º)
      const inRange = (c, w) => { let x = ((a - c + 540) % 360) - 180; return Math.abs(x) <= w; };
      d.right = inRange(0, 57.5);
      d.left = inRange(180, 57.5);
      d.up = inRange(90, 57.5);
      d.down = inRange(-90, 57.5);
    }
    this.apply(d);
    const k = Math.min(1, len);
    const nx = len > 0 ? dx / len * k : 0, ny = len > 0 ? dy / len * k : 0;
    this.knob.style.transform = `translate(${nx * 34}%, ${ny * 34}%)`;
  }
  padUp(e) {
    if (e.pointerId !== this.padTouch) return;
    this.padTouch = null;
    this.apply({ left: false, right: false, up: false, down: false });
    this.knob.style.transform = '';
  }
  apply(d) {
    for (const k of Object.keys(d)) {
      if (d[k] !== this.dirs[k]) {
        input.setTouch(k, d[k]);
        this.pad.classList.toggle('d-' + k, d[k]);
        if (d[k] && navigator.vibrate && window.__vibrate) navigator.vibrate(5);
      }
    }
    this.dirs = d;
  }
  setActionLabel(t) {
    const el = this.root.querySelector('[data-act="action"] span');
    if (el && el.textContent !== t) el.textContent = t;
  }
  setJumpLabel(t) {
    const el = this.root.querySelector('[data-act="jump"] span');
    if (el && el.textContent !== t) el.textContent = t;
  }
  show(on) { this.root.classList.toggle('on', on); }
  reset() { this.apply({ left: false, right: false, up: false, down: false }); this.knob.style.transform = ''; for (const b of this.btns) b.classList.remove('down'); }
}
