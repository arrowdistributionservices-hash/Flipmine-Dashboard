import { Redis } from '@upstash/redis';
import { fetchAllSourcingRecords, buildSourcingDashboardData, fetchDailyPurchasingSummary } from '../../lib/sourcing';

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

export default async function handler(req, res) {
  const wantDebug = req.query.debug === '1';
  const debugLog = wantDebug ? [] : null;

  let sourcing = { clients: [], global: { cost: 0, profit: 0, n: 0, roi: 0, corr_roi: 0 }, by_client: {}, sourcer_efficiency: {}, non_arris_outliers: [], brand_breakdown: [], total_count: 0 };
  let salesAccounts = {};
  let purchasingSummary = { daily: [], weekly: [] };
  let sourcingError = null;

  try {
    const records = await fetchAllSourcingRecords(debugLog);
    sourcing = buildSourcingDashboardData(records);
  } catch (e) {
    sourcingError = String(e);
  }

  try {
    purchasingSummary = await fetchDailyPurchasingSummary();
  } catch (e) {
    // leave purchasingSummary at empty default
  }

  const kv = getKv();
  if (kv) {
    try {
      salesAccounts = (await kv.get('sales_accounts')) || {};
    } catch (e) {
      // database not reachable yet — keep sales empty rather than crashing
    }
  }

  const payload = { sourcing, sales: salesAccounts, purchasing: purchasingSummary, generatedAt: new Date().toISOString() };
  if (wantDebug) { payload.debug = debugLog; payload.sourcingError = sourcingError; }

  res.setHeader('Cache-Control', wantDebug ? 'no-store' : 's-maxage=120, stale-while-revalidate=300');
  return res.status(200).json(payload);
}
