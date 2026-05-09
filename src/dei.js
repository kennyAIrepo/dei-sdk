// DEI SDK — public entry point.
// Two usage modes:
//   1. attach({ scene, camera, renderer, videoElement })   — host owns render loop
//   2. create({ canvas, ... })                              — SDK owns everything
//
// Re-exports primitives so power users can compose them directly.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { DEFAULT_HAND_MODEL_URL } from './constants.js';
import { makeMp2s } from './coords.js';
import { loadRiggedHands } from './rigged-hand.js';
import { initTracking, makeDetector } from './tracking.js';
import { Grabbable, GrabManager, ThumbUpTrigger, HandWaveDetector, isPinch, pinchPoint } from './gestures.js';
import { Physics, poseToBodyPoints, detectFloorY } from './physics.js';
import { VoiceController } from './voice.js';
import { VoicePanel } from './spatial-ui.js';
import { Gallery } from './gallery-ui.js';
import { searchModels, loadModel } from './sketchfab.js';
import { parseSpawnIntent } from './intent.js';

class EventBus {
  constructor() { this.h = {}; }
  on(name, fn) { (this.h[name] = this.h[name] || []).push(fn); return () => this.off(name, fn); }
  off(name, fn) { if (!this.h[name]) return; this.h[name] = this.h[name].filter(f => f !== fn); }
  emit(name, payload) { (this.h[name] || []).forEach(f => { try { f(payload); } catch(e){ console.error(e); } }); }
}

class DEI {
  constructor() {
    this.events = new EventBus();
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.videoElement = null;
    this.mp2s = null;
    this.RH = null; this.LH = null;
    this.handCount = 0;
    this.hands = null;          // raw normalized landmarks
    this.handedness = [];
    this.poseLandmarks = null;
    this.bodyPts = null;
    this.physics = null;
    this.grab = new GrabManager();
    this.voice = null;
    this.gallery = null;
    this._sketchfab = null;             // { searchUrl, downloadUrl } or null
    this._waveDet = [null, null];       // per-hand HandWaveDetector
    this._thumbTrig = [null, null];     // per-hand ThumbUpTrigger
    this._pendingSpawn = null;          // { model } locked but not yet pinch-grabbed
    this._tracker = null;
    this._detect = null;
    this._clock = new THREE.Clock();
    this._raf = null;
    this._owned = { canvas: false, video: false };
  }

  on(name, fn) { return this.events.on(name, fn); }
  off(name, fn) { this.events.off(name, fn); }

  // Attach to an existing Three.js setup.
  static async attach(opts) {
    const dei = new DEI();
    await dei._setup(opts);
    return dei;
  }

  // Create a self-contained instance (canvas + camera + renderer + video).
  static async create(opts = {}) {
    const dei = new DEI();
    const canvas = opts.canvas || (() => {
      const c = document.createElement('canvas');
      c.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:1';
      document.body.appendChild(c);
      dei._owned.canvas = true;
      return c;
    })();
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setClearColor(0, 0);
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.6;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, innerWidth/innerHeight, .01, 100);
    camera.position.set(0, 0, 2.0);
    scene.add(new THREE.AmbientLight(0x506070, 1.0));
    scene.add(new THREE.DirectionalLight(0xfff8f0, 2.5).translateX(2).translateY(3).translateZ(5));
    scene.add(new THREE.DirectionalLight(0x5577aa, .8).translateX(-2).translateY(1).translateZ(3));

    const video = opts.videoElement || (() => {
      const v = document.createElement('video');
      v.playsInline = true; v.muted = true;
      v.style.display = 'none';
      document.body.appendChild(v);
      dei._owned.video = true;
      return v;
    })();

    let bgVid = null;
    if (opts.showCameraBackground !== false) {
      bgVid = document.createElement('video');
      bgVid.playsInline = true; bgVid.muted = true;
      bgVid.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;object-fit:cover;transform:scaleX(-1);z-index:0';
      document.body.appendChild(bgVid);
    }
    dei._bgVid = bgVid;

