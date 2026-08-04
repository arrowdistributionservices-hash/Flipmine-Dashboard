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
    // Raised from 200 - this is now a debugging aid, not the primary data
    // source (see the stateful hashes below), but still useful for
    // inspecting exactly what Prep Brothers sent.
    await kv.ltrim('prepbrothers_raw_events', 0, 999);
  } catch (e) {
    console.error('Failed to log Prep Brothers webhook event', e);
    return res.status(500).json({ error: 'Failed to store event' });
  }

  // Maintain running state rather than relying on the event log to still
  // contain the last update for a given item/shipment - a rolling list
  // eventually evicts old entries, which would silently drop items/
  // shipments that haven't changed recently from any "current totals"
  // computed by scanning it. These hashes hold one current record per
  // item/shipment, keyed by Prep Brothers' own id, updated in place.
  try {
    const data = parsedBody?.data;
    if (eventType === 'item.stock_updated' && data?.id != null) {
      await kv.hset('prepbrothers_item_stock', {
        [data.id]: JSON.stringify({
          itemId: data.id,
          merchantSku: data.merchant_sku ?? null,
          title: data.title ?? null,
          quantityInStock: data.quantity_in_stock ?? null,
          availableQuantity: data.available_quantity ?? null,
          allocatedQuantity: data.allocated_quantity ?? null,
          unavailableQuantity: data.unavailable_quantity ?? null,
          inboundQuantity: data.inbound_quantity ?? null,
          updatedAt: data.updated_at ?? receivedAt,
        }),
      });
    } else if (eventType === 'inbound_shipment.received' && data?.id != null) {
      await kv.hset('prepbrothers_shipments', {
        [data.id]: JSON.stringify({
          shipmentId: data.id,
          name: data.name ?? null,
          referenceId: data.reference_id ?? null,
          status: data.status ?? null,
          warehouseName: data.warehouse?.name ?? null,
          shippedAt: data.shipped_at ?? null,
          receivedAt: data.received_at ?? null,
          checkedInAt: data.checked_in_at ?? null,
          eta: data.eta ?? null,
          notes: data.notes ?? null,
          items: (data.actual_items || []).map((it) => ({ itemId: it.item_id, quantity: it.quantity })),
          updatedAt: data.updated_at ?? receivedAt,
        }),
      });
    }
  } catch (e) {
    // Don't fail the webhook over this - the raw event is already saved
    // above and can be replayed/backfilled into these hashes later.
    console.error('Failed to update Prep Brothers running state', e);
  }

  return res.status(200).json({ ok: true });
}
