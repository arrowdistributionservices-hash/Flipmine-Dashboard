// Client-payment side of the Overage calculation: what a client actually paid
// Arrow for an item, matched by ASIN against the eBay sourcing cost for that
// same item (from lib/sourcing.js). See lib/overage.js for how the two sides
// get combined.
//
// Each client has their own "Purchase Order" Google Sheet, spread across many
// tabs (one per order batch: "Order 1", "Order 2", etc). Unlike the Flipmine
// sourcing sheet, we don't hardcode tab names here — a client's sheet gets new
// order tabs added over time, so tabs are discovered dynamically via the
// Sheets API. That needs a (free) API key: see README for setup.

import Papa from 'papaparse';

export const PREP_FEE_PER_UNIT = 2; // matches the baseline already assumed in lib/sourcing.js's corr()

// clientName -> Google Sheet ID of their "Purchase Order" sheet.
// Add more clients here once their sheet is confirmed and shared "Anyone with the link".
export const CLIENT_PAYMENT_SHEETS = {
  Ursula: '1uMTHfear2ioKwPWi8m6XEFiYbG1_8pjmcFx9C0c4DLs',
};

async function listTabTitles(sheetId, apiKey) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?key=${apiKey}&fields=sheets.properties.title`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheets API list failed: ${res.status}`);
  const json = await res.json();
  return (json.sheets || []).map(s => s.properties.title);
}

async function fetchTabCsv(sheetId, tabName) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch tab "${tabName}": ${res.status}`);
  const text = await res.text();
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  return parsed.data.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [(k || '').trim(), v])));
}

function toF(x) {
  if (x === null || x === undefined || x === '') return null;
  const n = parseFloat(String(x).replace(/[$,\s]/g, ''));
  return isNaN(n) ? null : n;
}

function findKey(headers, pattern) {
  return headers.find(h => pattern.test(h));
}

// Parses one tab's rows into {asin, totalSpent, qty} line items. Subtotal/footer
// rows (which every order tab has) naturally have a blank ASIN and get skipped —
// we only care about rows we can match to a specific eBay purchase.
function parseTabRows(rows) {
  if (!rows.length) return [];
  const headers = Object.keys(rows[0]);
  const asinKey = findKey(headers, /^asin$/i);
  const totalSpentKey = findKey(headers, /total spent|total spend/i);
  const qtyKey = findKey(headers, /qty to order|quantity to order|^qty$/i);
  if (!asinKey || !totalSpentKey) return [];

  const items = [];
  for (const row of rows) {
    const asin = (row[asinKey] || '').trim();
    if (!asin) continue;
    const totalSpent = toF(row[totalSpentKey]);
    if (totalSpent === null) continue;
    const qty = qtyKey ? toF(row[qtyKey]) : null;
    items.push({ asin, totalSpent, qty: qty || 0 });
  }
  return items;
}

export async function fetchClientPaymentItems(clientName, sheetId, apiKey, debugLog) {
  const tabs = await listTabTitles(sheetId, apiKey);
  const items = [];
  for (const tab of tabs) {
    try {
      const rows = await fetchTabCsv(sheetId, tab);
      const tabItems = parseTabRows(rows);
      items.push(...tabItems);
      if (debugLog) debugLog.push({ client: clientName, tab, ok: true, itemsFound: tabItems.length });
    } catch (e) {
      if (debugLog) debugLog.push({ client: clientName, tab, ok: false, error: String(e) });
    }
  }
  return items;
}

// records: sourcing records from lib/sourcing.js's fetchAllSourcingRecords()
// (needs the raw records, not the aggregated dashboard data, since ASIN isn't
// preserved through buildSourcingDashboardData). Pass an apiKey (from
// GOOGLE_SHEETS_API_KEY) to enable tab discovery; without one, overage is
// skipped entirely for every client rather than guessing at tab names.
export async function computeOverage(sourcingRecordsWithAsin, apiKey, debugLog) {
  if (!apiKey) {
    return { enabled: false, reason: 'GOOGLE_SHEETS_API_KEY not set', clients: {} };
  }

  const clients = {};
  for (const [clientName, sheetId] of Object.entries(CLIENT_PAYMENT_SHEETS)) {
    const ebayRows = sourcingRecordsWithAsin.filter(r => r.client === clientName && r.asin);
    const ebayByAsin = {};
    for (const r of ebayRows) {
      if (!ebayByAsin[r.asin]) ebayByAsin[r.asin] = { cost: 0, qty: 0 };
      ebayByAsin[r.asin].cost += r.cost * (r.qty || 1);
      ebayByAsin[r.asin].qty += (r.qty || 1);
    }

    let clientItems = [];
    let fetchError = null;
    try {
      clientItems = await fetchClientPaymentItems(clientName, sheetId, apiKey, debugLog);
    } catch (e) {
      fetchError = String(e);
    }

    let matchedEbayCost = 0, matchedEbayQty = 0, matchedClientTotal = 0, matchedClientQty = 0;
    const matchedAsins = new Set();
    for (const item of clientItems) {
      if (!ebayByAsin[item.asin]) continue;
      matchedClientTotal += item.totalSpent;
      matchedClientQty += item.qty;
      matchedAsins.add(item.asin);
    }
    for (const asin of matchedAsins) {
      matchedEbayCost += ebayByAsin[asin].cost;
      matchedEbayQty += ebayByAsin[asin].qty;
    }

    const prepFee = PREP_FEE_PER_UNIT * matchedEbayQty;
    const overage = matchedClientTotal - matchedEbayCost - prepFee;

    clients[clientName] = {
      matchedAsinCount: matchedAsins.size,
      totalEbayAsinCount: Object.keys(ebayByAsin).length,
      matchedEbayCost: round2(matchedEbayCost),
      matchedEbayQty,
      matchedClientTotal: round2(matchedClientTotal),
      matchedClientQty: round2(matchedClientQty),
      prepFee: round2(prepFee),
      overage: round2(overage),
      fetchError,
    };
  }

  return { enabled: true, clients };
}

function round2(n) { return Math.round(n * 100) / 100; }
