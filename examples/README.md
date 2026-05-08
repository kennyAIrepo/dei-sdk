# DEI SDK

Hand-tracking AR for any Three.js project. Drop in a `<script>` link, get a rigged 42-point hand mesh, pinch/grab/throw, voice triggers — no build step.

```html
<script type="importmap">
{"imports":{
  "three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
  "three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/",
  "dei":"https://cdn.jsdelivr.net/gh/YOUR_USER/dei-sdk@v0.1.0/src/dei.js"
}}
</script>
<script type="module">
  import { DEI } from 'dei';
  await DEI.create();   // grant camera → blue ghost hands appear, tracked + meshed live
</script>
```

That's it. No npm, no bundler, no install. Loop auto-starts; loading overlay auto-fades.

---

## What's in the box

| Module | Purpose |
|---|---|
| `dei.js` | Public entry. `DEI.create()` (managed) or `DEI.attach()` (plugin). |
| `rigged-hand.js` | 42-point inverse-cube-distance skinning, holo Fresnel shader. |
| `tracking.js` | MediaPipe Hand+Pose Landmarker bootstrap, jitter stabilizer. |
| `gestures.js` | `isPinch`, `palmCenter`, `handQuat`, `Grabbable`, `GrabManager`. |
| `physics.js` | cannon-es world + body-capsule collider + auto floor detection. |
| `voice.js` | Whisper rolling-window transcription + regex command registry. |
| `coords.js` | Camera-aware MediaPipe→scene-space mapping. |
| `constants.js` | Rest pose, K, thresholds, model URLs. |
| `assets/holo_hands.glb` | Default hand mesh (override with your own). |

---

## Two usage modes

### 1. Managed — SDK owns canvas + camera + render loop
Best for new projects. Loop auto-starts.
```js
import { DEI } from 'dei';
const dei = await DEI.create({
  voice: { apiKey: 'sk-...' },   // optional
  // autoStart: false,           // disable to call dei.start() yourself
  // showLoadingUI: false,       // disable built-in fade overlay
});
```

### 2. Plugin — attach to your existing Three.js scene
Best for adding hand-AR to an existing 3D project.
```js
import { DEI } from 'dei';
const dei = await DEI.attach({
  scene, camera, renderer, videoElement,
  autoStartCamera: false, // you already manage video
  autoStart: false,        // you own the render loop
});
function tick(dt) { dei.update(dt); renderer.render(scene, camera); }
```

---

## Make any mesh interactive

```js
const cube = new THREE.Mesh(geom, mat);
scene.add(cube);

dei.makeGrabbable(cube, {
  radius: 0.15,        // grab radius
  physics: true,       // throw with momentum
  mass: 0.6,
  scalable: true,      // two-hand pinch resizes
  pinchOnly: false,    // true = bird-style (single pinch grab)
});
```

Hand mesh deforms around it in real time (vertices push out of the sphere collider).

---

## Events

```js
dei.on('ready',          dei => {});
dei.on('frame',          ({dt, t, sls, hands}) => {});
dei.on('grab',           ({target, hand}) => {});
dei.on('release',        ({target, velocity}) => {});
dei.on('twoHandScale',   ({target, scale, midpoint}) => {});
dei.on('transcript',     text => {});
dei.on('voiceStatus',    s => {});  // 'on' | 'off' | 'wait' | 'denied'
```

---

## Voice / AI triggers

Register regex → handler. Pure regex routing — no per-utterance LLM cost.

```js
dei.voice.register(/\bcube|box\b/, () => spawn(box), 'spawn_cube');
dei.voice.register(/\bhide|clear\b/, () => clearAll(), 'hide');

// Imperative bypass (e.g. wired to a button):
dei.voice.trigger('spawn_cube');
```

**API key handling.** The SDK never embeds a key. You pass it at init. For deployment, route through a backend proxy (see Architecture below).

---

## Power-user composition

Skip `DEI` and use the primitives directly:

```js
import { loadRiggedHands, GrabManager, Grabbable, Physics, VoiceController, makeMp2s, initTracking, makeDetector } from 'dei';

const mp2s = makeMp2s(camera);
const { RH, LH } = await loadRiggedHands(scene, gltfLoader, handUrl);
const tracker = await initTracking({ numHands: 2 });
const detect = makeDetector(tracker.hand, tracker.pose);
// ... build your own loop
```

---

## Architecture — Transference

How to share this between projects / teammates.

