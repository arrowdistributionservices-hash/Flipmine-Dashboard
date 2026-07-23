import Papa from 'papaparse';

const SHEET_ID = process.env.SOURCING_SHEET_ID || '1XR3kMnj-m4uDXPa7R7soHhtA6pplbkoa_H7WpqOeAoY';

const AUTO_FEED_TABS = ['Deals', 'Lego Deals', 'Google']; // Scraper/Automated — only these 3 have Bought/Client Name columns

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
  // Some sheet tabs have stray leading/trailing spaces in header names (e.g. " Total Cost ").
  // Normalize every row's keys to their trimmed form so lookups like r['Total Cost'] work regardless.
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
  return Math.abs(n) > 5 ? n / 100 : n; // handle "73%" text vs 0.73 fraction
}

export async function fetchAllSourcingRecords(debugLog) {
  const records = [];

  for (const sheet of AUTO_FEED_TABS) {
    let rows;
    try {
      rows = await fetchSheetCsv(sheet);
      if (debugLog) debugLog.push({ sheet, ok: true, rawRows: rows.length, headers: rows[0] ? Object.keys(rows[0]) : [] });
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
    if (debugLog && rows[0]) {
      debugLog[debugLog.length - 1].sampleBoughtValues = rows.slice(0, 8).map(r => JSON.stringify(r['Bought (Y/N)']));
      debugLog[debugLog.length - 1].sampleClientValues = rows.slice(0, 8).map(r => JSON.stringify(r['Client Name']));
      debugLog[debugLog.length - 1].samplePriceValues = rows.slice(0, 8).map(r => JSON.stringify(r['Ebay Price'] ?? r['eBay Price']));
      debugLog[debugLog.length - 1].sampleProfitValues = rows.slice(0, 8).map(r => JSON.stringify(r['Profit']));
    }
  }

  for (const [sheet, [sourcer, mkt]] of Object.entries(MANUAL_TABS)) {
    let rows;
    try {
      rows = await fetchSheetCsv(sheet);
      if (debugLog) debugLog.push({ sheet, ok: true, rawRows: rows.length, headers: rows[0] ? Object.keys(rows[0]) : [] });
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
      debugLog[debugLog.length - 1].sampleBoughtValues = rows.slice(0, 8).map(r => JSON.stringify(r['Bought (Y/N)']));
      debugLog[debugLog.length - 1].sampleClientValues = rows.slice(0, 8).map(r => JSON.stringify(r['Client Name']));
      debugLog[debugLog.length - 1].sampleTotalCostValues = rows.slice(0, 8).map(r => JSON.stringify(r['Total Cost']));
      debugLog[debugLog.length - 1].sampleTotalProfitValues = rows.slice(0, 8).map(r => JSON.stringify(r['Total Profit']));
      debugLog[debugLog.length - 1].sampleQtyValues = rows.slice(0, 8).map(r => JSON.stringify(r['Qty']));
      // also show these fields specifically from rows that ARE marked bought+client, wherever they are in the sheet
      const boughtRows = rows.filter(r => {
        const b = normBought(r['Bought (Y/N)']);
        return (b === 'yes' || b === 'true') && (r['Client Name'] || '').trim();
      }).slice(0, 5);
      debugLog[debugLog.length - 1].boughtRowsSample = boughtRows.map(r => ({
        totalCost: JSON.stringify(r['Total Cost']),
        totalProfit: JSON.stringify(r['Total Profit']),
        qty: JSON.stringify(r['Qty']),
        profitPerUnit: JSON.stringify(r['Profit/unit']),
      }));
    }
  }

  return records;
}

function corr(r) {
  if (r.sourcer === 'Scraper/Automated') return [r.cost, r.profit];
  const delta = (r.prep - 2) * r.qty;
  return [r.cost - delta, r.profit + delta];
}

function agg(rs) {
  const cost = rs.reduce((a, r) => a + r.cost, 0);
  const profit = rs.reduce((a, r) => a + r.profit, 0);
  const n = rs.length;
  const roi = cost ? profit / cost : 0;
  let ccost = 0, cprofit = 0;
  rs.forEach(r => { const [cc, cp] = corr(r); ccost += cc; cprofit += cp; });
  const croi = ccost ? cprofit / ccost : 0;
  return { cost: round2(cost), profit: round2(profit), n, roi, corr_cost: round2(ccost), corr_profit: round2(cprofit), corr_roi: croi };
}
function round2(n) { return Math.round(n * 100) / 100; }

export function buildSourcingDashboardData(records) {
  const clients = [...new Set(records.map(r => r.client))].sort();
  const sourcerOrder = ['Hasan', 'Nabeel', 'Faqahat', 'Scraper/Automated'];

  const global = agg(records);
  const byClient = {}; clients.forEach(c => byClient[c] = agg(records.filter(r => r.client === c)));

  const byClientMkt = {};
  clients.forEach(c => ['Amazon', 'Walmart'].forEach(m => {
    const rs = records.filter(r => r.client === c && r.marketplace === m);
    byClientMkt[`${c}|${m}`] = rs.length ? agg(rs) : { cost: 0, profit: 0, n: 0, roi: 0 };
  }));

  const byClientSrc = {};
  clients.forEach(c => sourcerOrder.forEach(s => {
    const rs = records.filter(r => r.client === c && r.sourcer === s);
    byClientSrc[`${c}|${s}`] = rs.length ? agg(rs) : { cost: 0, profit: 0, n: 0, roi: 0 };
  }));

  const sourcerEfficiency = {};
  sourcerOrder.forEach(s => {
    const rs = records.filter(r => r.sourcer === s);
    sourcerEfficiency[s] = { ...agg(rs), clients: [...new Set(rs.map(r => r.client))].sort() };
  });

  const arrisPat = /arris/i;
  const withRoi = records.map(r => ({ ...r, calc_roi: r.cost ? r.profit / r.cost : null })).filter(r => r.calc_roi !== null);
  const nonArris = withRoi.filter(r => !r.title || !arrisPat.test(r.title)).sort((a, b) => b.calc_roi - a.calc_roi).slice(0, 25)
    .map(r => ({ client: r.client, sourcer: r.sourcer, title: r.title, cost: round2(r.cost), profit: round2(r.profit), roi: r.calc_roi }));

  const brandBreakdown = buildBrandBreakdown(records);

  return { clients, global, by_client: byClient, by_client_mkt: byClientMkt, by_client_src: byClientSrc,
           sourcer_efficiency: sourcerEfficiency, non_arris_outliers: nonArris, total_count: records.length,
           brand_breakdown: brandBreakdown, fetchedAt: new Date().toISOString() };
}

// ---------------- Brand breakdown ----------------
const BRAND_PATTERNS = [
  ['ARRIS', /arris/i],
  ['LEGO', /lego/i],
  ['Google', /\b(google|nest)\b/i],
  ['Honeywell', /honeywell/i],
];

function buildBrandBreakdown(records) {
  const buckets = {};
  BRAND_PATTERNS.forEach(([name]) => { buckets[name] = []; });
  records.forEach(r => {
    if (!r.title) return;
    for (const [name, pat] of BRAND_PATTERNS) {
      if (pat.test(r.title)) { buckets[name].push(r); break; } // first match wins, brands are mutually exclusive here
    }
  });
  return BRAND_PATTERNS.map(([name]) => {
    const rs = buckets[name];
    const a = agg(rs);
    return { brand: name, n: a.n, cost: a.cost, profit: a.profit, roi: a.roi };
  }).filter(b => b.n > 0).sort((a, b) => b.profit - a.profit);
}

// ---------------- Daily / Weekly Purchasing Summary tab ----------------
function toNum(x) {
  if (x === null || x === undefined || x === '') return null;
  const n = parseFloat(String(x).replace(/[$,]/g, ''));
  return isNaN(n) ? null : n;
}

export async function fetchDailyPurchasingSummary(debug) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent('Daily Purchasing Summary')}`;
  let rows;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const text = await res.text();
    const parsed = Papa.parse(text, { header: false, skipEmptyLines: false });
    rows = parsed.data;
  } catch (e) {
    return { daily: [], weekly: [], bySource: {}, error: String(e) };
  }

  const block2HeaderIdx = rows.findIndex(r => r && typeof r[0] === 'string' && r[0].toLowerCase().includes("faqahat's sourcing"));

  const perSourceDaily = { Nabeel: {}, Hasan: {}, Faqahat: {}, Google: {} };
  const weekly = [];

  const addDay = (bucket, date, purchasing, profit) => {
    if (!date || purchasing === null) return;
    const key = String(date);
    if (!bucket[key]) bucket[key] = { purchasing: 0, profit: 0 };
    bucket[key].purchasing += purchasing;
    bucket[key].profit += profit || 0;
  };

  for (let i = 2; i < (block2HeaderIdx > 0 ? block2HeaderIdx - 2 : rows.length); i++) {
    const row = rows[i];
    if (!row) continue;
    addDay(perSourceDaily.Nabeel, row[0], toNum(row[1]), toNum(row[2]));
    addDay(perSourceDaily.Hasan, row[5], toNum(row[6]), toNum(row[7]));
    const week = row[15];
    const totalWeek = toNum(row[18]);
    if (week && totalWeek !== null) {
      weekly.push({ week, e2aE2w: toNum(row[16]), wholesale: toNum(row[17]), total: totalWeek });
    }
  }

  const debugInfo = { block2HeaderIdx, totalRows: rows.length };
  if (block2HeaderIdx >= 0) {
    debugInfo.block2TitleRow = rows[block2HeaderIdx];
    debugInfo.block2HeaderRow = rows[block2HeaderIdx + 1];
    debugInfo.block2FirstDataRow = rows[block2HeaderIdx + 2];
    debugInfo.block2LastFewRows = rows.slice(-3);
    for (let i = block2HeaderIdx + 2; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      addDay(perSourceDaily.Faqahat, row[0], toNum(row[1]), toNum(row[2]));
      addDay(perSourceDaily.Google, row[5], toNum(row[6]), toNum(row[7]));
    }
  }
  debugInfo.faqahatCount = Object.keys(perSourceDaily.Faqahat).length;
  debugInfo.googleCount = Object.keys(perSourceDaily.Google).length;
  debugInfo.faqahatDates = Object.keys(perSourceDaily.Faqahat);
  debugInfo.nabeelDates = Object.keys(perSourceDaily.Nabeel);

  const allDates = new Set();
  Object.values(perSourceDaily).forEach(bucket => Object.keys(bucket).forEach(d => allDates.add(d)));
  const daily = [...allDates].sort().map(date => {
    let purchasing = 0, profit = 0;
    Object.values(perSourceDaily).forEach(bucket => {
      if (bucket[date]) { purchasing += bucket[date].purchasing; profit += bucket[date].profit; }
    });
    const roi = purchasing ? profit / purchasing : null;
    return { date, purchasing: round2(purchasing), profit: round2(profit), roi };
  });

  const result = { daily: daily.slice(-14), weekly, bySource: perSourceDaily };
  if (debug) result._debug = debugInfo;
  return result;
}

