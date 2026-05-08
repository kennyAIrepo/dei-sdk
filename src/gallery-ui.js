// Gallery panel — semi-transparent column on the right.
// Top: large preview frame (currently-selected model).
// Bottom: horizontal scroll strip of alternatives.
// Scroll via hand-wave swipe. Confirm via thumb-up. Then pinch-grab to spawn.
//
// State machine:
//   hidden  → searching (loading) → showing → locked → spawning → done
//
// Gesture wiring is done by DEI core (HandWaveDetector + ThumbUpTrigger).
// This module only renders + exposes scroll() / lock() / unlock() / hide().

const CSS = `
#_dei_gal {
  position: fixed; top: 80px; right: 18px; bottom: 100px;
  z-index: 40; width: min(320px, 30vw);
  display: flex; flex-direction: column; gap: 10px;
  font-family: 'Courier New', monospace; color: rgba(180,230,255,.92);
  background: linear-gradient(180deg, rgba(6,16,28,.78), rgba(2,8,16,.88));
  border: 1px solid rgba(100,180,255,.22);
  border-radius: 14px; backdrop-filter: blur(12px);
  box-shadow: 0 6px 30px rgba(0,40,80,.4), inset 0 0 0 1px rgba(100,200,255,.05);
  padding: 12px; pointer-events: auto;
  opacity: 0; transform: translateX(20px); transition: opacity .35s, transform .35s;
}
#_dei_gal.show { opacity: 1; transform: translateX(0); }
#_dei_gal._gHdr {
  display: flex; align-items: center; gap: 8px;
  font-size: 10px; letter-spacing: 2px; text-transform: uppercase;
  color: rgba(120,200,255,.55);
}
#_dei_gal ._q { flex: 1; color: rgba(200,235,255,.85); text-transform: none; letter-spacing: 1px; font-size: 11px; }
#_dei_gal ._x {
  background: none; border: none; color: rgba(120,200,255,.4);
  cursor: pointer; font-size: 14px; padding: 0 4px; font-family: inherit;
}
#_dei_gal ._x:hover { color: rgba(180,230,255,.9); }

#_dei_gal ._main {
  position: relative; flex: 1; min-height: 160px;
  background: rgba(0,8,20,.4); border: 1px solid rgba(100,180,255,.15);
  border-radius: 10px; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
}
#_dei_gal ._main img {
  width: 100%; height: 100%; object-fit: contain;
  transition: opacity .25s;
}
#_dei_gal ._main._locked { border-color: rgba(120,255,180,.7); box-shadow: 0 0 16px rgba(120,255,180,.3); }
#_dei_gal ._meta {
  position: absolute; left: 10px; right: 10px; bottom: 8px;
  font-size: 11px; color: rgba(200,230,255,.85);
  background: rgba(0,8,20,.6); padding: 4px 8px; border-radius: 4px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#_dei_gal ._badge {
  position: absolute; top: 8px; left: 8px;
  background: rgba(120,255,180,.85); color: #001;
  font-size: 9px; padding: 3px 8px; border-radius: 999px; letter-spacing: 1px;
  display: none; font-weight: bold;
}
#_dei_gal._lockedState ._badge { display: block; }

#_dei_gal ._strip {
  display: flex; gap: 6px; overflow-x: auto; overflow-y: hidden;
  padding: 4px 2px; min-height: 64px;
  scrollbar-width: thin; scrollbar-color: rgba(100,180,255,.3) transparent;
  scroll-behavior: smooth;
}
#_dei_gal ._strip::-webkit-scrollbar { height: 4px; }
#_dei_gal ._strip::-webkit-scrollbar-thumb { background: rgba(100,180,255,.3); border-radius: 2px; }
#_dei_gal ._strip ._th {
  flex: 0 0 auto; width: 64px; height: 56px;
  border: 1px solid rgba(100,180,255,.15); border-radius: 6px;
  overflow: hidden; cursor: pointer; opacity: .55; transition: all .2s;
  background: rgba(0,8,20,.4);
}
#_dei_gal ._strip ._th img { width: 100%; height: 100%; object-fit: cover; }
#_dei_gal ._strip ._th._active { opacity: 1; border-color: rgba(120,200,255,.7); transform: scale(1.05); }
#_dei_gal ._strip ._th:hover { opacity: .85; }

#_dei_gal ._hint {
  font-size: 10px; color: rgba(140,200,240,.5); letter-spacing: 1px;
  text-align: center; padding: 4px 0;
}
#_dei_gal ._loader {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 10px; color: rgba(120,200,255,.5); letter-spacing: 2px;
}
#_dei_gal ._loader._hide { display: none; }
#_dei_gal ._empty { color: rgba(255,180,150,.7); font-size: 11px; text-align: center; padding: 16px; }
`;

