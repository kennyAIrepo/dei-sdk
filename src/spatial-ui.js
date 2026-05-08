// Spatial dialogue panel: floating HUD that hosts the command bus.
// Two input routes feed the same registered regex handlers:
//   - text input field   (always available, no API needed)
//   - mic toggle button  (opt-in; requires voice.apiKey or voice.transcribeUrl)
//
// Construct via DEI.create({ ui: true }) or directly: new VoicePanel({ dei }).

const CSS = `
#_dei_panel {
  position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%);
  z-index: 50; width: min(440px, 92vw);
  font-family: 'Courier New', monospace; color: rgba(180,230,255,.92);
  background: linear-gradient(180deg, rgba(6,16,28,.78), rgba(2,8,16,.88));
  border: 1px solid rgba(100,180,255,.22);
  border-radius: 12px; backdrop-filter: blur(10px);
  box-shadow: 0 4px 24px rgba(0,40,80,.4), inset 0 0 0 1px rgba(100,200,255,.05);
  transition: opacity .3s, transform .3s;
}
#_dei_panel.collapsed { width: 56px; height: 56px; cursor: pointer; }
#_dei_panel.collapsed > *:not(._dei_orb) { display: none; }
#_dei_panel ._dei_orb {
  display: none; align-items: center; justify-content: center;
  width: 100%; height: 100%; font-size: 22px;
}
#_dei_panel.collapsed ._dei_orb { display: flex; animation: _deiPulse 2s infinite ease-in-out; }
@keyframes _deiPulse { 0%,100%{opacity:.7} 50%{opacity:1} }

#_dei_panel ._hdr {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; border-bottom: 1px solid rgba(100,180,255,.1);
  font-size: 10px; letter-spacing: 2px; text-transform: uppercase;
  color: rgba(120,200,255,.55);
}
#_dei_panel ._hdr ._title { flex: 1 }
#_dei_panel ._hdr ._collapse {
  background: none; border: none; color: rgba(120,200,255,.4);
  cursor: pointer; font-size: 14px; padding: 0 4px;
}
#_dei_panel ._hdr ._collapse:hover { color: rgba(180,230,255,.9); }

#_dei_panel ._mic {
  background: rgba(20,40,60,.5); border: 1px solid rgba(100,180,255,.2);
  border-radius: 6px; padding: 4px 10px; font-size: 11px;
  color: rgba(150,210,255,.7); cursor: pointer; font-family: inherit;
  display: flex; align-items: center; gap: 6px;
  transition: all .2s;
}
#_dei_panel ._mic:hover { border-color: rgba(120,200,255,.5); color: rgba(200,240,255,.95); }
#_dei_panel ._mic[data-state="on"] { background: rgba(40,100,140,.6); border-color: rgba(120,255,200,.5); color: rgba(150,255,210,.95); }
#_dei_panel ._mic[data-state="wait"] { background: rgba(80,60,30,.5); border-color: rgba(255,200,100,.4); color: rgba(255,220,140,.9); }
#_dei_panel ._mic[data-state="denied"] { background: rgba(80,30,30,.5); border-color: rgba(255,100,100,.4); color: rgba(255,150,150,.9); }
#_dei_panel ._mic ._dot {
  width: 7px; height: 7px; border-radius: 50%; background: rgba(150,180,200,.4);
}
#_dei_panel ._mic[data-state="on"] ._dot { background: #66ffaa; animation: _deiBlink 1s infinite; }
#_dei_panel ._mic[data-state="wait"] ._dot { background: #ffcc66; animation: _deiBlink 1.4s infinite; }
@keyframes _deiBlink { 0%,100%{opacity:1} 50%{opacity:.3} }

#_dei_panel ._log {
  max-height: 180px; overflow-y: auto; padding: 8px 14px;
  font-size: 12px; line-height: 1.5;
  scrollbar-width: thin; scrollbar-color: rgba(100,180,255,.3) transparent;
}
#_dei_panel ._log::-webkit-scrollbar { width: 4px; }
#_dei_panel ._log::-webkit-scrollbar-thumb { background: rgba(100,180,255,.3); border-radius: 2px; }
#_dei_panel ._log ._row { margin: 3px 0; }
#_dei_panel ._log ._row._user { color: rgba(180,230,255,.92); }
#_dei_panel ._log ._row._user:before { content: '› '; color: rgba(120,200,255,.5); }
#_dei_panel ._log ._row._sys  { color: rgba(150,255,200,.85); font-size: 11px; }
#_dei_panel ._log ._row._sys:before { content: '✓ '; }
#_dei_panel ._log ._row._err  { color: rgba(255,180,150,.8); font-size: 11px; }
#_dei_panel ._log ._row._err:before { content: '✗ '; }

#_dei_panel ._inputRow {
  display: flex; gap: 6px; padding: 8px 12px; border-top: 1px solid rgba(100,180,255,.1);
}
#_dei_panel ._txt {
  flex: 1; background: rgba(0,10,20,.5); border: 1px solid rgba(100,180,255,.15);
  border-radius: 6px; padding: 7px 10px; font-family: inherit; font-size: 12px;
  color: rgba(220,240,255,.95); outline: none; transition: border .2s;
}
#_dei_panel ._txt:focus { border-color: rgba(120,200,255,.5); }
#_dei_panel ._txt::placeholder { color: rgba(120,180,220,.4); }
#_dei_panel ._send {
  background: rgba(40,100,160,.5); border: 1px solid rgba(120,200,255,.3);
  border-radius: 6px; padding: 0 12px; color: rgba(180,230,255,.9);
  cursor: pointer; font-family: inherit; font-size: 11px; transition: all .2s;
}
#_dei_panel ._send:hover { background: rgba(60,140,200,.7); }
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
