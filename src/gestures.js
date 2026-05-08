import * as THREE from 'three';
import { PINCH_TH } from './constants.js';

// Raw-landmark predicates (operate on MediaPipe normalized coords)
export function isPinch(lm, threshold = PINCH_TH) {
  return Math.hypot(
    lm[4].x - lm[8].x,
    lm[4].y - lm[8].y,
    (lm[4].z || 0) - (lm[8].z || 0)
  ) < threshold;
}

// Scene-space predicates (operate on Vector3[])
export function pinchPoint(sl) {
  return new THREE.Vector3(
    (sl[4].x + sl[8].x) / 2,
    (sl[4].y + sl[8].y) / 2,
    (sl[4].z + sl[8].z) / 2
  );
}

export function palmCenter(sl) {
  return new THREE.Vector3(
    (sl[0].x + sl[5].x + sl[9].x + sl[17].x) / 4,
    (sl[0].y + sl[5].y + sl[9].y + sl[17].y) / 4,
    (sl[0].z + sl[5].z + sl[9].z + sl[17].z) / 4
  );
}

// Hand orientation as a quaternion. Up = wrist→middleMCP, fwd = up × across.
export function handQuat(sl) {
  const up = new THREE.Vector3().subVectors(sl[9], sl[0]).normalize();
  const ac = new THREE.Vector3().subVectors(sl[5], sl[17]).normalize();
  const fw = new THREE.Vector3().crossVectors(up, ac).normalize();
  const rt = new THREE.Vector3().crossVectors(up, fw).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(rt, up, fw)
  );
}

// Distance from object center to nearest landmark.
export function minLandmarkDist(sl, target) {
  if (!sl) return Infinity;
  let m = Infinity;
  for (let i = 0; i < 21; i++) {
    const d = sl[i].distanceTo(target);
    if (d < m) m = d;
  }
  return m;
}

// Count of "key" landmarks (wrist + finger MCPs/tips) within `maxDist` of target.
const KEY = [0, 4, 5, 8, 9, 12, 13, 16, 17, 20];
export function countNear(sl, target, maxDist) {
  if (!sl) return 0;
  let n = 0;
  for (const i of KEY) if (sl[i].distanceTo(target) < maxDist) n++;
  return n;
}

// ─────────────────────────────────────────────────────────────────────
// Thumb-up: thumb extended up, other 4 fingers folded down.
// Operates on raw normalized landmarks (lower y = higher on screen).
// Returns true while pose is held; pair with debounce to fire once per gesture.
// ─────────────────────────────────────────────────────────────────────
export function isThumbUp(lm) {
  if (!lm) return false;
  const t = lm[4], tIp = lm[3], tMcp = lm[2], wrist = lm[0];
  const idxTip = lm[8], idxMcp = lm[5];
  const midTip = lm[12], midMcp = lm[9];
  const ringTip = lm[16], ringMcp = lm[13];
  const pinkyTip = lm[20], pinkyMcp = lm[17];
  // Thumb pointing UP (lower y is higher visually)
  const thumbExtended = t.y < tIp.y && tIp.y < tMcp.y && (wrist.y - t.y) > 0.10;
  // Other fingers folded: tip BELOW or near the MCP
  const idxFolded   = idxTip.y   > idxMcp.y   - 0.02;
  const midFolded   = midTip.y   > midMcp.y   - 0.02;
  const ringFolded  = ringTip.y  > ringMcp.y  - 0.02;
  const pinkyFolded = pinkyTip.y > pinkyMcp.y - 0.02;
  return thumbExtended && idxFolded && midFolded && ringFolded && pinkyFolded;
}

