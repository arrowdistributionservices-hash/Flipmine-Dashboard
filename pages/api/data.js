import { Redis } from '@upstash/redis';
import { fetchAllSourcingRecords, buildSourcingDashboardData } from '../../lib/sourcing';

const kv = Redis.fromEnv();

export default async function handler(req, res) {
  try {
    const [salesAccounts, sourcingRecords] = await Promise.all([
      kv.get('sales_accounts').then(v => v || {}),
      fetchAllSourcingRecords(),
    ]);
    const sourcing = buildSourcingDashboardData(sourcingRecords);

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    return res.status(200).json({ sourcing, sales: salesAccounts, generatedAt: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to build dashboard data', detail: String(e) });
  }
}
