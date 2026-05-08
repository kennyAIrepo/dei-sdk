// Whisper-based rolling-window voice + regex command registry.
// Three modes:
//   - direct OpenAI:    new VoiceController({ apiKey: 'sk-...' })
//   - backend proxy:    new VoiceController({ transcribeUrl: '/api/transcribe' })
//   - text-only:        new VoiceController()    (register/match work, start() throws)
//
// `register()` and `match()` always work — they don't need the mic running.
// This means typed input can dispatch commands without ever enabling voice.

const OPENAI_TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';

export class VoiceController {
  constructor({
    apiKey = null,
    transcribeUrl = null,    // proxy endpoint; if set, no apiKey needed
    model = 'gpt-4o-transcribe',
    language = 'en',
    interval = 4000,
    minBlobBytes = 4000,
    onTranscript = null,
    onStatus = null,         // ('on'|'off'|'wait'|'denied')
    onMatch = null,          // (handler, text)
    onNoMatch = null,        // (text)
  } = {}) {
    if (apiKey && !apiKey.startsWith('sk-')) {
      throw new Error('VoiceController: apiKey must start with sk-');
    }
    this.apiKey = apiKey;
    this.transcribeUrl = transcribeUrl;
    this.model = model;
    this.language = language;
    this.interval = interval;
    this.minBlobBytes = minBlobBytes;
    this.onTranscript = onTranscript;
    this.onStatus = onStatus;
    this.onMatch = onMatch;
    this.onNoMatch = onNoMatch;

    this.active = false;
    this.busy = false;
    this.handlers = [];
    this._stream = null;
    this._rec = null;
  }

  register(pattern, run, name) {
    this.handlers.push({ pattern, run, name: name || pattern.toString() });
    return () => {
      const i = this.handlers.findIndex(h => h.run === run);
      if (i >= 0) this.handlers.splice(i, 1);
    };
  }

  trigger(name) {
    const h = this.handlers.find(h => h.name === name);
    if (h) { h.run(''); return true; }
    return false;
  }

  // Pure regex dispatch. Works without mic. Returns matched handler or null.
  match(text) {
    const l = (text || '').toLowerCase().trim();
    if (!l) return null;
    for (const h of this.handlers) {
      if (h.pattern.test(l)) { h.run(l); this.onMatch?.(h, l); return h; }
    }
    this.onNoMatch?.(l);
    return null;
  }

  async _transcribe(blob) {
    const url = this.transcribeUrl || OPENAI_TRANSCRIBE_URL;
    const fd = new FormData();
    fd.append('file', blob, 'audio.webm');
    fd.append('model', this.model);
    fd.append('language', this.language);
    const headers = {};
    if (!this.transcribeUrl && this.apiKey) headers['Authorization'] = 'Bearer ' + this.apiKey;
    try {
      const r = await fetch(url, { method: 'POST', headers, body: fd });
      if (!r.ok) return null;
      return (await r.json()).text || null;
    } catch (e) { return null; }
  }

  async start() {
    if (!this.apiKey && !this.transcribeUrl) {
      throw new Error('VoiceController.start() requires apiKey or transcribeUrl');
    }
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      this.active = true;
      this.onStatus?.('on');
      this._loop();
    } catch (e) {
      this.onStatus?.('denied');
      throw e;
    }
  }

  stop() {
    this.active = false;
    this._rec?.state === 'recording' && this._rec.stop();
    this._stream?.getTracks().forEach(t => t.stop());
    this._stream = null;
    this.onStatus?.('off');
  }

  _loop() {
    if (!this.active || this.busy) return;
    let ch = [];
    const mt = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus' : 'audio/webm';
    const rc = new MediaRecorder(this._stream, { mimeType: mt });
    this._rec = rc;
    rc.ondataavailable = e => { if (e.data.size > 0) ch.push(e.data); };
    rc.onstop = async () => {
      const blob = new Blob(ch, { type: mt });
      if (blob.size < this.minBlobBytes) { this._next(); return; }
      this.busy = true;
      this.onStatus?.('wait');
      const txt = await this._transcribe(blob);
      if (txt && txt.trim().length > 1) {
        this.onTranscript?.(txt);
        this.match(txt);
      }
      this.busy = false;
      this.onStatus?.('on');
      this._next();
    };
    rc.start();
    setTimeout(() => { if (rc.state === 'recording') rc.stop(); }, this.interval);
  }

  _next() { setTimeout(() => this._loop(), 200); }
}
