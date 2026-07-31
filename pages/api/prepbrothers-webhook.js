import { Redis } from '@upstash/redis';
import crypto from 'crypto';

// Disable Next's default body parser so we can read the exact raw bytes
// Prep Brothers sent - HMAC signatures are computed over the raw payload,
// and re-serializing a parsed JSON object can produce different bytes
// (key order, whitespace) that would make a correct signature look invalid.
export const config = { api: { bodyParser: false } };

function getKv() {
  try {
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;
    return new Redis({ url, token });
  } catch (e) {
    return null;
  }
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// We don't yet know which header Prep Brothers puts their signature in, so
// this collects every header that looks signature-related rather than
// guessing one name - once a real event lands, /api/prepbrothers-events
// will show us the real header name and we can lock verification to it.
function collectCandidateSignatureHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (/sign|hmac|webhook|secret/i.test(key)) out[key] = value;
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const kv = getKv();
  if (!kv) return res.status(500).json({ error: 'Redis not configured on this deployment' });

  const rawBody = await readRawBody(req);
  let parsedBody = null;
  try { parsedBody = JSON.parse(rawBody); } catch (e) { /* keep raw only */ }

  const secret = process.env.PREPBROTHERS_WEBHOOK_SECRET || null;
  const candidateSigHeaders = collectCandidateSignatureHeaders(req.headers);
  let computedHmac = null;
  if (secret) {
    computedHmac = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  }

  const receivedAt = new Date().toISOString();
  const eventType = parsedBody?.type || parsedBody?.event || parsedBody?.eventType || parsedBody?.webhookType || 'unknown';

  try {
    await kv.lpush('prepbrothers_raw_events', JSON.stringify({
      receivedAt,
      eventType,
      body: parsedBody ?? rawBody,
      candidateSigHeaders,
      computedHmac, // compare this by eye against candidateSigHeaders once secret is set
    }));
    await kv.ltrim('prepbrothers_raw_events', 0, 199);
  } catch (e) {
    console.error('Failed to log Prep Brothers webhook event', e);
    return res.status(500).json({ error: 'Failed to store event' });
  }

  return res.status(200).json({ ok: true });
}
