# Architecture

## Module dependency graph

```
                    ┌──────────────┐
                    │ constants.js │ (pure data, no deps)
                    └──────┬───────┘
                           │
         ┌────────┬────────┼─────────┬──────────┐
         ▼        ▼        ▼         ▼          ▼
    ┌────────┐ ┌──────────┐ ┌───────────┐ ┌──────────┐
    │coords  │ │tracking  │ │gestures   │ │ shaders/ │
    │.js     │ │.js       │ │.js        │ │ holo.js  │
    └───┬────┘ └────┬─────┘ └────┬──────┘ └────┬─────┘
        │           │            │             │
        └─────┬─────┴────────────┘             │
              ▼                                ▼
        ┌──────────────┐              ┌────────────────┐
        │rigged-hand.js│◀─────────────│                │
        └──────┬───────┘                               │
               │                                       │
        ┌──────▼─────────┐    ┌────────────┐           │
        │   physics.js   │    │  voice.js  │           │
        └──────┬─────────┘    └─────┬──────┘           │
               │                    │                  │
               └─────────┬──────────┴──────────────────┘
                         ▼
                  ┌─────────────┐
                  │   dei.js    │  ← public entry
                  └─────────────┘
```

## Per-frame data flow

```
camera feed (video) ─┐
                     ▼
            ┌────────────────┐
            │  MediaPipe     │  detect on video element
            │  Hand+Pose     │
            └───┬────────────┘
                │ raw landmarks (normalized)
                ▼
            ┌────────────────┐
            │  stabilize     │  noise reject (<0.003 → hold prev)
            └───┬────────────┘
                │ stable normalized
                ▼
            ┌────────────────┐
            │  mp2s()        │  → THREE.Vector3[] in scene space
            └───┬────────────┘
                │ scene-space sls
                ├───────────────────────┐
                ▼                       ▼
        ┌────────────┐         ┌──────────────────┐
        │ GrabMgr    │         │  poseToBodyPts   │
        │ .update()  │         └────┬─────────────┘
        └────┬───────┘              │
             │ updates Grabbable    ▼
             │ positions/scales     ┌────────────────┐
             │ → collider.center    │ Physics        │
             │                      │ .syncBodyCaps  │
             │                      │ .step(dt)      │
             ▼                      └────┬───────────┘
        ┌─────────────────────┐          │
        │ RH.deform(slR)      │──────────┘  reads colliders[]
        │ LH.deform(slL)      │
        │   (skinning + push  │
        │    out of colliders)│
        └─────────┬───────────┘
                  ▼
            renderer.render()
```

## Key invariants

- **Update order:** `detect → grab.update → physics.step → hand.deform`. The grab manager moves objects (and updates their collider centers); the hand deform reads collider state. Reversing this introduces one-frame lag where the hand mesh squishes around the *previous* ball position.
- **Handedness flip:** MediaPipe returns the mirror-image label. `tracking.js` flips it on the way out so `handedness[i]` matches the user's actual hand (when they're looking at a selfie-mirrored video).
- **Coordinate convention:** `mp2s(lm)` flips Y (screen→world) and exaggerates Z by 1.2× so depth pinch is responsive. All scene-space computations live in this frame.
- **Skinning frame:** `buildFrame(landmarks)` encodes hand position + rotation + uniform scale (palm length) in a single `Matrix4`. Both rest pose and live pose use the same construction; weights are computed once at `init()`, applied every frame.

## Where state lives

| State | Owner | Lifetime |
|---|---|---|
| Stabilized hand landmarks | `tracking.js` closure | session |
| Skinning weights (`li`, `lw`) | `RiggedHand` instance | per hand mesh load |
| Sphere colliders | `RiggedHand.colliders[]` | added/removed at runtime |
| Grab targets | `GrabManager.targets[]` | added/removed at runtime |
| Per-Grabbable physics body | `Physics.dynamics` (Map) | lazy on first throw |
| Floor Y | `Physics.floorY` | smoothed each frame |
| Voice handlers | `VoiceController.handlers[]` | added/removed at runtime |

## Extension points

- **Custom hand mesh:** pass `handModelUrl`. Geometry must be a single mesh, both hands modeled together, X<0 = right hand.
- **Custom hand shader:** `RiggedHand.constructor({ material })` accepts any `THREE.Material`. Vertex skinning is pre-computed in shader-agnostic CPU code.
- **Custom voice backend:** subclass `VoiceController` and override `_transcribe(blob)` to point at your proxy.
- **Custom collider shapes:** `RiggedHand.addCollider(c)` currently assumes spheres. To add box/capsule, extend the inner loop in `RiggedHand.deform()` (line ~120).
- **Pose-driven body interactions:** `dei.bodyPts` is an array of 15 `Vector3`s available every frame. Build whatever you want on top.

## What's NOT in the SDK (deliberate)

- The original demo's ball/bird/butterfly/fire entities. These are **example content**, not engine. See [examples/](./examples/) for how to build them with primitives.
- Any built-in API key. Voice requires consumer-supplied credentials.
- Any opinion about HUD / UI / buttons. The SDK only emits events.
