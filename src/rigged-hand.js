import * as THREE from 'three';
import { K, REST_R42, REST_L42 } from './constants.js';
import { v3a, buildFrame } from './coords.js';
import { HOLO_VS, HOLO_FS } from './shaders/holo.js';

// 42-point inverse-cube-distance skinning. One instance per hand.
// External colliders (sphere {center, radius, active}) push verts out during deform.
export class RiggedHand {
  constructor(restCoords, scene, { material } = {}) {
    this.rv = v3a(restCoords);
    this.rf = buildFrame(this.rv.slice(0, 21));
    this.rfi = new THREE.Matrix4().copy(this.rf).invert();
    this.rl42 = this.rv.map(p => p.clone().applyMatrix4(this.rfi));

    this.lOff = [];
    for (let i = 0; i < 21; i++) {
      this.lOff.push(new THREE.Vector3().subVectors(this.rl42[21 + i], this.rl42[i]));
    }
    this.mesh = null;
    this.vc = 0;
    this.lv = null;
    this.li = null;
    this.lw = null;

    this.grp = new THREE.Group();
    this.grp.visible = false;
    scene.add(this.grp);

    this.u = { uTime: { value: 0 }, uGlow: { value: 0 } };
    this._materialOverride = material || null;
    this.colliders = []; // [{center: Vector3, radius: number, active: boolean}]
  }

  addCollider(c) { this.colliders.push(c); return c; }
  removeCollider(c) { const i = this.colliders.indexOf(c); if (i >= 0) this.colliders.splice(i, 1); }

  init(pos, norm, uv, idx) {
    this.vc = pos.length / 3;
    this.lv = new Float32Array(this.vc * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < this.vc; i++) {
      v.set(pos[i*3], pos[i*3+1], pos[i*3+2]);
      v.applyMatrix4(this.rfi);
      this.lv[i*3] = v.x; this.lv[i*3+1] = v.y; this.lv[i*3+2] = v.z;
    }
    this.li = new Uint8Array(this.vc * K);
    this.lw = new Float32Array(this.vc * K);
    for (let vi = 0; vi < this.vc; vi++) {
      const vx = this.lv[vi*3], vy = this.lv[vi*3+1], vz = this.lv[vi*3+2];
      const d = [];
      for (let li = 0; li < 42; li++) {
        const r = this.rl42[li];
        d.push({ i: li, d: Math.sqrt((vx-r.x)**2 + (vy-r.y)**2 + (vz-r.z)**2) });
      }
      d.sort((a, b) => a.d - b.d);
      let ws = 0;
      for (let k = 0; k < K; k++) { const w = 1 / (d[k].d**3 + .00001); d[k].w = w; ws += w; }
      for (let k = 0; k < K; k++) {
        this.li[vi*K+k] = d[k].i;
        this.lw[vi*K+k] = d[k].w / ws;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.vc*3), 3));
    if (norm) geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(norm), 3));
    if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
    if (idx) geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
    geo.computeVertexNormals();

    const mat = this._materialOverride || new THREE.ShaderMaterial({
      vertexShader: HOLO_VS,
      fragmentShader: HOLO_FS,
      uniforms: this.u,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.grp.add(this.mesh);
  }

  // sl: 21 scene-space landmarks (THREE.Vector3[]). Returns sl on success, null on hide.
  deform(sl) {
    if (!this.mesh || !sl) { this.grp.visible = false; return null; }
    const cf = buildFrame(sl);
    if (!cf) { this.grp.visible = false; return null; }
    this.grp.visible = true;

    const ci = new THREE.Matrix4().copy(cf).invert();
    const clf = sl.map(p => p.clone().applyMatrix4(ci));
    const cl = [];
    for (let i = 0; i < 21; i++) cl.push(clf[i]);
    for (let i = 0; i < 21; i++) cl.push(clf[i].clone().add(this.lOff[i]));

    const dx = new Float32Array(42), dy = new Float32Array(42), dz = new Float32Array(42);
    for (let i = 0; i < 42; i++) {
      let x = cl[i].x - this.rl42[i].x;
      let y = cl[i].y - this.rl42[i].y;
      let z = cl[i].z - this.rl42[i].z;
      const m = Math.sqrt(x*x + y*y + z*z);
      if (m > 1.5) { const s = 1.5 / m; x *= s; y *= s; z *= s; }
      dx[i] = x; dy[i] = y; dz[i] = z;
    }

    const pa = this.mesh.geometry.getAttribute('position').array;
    const v = new THREE.Vector3();
    let cc = 0;
    for (let vi = 0; vi < this.vc; vi++) {
      let px = this.lv[vi*3], py = this.lv[vi*3+1], pz = this.lv[vi*3+2];
      for (let k = 0; k < K; k++) {
        const li = this.li[vi*K+k], w = this.lw[vi*K+k];
        px += dx[li]*w; py += dy[li]*w; pz += dz[li]*w;
      }
      v.set(px, py, pz).applyMatrix4(cf);
      for (const col of this.colliders) {
        if (!col.active) continue;
        if (col.halfExtents) {
          // AABB push-out — matches the actual object bounds, not a single sphere.
          const he = col.halfExtents, c = col.center;
          const dx = v.x - c.x, dy = v.y - c.y, dz = v.z - c.z;
          if (Math.abs(dx) < he.x && Math.abs(dy) < he.y && Math.abs(dz) < he.z) {
            // Inside box: push to the nearest face (smallest penetration depth).
            const pX = he.x - Math.abs(dx);
            const pY = he.y - Math.abs(dy);
            const pZ = he.z - Math.abs(dz);
            if (pX <= pY && pX <= pZ) {
              v.x = c.x + (dx >= 0 ? he.x : -he.x);
            } else if (pY <= pZ) {
              v.y = c.y + (dy >= 0 ? he.y : -he.y);
            } else {
              v.z = c.z + (dz >= 0 ? he.z : -he.z);
            }
            cc++;
          }
        } else if (col.radius) {
          // Legacy sphere push-out — kept for any older callers without halfExtents.
          const d = v.distanceTo(col.center);
          if (d < col.radius) {
            const dir = v.clone().sub(col.center);
            if (dir.length() > .0001) {
              dir.normalize().multiplyScalar(col.radius);
              v.copy(col.center).add(dir);
            }
            cc++;
          }
        }
      }
      pa[vi*3] = v.x; pa[vi*3+1] = v.y; pa[vi*3+2] = v.z;
    }
    this.mesh.geometry.getAttribute('position').needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    this.u.uGlow.value += ((cc > 20 ? .5 : 0) - this.u.uGlow.value) * .15;
    return sl;
  }

  setGlow(target) {
    this.u.uGlow.value += (target - this.u.uGlow.value) * 0.1;
  }

  tickTime(t) { this.u.uTime.value = t; }
}

