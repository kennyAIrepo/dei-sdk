import { MP_VERSION, HAND_MODEL_URL, POSE_MODEL_URL } from './constants.js';

// Loads MediaPipe HandLandmarker + (optional) PoseLandmarker.
// Returns {hand, pose}. Either may be null per opts.
export async function initTracking({
  numHands = 2,
  pose = true,
  handConfidence = 0.5,
  poseConfidence = 0.5,
  delegate = 'GPU',
} = {}) {
  const V = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/+esm`);
  const fs = await V.FilesetResolver.forVisionTasks(
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`
  );
  const hand = await V.HandLandmarker.createFromOptions(fs, {
    baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numHands,
    minHandDetectionConfidence: handConfidence,
    minTrackingConfidence: handConfidence,
  });
  let poseModel = null;
  if (pose) {
    poseModel = await V.PoseLandmarker.createFromOptions(fs, {
      baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: poseConfidence,
      minTrackingConfidence: poseConfidence,
    });
  }
  return { hand, pose: poseModel };
}

const NOISE = 0.003;
// Per-hand jitter rejection. Pass an index 0..numHands-1.
export function makeStabilizer() {
  const stH = [];
  return function stab(raw, i) {
    if (!stH[i]) {
      stH[i] = raw.map(p => ({ x: p.x, y: p.y, z: p.z }));
      return stH[i];
    }
    for (let j = 0; j < raw.length; j++) {
      if (Math.hypot(raw[j].x - stH[i][j].x, raw[j].y - stH[i][j].y) > NOISE) {
        stH[i][j] = { x: raw[j].x, y: raw[j].y, z: raw[j].z };
      }
    }
    return stH[i];
  };
}

// Detects on `videoEl`, applies X-mirror (selfie), handedness flip, stabilization.
// Returns {hands: [stabilized landmarks], handedness: ['Left'|'Right'], poseLandmarks, poseWorld}.
export function makeDetector(handModel, poseModel) {
  const stab = makeStabilizer();
  let lastT = -1, frame = 0;
  let cache = { hands: null, handCount: 0, handedness: [], poseLandmarks: null, poseWorld: null };
  return function detect(videoEl, { posePeriod = 4 } = {}) {
    if (!handModel || videoEl.readyState < 2) return cache;
    const now = performance.now();
    if (now === lastT) return cache;
    const hr = handModel.detectForVideo(videoEl, now);
    if (hr.landmarks && hr.landmarks.length) {
      cache.handCount = hr.landmarks.length;
      cache.hands = [];
      cache.handedness = [];
      for (let h = 0; h < cache.handCount; h++) {
        cache.hands.push(stab(hr.landmarks[h].map(p => ({ x: 1 - p.x, y: p.y, z: p.z })), h));
        const hd = hr.handednesses?.[h]?.[0]?.categoryName;
        cache.handedness.push(hd === 'Left' ? 'Right' : 'Left');
      }
    } else {
      cache.handCount = 0; cache.hands = null; cache.handedness = [];
    }
    if (poseModel && (frame % posePeriod === 0)) {
      const pr = poseModel.detectForVideo(videoEl, now);
      cache.poseLandmarks = pr.landmarks?.[0]?.map(p => ({ x: 1 - p.x, y: p.y, z: p.z || 0 })) || null;
      cache.poseWorld = pr.worldLandmarks?.[0] || null;
    }
    frame++;
    lastT = now;
    return cache;
  };
}
