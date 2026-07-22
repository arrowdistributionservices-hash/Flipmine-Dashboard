import { Redis } from '@upstash/redis';
import { fetchAllSourcingRecords, buildSourcingDashboardData } from '../../lib/sourcing';

function getKv() {
  try {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
    return Redis.fromEnv();
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  const wantDebug = req.query.debug === '1';
  const debugLog = wantDebug ? [] : null;

  let sourcing = { clients: [], global: { cost: 0, profit: 0, n: 0, roi: 0, corr_roi: 0 }, by_client: {}, sourcer_efficiency: {}, non_arris_outliers: [], total_count: 0 };
  let salesAccounts = {};
  let sourcingError = null;

  try {
    const records = await fetchAllSourcingRecords(debugLog);
    sourcing = buildSourcingDashboardData(records);
  } catch (e) {
    sourcingError = String(e);
  }

  const kv = getKv();
  if (kv) {
    try {
      salesAccounts = (await kv.get('sales_accounts')) || {};
    } catch (e) {
      // database not reachable yet — keep sales empty rather than crashing
    }
  }

  const payload = { sourcing, sales: salesAccounts, generatedAt: new Date().toISOString() };
  if (wantDebug) { payload.debug = debugLog; payload.sourcingError = sourcingError; }

  res.setHeader('Cache-Control', wantDebug ? 'no-store' : 's-maxage=120, stale-while-revalidate=300');
  return res.status(200).json(payload);
}
