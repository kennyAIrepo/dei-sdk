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
  display: flex; flex-direction: column; gap: 8px;
  font-family: 'Courier New', monospace; color: #aadfff;
  background: transparent;
  border: 1px solid rgba(120, 200, 255, 0.55);
  border-radius: 3px;
  box-shadow: 0 0 18px rgba(80, 180, 255, 0.18), inset 0 0 0 1px rgba(120, 200, 255, 0.05);
  padding: 10px; pointer-events: auto;
  opacity: 0; transform: translateX(20px); transition: opacity .3s, transform .3s;
}
#_dei_gal.show { opacity: 1; transform: translateX(0); }

#_dei_gal ._gHdr {
  display: flex; align-items: center; gap: 8px;
  font-size: 9px; letter-spacing: 2px; text-transform: uppercase;
  color: rgba(140, 210, 255, 0.6);
}
#_dei_gal ._q { flex: 1; color: #aadfff; text-transform: none; letter-spacing: 1px; font-size: 11px; }
#_dei_gal ._x {
  background: none; border: none; color: rgba(140, 210, 255, 0.4);
  cursor: pointer; font-size: 14px; padding: 0 4px; font-family: inherit;
}
#_dei_gal ._x:hover { color: #aadfff; }

#_dei_gal ._main {
  position: relative; flex: 1; min-height: 160px;
  background: transparent;
  border: 1px solid rgba(120, 200, 255, 0.3);
  border-radius: 2px;
  overflow: hidden;
  display: flex; align-items: center; justify-content: center;
}
#_dei_gal ._main img {
  max-width: 100%; max-height: 100%; object-fit: contain;
  transition: opacity .25s;
  /* the model image itself stays fully solid against the see-through frame */
}
#_dei_gal ._main._locked { border-color: rgba(120, 255, 180, 0.85); box-shadow: 0 0 18px rgba(120, 255, 180, 0.35); }
#_dei_gal ._meta {
  position: absolute; left: 6px; right: 6px; bottom: 6px;
  font-size: 10px; color: #aadfff;
  background: rgba(0, 10, 22, 0.55);
  border: 1px solid rgba(120, 200, 255, 0.2);
  padding: 3px 6px; border-radius: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  letter-spacing: 0.5px;
}
#_dei_gal ._badge {
  position: absolute; top: 6px; left: 6px;
  background: rgba(120, 255, 180, 0.9); color: #001;
  font-size: 9px; padding: 3px 8px; border-radius: 2px; letter-spacing: 1px;
  display: none; font-weight: bold;
}
#_dei_gal._lockedState ._badge { display: block; }

#_dei_gal ._strip {
  display: flex; gap: 5px; overflow-x: auto; overflow-y: hidden;
  padding: 2px; min-height: 56px;
  scrollbar-width: thin; scrollbar-color: rgba(120, 200, 255, 0.3) transparent;
  scroll-behavior: smooth;
}
#_dei_gal ._strip::-webkit-scrollbar { height: 3px; }
#_dei_gal ._strip::-webkit-scrollbar-thumb { background: rgba(120, 200, 255, 0.4); border-radius: 1px; }
#_dei_gal ._strip ._th {
  flex: 0 0 auto; width: 60px; height: 50px;
  border: 1px solid rgba(120, 200, 255, 0.2); border-radius: 2px;
  overflow: hidden; cursor: pointer; opacity: .65; transition: all .15s;
  background: transparent;
}
#_dei_gal ._strip ._th img { width: 100%; height: 100%; object-fit: cover; }
#_dei_gal ._strip ._th._active {
  opacity: 1; border-color: rgba(120, 200, 255, 0.95);
  box-shadow: 0 0 8px rgba(120, 200, 255, 0.4); transform: scale(1.06);
}
#_dei_gal ._strip ._th:hover { opacity: .9; }

#_dei_gal ._hint {
  font-size: 9px; color: rgba(140, 210, 255, 0.5); letter-spacing: 1px;
  text-align: center; padding: 2px 0;
}
#_dei_gal ._loader {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 10px; color: rgba(140, 210, 255, 0.55); letter-spacing: 2px;
  background: rgba(0, 10, 22, 0.25);
}
#_dei_gal ._loader._hide { display: none; }
#_dei_gal ._empty { color: #ffaadd; font-size: 11px; text-align: center; padding: 16px; }
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