// Loads the hand GLB and creates {RH, LH} from a single split mesh (X<0 = right).
export async function loadRiggedHands(scene, gltfLoader, url, opts = {}) {
  return new Promise((resolve, reject) => {
    gltfLoader.load(url, (gltf) => {
      let sg = null;
      gltf.scene.traverse(c => { if (c.isMesh) sg = c.geometry; });
      if (!sg) return reject(new Error('No mesh in GLB'));

      const bx = new THREE.Box3().setFromObject(gltf.scene);
      const ct = bx.getCenter(new THREE.Vector3());
      const ap = sg.getAttribute('position').array;
      const an = sg.getAttribute('normal')?.array;
      const au = sg.getAttribute('uv')?.array;
      const ai = sg.index ? Array.from(sg.index.array) : null;
      const vc = sg.getAttribute('position').count;

      const cp = new Float32Array(ap.length);
      for (let i = 0; i < vc; i++) {
        cp[i*3]   = ap[i*3]   - ct.x;
        cp[i*3+1] = ap[i*3+1] - ct.y;
        cp[i*3+2] = ap[i*3+2] - ct.z;
      }
      const lv = [], rv = [];
      const lm = new Int32Array(vc).fill(-1), rm = new Int32Array(vc).fill(-1);
      for (let i = 0; i < vc; i++) {
        if (cp[i*3] < 0) { rm[i] = rv.length; rv.push(i); }
        else            { lm[i] = lv.length; lv.push(i); }
      }
      function ext(vl, vmap) {
        const n = vl.length;
        const p = new Float32Array(n*3);
        const nr = an ? new Float32Array(n*3) : null;
        const uv = au ? new Float32Array(n*2) : null;
        for (let i = 0; i < n; i++) {
          const o = vl[i];
          p[i*3] = cp[o*3]; p[i*3+1] = cp[o*3+1]; p[i*3+2] = cp[o*3+2];
          if (nr) { nr[i*3] = an[o*3]; nr[i*3+1] = an[o*3+1]; nr[i*3+2] = an[o*3+2]; }
          if (uv) { uv[i*2] = au[o*2]; uv[i*2+1] = au[o*2+1]; }
        }
        let idx = null;
        if (ai) {
          const t = [];
          for (let i = 0; i < ai.length; i += 3) {
            const a = vmap[ai[i]], b = vmap[ai[i+1]], c = vmap[ai[i+2]];
            if (a >= 0 && b >= 0 && c >= 0) t.push(a, b, c);
          }
          idx = new Uint32Array(t);
        }
        return { p, nr, uv, idx };
      }
      const rd = ext(rv, rm), ld = ext(lv, lm);
      const RH = new RiggedHand(REST_R42, scene, opts);
      const LH = new RiggedHand(REST_L42, scene, opts);
      RH.init(rd.p, rd.nr, rd.uv, rd.idx);
      LH.init(ld.p, ld.nr, ld.uv, ld.idx);
      resolve({ RH, LH });
    }, undefined, reject);
  });
}
