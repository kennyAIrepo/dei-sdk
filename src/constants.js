// Skinning + gesture constants. Pure data, no deps.

export const K = 5;                // top-K nearest control points per vertex
export const PINCH_TH = 0.065;     // thumb-tip ↔ index-tip distance (normalized)
export const CAM_FOV = 50;
export const CAM_Z = 2.0;

// Body segments: [landmarkA, landmarkB, name, capsuleRadius]
export const BODY_SEGS = [
  [0, 1, 'head', .12], [1, 2, 'torso', .18],
  [3, 5, 'uarmL', .05], [4, 6, 'uarmR', .05],
  [5, 7, 'farmL', .04], [6, 8, 'farmR', .04],
  [9, 11, 'thighL', .07], [10, 12, 'thighR', .07],
  [11, 13, 'shinL', .05], [12, 14, 'shinR', .05],
];

// 42-point right-hand rest pose (canonical bind). Mirror X for left.
export const REST_R42 = [[-0.5444,-0.0146,-0.0642],[-0.5444,0.0861,-0.0661],[-0.5039,0.2035,-0.0832],[-0.4630,0.3090,-0.0951],[-0.4094,0.3828,-0.1013],[-0.3664,0.2333,-0.2469],[-0.3256,0.3046,-0.2561],[-0.2678,0.3497,-0.2329],[-0.1941,0.4165,-0.1704],[-0.3242,0.1728,-0.2354],[-0.2528,0.2412,-0.2539],[-0.1915,0.2954,-0.2142],[-0.1246,0.3386,-0.1585],[-0.2595,0.0978,-0.2171],[-0.2125,0.1275,-0.2089],[-0.1349,0.1732,-0.1740],[-0.0925,0.2225,-0.1185],[-0.2269,0.0154,-0.1584],[-0.1815,0.0349,-0.1444],[-0.1283,0.0696,-0.1028],[-0.0958,0.1168,-0.0554],[-0.6102,-0.0537,-0.2047],[-0.5915,0.1313,-0.1828],[-0.5333,0.2436,-0.1749],[-0.4564,0.3158,-0.1746],[-0.4143,0.3944,-0.1523],[-0.4259,0.2015,-0.3209],[-0.3284,0.3077,-0.3211],[-0.2496,0.3732,-0.2810],[-0.1874,0.4195,-0.2083],[-0.3597,0.1516,-0.3366],[-0.2364,0.2478,-0.3148],[-0.1824,0.3028,-0.2743],[-0.1113,0.3483,-0.2002],[-0.3156,0.0598,-0.3027],[-0.1900,0.1355,-0.2753],[-0.1200,0.1819,-0.2311],[-0.0725,0.2391,-0.1628],[-0.2717,0.0039,-0.2503],[-0.1635,0.0402,-0.2022],[-0.0999,0.0902,-0.1409],[-0.0666,0.1299,-0.0854]];
export const REST_L42 = REST_R42.map(p => [-p[0], p[1], p[2]]);

// MediaPipe model URLs (pinned)
export const MP_VERSION = '0.10.18';
export const HAND_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
export const POSE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

// Default hand model URL on jsDelivr (override in DEI.create({handModelUrl}))
export const DEFAULT_HAND_MODEL_URL = 'https://cdn.jsdelivr.net/gh/kennyAIrepo/dei-sdk@main/assets/holo_hands.glb';
