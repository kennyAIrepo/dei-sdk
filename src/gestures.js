import * as THREE from 'three';
import { PINCH_TH } from './constants.js';

const _yAxis = new THREE.Vector3(0, 1, 0);
const _showcaseQ = new THREE.Quaternion();

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

// Palm-facing direction (the "forward" axis of handQuat). For a right hand
// held palm-up, this vector points roughly +Y in scene space.
export function palmNormal(sl) {
  const up = new THREE.Vector3().subVectors(sl[9], sl[0]).normalize();
  const ac = new THREE.Vector3().subVectors(sl[5], sl[17]).normalize();
  return new THREE.Vector3().crossVectors(up, ac).normalize();
}

// "Cup" gesture: two hands held palms-up, near each other in front of the body.
// Triggers onCup() when held for `holdMs`. Used to re-summon dropped objects.
export class CupGestureDetector {
  constructor({
    holdMs = 500,
    cooldown = 1.2,
    maxHandGap = 0.55,    // max scene-space distance between wrists
    maxYDiff   = 0.18,    // wrists must be at similar height
    minPalmUpY = 0.45,    // palm normal Y must exceed this on both hands
    onCup = null,
  } = {}) {
    this.holdMs = holdMs;
    this.cooldown = cooldown;
    this.maxHandGap = maxHandGap;
    this.maxYDiff = maxYDiff;
    this.minPalmUpY = minPalmUpY;
    this.onCup = onCup;
    this._holdT = 0;
    this._cool = 0;
  }
  update(hands, sls, dt) {
    this._cool = Math.max(0, this._cool - dt);
    if (this._cool > 0) return;
    if (!hands || !sls || hands.length < 2 || !sls[0] || !sls[1]) { this._holdT = 0; return; }
    const n0 = palmNormal(sls[0]);
    const n1 = palmNormal(sls[1]);
    if (n0.y < this.minPalmUpY || n1.y < this.minPalmUpY) { this._holdT = 0; return; }
    const w0 = sls[0][0], w1 = sls[1][0];
    const gap = w0.distanceTo(w1);
    const yDiff = Math.abs(w0.y - w1.y);
    if (gap > this.maxHandGap || yDiff > this.maxYDiff) { this._holdT = 0; return; }
    this._holdT += (dt || 0.016) * 1000;
    if (this._holdT >= this.holdMs) {
      this._holdT = 0;
      this._cool = this.cooldown;
      this.onCup?.({ midpoint: w0.clone().add(w1).multiplyScalar(0.5) });
    }
  }
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

// ── AABB versions (use these for grab volumes that match the actual object shape) ──
// Returns distance from point p to nearest face of an AABB; 0 if inside.
export function distToAABB(p, center, halfExt) {
  const dx = Math.max(Math.abs(p.x - center.x) - halfExt.x, 0);
  const dy = Math.max(Math.abs(p.y - center.y) - halfExt.y, 0);
  const dz = Math.max(Math.abs(p.z - center.z) - halfExt.z, 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
export function minLandmarkToAABB(sl, center, halfExt) {
  if (!sl) return Infinity;
  let m = Infinity;
  for (let i = 0; i < 21; i++) {
    const d = distToAABB(sl[i], center, halfExt);
    if (d < m) m = d;
  }
  return m;
}
export function countNearAABB(sl, center, halfExt, surfaceBuffer) {
  if (!sl) return 0;
  let n = 0;
  for (const i of KEY) if (distToAABB(sl[i], center, halfExt) < surfaceBuffer) n++;
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

    // Preserve whatever scale the mesh arrived with (e.g. Sketchfab normalize
    // already applied scale = targetSize/maxDim). applyTransform() multiplies
    // this by the user-controlled `scale` so we never blow up pre-scaled meshes.
    this._baseScale = mesh.scale.x || 1;

    // Per-axis half-extents from the actual visible bounding box.
    // The grab volume and hand-mesh squish use this AABB so the interaction
    // matches the real object shape (not a sphere around it).
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    if (!box.isEmpty()) {
      const sz = box.getSize(new THREE.Vector3());
      this._baseHalfExtents = new THREE.Vector3(
        Math.max(0.02, sz.x / 2),
        Math.max(0.02, sz.y / 2),
        Math.max(0.02, sz.z / 2),
      );
    } else {
      this._baseHalfExtents = new THREE.Vector3(0.075, 0.075, 0.075);
    }
    // Legacy single-radius (for any code still reading collider.radius).
    this.radius = opts.radius ?? Math.max(this._baseHalfExtents.x, this._baseHalfExtents.y, this._baseHalfExtents.z);

    this.scalable = opts.scalable ?? true;
    this.minScale = opts.minScale ?? 0.2;
    this.maxScale = opts.maxScale ?? 4;
    this.grabFingerCount = opts.grabFingerCount ?? 4;
    this.pinchOnly = opts.pinchOnly ?? false;
    this.collide = opts.collide ?? true;
    this.followLerp = opts.followLerp ?? 0.85;
    this.rotSlerp = opts.rotSlerp ?? 0.75;
    this.throwBoost = opts.throwBoost ?? 60;
    this.grabSurfaceBuffer = opts.grabSurfaceBuffer ?? 0.08;   // closest-landmark distance to surface for grab
    this.grabWrapBuffer    = opts.grabWrapBuffer    ?? 0.13;   // how close 4+ fingers must be to surface
    this.onGrab = opts.onGrab || null;
    this.onRelease = opts.onRelease || null;
    this.onScale = opts.onScale || null;

    this.scale = 1;
    this.position = mesh.position;
    this.quaternion = mesh.quaternion;

    this.collider = {
      center: mesh.position,
      radius: this.radius,
      halfExtents: this._baseHalfExtents.clone(),
      active: true,
    };

    this.grabbed = false;
    this.grabHand = -1;
    this._everGrabbed = false;
    this._spawnPos = null;                    // set by host on spawn; cup gesture summons back here
    this.spinSpeed = opts.spinSpeed ?? 0.55;  // rad/s showcase rotation while idle
    this._grabOff = new THREE.Vector3();
    this._grabQO = new THREE.Quaternion();
    this._velHistory = [];
    this._twoHandPrev = 0;
  }

  applyTransform() {
    this.collider.center = this.mesh.position;
    this.collider.radius = this.radius * this.scale;
    this.collider.halfExtents.copy(this._baseHalfExtents).multiplyScalar(this.scale);
    this.mesh.scale.setScalar(this._baseScale * this.scale);
  }

  setBaseScale(s) {
    this._baseScale = s;
    this.applyTransform();
  }
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

    // 2) Per-hand grab logic — AABB based, so volume matches actual object shape.
    for (const g of this.targets) {
      const he = g.collider.halfExtents;
      const center = g.mesh.position;

      // Find closest hand to this object that meets grab criteria.
      // Uses center-distance detection (matching dei_full.html basketball grab):
      // grab fires when a landmark enters a sphere of radius (g.radius + 0.1) around
      // the object center — so palm center is already near/inside the object and
      // grabOff stays small, preventing the floating-at-a-distance gap.
      let bestH = -1, bestD = Infinity;
      for (let h = 0; h < hc; h++) {
        if (!sls[h]) continue;
        if (g.pinchOnly) {
          if (!isPinch(hands[h])) continue;
          const pp = pinchPoint(sls[h]);
          const d = pp.distanceTo(center);
          if (d < bestD) { bestD = d; bestH = h; }
        } else {
          const d = minLandmarkDist(sls[h], center);
          if (d < bestD) { bestD = d; bestH = h; }
        }
      }

      let didGrab = false;

      if (g.pinchOnly) {
        const reach = g.radius + 0.1;
        if (bestH >= 0 && bestD < reach) {
          if (!g.grabbed) {
            const pp = pinchPoint(sls[bestH]);
            g.grabbed = true; g.grabHand = bestH; g._everGrabbed = true;
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
            didGrab = true;
          }
        } else if (g.grabbed) {
          this._release(g, events);
        }
      } else {
        // Non-pinch: mirror dei_full.html — grab when closest landmark is within
        // (radius + 0.1) of center AND 4+ key landmarks are in the same sphere.
        const grabR = g.radius + 0.1;
        const grabOK = bestH >= 0
          && bestD < grabR
          && countNear(sls[bestH], center, grabR) >= g.grabFingerCount;
        if (grabOK) {
          if (!g.grabbed) {
            g.grabbed = true; g.grabHand = bestH; g._everGrabbed = true;
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
            didGrab = true;
          }
        } else if (g.grabbed) {
          this._release(g, events);
        }
      }

      // Showcase Y-spin only while the object has never been physically dropped.
      // Once it's been grabbed+released (physActive ever set) it should sit still on
      // the floor, not keep spinning — exactly like the original dei_full.html ball.
      const inPhys = !!g.userData?.physActive;
      const idle = !didGrab && !inPhys && !g._everGrabbed;
      if (idle) {
        _showcaseQ.setFromAxisAngle(_yAxis, g.spinSpeed * (dt || 0.016));
        g.mesh.quaternion.premultiply(_showcaseQ);
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
