// Cloudflare Worker — proxies audio to OpenAI Whisper.
// Deploy:  wrangler deploy   (or paste into the dashboard editor)
// Secret:  wrangler secret put OPENAI_API_KEY
//
// Frontend usage:
//   DEI.create({ voice: { transcribeUrl: 'https://your-worker.workers.dev/transcribe' } })
//
// Restrict CORS to your origin in production (replace ALLOW_ORIGIN below).

const ALLOW_ORIGIN = '*';                               // e.g. 'https://your-user.github.io'
const ALLOW_REFERERS = [];                              // e.g. ['https://your-user.github.io/']
const RATE_LIMIT_PER_MIN = 30;                          // per-IP soft cap (requires KV; optional)

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': ALLOW_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST')   return new Response('Method not allowed', { status: 405, headers: cors });

    if (ALLOW_REFERERS.length) {
      const ref = request.headers.get('referer') || '';
      if (!ALLOW_REFERERS.some(a => ref.startsWith(a))) {
        return new Response('forbidden', { status: 403, headers: cors });
      }
    }

    if (!env.OPENAI_API_KEY) {
      return new Response('OPENAI_API_KEY not configured', { status: 500, headers: cors });
    }

    // Optional: simple per-IP rate limit using a Workers KV namespace bound as RATE_KV.
    if (env.RATE_KV) {
      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      const minute = Math.floor(Date.now() / 60000);
      const key = `rl:${ip}:${minute}`;
      const cur = parseInt(await env.RATE_KV.get(key) || '0', 10);
      if (cur >= RATE_LIMIT_PER_MIN) return new Response('rate limited', { status: 429, headers: cors });
      await env.RATE_KV.put(key, String(cur + 1), { expirationTtl: 65 });
    }

    const ct = request.headers.get('content-type') || '';
    if (!ct.startsWith('multipart/form-data')) {
      return new Response('expected multipart/form-data', { status: 400, headers: cors });
    }

    // Stream the multipart body straight through to OpenAI.
    const upstream = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.OPENAI_API_KEY,
        'Content-Type': ct,
      },
      body: request.body,
    });

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { ...cors, 'Content-Type': upstream.headers.get('content-type') || 'application/json' },
    });
  },
};