### Tier 1 — CDN link (zero install)
**Pattern:** GitHub repo + jsDelivr.
```
https://cdn.jsdelivr.net/gh/<user>/dei-sdk@<tag>/src/dei.js
```
- Push to GitHub, tag a release (`git tag v0.1.0 && git push --tags`).
- jsDelivr auto-serves from `cdn.jsdelivr.net/gh/...`.
- Cache busts on tag change. Use `@latest` only for prototyping.
- Hand model GLB ships from the same path: `.../dei-sdk@v0.1.0/assets/holo_hands.glb`.

**Use when:** you want a single shareable URL, no build pipelines on consumers.

### Tier 2 — npm package
**Pattern:** `npm publish` with `"type":"module"`. Already configured in `package.json`.
```
npm install dei-sdk three
```
```js
import { DEI } from 'dei-sdk';
```
**Use when:** consumer projects use bundlers (Vite, webpack, react-three-fiber).

### Tier 3 — single bundled file (drop-in `<script>`)
**Pattern:** prebuild with esbuild → one `dei.bundle.js` with three excluded.
```bash
esbuild src/dei.js --bundle --format=esm --external:three --outfile=dist/dei.bundle.js
```
**Use when:** consumers want one file, full offline copy.

### Recommended: ship all three.
- Tier 1 for "just play with it"
- Tier 2 for production apps
- Tier 3 for air-gapped / kiosk / offline

---

## Architecture — Deployment

### Static-only (simplest)
- Host on GitHub Pages / Netlify / Cloudflare Pages.
- All assets are static. MediaPipe loads from Google CDN. No backend.
- **Limit:** voice requires the consumer to supply their own OpenAI key at runtime. Don't ship one.

### With a voice proxy (recommended for production)
Stand up a tiny serverless function so the OpenAI key never reaches the browser.
```
Browser → POST /api/transcribe (audio) → Cloudflare Worker / Vercel Edge Function → OpenAI
                                              (uses env-var key)
```
Then in your app:
```js
new VoiceController({
  apiKey: 'PROXY',  // sentinel; override transcribeUrl below
  transcribeUrl: '/api/transcribe',  // (add this option to voice.js)
});
```
*(Trivial extension — voice.js currently hardcodes the OpenAI URL; add a `transcribeUrl` option.)*

### Embed in another app
Two patterns:
1. **Iframe** — host the SDK at `dei.example.com`, embed via `<iframe>`. Cross-origin postMessage for events.
2. **Script include** — `<script type="module" src=".../dei.js">`. Same-origin, full DOM access.

### Asset hosting
- Hand GLB: ship from same CDN as JS so version-locking works.
- MediaPipe WASM + models: pinned to `@0.10.18` from Google's CDN. Override in `constants.js` if you want to self-host.

---

## Performance tuning

| Lever | Where | Default | Notes |
|---|---|---|---|
| Hand count | `DEI.create({numHands})` | 2 | Drop to 1 to halve detection cost. |
| Pose detection period | `tracking.js:posePeriod` | every 4 frames | Pose is expensive; doesn't need to run every frame. |
| Pinch threshold | `constants.PINCH_TH` | 0.065 | Lower = stricter pinch. |
| Skinning K | `constants.K` | 5 | Top-K control points per vertex. |
| Stabilizer noise | `tracking.js:NOISE` | 0.003 | Higher = less jitter, more lag. |
| Voice interval | `voice.interval` | 4000 ms | Shorter = lower latency, more API calls. |
| Min audio blob | `voice.minBlobBytes` | 4000 | Skip silence. |

---

## Critical invariants (don't violate when extending)

1. **Order of update():** detect → physics step → grab manager → hand deform. Grab updates collider centers; deform reads them. Reversing causes a one-frame lag in the squish effect.
2. **Handedness flip:** MediaPipe returns mirrored. SDK flips `Left↔Right` automatically; don't double-flip.
3. **`mp2s` depends on camera FOV + Z.** If you reposition the camera dynamically, call `dei.mp2s.recompute()`.
4. **Hand mesh is split by X<0 = right.** Keep your custom hand GLB centered with both hands modeled together if replacing `holo_hands.glb`.

---

## Roadmap (not done)

- [ ] `transcribeUrl` option on VoiceController for backend proxy.
- [ ] Pre-bundled `dist/dei.bundle.js` for `<script>` consumers.
- [ ] Optional WebXR mode (currently camera-feed only).
- [ ] Body-mesh visual capsules (extracted but not exposed in main API).
- [ ] Replaceable holo shader as constructor option (already wired internally).

---

## License

MIT. Hand model GLB is yours — keep it, swap it, ship it.
