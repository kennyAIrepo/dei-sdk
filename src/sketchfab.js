// Sketchfab client. Talks to YOUR proxy (which holds the Sketchfab API token),
// not directly to Sketchfab — same secrecy pattern as the OpenAI proxy.
//
// Proxy endpoints expected:
//   GET  /api/sketchfab/search?q=<query>&count=24
//   GET  /api/sketchfab/download?uid=<modelUid>
//
// Returns models normalized to:
//   { uid, name, thumbnail, author, license, viewerUrl }

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function searchModels(query, {
  searchUrl = '/api/sketchfab/search',
  count = 24,
  downloadable = true,
} = {}) {
  const params = new URLSearchParams({ q: query, count: String(count), downloadable: String(downloadable) });
  const r = await fetch(`${searchUrl}?${params}`);
  if (!r.ok) throw new Error('sketchfab search failed: ' + r.status);
  const j = await r.json();
  return (j.results || []).map(normalizeResult).filter(Boolean);
}

function normalizeResult(m) {
  if (!m || !m.uid) return null;
  // Sketchfab returns thumbnails.images sorted descending by size.
  const thumbs = m.thumbnails?.images || [];
  const small = pickThumb(thumbs, 256);
  const large = pickThumb(thumbs, 720);
  return {
    uid: m.uid,
    name: m.name || 'untitled',
    thumbnail: small,
    thumbnailLarge: large,
    author: m.user?.username || '',
    license: m.license?.slug || '',
    viewerUrl: m.viewerUrl || `https://sketchfab.com/3d-models/${m.uid}`,
    raw: m,
  };
}

function pickThumb(images, target) {
  if (!images.length) return null;
  let best = images[0];
  for (const img of images) {
    if (img.width <= target && img.width > (best.width || 0)) best = img;
  }
  return best.url;
}

// Resolve a model UID → a temporary signed download URL via your proxy.
// Returns { url, format: 'glb'|'gltf' } where 'gltf' indicates a zipped archive.
export async function getDownloadInfo(uid, { downloadUrl = '/api/sketchfab/download' } = {}) {
  const r = await fetch(`${downloadUrl}?uid=${encodeURIComponent(uid)}`);
  if (!r.ok) throw new Error('sketchfab download lookup failed: ' + r.status);
  const j = await r.json();
  if (j.glb?.url)  return { url: j.glb.url,  format: 'glb' };
  if (j.gltf?.url) return { url: j.gltf.url, format: 'gltf' };
  throw new Error('no usable download flavor on this model');
}

// Loads a Sketchfab download into a Three.js Group. Handles direct .glb and zipped gltf.
// Returns { group, gltf } — `group` is a centered, normalized-scale Object3D.
export async function loadModel(uid, opts = {}) {
  const info = await getDownloadInfo(uid, opts);
  const loader = new GLTFLoader();
  let gltf;
  if (info.format === 'glb') {
    gltf = await new Promise((res, rej) => loader.load(info.url, res, undefined, rej));
  } else {
    gltf = await loadZippedGltf(info.url, loader);
  }
  const group = normalize(gltf.scene, opts.targetSize ?? 0.3);
  return { group, gltf };
}

// Center + uniform-scale so the largest dimension equals `targetSize`.
function normalize(root, targetSize) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = targetSize / maxDim;
  root.position.sub(center);
  const wrap = new THREE.Group();
  wrap.add(root);
  wrap.scale.setScalar(scale);
  // Apply doubleSide on materials — Sketchfab models often have one-sided geom.
  wrap.traverse(c => { if (c.isMesh && c.material) c.material.side = THREE.DoubleSide; });
  return wrap;
}

// Zipped glTF support. Lazy-imports JSZip so it's only paid when needed.
async function loadZippedGltf(url, loader) {
  const JSZipMod = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
  const JSZip = JSZipMod.default || JSZipMod;
  const buf = await fetch(url).then(r => r.arrayBuffer());
  const zip = await JSZip.loadAsync(buf);
  let gltfPath = null;
  zip.forEach((p) => { if (!gltfPath && /\.gltf$/i.test(p)) gltfPath = p; });
  if (!gltfPath) throw new Error('no .gltf in archive');
  const gltfText = await zip.file(gltfPath).async('string');

  // Build a virtual file map for buffers/textures.
  const dir = gltfPath.includes('/') ? gltfPath.replace(/[^/]+$/, '') : '';
  const blobUrls = new Map();
  await Promise.all(Object.keys(zip.files).map(async (name) => {
    if (name === gltfPath || zip.files[name].dir) return;
    const blob = await zip.files[name].async('blob');
    blobUrls.set(name, URL.createObjectURL(blob));
  }));

  // Patch URIs in the glTF JSON to point at the blob URLs.
  const gltf = JSON.parse(gltfText);
  const remap = (uri) => {
    if (!uri || uri.startsWith('data:')) return uri;
    const candidates = [uri, dir + uri, uri.replace(/^\.\//, '')];
    for (const c of candidates) {
      if (blobUrls.has(c)) return blobUrls.get(c);
      const tail = c.split('/').pop();
      for (const k of blobUrls.keys()) if (k.endsWith('/' + tail) || k === tail) return blobUrls.get(k);
    }
    return uri;
  };
  (gltf.buffers || []).forEach(b => { if (b.uri) b.uri = remap(b.uri); });
  (gltf.images  || []).forEach(i => { if (i.uri) i.uri = remap(i.uri); });

  const patched = new Blob([JSON.stringify(gltf)], { type: 'model/gltf+json' });
  const patchedUrl = URL.createObjectURL(patched);
  return new Promise((res, rej) => loader.load(patchedUrl, (g) => {
    URL.revokeObjectURL(patchedUrl);
    blobUrls.forEach(u => URL.revokeObjectURL(u));
    res(g);
  }, undefined, rej));
}
