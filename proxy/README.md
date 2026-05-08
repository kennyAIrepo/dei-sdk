# Voice proxy

A tiny serverless function that holds your OpenAI API key server-side. The browser never sees it; it just POSTs audio to your endpoint, your endpoint POSTs to OpenAI.

```
Browser ──audio──▶ /api/transcribe (proxy) ──audio + key──▶ OpenAI Whisper
                                  ◀──text─────────
```

Pick **one** of the two templates below. Both accept the same multipart body and return the same JSON shape, so the SDK side doesn't change.

---

## Cloudflare Worker (recommended for static-hosted demos)

[cloudflare-worker.js](./cloudflare-worker.js) — single file, deploys in ~60 seconds.

### Deploy

1. `npm install -g wrangler && wrangler login`
2. `mkdir dei-proxy && cd dei-proxy`
3. Copy `cloudflare-worker.js` into the folder, rename to `src/index.js`.
4. Create `wrangler.toml`:
   ```toml
   name = "dei-proxy"
   main = "src/index.js"
   compatibility_date = "2024-01-01"
   ```
5. `wrangler secret put OPENAI_API_KEY` → paste your `sk-...`
6. `wrangler deploy`

You get a URL like `https://dei-proxy.YOUR-SUBDOMAIN.workers.dev`. Pass it to the SDK:
```js
DEI.create({
  voice: { transcribeUrl: 'https://dei-proxy.YOUR-SUBDOMAIN.workers.dev' },
});
```

### Lock it down (do this before sharing the link)

In `cloudflare-worker.js`:
```js
const ALLOW_ORIGIN = 'https://your-user.github.io';     // not '*'
const ALLOW_REFERERS = ['https://your-user.github.io/'];
```
Optional: bind a Workers KV namespace as `RATE_KV` for per-IP rate limiting (already wired).

---

## Vercel Edge Function

[vercel-edge.js](./vercel-edge.js) — drop into `/api/transcribe.js` of any Vercel project.

### Deploy

1. `npm install -g vercel`
2. Place `vercel-edge.js` at `api/transcribe.js`.
3. `vercel env add OPENAI_API_KEY` → paste your key.
4. `vercel deploy --prod`

Frontend:
```js
DEI.create({ voice: { transcribeUrl: '/api/transcribe' } });
```
(Same-origin path works because the SPA and the function are served by the same project.)

---

## Cost / abuse protection

Whisper is cheap (~$0.006/min) but unbounded keys are still a liability. Apply at least one:

| Layer | What | How |
|---|---|---|
| Origin pin | Reject requests not from your domain | `ALLOW_ORIGIN` + `ALLOW_REFERERS` |
| Rate limit | Cap per-IP req/min | Cloudflare KV (wired) or Cloudflare WAF |
| Auth | Require a session token | Add `Authorization: Bearer <token>` check; mint tokens from your auth flow |
| Length cap | Reject huge blobs | Add `Content-Length` check before forwarding |

For a public demo on GitHub Pages, origin pin + rate limit is usually enough.

---

## Why proxy at all?

If you ship the OpenAI key in a static HTML file (the original `dei_config.js` did this), anyone who opens View Source can use it. They can rack up your bill, or just use it for unrelated requests. The proxy is the only way to share a public link AND keep voice working AND keep the key secret.
