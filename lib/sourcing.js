import Papa from 'papaparse';

const SHEET_ID = process.env.SOURCING_SHEET_ID || '1XR3kMnj-m4uDXPa7R7soHhtA6pplbkoa_H7WpqOeAoY';

const AUTO_FEED_TABS = ['Deals', 'Lego Deals', 'Google'];

const MANUAL_TABS = {
      'LEGO Manual Purchasing (Nabeel)': ['Nabeel', 'Walmart'],
      'Manual Purchasing (Hasan)': ['Hasan', 'Walmart'],
      'E2A (Manual Purchasing)': ['Hasan', 'Amazon'],
      'E2A (Manual Purchasing Nabeel)': ['Nabeel', 'Amazon'],
      'Faqahat E2A (Manual Purchasing)': ['Faqahat', 'Amazon'],
      'Faqahat E2W (Manual purchasing)': ['Faqahat', 'Walmart'],
};

async function fetchSheetCsv(sheetName) {
      const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch sheet tab "${sheetName}": ${res.status}`);
      const text = await res.text();
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
      return parsed.data.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.trim(), v])));
}

function normBought(v) {
      if (v === null || v === undefined) return '';
      return String(v).replace(/[\u00a0\u200b]/g, ' ').trim().toLowerCase();
}

function toF(x) {
      if (x === null || x === undefined || x === '') return null;
      const n = parseFloat(String(x).replace(/[$,]/g, ''));
      return isNaN(n) ? null : n;
}

function toRoi(x) {
      if (x === null || x === undefined || x === '') return null;
      const n = parseFloat(String(x).replace('%', ''));
      if (isNaN(n)) return null;
      return Math.abs(n) > 5 ? n / 100 : n;
}

export async function fetchAllSourcingRecords(debugLog) {
      const records = [];

  for (const sheet of AUTO_FEED_TABS) {
          let rows;
          try {
                    rows = await fetchSheetCsv(sheet);
                    if (debugLog) debugLog.push({ sheet, ok: true, rawRows: rows.length });
          } catch (e) {
                    if (debugLog) debugLog.push({ sheet, ok: false, error: String(e) });
                    continue;
          }
          let matched = 0;
          for (const r of rows) {
                    const bought = normBought(r['Bought (Y/N)']);
                    if (bought !== 'yes' && bought !== 'true') continue;
                    const client = (r['Client Name'] || '').trim();
                    if (!client) continue;
                    const cost = toF(r['Ebay Price'] ?? r['eBay Price']);
                    const profit = toF(r['Profit']);
                    const roi = toRoi(r['ROI']);
                    const walmartId = r['Walmart Item ID'];
                    const marketplace = walmartId ? 'Walmart' : 'Amazon';
                    const title = r['Ebay Title'] || r['eBay Title'] || null;
                    if (cost === null || profit === null) continue;
                    matched++;
                    records.push({ client, sourcer: 'Scraper/Automated', marketplace, cost, profit, roi, title, prep: 0, qty: 1 });
          }
          if (debugLog) debugLog[debugLog.length - 1].matchedBought = matched;
  }

  for (const [sheet, pair] of Object.entries(MANUAL_TABS)) {
          const sourcer = pair[0];
          const mkt = pair[1];
          let rows;
          try {
                    rows = await fetchSheetCsv(sheet);
                    if (debugLog) debugLog.push({ sheet, ok: true, rawRows: rows.length });
          } catch (e) {
                    if (debugLog) debugLog.push({ sheet, ok: false, error: String(e) });
                    continue;
          }
          let matched = 0;
          let boughtOnly = 0;
          for (const r of rows) {
                    const bought = normBought(r['Bought (Y/N)']);
                    if (bought !== 'yes' && bought !== 'true') continue;
                    const client = (r['Client Name'] || '').trim();
                    if (!client) continue;
                    boughtOnly++;
                    const qty = toF(r['Qty']) || 1;
                    const cost = toF(r['Total Cost']);
                    let profit = toF(r['Total Profit']);
                    if (profit === null) {
                                const pu = toF(r['Profit/unit']);
                                profit = pu !== null ? pu * qty : null;
                    }
                    const roi = toRoi(r['ROI']);
                    const prep = toF(r['Prep Cost']) || 0;
                    const title = r['eBay Title'] || r['eBay title'] || null;
                    if (cost === null || profit === null) continue;
                    matched++;
                    records.push({ client, sourcer, marketplace: mkt, cost, profit, roi, title, prep, qty });
          }
          if (debugLog) {
                    debugLog[debugLog.length - 1].matchedBought = matched;
                    debugLog[debugLog.length - 1].boughtAndClientOnly = boughtOnly;
          }
  }

  return records;
}

function corr(r) {
      if (r.sourcer === 'Scraper/Automated') return [r.cost, r.profit];
      const delta = (r.prep - 2) * r.qty;
      return [r.cost - delta, r.profit + delta];
}

function round2(n) { return Math.round(n * 100) / 100; }

function agg(rs) {
      const cost = rs.reduce((a, r) => a + r.cost, 0);
      const profit = rs.reduce((a, r) => a + r.profit, 0);
      const n = rs.length;
      const roi = cost ? profit / cost : 0;
      let ccost = 0, cprofit = 0;
      rs.forEach(r => { const pair = corr(r); ccost += pair[0]; cprofit += pair[1]; });
      const croi = ccost ? cprofit / ccost : 0;
      return { cost: round2(cost), profit: round2(profit), n, roi, corr_cost: round2(ccost), corr_profit: round2(cprofit), corr_roi: croi };
}

export function buildSourcingDashboardData(records) {
      const clients = Array.from(new Set(records.map(r => r.client))).sort();
      const sourcerOrder = ['Hasan', 'Nabeel', 'Faqahat', 'Scraper/Automated'];

  const global = agg(records);
      const byClient = {};
      clients.forEach(c => { byClient[c] = agg(records.filter(r => r.client === c)); });

  const byClientMkt = {};
      clients.forEach(c => {
              ['Amazon', 'Walmart'].forEach(m => {
                        const rs = records.filter(r => r.client === c && r.marketplace === m);
                        byClientMkt[c + '|' + m] = rs.length ? agg(rs) : { cost: 0, profit: 0, n: 0, roi: 0 };
              });
      });

  const byClientSrc = {};
      clients.forEach(c => {
              sourcerOrder.forEach(s => {
                        const rs = records.filter(r => r.client === c && r.sourcer === s);
                        byClientSrc[c + '|' + s] = rs.length ? agg(rs) : { cost: 0, profit: 0, n: 0, roi: 0 };
              });
      });

  const sourcerEfficiency = {};
      sourcerOrder.forEach(s => {
              const rs = records.filter(r => r.sourcer === s);
              const base = agg(rs);
              base.clients = Array.from(new Set(rs.map(r => r.client))).sort();
              sourcerEfficiency[s] = base;
      });

  const arrisPat = /arris/i;
      const withRoi = records.map(r => {
              const copy = Object.assign({}, r);
              copy.calc_roi = r.cost ? r.profit / r.cost : null;
              return copy;
                      }).filter(r => r.calc_roi !== null);

  const nonArris = withRoi
        .filter(r => !r.title || !arrisPat.test(r.title))
        .sort((a, b) => b.calc_roi - a.calc_roi)
        .slice(0, 25)
        .map(r => ({ client: r.client, sourcer: r.sourcer, title: r.title, cost: round2(r.cost), profit: round2(r.profit), roi: r.calc_roi }));

  return {
          clients: clients,
          global: global,
          by_client: byClient,
          by_client_mkt: byClientMkt,
          by_client_src: byClientSrc,
          sourcer_efficiency: sourcerEfficiency,
          non_arris_outliers: nonArris,
          total_count: records.length,
          fetchedAt: new Date().toISOString()
  };
}
