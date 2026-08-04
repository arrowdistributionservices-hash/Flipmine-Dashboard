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

function parseHashValues(obj) {
  return Object.values(obj || {}).map((v) => {
    try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return null; }
  }).filter(Boolean);
}

// Backfill: replay the raw event log into the running-state hashes,
// keeping only the newest record per item/shipment id. This is what makes
// events captured before the stateful hashes existed (and any gap if the
// webhook write ever fails) show up here too - safe to run on every call,
// since it only overwrites a hash entry when the replayed event is
// actually newer than what's already stored.
async function backfillFromRawEvents(kv) {
  let raw = [];
  try {
    raw = await kv.lrange('prepbrothers_raw_events', 0, 999);
  } catch (e) {
    return; // hashes are still readable even if this fails
  }

  const events = raw.map((r) => {
    try { return typeof r === 'string' ? JSON.parse(r) : r; } catch (e) { return null; }
  }).filter(Boolean);

  const latestStock = new Map(); // itemId -> {record, ts}
  const latestShipment = new Map(); // shipmentId -> {record, ts}

  for (const e of events) {
    const type = e.eventType;
    const data = e.body?.data;
    if (!data || data.id == null) continue;
    const ts = new Date(data.updated_at || e.receivedAt || 0).getTime();

    if (type === 'item.stock_updated') {
      const cur = latestStock.get(data.id);
      if (!cur || ts > cur.ts) {
        latestStock.set(data.id, {
          ts,
          record: {
            itemId: data.id,
            merchantSku: data.merchant_sku ?? null,
            title: data.title ?? null,
            quantityInStock: data.quantity_in_stock ?? null,
            availableQuantity: data.available_quantity ?? null,
            allocatedQuantity: data.allocated_quantity ?? null,
            unavailableQuantity: data.unavailable_quantity ?? null,
            inboundQuantity: data.inbound_quantity ?? null,
            updatedAt: data.updated_at ?? e.receivedAt,
          },
        });
      }
    } else if (type === 'inbound_shipment.received') {
      const cur = latestShipment.get(data.id);
      if (!cur || ts > cur.ts) {
        latestShipment.set(data.id, {
          ts,
          record: {
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
            updatedAt: data.updated_at ?? e.receivedAt,
          },
        });
      }
    }
  }

  // Merge against what's already in the hashes (existing hash entries win
  // unless the replayed one is strictly newer), then write back only what
  // changed.
  const existingStock = parseHashValues(await kv.hgetall('prepbrothers_item_stock'));
  const existingShipments = parseHashValues(await kv.hgetall('prepbrothers_shipments'));
  const existingStockById = new Map(existingStock.map((r) => [r.itemId, r]));
  const existingShipmentById = new Map(existingShipments.map((r) => [r.shipmentId, r]));

  const stockWrites = {};
  for (const [id, { record }] of latestStock) {
    const existing = existingStockById.get(id);
    const existingTs = existing ? new Date(existing.updatedAt || 0).getTime() : -1;
    if (!existing || new Date(record.updatedAt || 0).getTime() > existingTs) {
      stockWrites[id] = JSON.stringify(record);
    }
  }
  if (Object.keys(stockWrites).length) await kv.hset('prepbrothers_item_stock', stockWrites);

  const shipmentWrites = {};
  for (const [id, { record }] of latestShipment) {
    const existing = existingShipmentById.get(id);
    const existingTs = existing ? new Date(existing.updatedAt || 0).getTime() : -1;
    if (!existing || new Date(record.updatedAt || 0).getTime() > existingTs) {
      shipmentWrites[id] = JSON.stringify(record);
    }
  }
  if (Object.keys(shipmentWrites).length) await kv.hset('prepbrothers_shipments', shipmentWrites);
}

// Computed on-hand / in-transit-to-WFS totals, built from Prep Brothers'
// webhook activity (see prepbrothers-webhook.js). This is necessarily a
// partial picture, not a guaranteed-complete inventory count: it only knows
// about items/shipments that have actually triggered a webhook event since
// the integration started - anything that hasn't changed since then simply
// hasn't been reported to us yet. `itemsTracked` / `shipmentsTracked` are
// included so callers can show how much data this is actually based on.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const kv = getKv();
  if (!kv) {
    return res.status(200).json({
      configured: false,
      note: 'Redis not configured on this deployment',
    });
  }

  try {
    await backfillFromRawEvents(kv);

    const stockRecords = parseHashValues(await kv.hgetall('prepbrothers_item_stock'));
    const shipmentRecords = parseHashValues(await kv.hgetall('prepbrothers_shipments'));

    const onHandUnits = stockRecords.reduce((a, r) => a + (Number(r.quantityInStock) || 0), 0);
    const availableUnits = stockRecords.reduce((a, r) => a + (Number(r.availableQuantity) || 0), 0);
    const allocatedUnits = stockRecords.reduce((a, r) => a + (Number(r.allocatedQuantity) || 0), 0);

    // A shipment is treated as WFS-bound if Prep Brothers' own shipment name
    // says so (their naming convention, e.g. "WFS - eBay #09-14934-38000") -
    // there's no separate explicit flag for this in the webhook payload.
    const wfsShipments = shipmentRecords.filter((s) => /wfs/i.test(s.name || ''));
    const wfsInboundUnits = wfsShipments.reduce(
      (a, s) => a + (s.items || []).reduce((sa, it) => sa + (Number(it.quantity) || 0), 0),
      0
    );
    // "Still inbound" (not yet checked in / processed) vs already checked in
    // at the prep warehouse - both are pre-WFS, but this distinguishes
    // what's freshly landed from what's been sitting processed.
    const wfsAwaitingCheckIn = wfsShipments.filter((s) => !s.checkedInAt);
    const wfsAwaitingCheckInUnits = wfsAwaitingCheckIn.reduce(
      (a, s) => a + (s.items || []).reduce((sa, it) => sa + (Number(it.quantity) || 0), 0),
      0
    );

    const latestActivityAt = [...stockRecords, ...shipmentRecords]
      .map((r) => r.updatedAt)
      .filter(Boolean)
      .sort()
      .slice(-1)[0] || null;

    return res.status(200).json({
      configured: true,
      prepWarehouse: {
        onHandUnits,
        availableUnits,
        allocatedUnits,
        itemsTracked: stockRecords.length,
      },
      wfsInbound: {
        totalUnits: wfsInboundUnits,
        totalShipments: wfsShipments.length,
        awaitingCheckInUnits: wfsAwaitingCheckInUnits,
        awaitingCheckInShipments: wfsAwaitingCheckIn.length,
      },
      shipmentsTracked: shipmentRecords.length,
      latestActivityAt,
      note: 'Based on Prep Brothers webhook activity only - items/shipments with no reported change since the integration started are not reflected. Coverage grows over time.',
    });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
