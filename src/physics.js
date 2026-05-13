import { BODY_SEGS } from './constants.js';

// Lazy-loaded cannon-es. World owns floor (kinematic), body capsules (kinematic),
// and dynamic bodies for thrown Grabbables.
export class Physics {
  constructor() {
    this.CANNON = null;
    this.world = null;
    this.floor = null;
    this.bodyCaps = [];        // 10 kinematic spheres for body collision
    this.dynamics = new Map(); // Grabbable → CANNON.Body
    this.gravity = -6.0;
    this.floorY = -0.8;
    this.ready = false;
  }

  async init({ gravity = -6.0 } = {}) {
    this.gravity = gravity;
    const C = await import('https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm');
    this.CANNON = C;
    this.world = new C.World({ gravity: new C.Vec3(0, gravity, 0) });
    this.world.broadphase = new C.NaiveBroadphase();

    const floorMat = new C.Material('floor');
    this.floor = new C.Body({ mass: 0, material: floorMat, shape: new C.Plane() });
    this.floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.floor.position.set(0, this.floorY, 0);
    this.world.addBody(this.floor);

    const ballMat = new C.Material('ball');
    const bodyMat = new C.Material('body');
    this.world.addContactMaterial(new C.ContactMaterial(floorMat, ballMat, { restitution: 0.75, friction: 0.4 }));
    this.world.addContactMaterial(new C.ContactMaterial(bodyMat, ballMat, { restitution: 0.5, friction: 0.3 }));
    this._floorMat = floorMat; this._ballMat = ballMat; this._bodyMat = bodyMat;

    for (let i = 0; i < BODY_SEGS.length; i++) {
      const b = new C.Body({ mass: 0, type: C.Body.KINEMATIC, material: bodyMat });
      b.addShape(new C.Sphere(BODY_SEGS[i][3]));
      this.world.addBody(b);
      this.bodyCaps.push(b);
    }
    this.ready = true;
  }

  setFloorY(y, smoothing = 0.1) {
    this.floorY += (y - this.floorY) * smoothing;
    if (this.floor) this.floor.position.y = this.floorY;
  }

  // bodyPts: array of THREE.Vector3 indexed per BODY_SEGS endpoints (15 slots).
  syncBodyCapsules(bodyPts) {
    if (!this.ready || !bodyPts) return;
    for (let si = 0; si < BODY_SEGS.length && si < this.bodyCaps.length; si++) {
      const [a, b] = BODY_SEGS[si];
      if (!bodyPts[a] || !bodyPts[b]) continue;
      const mid = bodyPts[a].clone().add(bodyPts[b]).multiplyScalar(0.5);
      this.bodyCaps[si].position.set(mid.x, mid.y, mid.z);
    }
  }

  // Throw a Grabbable into the physical world with given velocity.
  throwGrabbable(g, velocity, { mass = 0.6 } = {}) {
    if (!this.ready) return;
    let b = this.dynamics.get(g);
    const r = g.radius * g.scale;
    if (!b) {
      b = new this.CANNON.Body({
        mass,
        shape: new this.CANNON.Sphere(r),
        material: this._ballMat,
      });
      this.world.addBody(b);
      this.dynamics.set(g, b);
    }
    b.shapes[0] = new this.CANNON.Sphere(r);
    b.updateBoundingRadius();
    b.position.set(g.mesh.position.x, g.mesh.position.y, g.mesh.position.z);
    b.velocity.set(velocity.x, velocity.y, velocity.z);
    b.angularVelocity.set(Math.random()*2-1, Math.random()*2-1, Math.random()*2-1);
    g.userData = g.userData || {};
    g.userData.physActive = true;
  }

  pickUp(g) {
    g.userData = g.userData || {};
    g.userData.physActive = false;
  }

  step(dt) {
    if (!this.ready) return;
    this.world.step(1 / 60, dt, 3);
    for (const [g, b] of this.dynamics) {
      if (!g.userData?.physActive) continue;
      g.mesh.position.set(b.position.x, b.position.y, b.position.z);
      g.mesh.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      // Recover if it tunnels past floor.
      if (g.mesh.position.y < this.floorY - 1) {
        g.mesh.position.y = this.floorY + g.radius * g.scale;
        b.position.y = g.mesh.position.y;
        b.velocity.set(0, 0, 0);
      }
    }
  }
}

// Pose → 15-slot body points (head, shoulder mid, hip mid, shoulders L/R, elbows, wrists, hips, knees, ankles).
// `mp2s` is the camera-aware mapper from coords.makeMp2s.
export function poseToBodyPoints(poseLandmarks, mp2s) {
  if (!poseLandmarks) return null;
  const lm = poseLandmarks;
  const pts = [];
  pts[0] = mp2s(lm[0]);
  pts[1] = mp2s({ x:(lm[11].x+lm[12].x)/2, y:(lm[11].y+lm[12].y)/2, z:((lm[11].z||0)+(lm[12].z||0))/2 });
  pts[2] = mp2s({ x:(lm[23].x+lm[24].x)/2, y:(lm[23].y+lm[24].y)/2, z:((lm[23].z||0)+(lm[24].z||0))/2 });
  pts[3] = mp2s(lm[11]);  pts[4] = mp2s(lm[12]);
  pts[5] = mp2s(lm[13]);  pts[6] = mp2s(lm[14]);
  pts[7] = mp2s(lm[15]);  pts[8] = mp2s(lm[16]);
  pts[9] = mp2s(lm[23]);  pts[10] = mp2s(lm[24]);
  pts[11] = mp2s(lm[25]); pts[12] = mp2s(lm[26]);
  pts[13] = mp2s(lm[27]); pts[14] = mp2s(lm[28]);
  return pts;
}

// Returns scene-Y of the floor.
// Preferred: lowest visible foot landmark.
// Fallback 1: hip midpoint minus ~0.9m (typical adult hip→floor).
// Fallback 2: shoulder midpoint minus ~1.5m.
// Last: null (caller keeps previous value).
export function detectFloorY(poseLandmarks, mp2s) {
  if (!poseLandmarks) return null;
  const VIS = 0.3;

  const feet = [27, 28, 29, 30, 31, 32];
  let lowest = Infinity;
  for (const fi of feet) {
    const lm = poseLandmarks[fi];
    if (lm && (lm.visibility == null || lm.visibility >= VIS)) {
      const v = mp2s(lm);
      if (v.y < lowest) lowest = v.y;
    }
  }
  if (lowest !== Infinity) return lowest - 0.05;

  const hipL = poseLandmarks[23], hipR = poseLandmarks[24];
  const hipsVisible = hipL && hipR
    && (hipL.visibility == null || hipL.visibility >= VIS)
    && (hipR.visibility == null || hipR.visibility >= VIS);
  if (hipsVisible) {
    const hipMidY = mp2s({ x:(hipL.x+hipR.x)/2, y:(hipL.y+hipR.y)/2, z:0 }).y;
    return hipMidY - 0.9;
  }

  const shL = poseLandmarks[11], shR = poseLandmarks[12];
  const shoulVisible = shL && shR
    && (shL.visibility == null || shL.visibility >= VIS)
    && (shR.visibility == null || shR.visibility >= VIS);
  if (shoulVisible) {
    const shMidY = mp2s({ x:(shL.x+shR.x)/2, y:(shL.y+shR.y)/2, z:0 }).y;
    return shMidY - 1.5;
  }

  return null;
}
