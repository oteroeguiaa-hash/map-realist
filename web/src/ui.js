// Interface : écran de chargement, compteur, menu (heure, météo, qualité, lieux), messages.
export class UI {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.$ = $;
    this.hour = 16.2;
    this.weather = 0.32;
    this.onQuality = this.onHour = this.onWeather = this.onPlace = this.onCamera = this.onReset = this.onStart = () => {};
    this.toastT = 0;
    $('bMenu').addEventListener('click', () => this.openMenu(true));
    $('bClose').addEventListener('click', () => this.openMenu(false));
    $('bCam').addEventListener('click', () => this.onCamera());
    $('bReset').addEventListener('click', () => { this.onReset(); this.openMenu(false); });
    const hourEl = $('sHour'), wEl = $('sWeather');
    const fmtH = (h) => `${String(Math.floor(h)).padStart(2, '0')} h ${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
    const wLabel = (w) => (w < 0.18 ? 'Grand beau' : w < 0.42 ? 'Beau, quelques nuages' : w < 0.65 ? 'Nuageux' : w < 0.85 ? 'Très nuageux' : 'Orageux');
    hourEl.value = this.hour; $('vHour').textContent = fmtH(this.hour);
    wEl.value = this.weather; $('vWeather').textContent = wLabel(this.weather);
    hourEl.addEventListener('input', () => { this.hour = +hourEl.value; $('vHour').textContent = fmtH(this.hour); this.onHour(this.hour); });
    wEl.addEventListener('input', () => { this.weather = +wEl.value; $('vWeather').textContent = wLabel(this.weather); this.onWeather(this.weather); });
    document.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('[data-q]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      this.onQuality(+b.dataset.q);
    }));
    document.querySelectorAll('[data-place]').forEach((b) => b.addEventListener('click', () => { this.onPlace(b.dataset.place); this.openMenu(false); }));
    $('tFps').addEventListener('change', () => { $('fps').hidden = !$('tFps').checked; });
    this.onZoom = this.onBeam = () => {};
    this.zoom = 6;
    const zoomBy = (f) => { this.zoom = Math.min(20, Math.max(1, Math.round(this.zoom * f))); if (this.zoom === 1 && f > 1) this.zoom = 2; this.onZoom(this.zoom); };
    $('bZoomIn').addEventListener('click', () => zoomBy(1.5));
    $('bZoomOut').addEventListener('click', () => zoomBy(1 / 1.5));
    $('sBeam').addEventListener('input', (e) => this.onBeam(+e.target.value));
    $('bCredits').addEventListener('click', () => { this.openMenu(false); $('credits').hidden = false; });
    $('bCredClose').addEventListener('click', () => { $('credits').hidden = true; });
    $('bPlay').addEventListener('click', () => {
      $('load').classList.add('gone');
      $('hud').hidden = false;
      setTimeout(() => { $('load').hidden = true; }, 700);
      this.onStart();
      this.toast('Joystick à gauche pour marcher · glisse à droite pour regarder · le buggy est devant toi');
    });
  }
  progress(p, msg) {
    this.$('bar').style.transform = `scaleX(${Math.max(0.02, Math.min(1, p))})`;
    if (msg) this.$('status').textContent = msg;
  }
  ready() {
    this.progress(1, 'Prêt. L’île est chargée.');
    this.$('bPlay').disabled = false;
    this.$('load').classList.add('ready');
  }
  error(msg) {
    this.$('status').textContent = 'Impossible de lancer la démo : ' + msg;
    this.$('load').classList.add('err');
  }
  openMenu(v) { this.$('menu').hidden = !v; }
  toast(msg) {
    const t = this.$('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => t.classList.remove('show'), 3200);
  }
  hud(s) {
    if (!this._n) this._n = 0;
    if (++this._n % 6) return;
    const set = (id, prop, v) => { const e = this.$(id); if (e[prop] !== v) e[prop] = v; };
    set('spd', 'textContent', String(Math.round(s.speed * 3.6)));
    set('mode', 'textContent', s.mode);
    set('droneBtns', 'hidden', !s.upDown);
    set('bBrake', 'hidden', !s.inBuggy);
    set('bJump', 'hidden', s.inBuggy || s.drone);
    set('bAct', 'hidden', !s.action);
    if (s.action) set('bAct', 'textContent', s.action);
    set('bTool', 'hidden', !s.tools);
    set('bTool', 'textContent', s.toolLabel || 'Outil');
    set('bBuild', 'hidden', !s.build);
    set('bBuild', 'textContent', s.building ? 'Terminer' : 'Construire');
    set('wood', 'hidden', !(s.wood > 0 || s.building));
    set('woodN', 'textContent', String(s.wood || 0));
    set('fps', 'textContent', `${Math.round(s.fps)} i/s`);
  }
  optics(bino, zoom, torch) {
    const $ = this.$;
    const bn = $('bino');
    if (bn.hasAttribute('hidden') === bino) {
      bn.toggleAttribute('hidden', !bino); // élément SVG : pas de propriété .hidden
      if (bino) {
        // deux optiques qui se chevauchent un peu, bords adoucis
        const W = window.innerWidth, H = window.innerHeight, r = Math.min(H * 0.46, W * 0.27);
        for (const [id, cx] of [['lensL', W / 2 - r * 0.78], ['lensR', W / 2 + r * 0.78]]) { const c = $(id); c.setAttribute('cx', cx); c.setAttribute('cy', H / 2); c.setAttribute('r', r); }
      }
    }
    if ($('zoomBar').hidden === bino) $('zoomBar').hidden = !bino;
    if (bino) { const t = Math.round(zoom) + '×'; if ($('zoomV').textContent !== t) $('zoomV').textContent = t; }
    if ($('beamBar').hidden === torch) $('beamBar').hidden = !torch;
  }
  credits(manifest) {
    const ul = this.$('credList');
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const items = Object.entries(manifest).map(([k, m]) => `<li><b>${esc(m.title || k)}</b> — ${esc(m.author || 'auteur inconnu')} · ${esc(m.license || '')}${m.source ? ` · <a href="${esc(m.source)}" target="_blank" rel="noopener">source</a>` : ''}</li>`);
    items.push('<li><b>Textures de sol, éclairage « stream », textures des falaises</b> — Poly Haven · CC0</li>');
    items.push('<li>Les modèles sous licence « NC » sont réservés à un usage personnel, non commercial.</li>');
    ul.innerHTML = items.join('');
  }
}