let _cssInjected = false;
function injectCSS() {
  if (_cssInjected) return;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
  _cssInjected = true;
}

export class Gallery {
  constructor({ onSelect, onLock, onCancel } = {}) {
    injectCSS();
    this.onSelect = onSelect;   // (model) => void  (called when active changes)
    this.onLock = onLock;       // (model) => void  (called on thumb-up)
    this.onCancel = onCancel;
    this.results = [];
    this.activeIdx = 0;
    this.locked = false;

    const root = document.createElement('div');
    root.id = '_dei_gal';
    root.innerHTML = `
      <div class="_gHdr">
        <span>SEARCH</span>
        <span class="_q">—</span>
        <button class="_x" type="button" title="close">×</button>
      </div>
      <div class="_main">
        <span class="_badge">LOCKED · pinch to grab</span>
        <img alt="" />
        <div class="_meta"></div>
        <div class="_loader">searching…</div>
      </div>
      <div class="_strip"></div>
      <div class="_hint">wave ←/→ to scroll · 👍 to lock · pinch to grab</div>
    `;
    document.body.appendChild(root);
    this.root = root;
    this.qEl = root.querySelector('._q');
    this.mainEl = root.querySelector('._main');
    this.imgEl = root.querySelector('._main img');
    this.metaEl = root.querySelector('._meta');
    this.loaderEl = root.querySelector('._loader');
    this.stripEl = root.querySelector('._strip');
    root.querySelector('._x').onclick = () => this.cancel();
  }

  show() { this.root.classList.add('show'); }
  hide() {
    this.root.classList.remove('show');
    this.locked = false;
    this.mainEl.classList.remove('_locked');
    this.root.classList.remove('_lockedState');
  }

  setQuery(q) { this.qEl.textContent = q || '—'; }
  setLoading(on) { this.loaderEl.classList.toggle('_hide', !on); }

  setResults(query, results) {
    this.results = results || [];
    this.activeIdx = 0;
    this.locked = false;
    this.mainEl.classList.remove('_locked');
    this.root.classList.remove('_lockedState');
    this.setQuery(query);
    this.setLoading(false);
    this.stripEl.innerHTML = '';
    if (!this.results.length) {
      this.imgEl.style.opacity = '0';
      this.metaEl.textContent = '';
      const e = document.createElement('div');
      e.className = '_empty';
      e.textContent = 'no models found';
      this.stripEl.appendChild(e);
      return;
    }
    for (let i = 0; i < this.results.length; i++) {
      const r = this.results[i];
      const el = document.createElement('div');
      el.className = '_th';
      el.dataset.idx = String(i);
      el.innerHTML = `<img alt="${r.name}" src="${r.thumbnail || ''}" loading="lazy" />`;
      el.onclick = () => this._setActive(i, true);
      this.stripEl.appendChild(el);
    }
    this._setActive(0, false);
  }

  scroll(dir) {
    if (this.locked || !this.results.length) return;
    const next = Math.max(0, Math.min(this.results.length - 1, this.activeIdx + (dir === 'right' ? 1 : -1)));
    if (next !== this.activeIdx) this._setActive(next, true);
  }

  _setActive(i, scrollIntoView) {
    this.activeIdx = i;
    const m = this.results[i];
    if (!m) return;
    this.imgEl.style.opacity = '1';
    this.imgEl.src = m.thumbnailLarge || m.thumbnail || '';
    this.imgEl.alt = m.name;
    this.metaEl.textContent = `${m.name}${m.author ? ' · @' + m.author : ''}${m.license ? ' · ' + m.license : ''}`;
    [...this.stripEl.children].forEach((c, idx) => {
      c.classList.toggle('_active', idx === i);
    });
    if (scrollIntoView) {
      const el = this.stripEl.children[i];
      if (el) el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
    this.onSelect?.(m);
  }

  lock() {
    if (this.locked || !this.results.length) return;
    const m = this.results[this.activeIdx];
    if (!m) return;
    this.locked = true;
    this.mainEl.classList.add('_locked');
    this.root.classList.add('_lockedState');
    this.onLock?.(m);
  }

  current() { return this.results[this.activeIdx] || null; }

  cancel() {
    this.hide();
    this.onCancel?.();
  }

  destroy() { this.root.remove(); }
}
