// Spatial dialogue panel: floating HUD that hosts the command bus.
// Two input routes feed the same registered regex handlers:
//   - text input field   (always available, no API needed)
//   - mic toggle button  (opt-in; requires voice.apiKey or voice.transcribeUrl)
//
// Construct via DEI.create({ ui: true }) or directly: new VoicePanel({ dei }).

const CSS = `
#_dei_panel {
  position: fixed; bottom: 10px; left: 50%; transform: translateX(-50%);
  z-index: 50; width: min(560px, 90vw);
  font-family: 'Courier New', monospace;
  color: #9fdaff;
  background: rgba(0, 10, 22, 0.30);
  border: 1px solid rgba(120, 200, 255, 0.7);
  border-radius: 3px;
  backdrop-filter: blur(6px);
  box-shadow: 0 0 18px rgba(80, 180, 255, 0.22), inset 0 0 0 1px rgba(120, 200, 255, 0.06);
  transition: opacity .25s, transform .25s;
}
#_dei_panel.collapsed { width: 38px; height: 38px; cursor: pointer; }
#_dei_panel.collapsed > *:not(._dei_orb) { display: none; }
#_dei_panel ._dei_orb {
  display: none; align-items: center; justify-content: center;
  width: 100%; height: 100%; font-size: 16px; color: #9fdaff;
}
#_dei_panel.collapsed ._dei_orb { display: flex; animation: _deiPulse 2s infinite ease-in-out; }
@keyframes _deiPulse { 0%,100%{opacity:.6} 50%{opacity:1} }

#_dei_panel ._hdr {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 10px;
  border-bottom: 1px solid rgba(120, 200, 255, 0.25);
  font-size: 9px; letter-spacing: 2px; text-transform: uppercase;
  color: rgba(140, 210, 255, 0.6);
}
#_dei_panel ._hdr ._title { flex: 1 }
#_dei_panel ._hdr ._collapse {
  background: none; border: none; color: rgba(140, 210, 255, 0.4);
  cursor: pointer; font-size: 13px; padding: 0 3px; font-family: inherit;
}
#_dei_panel ._hdr ._collapse:hover { color: #aadfff; }

#_dei_panel ._mic {
  background: rgba(0, 18, 36, 0.4);
  border: 1px solid rgba(120, 200, 255, 0.45);
  border-radius: 2px; padding: 2px 8px; font-size: 9px;
  color: rgba(150, 215, 255, 0.85); cursor: pointer; font-family: inherit;
  display: flex; align-items: center; gap: 5px;
  letter-spacing: 1px; transition: all .15s;
}
#_dei_panel ._mic:hover { border-color: rgba(120, 200, 255, 0.85); color: #aadfff; }
#_dei_panel ._mic[data-state="on"]     { background: rgba(40, 130, 220, 0.22); border-color: rgba(120, 200, 255, 0.95); color: #aadfff; }
#_dei_panel ._mic[data-state="wait"]   { background: rgba(180, 130, 220, 0.18); border-color: rgba(200, 150, 255, 0.7); color: #ddbbff; }
#_dei_panel ._mic[data-state="denied"] { background: rgba(80, 30, 30, 0.4);     border-color: rgba(255, 130, 130, 0.55); color: #ff9999; }
#_dei_panel ._mic ._dot {
  width: 6px; height: 6px; border-radius: 50%; background: rgba(160, 200, 230, 0.4);
}
#_dei_panel ._mic[data-state="on"]   ._dot { background: #6fbcff; animation: _deiBlink 1s infinite; box-shadow: 0 0 6px #6fbcff; }
#_dei_panel ._mic[data-state="wait"] ._dot { background: #ddbbff; animation: _deiBlink 1.4s infinite; }
@keyframes _deiBlink { 0%,100%{opacity:1} 50%{opacity:.3} }

#_dei_panel ._log {
  max-height: 88px; overflow-y: auto; padding: 4px 10px;
  font-size: 11px; line-height: 1.35;
  scrollbar-width: thin; scrollbar-color: rgba(120, 200, 255, 0.3) transparent;
}
#_dei_panel ._log::-webkit-scrollbar { width: 3px; }
#_dei_panel ._log::-webkit-scrollbar-thumb { background: rgba(120, 200, 255, 0.4); border-radius: 1px; }
#_dei_panel ._log ._row { margin: 1px 0; }
#_dei_panel ._log ._row._user { color: #aadfff; }
#_dei_panel ._log ._row._user:before { content: '› '; color: rgba(140, 210, 255, 0.55); }
#_dei_panel ._log ._row._sys  { color: #7fc8ff; font-size: 10px; }
#_dei_panel ._log ._row._sys:before  { content: '✓ '; }
#_dei_panel ._log ._row._err  { color: #ffaadd; font-size: 10px; }
#_dei_panel ._log ._row._err:before  { content: '✗ '; }

#_dei_panel ._inputRow {
  display: flex; gap: 4px; padding: 4px 8px;
  border-top: 1px solid rgba(120, 200, 255, 0.25);
}
#_dei_panel ._txt {
  flex: 1; background: rgba(0, 14, 28, 0.45);
  border: 1px solid rgba(120, 200, 255, 0.3);
  border-radius: 2px; padding: 4px 8px;
  font-family: inherit; font-size: 11px;
  color: #aadfff; outline: none; transition: border .15s;
  letter-spacing: 0.5px;
}
#_dei_panel ._txt:focus { border-color: rgba(120, 200, 255, 0.85); box-shadow: 0 0 6px rgba(120, 200, 255, 0.3); }
#_dei_panel ._txt::placeholder { color: rgba(140, 200, 230, 0.42); }
#_dei_panel ._send {
  background: rgba(20, 60, 110, 0.4);
  border: 1px solid rgba(120, 200, 255, 0.55);
  border-radius: 2px; padding: 0 12px;
  color: #aadfff; cursor: pointer;
  font-family: inherit; font-size: 9px; letter-spacing: 2px;
  transition: all .15s;
}
#_dei_panel ._send:hover { background: rgba(40, 100, 180, 0.55); border-color: rgba(120, 200, 255, 0.9); }
`;

