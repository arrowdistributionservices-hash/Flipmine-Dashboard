import { Redis } from '@upstash/redis';

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

// Prep Brothers webhook receiver. We don't have their payload schema
// documented anywhere, so this deliberately does the minimum safe thing:
// log every raw event as-is, keyed by receipt time. Once real events have
// landed here, /api/prepbrothers-events can be inspected to see the real
// shape, and a follow-up pass will turn this into actual on-hand /
// in-transit-to-WFS totals instead of a raw log.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const kv = getKv();
  if (!kv) return res.status(500).json({ error: 'Redis not configured on this deployment' });

  const receivedAt = new Date().toISOString();
  const body = req.body;
  const eventType = body?.type || body?.event || body?.eventType || body?.webhookType || 'unknown';

  try {
    await kv.lpush('prepbrothers_raw_events', JSON.stringify({ receivedAt, eventType, body }));
    await kv.ltrim('prepbrothers_raw_events', 0, 199); // keep the most recent 200 events
  } catch (e) {
    console.error('Failed to log Prep Brothers webhook event', e);
    return res.status(500).json({ error: 'Failed to store event' });
  }

  return res.status(200).json({ ok: true });
}
