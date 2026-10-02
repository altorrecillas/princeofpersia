// Interfaz durante la partida: vida, enemigo, reloj, mensajes y avisos.
const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.hp = $('hp'); this.ehp = $('ehp'); this.ename = $('ename');
    this.timer = $('timer'); this.msg = $('msg'); this.banner_ = $('banner'); this.toast_ = $('toast'); this.prompt_ = $('prompt');
    this.dead = $('dead'); this.deadMsg = $('deadMsg');
    this.lastHp = ''; this.lastE = ''; this.lastTimer = '';
    this.msgT = 0; this.toastT = 0; this.bannerT = 0;
    this.tapped = false;
    this.dead.addEventListener('pointerdown', () => { this.tapped = true; });
  }
  consumeTap() { const t = this.tapped; this.tapped = false; return t; }

  tri(n, max, cls) {
    let s = '';
    for (let i = 0; i < max; i++) s += `<i class="${i < n ? cls : 'empty'}"></i>`;
    return s;
  }

  setLevel(def) { this.level = def; }

  update(game) {
    const p = game.player;
    if (!p) return;
    const key = p.hp + '/' + p.maxHp;
    if (key !== this.lastHp) {
      this.hp.innerHTML = this.tri(p.hp, p.maxHp, 'full');
      this.hp.classList.toggle('low', p.hp <= 1 && p.alive);
      this.lastHp = key;
    }
    // enemigo en combate
    const e = p.inCombat && p.target ? p.target : null;
    const ek = e ? e.hp + '/' + e.maxHp + e.type : '';
    if (ek !== this.lastE) {
      this.lastE = ek;
      if (e) {
        const names = { guard: 'Guardia', fat: 'Guardia gordo', skeleton: 'Esqueleto', jaffar: 'Jaffar', shadow: 'Sombra' };
        this.ename.textContent = names[e.type] || 'Guardia';
        this.ehp.innerHTML = e.immortal ? '<b class="inf">∞</b>' : this.tri(Math.max(0, e.hp), e.maxHp, 'efull');
        $('enemy').classList.add('on');
      } else $('enemy').classList.remove('on');
    }
    if (game.settings.timer && game.run) {
      const t = Math.ceil(game.run.timeLeft);
      const s = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
      if (s !== this.lastTimer) { this.timer.querySelector('span').textContent = s; this.lastTimer = s; this.timer.classList.toggle('low', t < 300); }
      this.timer.style.display = '';
    } else this.timer.style.display = 'none';
    const dt = 1 / 60;
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) this.msg.classList.remove('on'); }
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.toast_.classList.remove('on'); }
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) this.banner_.classList.remove('on'); }
  }

  message(t, dur = 3.2) { this.msg.textContent = t; this.msg.classList.add('on'); this.msgT = dur; }
  toast(t, dur = 2.4) { this.toast_.textContent = t; this.toast_.classList.add('on'); this.toastT = dur; }
  banner(title, sub, dur = 3.4) {
    this.banner_.innerHTML = `<div class="bt">${title}</div><div class="bs">${sub || ''}</div>`;
    this.banner_.classList.remove('on'); void this.banner_.offsetWidth; this.banner_.classList.add('on');
    this.bannerT = dur;
  }
  prompt(t) {
    if (t === this.lastPrompt) return;
    this.lastPrompt = t;
    this.prompt_.textContent = t;
    this.prompt_.classList.toggle('on', !!t);
  }
  flashEnemy() { const el = $('enemy'); el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }
  showDead(on, msg) {
    this.dead.classList.toggle('on', on);
    if (msg) this.deadMsg.textContent = msg;
    this.tapped = false;
  }
  show(on) { document.getElementById('hud').classList.toggle('on', on); }
}