    await dei._setup({ ...opts, scene, camera, renderer, videoElement: video });
    return dei;
  }

  async _setup({
    scene, camera, renderer, videoElement,
    handModelUrl = DEFAULT_HAND_MODEL_URL,
    numHands = 2,
    pose = true,
    physics = true,
    voice = {},             // { apiKey?, transcribeUrl?, model?, interval?, lang? }; {} = text-only
    autoStartCamera = true,
    autoStartVoice = false, // mic stays OFF until user opts in via the panel
    autoStart = true,
    showLoadingUI = true,
    ui = true,              // mount the spatial dialogue panel; pass {} for options or false to skip
    sketchfab = true,       // mount gallery + intent flow; pass {searchUrl, downloadUrl} or false to skip
  } = {}) {
    const opts_sketchfab = sketchfab;
    this.scene = scene; this.camera = camera; this.renderer = renderer;
    this.videoElement = videoElement;
    this.mp2s = makeMp2s(camera);

    if (showLoadingUI) this._showLoader();

    addEventListener('resize', () => {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
      this.mp2s.recompute();
    });

    try {
      if (autoStartCamera) {
        this._setLoader('Requesting camera…');
        await this._startCamera();
      }

      this._setLoader('Loading hand mesh…');
      const loader = new GLTFLoader();
      const { RH, LH } = await loadRiggedHands(scene, loader, handModelUrl);
      this.RH = RH; this.LH = LH;

      if (physics) {
        this._setLoader('Initializing physics…');
        this.physics = new Physics();
        await this.physics.init();
      }

      this._setLoader('Loading tracking models…');
      this._tracker = await initTracking({ numHands, pose });
      this._detect = makeDetector(this._tracker.hand, this._tracker.pose);

      // Voice is always created (text-only mode if no key/proxy supplied).
      // Mic only turns on when user opts in (panel button) or autoStartVoice=true.
      this.voice = new VoiceController({
        apiKey: voice?.apiKey || null,
        transcribeUrl: voice?.transcribeUrl || null,
        model: voice?.model,
        language: voice?.language || voice?.lang,
        interval: voice?.interval,
        onTranscript: (t) => this.events.emit('transcript', t),
        onStatus: (s) => this.events.emit('voiceStatus', s),
        onMatch: (h, t) => this.events.emit('command', { handler: h, text: t }),
        onNoMatch: (t) => this.events.emit('noMatch', t),
      });
      if (autoStartVoice && (this.voice.apiKey || this.voice.transcribeUrl)) {
        try { await this.voice.start(); } catch(e) { console.warn('Voice start failed:', e); }
      }

      if (ui) {
        const uiOpts = (typeof ui === 'object') ? ui : {};
        const voiceUsable = !!(this.voice.apiKey || this.voice.transcribeUrl);
        this.panel = new VoicePanel({ dei: this, voiceEnabled: voiceUsable, ...uiOpts });
      }

      // Sketchfab + intent flow (opt-in via opts.sketchfab).
      if (opts_sketchfab !== false) {
        this._sketchfab = {
          searchUrl: (typeof opts_sketchfab === 'object' && opts_sketchfab.searchUrl) || '/api/sketchfab/search',
          downloadUrl: (typeof opts_sketchfab === 'object' && opts_sketchfab.downloadUrl) || '/api/sketchfab/download',
        };
        this.gallery = new Gallery({
          onLock: (model) => this._onGalleryLock(model),
          onCancel: () => { this._pendingSpawn = null; },
        });
        // Gesture detectors per hand.
        for (let h = 0; h < 2; h++) {
          this._waveDet[h] = new HandWaveDetector({
            onSwipe: (dir) => { if (this.gallery?.root.classList.contains('show')) this.gallery.scroll(dir); },
          });
          this._thumbTrig[h] = new ThumbUpTrigger({
            onUp: () => { if (this.gallery?.root.classList.contains('show')) this.gallery.lock(); },
          });
        }
        // Hook noMatch → intent parser → gallery search.
        this.events.on('noMatch', (text) => this._handleSpawnText(text));
      }
    } catch (e) {
      this._setLoader('Error: ' + (e?.message || e), true);
      throw e;
    }

    this._hideLoader();
    this.events.emit('ready', this);
    if (autoStart) this.start();
  }

  _showLoader() {
    if (this._loaderEl) return;
    const o = document.createElement('div');
    o.id = '_dei_loader';
    o.style.cssText = 'position:fixed;inset:0;background:radial-gradient(ellipse at center,rgba(8,18,30,.95),rgba(0,4,10,.98));color:rgba(150,220,255,.9);display:flex;align-items:center;justify-content:center;font-family:"Courier New",monospace;font-size:13px;z-index:99999;letter-spacing:2px;backdrop-filter:blur(10px);transition:opacity .5s ease';
    o.innerHTML = '<div style="text-align:center"><div style="font-size:10px;opacity:.5;margin-bottom:10px">DEI · HAND TRACKING</div><div id="_dei_status">Initializing…</div><div style="margin-top:14px;width:140px;height:1px;background:rgba(120,200,255,.15);overflow:hidden"><div style="width:40%;height:100%;background:rgba(120,200,255,.7);animation:_deiSweep 1.4s infinite ease-in-out"></div></div></div><style>@keyframes _deiSweep{0%{margin-left:-40%}100%{margin-left:140%}}</style>';
    document.body.appendChild(o);
    this._loaderEl = o;
  }
  _setLoader(msg, isError = false) {
    const s = document.getElementById('_dei_status');
    if (s) { s.textContent = msg; if (isError) s.style.color = '#ff7766'; }
  }
  _hideLoader() {
    if (!this._loaderEl) return;
    this._loaderEl.style.opacity = '0';
    setTimeout(() => { this._loaderEl?.remove(); this._loaderEl = null; }, 500);
  }

  async _startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    if (this._bgVid) { this._bgVid.srcObject = stream.clone(); this._bgVid.play(); }
    const detStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    });
    this.videoElement.srcObject = detStream;
    await this.videoElement.play();
  }

  // Wrap any Three.js Object3D into a Grabbable. Optionally physics-throwable.
  makeGrabbable(mesh, opts = {}) {
    const g = new Grabbable(mesh, opts);
    this.grab.add(g);
    if (opts.handCollide !== false) {
      this.RH?.addCollider(g.collider);
      this.LH?.addCollider(g.collider);
    }
    if (opts.physics && this.physics) {
      g.onRelease = (vel) => this.physics.throwGrabbable(g, vel, { mass: opts.mass || 0.6 });
      g.onGrab = () => this.physics.pickUp(g);
    }
    return g;
  }

  removeGrabbable(g) {
    this.grab.remove(g);
    this.RH?.removeCollider(g.collider);
    this.LH?.removeCollider(g.collider);
  }

  // Add a passive sphere collider that affects hand-mesh skin (no grab logic).
  addHandCollider(c) {
    this.RH?.addCollider(c);
    this.LH?.addCollider(c);
    return c;
  }

  // ── Sketchfab + intent flow ───────────────────────────────────────
  // Public: kick off a search programmatically (e.g. wired to a button).
  async searchSketchfab(query) {
    if (!this._sketchfab || !this.gallery) return;
    this.gallery.show();
    this.gallery.setQuery(query);
    this.gallery.setLoading(true);
    try {
      const results = await searchModels(query, this._sketchfab);
      this.gallery.setResults(query, results);
      this.events.emit('searchResults', { query, results });
    } catch (e) {
      this.gallery.setResults(query, []);
      this.panel?.appendLog?.('err', 'sketchfab search failed');
      console.warn(e);
    }
  }

  async _handleSpawnText(text) {
    const intent = parseSpawnIntent(text);
    if (!intent || !this._sketchfab) return;
    this.panel?.appendLog?.('sys', `searching: ${intent.target}`);
    await this.searchSketchfab(intent.target);
  }

  _onGalleryLock(model) {
    this._pendingSpawn = { model };
    this.panel?.appendLog?.('sys', `locked "${model.name}" — pinch to grab`);
    this.events.emit('galleryLock', model);
  }

  async _spawnLockedAt(scenePos) {
    const pending = this._pendingSpawn;
    if (!pending) return;
    this._pendingSpawn = null;
    this.gallery?.hide();
    this.panel?.appendLog?.('sys', `loading "${pending.model.name}"…`);
    try {
      const { group } = await loadModel(pending.model.uid, {
        ...this._sketchfab,
        targetSize: 0.15,   // small enough to fit in hand by default; user scales up via two-hand pinch
      });
      group.position.copy(scenePos);
      this.scene.add(group);
      const g = this.makeGrabbable(group, {
        radius: 0.10,
        physics: !!this.physics,
        mass: 0.4,
        scalable: true,
        minScale: 0.3,
        maxScale: 12,        // allow scaling up to ~real-world sizes
      });
      this.events.emit('spawn', { model: pending.model, mesh: group, grabbable: g });
      this.panel?.appendLog?.('sys', `spawned "${pending.model.name}"`);
    } catch (e) {
      console.warn('spawn failed:', e);
      this.panel?.appendLog?.('err', `couldn't load "${pending.model.name}"`);
    }
  }

  // Per-frame update. Call from your render loop, or use start() to self-drive.
  update(dt) {
    const t = this._clock.elapsedTime;
    this.RH?.tickTime(t); this.LH?.tickTime(t);

    const det = this._detect(this.videoElement);
    this.hands = det.hands;
    this.handCount = det.handCount;
    this.handedness = det.handedness;
    this.poseLandmarks = det.poseLandmarks;

    if (this.poseLandmarks && this.physics) {
      const fy = detectFloorY(this.poseLandmarks, this.mp2s);
      if (fy != null) this.physics.setFloorY(fy);
    }

    this.bodyPts = this.poseLandmarks ? poseToBodyPoints(this.poseLandmarks, this.mp2s) : null;
    this.physics?.syncBodyCapsules(this.bodyPts);

    // Hand landmarks → scene-space.
    const sls = [];
    for (let h = 0; h < Math.min(this.handCount, 2); h++) {
      if (!this.hands?.[h]) continue;
      sls[h] = this.hands[h].map(this.mp2s);
    }

    // Gallery gestures — wave to scroll, thumb-up to lock, pinch to spawn.
    if (this.gallery) {
      const visible = this.gallery.root.classList.contains('show');
      for (let h = 0; h < Math.min(this.handCount, 2); h++) {
        const lm = this.hands?.[h];
        if (!lm) continue;
        if (visible && !this.gallery.locked) {
          this._waveDet[h]?.update(lm[0], dt);
        }
        if (visible) {
          this._thumbTrig[h]?.update(lm, dt);
        }
        // Pinch-to-spawn: when locked, a pinch grabs the model into the scene.
        if (this._pendingSpawn && sls[h] && isPinch(lm)) {
          this._spawnLockedAt(pinchPoint(sls[h]));
        }
      }
    }

    // Gestures BEFORE deform — so collider centers are current when hand-mesh skins.
    this.grab.update(this.hands, sls, dt, this.events);
    if (this.physics) this.physics.step(dt);

    // Deform hands.
    let rOK = false, lOK = false;
    for (let h = 0; h < Math.min(this.handCount, 2); h++) {
      if (!sls[h]) continue;
      const isR = this.handedness[h] === 'Right';
      if (isR && !rOK) { this.RH.deform(sls[h]); rOK = true; }
      else if (!isR && !lOK) { this.LH.deform(sls[h]); lOK = true; }
    }
    if (!rOK) this.RH.grp.visible = false;
    if (!lOK) this.LH.grp.visible = false;

    this.events.emit('frame', { dt, t, sls, hands: this.hands, handedness: this.handedness });
  }

  start() {
    const tick = () => {
      this._raf = requestAnimationFrame(tick);
      const dt = Math.min(this._clock.getDelta(), 0.05);
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this.voice?.stop();
  }
}

export { DEI, Grabbable, GrabManager, Physics, VoiceController, VoicePanel, Gallery };
export { searchModels, loadModel } from './sketchfab.js';
export { parseSpawnIntent } from './intent.js';
export * from './gestures.js';
export { RiggedHand, loadRiggedHands } from './rigged-hand.js';
export { makeMp2s, buildFrame } from './coords.js';
export { initTracking, makeDetector } from './tracking.js';
export default DEI;
