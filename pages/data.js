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
  let sourcing = { clients: [], global: { cost: 0, profit: 0, n: 0, roi: 0, corr_roi: 0 }, by_client: {}, sourcer_efficiency: {}, non_arris_outliers: [], total_count: 0 };
  let salesAccounts = {};

  try {
    const records = await fetchAllSourcingRecords();
    sourcing = buildSourcingDashboardData(records);
  } catch (e) {
    // sourcing fetch failed (e.g. sheet not shared publicly yet) — keep the safe defaults above
  }

  const kv = getKv();
  if (kv) {
    try {
      salesAccounts = (await kv.get('sales_accounts')) || {};
    } catch (e) {
      // database not reachable yet — keep sales empty rather than crashing
    }
  }

  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
  return res.status(200).json({ sourcing, sales: salesAccounts, generatedAt: new Date().toISOString() });
}