// Edge-triggered version: fires onUp() only on rising transitions, with cooldown.
export class ThumbUpTrigger {
  constructor({ cooldown = 0.8, onUp = null } = {}) {
    this.cooldown = cooldown;
    this.onUp = onUp;
    this._wasUp = false;
    this._cool = 0;
  }
  update(lm, dt) {
    this._cool = Math.max(0, this._cool - dt);
    const up = isThumbUp(lm);
    if (up && !this._wasUp && this._cool === 0) {
      this._cool = this.cooldown;
      this.onUp?.();
    }
    this._wasUp = up;
    return up;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Hand-wave swipe detector: rolling-window wrist X velocity → 'left' | 'right'.
// Use raw normalized x (0..1). Coordinate is already mirror-flipped by tracker,
// so 'right' means user's actual right.
// ─────────────────────────────────────────────────────────────────────
export class HandWaveDetector {
  constructor({
    windowMs = 350,
    minDx = 0.18,         // normalized x distance over the window
    cooldown = 0.4,       // seconds between fires
    onSwipe = null,       // ('left'|'right') => void
  } = {}) {
    this.windowMs = windowMs;
    this.minDx = minDx;
    this.cooldown = cooldown;
    this.onSwipe = onSwipe;
    this._hist = [];
    this._cool = 0;
  }
  update(wristLm, dt) {
    this._cool = Math.max(0, this._cool - dt);
    if (!wristLm) { this._hist = []; return null; }
    const now = performance.now();
    this._hist.push({ x: wristLm.x, t: now });
    while (this._hist.length && now - this._hist[0].t > this.windowMs) this._hist.shift();
    if (this._cool > 0 || this._hist.length < 3) return null;
    const dx = this._hist[this._hist.length - 1].x - this._hist[0].x;
    if (Math.abs(dx) >= this.minDx) {
      const dir = dx > 0 ? 'right' : 'left';
      this._cool = this.cooldown;
      this._hist = [];
      this.onSwipe?.(dir);
      return dir;
    }
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Grabbable: per-object grab/throw/scale state machine.
// `mesh` is your Three.js Object3D; we never replace it, only drive transform.
// ─────────────────────────────────────────────────────────────────────
export class Grabbable {
  constructor(mesh, opts = {}) {
    this.mesh = mesh;
    this.radius = opts.radius ?? 0.15;
    this.scalable = opts.scalable ?? true;
    this.minScale = opts.minScale ?? 0.2;
    this.maxScale = opts.maxScale ?? 4;
    this.grabFingerCount = opts.grabFingerCount ?? 4;  // wrap requirement
    this.pinchOnly = opts.pinchOnly ?? false;          // small-object mode (e.g. bird)
    this.collide = opts.collide ?? true;               // include in hand-mesh push-out
    this.followLerp = opts.followLerp ?? 0.85;
    this.rotSlerp = opts.rotSlerp ?? 0.75;
    this.throwBoost = opts.throwBoost ?? 60;
    this.onGrab = opts.onGrab || null;
    this.onRelease = opts.onRelease || null;
    this.onScale = opts.onScale || null;

    this.scale = 1;
    this.position = mesh.position;
    this.quaternion = mesh.quaternion;

    this.collider = { center: mesh.position, radius: this.radius, active: true };
    this.grabbed = false;
    this.grabHand = -1;
    this._grabOff = new THREE.Vector3();
    this._grabQO = new THREE.Quaternion();
    this._velHistory = [];
    this._twoHandPrev = 0;
  }

  applyTransform() {
    this.collider.center = this.mesh.position;
    this.collider.radius = this.radius * this.scale;
    this.mesh.scale.setScalar(this.mesh.userData._baseScale ? this.mesh.userData._baseScale * this.scale : this.scale);
  }

  setBaseScale(s) { this.mesh.userData._baseScale = s; this.applyTransform(); }
}

// Iterates Grabbables vs. live hands. One Grabbable can be grabbed per hand.
// Two-hand pinch on the closest Grabbable scales it.
export class GrabManager {
  constructor() {
    this.targets = []; // Grabbable[]
    this._twoHandPrevD = 0;
    this._twoHandTarget = null;
  }
  add(g) { this.targets.push(g); return g; }
  remove(g) { const i = this.targets.indexOf(g); if (i >= 0) this.targets.splice(i, 1); }

  // hands: raw landmarks per hand. sls: scene-space Vector3[][]. dt: seconds.
  // events: optional bus with .emit(name, payload).
  update(hands, sls, dt, events) {
    const hc = Math.min(hands?.length || 0, 2);

    // 1) Two-hand pinch → pick the closest Grabbable to midpoint, scale it.
    let pinchHands = [];
    for (let h = 0; h < hc; h++) {
      if (hands[h] && sls[h] && isPinch(hands[h])) pinchHands.push(h);
    }
    if (pinchHands.length >= 2) {
      const p0 = pinchPoint(sls[pinchHands[0]]);
      const p1 = pinchPoint(sls[pinchHands[1]]);
      const mid = p0.clone().lerp(p1, .5);
      const dist = p0.distanceTo(p1);

      if (!this._twoHandTarget) {
        let best = null, bestD = Infinity;
        for (const g of this.targets) {
          if (!g.scalable) continue;
          const d = g.mesh.position.distanceTo(mid);
          if (d < bestD) { bestD = d; best = g; }
        }
        if (best && bestD < 0.6) this._twoHandTarget = best;
      }
      if (this._twoHandTarget) {
        const g = this._twoHandTarget;
        if (this._twoHandPrevD > 0) {
          const ds = (dist - this._twoHandPrevD) * 3;
          g.scale = Math.max(g.minScale, Math.min(g.maxScale, g.scale + ds));
          if (g.onScale) g.onScale(g.scale);
          if (events) events.emit('twoHandScale', { target: g, scale: g.scale, midpoint: mid });
        }
        this._twoHandPrevD = dist;
        g.mesh.position.copy(mid);
        g.applyTransform();
        return;
      }
    }
    this._twoHandPrevD = 0;
    this._twoHandTarget = null;

    // 2) Per-hand grab logic.
    for (const g of this.targets) {
      // Find closest hand to this object that meets grab criteria.
      let bestH = -1, bestD = Infinity;
      for (let h = 0; h < hc; h++) {
        if (!sls[h]) continue;
        if (g.pinchOnly) {
          if (!isPinch(hands[h])) continue;
          const pp = pinchPoint(sls[h]);
          const d = pp.distanceTo(g.mesh.position);
          if (d < bestD) { bestD = d; bestH = h; }
        } else {
          const d = minLandmarkDist(sls[h], g.mesh.position);
          if (d < bestD) { bestD = d; bestH = h; }
        }
      }
      const r = g.radius * g.scale;

      if (g.pinchOnly) {
        const reach = r * 2 + 0.15;
        if (bestH >= 0 && bestD < reach) {
          if (!g.grabbed) {
            const pp = pinchPoint(sls[bestH]);
            g.grabbed = true; g.grabHand = bestH;
            g._grabOff.subVectors(g.mesh.position, pp);
            g._grabQO.copy(new THREE.Quaternion()).invert().multiply(g.mesh.quaternion);
            g._velHistory = [];
            if (g.onGrab) g.onGrab(bestH);
            if (events) events.emit('grab', { target: g, hand: bestH });
          }
          if (g.grabbed && g.grabHand === bestH) {
            const pp = pinchPoint(sls[bestH]);
            const prev = g.mesh.position.clone();
            g.mesh.position.lerp(pp.clone().add(g._grabOff), g.followLerp);
            const hq = handQuat(sls[bestH]);
            g.mesh.quaternion.slerp(hq.clone().multiply(g._grabQO), g.rotSlerp * 0.4);
            g._velHistory.push(g.mesh.position.clone().sub(prev));
            if (g._velHistory.length > 5) g._velHistory.shift();
            g.applyTransform();
            continue;
          }
        } else if (g.grabbed) {
          this._release(g, events);
        }
      } else {
        const grabOK = bestH >= 0 && bestD < r + 0.1
          && countNear(sls[bestH], g.mesh.position, r + 0.1) >= g.grabFingerCount;
        if (grabOK) {
          if (!g.grabbed) {
            g.grabbed = true; g.grabHand = bestH;
            g._grabOff.subVectors(g.mesh.position, palmCenter(sls[bestH]));
            g._grabQO.copy(handQuat(sls[bestH])).invert().multiply(g.mesh.quaternion);
            g._velHistory = [];
            if (g.onGrab) g.onGrab(bestH);
            if (events) events.emit('grab', { target: g, hand: bestH });
          }
          if (g.grabbed && g.grabHand === bestH) {
            const pc = palmCenter(sls[bestH]);
            const hq = handQuat(sls[bestH]);
            const prev = g.mesh.position.clone();
            g.mesh.position.lerp(pc.clone().add(g._grabOff), g.followLerp);
            g.mesh.quaternion.slerp(hq.clone().multiply(g._grabQO), g.rotSlerp);
            g._velHistory.push(g.mesh.position.clone().sub(prev));
            if (g._velHistory.length > 5) g._velHistory.shift();
            g.applyTransform();
            continue;
          }
        } else if (g.grabbed) {
          this._release(g, events);
        }
      }
      g.applyTransform();
    }
  }

  _release(g, events) {
    const vel = new THREE.Vector3();
    for (const v of g._velHistory) vel.add(v);
    if (g._velHistory.length) vel.divideScalar(g._velHistory.length).multiplyScalar(g.throwBoost);
    g.grabbed = false; g.grabHand = -1; g._velHistory = [];
    if (g.onRelease) g.onRelease(vel);
    if (events) events.emit('release', { target: g, velocity: vel });
  }
}
