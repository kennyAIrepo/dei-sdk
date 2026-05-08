// Sketchfab download proxy. Returns the temporary signed URL for a model's
// downloadable archive (glb or gltf). Browser then fetches from that URL.
//
// GET /api/sketchfab/download?uid=<modelUid>
// → { glb?: {url,size}, gltf?: {url,size}, source?: {...}, usdz?: {...} }

export const config = { runtime: 'edge' };

const ALLOW_ORIGIN = '*';

export default async function handler(req) {
  const cors = {
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET')     return new Response('GET only', { status: 405, headers: cors });

  const url = new URL(req.url);
  const uid = url.searchParams.get('uid')?.trim();
  if (!uid) return new Response(JSON.stringify({ error: 'missing uid' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });

  const token = process.env.SKETCHFAB_API_TOKEN;
  if (!token) return new Response(JSON.stringify({ error: 'SKETCHFAB_API_TOKEN not configured' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });

  const upstream = await fetch(`https://api.sketchfab.com/v3/models/${encodeURIComponent(uid)}/download`, {
    headers: { 'Authorization': 'Token ' + token },
  });
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { ...cors, 'Content-Type': upstream.headers.get('content-type') || 'application/json' },
  });
}
