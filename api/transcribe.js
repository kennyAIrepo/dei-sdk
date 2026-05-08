// Vercel Edge Function — proxies audio to OpenAI Whisper.
// Auto-discovered by Vercel because it lives at /api/transcribe.js
// Env var required at deploy time: OPENAI_API_KEY
//
// Frontend hits this same-origin via fetch('/api/transcribe', { method:'POST', body: formData }).

export const config = { runtime: 'edge' };

// Same-origin request from your own page → CORS isn't enforced.
// Keep '*' until you find people stealing your URL; then lock to your Vercel domain.
const ALLOW_ORIGIN = '*';

export default async function handler(req) {
  const cors = {
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST')   return new Response('Method not allowed', { status: 405, headers: cors });

  const key = process.env.OPENAI_API_KEY;
  if (!key) return new Response('OPENAI_API_KEY not configured', { status: 500, headers: cors });

  const ct = req.headers.get('content-type') || '';
  if (!ct.startsWith('multipart/form-data')) {
    return new Response('expected multipart/form-data', { status: 400, headers: cors });
  }

  const upstream = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': ct },
    body: req.body,
  });
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { ...cors, 'Content-Type': upstream.headers.get('content-type') || 'application/json' },
  });
}