let _cssInjected = false;
function injectCSS() {
  if (_cssInjected) return;
  const s = document.createElement('style');
  s.id = '_dei_panel_css';
  s.textContent = CSS;
  document.head.appendChild(s);
  _cssInjected = true;
}

export class VoicePanel {
  constructor({
    dei,
    title = 'DEI · COMMAND',
    placeholder = 'type a command or tap mic to speak…',
    startCollapsed = false,
    voiceEnabled = true,    // show the mic button (still requires apiKey/transcribeUrl)
  } = {}) {
    if (!dei) throw new Error('VoicePanel requires { dei }');
    this.dei = dei;
    injectCSS();

    const root = document.createElement('div');
    root.id = '_dei_panel';
    root.innerHTML = `
      <div class="_dei_orb">💬</div>
      <div class="_hdr">
        <span class="_title"></span>
        ${voiceEnabled ? '<button class="_mic" data-state="off" type="button"><span class="_dot"></span><span class="_lbl">mic off</span></button>' : ''}
        <button class="_collapse" type="button" title="collapse">—</button>
      </div>
      <div class="_log"></div>
      <div class="_inputRow">
        <input class="_txt" type="text" autocomplete="off" />
        <button class="_send" type="button">SEND</button>
      </div>
    `;
    document.body.appendChild(root);
    this.root = root;

    root.querySelector('._title').textContent = title;
    this.logEl = root.querySelector('._log');
    this.txtEl = root.querySelector('._txt');
    this.txtEl.placeholder = placeholder;
    this.micEl = root.querySelector('._mic');

    if (startCollapsed) root.classList.add('collapsed');
    root.querySelector('._dei_orb').onclick = () => root.classList.remove('collapsed');
    root.querySelector('._collapse').onclick = (e) => { e.stopPropagation(); root.classList.add('collapsed'); };

    const submit = () => {
      const v = this.txtEl.value.trim();
      if (!v) return;
      this.txtEl.value = '';
      this.appendLog('user', v);
      const h = dei.voice.match(v);
      if (!h) this.appendLog('err', 'no match');
    };
    this.txtEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    root.querySelector('._send').onclick = submit;

    if (this.micEl) {
      this.micEl.onclick = async () => {
        if (dei.voice.active) { dei.voice.stop(); return; }
        if (!dei.voice.apiKey && !dei.voice.transcribeUrl) {
          this.appendLog('err', 'voice not configured (no apiKey/transcribeUrl)');
          return;
        }
        try { await dei.voice.start(); }
        catch (e) { this.appendLog('err', 'mic permission denied'); }
      };
    }

    dei.on('voiceStatus', (s) => this._setMic(s));
    dei.on('transcript', (t) => this.appendLog('user', t));
    dei.on('command', ({ handler }) => this.appendLog('sys', handler.name));
    dei.on('noMatch', () => {});  // already handled in user log if from typed input
  }

  appendLog(role, text) {
    const r = document.createElement('div');
    r.className = '_row _' + role;
    r.textContent = text;
    this.logEl.appendChild(r);
    this.logEl.scrollTop = this.logEl.scrollHeight;
    while (this.logEl.children.length > 100) this.logEl.removeChild(this.logEl.firstChild);
  }

  _setMic(state) {
    if (!this.micEl) return;
    this.micEl.dataset.state = state;
    const lbl = this.micEl.querySelector('._lbl');
    lbl.textContent = state === 'on' ? 'listening' : state === 'wait' ? 'transcribing' : state === 'denied' ? 'denied' : 'mic off';
  }

  destroy() { this.root.remove(); }
}
