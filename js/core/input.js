// Entrada unificada: teclado, mando y controles táctiles en pantalla.
// Acciones: left, right, up, down, jump, action, pause.

const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  Space: 'jump', KeyZ: 'jump', KeyK: 'jump',
  ShiftLeft: 'action', ShiftRight: 'action', KeyX: 'action', KeyJ: 'action', ControlLeft: 'action', Enter: 'action',
  Escape: 'pause', KeyP: 'pause',
};
const ACTIONS = ['left', 'right', 'up', 'down', 'jump', 'action', 'pause'];

export class Input {
  constructor() {
    this.keys = {};          // teclado
    this.touch = {};         // táctil
    this.pad = {};           // mando
    this.state = {};         // combinado
    this.prev = {};
    this.pressed = {};
    this.released = {};
    this.buffer = {};        // pulsaciones recientes (para no perder toques rápidos)
    this.enabled = true;
    this.lastDevice = 'keyboard';
    for (const a of ACTIONS) { this.state[a] = false; this.prev[a] = false; this.pressed[a] = false; this.buffer[a] = 0; }
    addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      if (!this.keys[a]) this.buffer[a] = 0.15;
      this.keys[a] = true;
      this.lastDevice = 'keyboard';
      if (a !== 'pause') e.preventDefault();
    });
    addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (a) this.keys[a] = false;
    });
    addEventListener('blur', () => { this.keys = {}; this.touch = {}; });
  }

  setTouch(action, v) {
    if (v && !this.touch[action]) this.buffer[action] = 0.15;
    this.touch[action] = v;
    this.lastDevice = 'touch';
  }

  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = pads && [...pads].find((g) => g && g.connected);
    const s = {};
    if (p) {
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      const b = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
      s.left = ax < -0.45 || b(14);
      s.right = ax > 0.45 || b(15);
      s.up = ay < -0.55 || b(12);
      s.down = ay > 0.55 || b(13);
      s.jump = b(0);
      s.action = b(2) || b(1) || b(5) || b(7);
      s.pause = b(9);
      if (Object.values(s).some(Boolean)) this.lastDevice = 'pad';
    }
    for (const a of ACTIONS) { if (s[a] && !this.pad[a]) this.buffer[a] = 0.15; }
    this.pad = s;
  }

  update(dt) {
    this.pollPad();
    for (const a of ACTIONS) {
      const v = this.enabled && !!(this.keys[a] || this.touch[a] || this.pad[a]);
      this.prev[a] = this.state[a];
      this.state[a] = v;
      this.pressed[a] = v && !this.prev[a];
      this.released[a] = !v && this.prev[a];
      if (this.buffer[a] > 0) this.buffer[a] -= dt;
    }
  }

  // pulsado hace poco (y aún no consumido)
  hit(a) { return this.pressed[a] || this.buffer[a] > 0; }
  consume(a) { this.buffer[a] = 0; this.pressed[a] = false; }
  clear() { for (const a of ACTIONS) { this.buffer[a] = 0; this.pressed[a] = false; } this.keys = {}; this.touch = {}; }
}

export const input = new Input();
