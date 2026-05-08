// Vercel Edge Function — proxies audio to OpenAI Whisper.
// File location: /api/transcribe.js  (then deploy with `vercel`)
// Set env var:    OPENAI_API_KEY
//
// Frontend usage:
//   DEI.create({ voice: { transcribeUrl: '/api/transcribe' } })
//
// Restrict ALLOW_ORIGIN below in production.

export const config = { runtime: 'edge' };

const ALLOW_ORIGIN = '*';   // e.g. 'https://your-domain.com'

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
