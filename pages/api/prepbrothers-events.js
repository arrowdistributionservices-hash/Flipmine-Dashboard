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

// Read-only endpoint for inspecting raw Prep Brothers webhook events while
// we figure out their real payload shape. Once that's known, this will be
// replaced by an endpoint that returns computed on-hand / in-transit-to-WFS
// totals instead of a raw event list.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const kv = getKv();
  if (!kv) return res.status(200).json({ events: [], note: 'Redis not configured on this deployment' });

  let raw = [];
  try {
    raw = await kv.lrange('prepbrothers_raw_events', 0, 49);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to read events', detail: String(e) });
  }

  const events = raw
    .map((r) => {
      try {
        return typeof r === 'string' ? JSON.parse(r) : r;
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean);

  return res.status(200).json({ count: events.length, events });
}
