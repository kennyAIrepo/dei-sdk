import * as THREE from 'three';

export function v3a(arr) {
  return arr.map(p => new THREE.Vector3(p[0], p[1], p[2]));
}

// Camera-aware MediaPipe → scene-space mapper.
// Returns mp2s(lm) closure that captures camera/screen state.
export function makeMp2s(camera) {
  let sW = 1, sH = 1;
  function recompute() {
    const a = innerWidth / innerHeight;
    const camZ = Math.abs(camera.position.z);
    const h = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camZ;
    sW = h * a * 2;
    sH = h * 2;
  }
  recompute();
  addEventListener('resize', recompute);
  function mp2s(lm) {
    return new THREE.Vector3(
      (lm.x - .5) * sW,
      -(lm.y - .5) * sH,
      -(lm.z || 0) * sH * 1.2
    );
  }
  mp2s.recompute = recompute;
  mp2s.bounds = () => ({ sW, sH });
  return mp2s;
}

// Build a 4x4 frame from 4 hand landmarks (wrist=0, mcp9, mcp5, mcp17).
// Encodes hand rotation AND uniform scale (length of palm vector).
export function buildFrame(lm) {
  const w = lm[0], m = lm[9], i = lm[5], p = lm[17];
  const yV = new THREE.Vector3().subVectors(m, w);
  const s = yV.length();
  if (s < .0001) return null;
  const yD = yV.clone().divideScalar(s);
  const ac = new THREE.Vector3().subVectors(i, p);
  const zD = new THREE.Vector3().crossVectors(yD, ac).normalize();
  const xD = new THREE.Vector3().crossVectors(yD, zD).normalize();
  const mt = new THREE.Matrix4().makeBasis(
    xD.multiplyScalar(s),
    yD.multiplyScalar(s),
    zD.multiplyScalar(s)
  );
  mt.setPosition(w);
  return mt;
}
