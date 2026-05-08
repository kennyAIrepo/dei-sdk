// Sketchfab search proxy. Holds SKETCHFAB_API_TOKEN server-side.
// GET /api/sketchfab/search?q=basketball&count=24

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
  const q = url.searchParams.get('q')?.trim();
  if (!q) return new Response(JSON.stringify({ error: 'missing q' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });

  const count = Math.min(parseInt(url.searchParams.get('count') || '24', 10), 50);
  const downloadable = url.searchParams.get('downloadable') !== 'false';

  const params = new URLSearchParams({
    type: 'models',
    q,
    count: String(count),
    sort_by: '-likeCount',
  });
  if (downloadable) params.set('downloadable', 'true');
  // Filter out adult / restricted content for a public demo.
  params.set('staffpicked', 'false');

  const token = process.env.SKETCHFAB_API_TOKEN;
  const headers = {};
  if (token) headers['Authorization'] = 'Token ' + token;

  const upstream = await fetch(`https://api.sketchfab.com/v3/search?${params}`, { headers });
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { ...cors, 'Content-Type': upstream.headers.get('content-type') || 'application/json' },
  });
}
