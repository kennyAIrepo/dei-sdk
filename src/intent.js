// Regex-first intent parser. Detects "give me X / spawn X / I want X / show me X"
// and extracts the noun. Cheap, deterministic, no API call.
//
// For ambiguous phrasing, you can layer an LLM fallback on top — but for direct
// "give me a basketball" / "spawn ice cream" the regex is enough.

const SPAWN_VERBS = '(give me|spawn|create|make|i (?:want|need)|gimme|show me|bring me|fetch me|find me|get me|i\'?d like|let me have|drop|conjure)';
const ARTICLE = '(?:a |an |some |the |me )?';
const SPAWN_RE = new RegExp(`\\b${SPAWN_VERBS}\\b\\s*${ARTICLE}([^,;.\\n!?]+)`, 'i');

export function parseSpawnIntent(text) {
  if (!text) return null;
  const m = text.match(SPAWN_RE);
  if (!m) return null;
  let raw = m[2].trim();
  // Strip filler/qualifier prefixes that slip through
  raw = raw.replace(/^(please |maybe |actually |another |one more |a few )/i, '').trim();
  // Take only the first thing if user listed multiples ("a ball, an apple")
  const first = raw.split(/\s*(?:,|\band\b)\s*/i)[0]?.trim();
  if (!first) return null;
  // Drop trailing filler ("for me", "right now")
  const noun = first.replace(/\s+(for me|please|right now|here|now)$/i, '').trim();
  if (!noun || noun.length > 60) return null;
  return { intent: 'spawn', target: noun };
}

// Optional remote LLM fallback — only call when regex misses and you really
// want to handle weird phrasing. Hits POST /api/intent on your Vercel proxy.
// (Not wired by default to keep zero-cost path zero-cost.)
export async function parseIntentRemote(text, endpoint = '/api/intent') {
  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (j?.intent === 'spawn' && j.target) return j;
    return null;
  } catch { return null; }
}
