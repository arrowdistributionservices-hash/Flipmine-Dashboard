// Shared parsing utilities: number locale detection + Sellerboard format detection

export function smartNum(raw) {
  if (raw === null || raw === undefined) return NaN;
  let s = String(raw).trim();
  if (s === '' || s === '-' || s.toLowerCase() === 'nan') return NaN;
  s = s.replace(/\u00a0/g, ' ').replace(/ /g, '');
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    const tail = s.split(',').pop();
    if (tail.length <= 2) {
      s = s.replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  }
  const n = parseFloat(s);
  return isNaN(n) ? NaN : n;
}

// Detect whether a parsed row-set is an Amazon Sellerboard export or a Walmart one
export function detectFormat(headers) {
  const h = headers.map(x => (x || '').toLowerCase());
  if (h.includes('asin') && h.some(x => x.includes('net profit'))) return 'amazon';
  if (h.some(x => x.includes('grossprofit') || x === 'gross profit') && !h.includes('asin')) return 'walmart';
  // fallback heuristics
  if (h.includes('asin')) return 'amazon';
  return 'walmart';
}

const AMAZON_NUMERIC = ['Units','Refunds','Sales','% Refunds','Refund сost','Refund cost','Amazon fees',
  'Cost of Goods','Shipping','Gross profit','Net profit','Estimated payout','Margin','ROI','BSR',
  'Sessions','Unit Session Percentage','Average Sales Price'];

const WALMART_NUMERIC = ['Units','Sales','Ads','Shipping costs','Fees','Cost of Goods','GrossProfit','Margin'];

// rows: array of objects (from PapaParse header:true, or SheetJS sheet_to_json)
export function summarizeAccount(rows, format, clientName, marketplace) {
  const numericCols = format === 'amazon' ? AMAZON_NUMERIC : WALMART_NUMERIC;
  const clean = rows.map(r => {
    const out = { ...r };
    numericCols.forEach(c => {
      if (c in out) out[c] = smartNum(out[c]);
    });
    return out;
  }).filter(r => {
    const productKey = format === 'amazon' ? 'Product' : 'Product';
    // Include any row with a product name and a real profit figure — some rows
    // (e.g. no units sold this period but storage/adjustment fees still applied)
    // have no Sales value at all but still carry real cost/profit and must count.
    const profitCol = format === 'amazon' ? 'Net profit' : 'GrossProfit';
    return r[productKey] && (!isNaN(r['Sales']) || !isNaN(r[profitCol]));
  });

  const profitCol = format === 'amazon' ? 'Net profit' : 'GrossProfit';
  const cogCol = 'Cost of Goods';

  const sales = clean.reduce((a, r) => a + (r['Sales'] || 0), 0);
  const profit = clean.reduce((a, r) => a + (r[profitCol] || 0), 0);
  const units = clean.reduce((a, r) => a + (r['Units'] || 0), 0);
  const cog = clean.reduce((a, r) => a + (r[cogCol] || 0), 0);
  const refunds = format === 'amazon' ? clean.reduce((a, r) => a + (r['Refunds'] || 0), 0) : null;

  const margin = sales ? (profit / sales) * 100 : null;
  const roi = cog ? (profit / Math.abs(cog)) * 100 : null;

  const sorted = [...clean].sort((a, b) => (b[profitCol] || 0) - (a[profitCol] || 0));
  const top5 = sorted.slice(0, 5).map(r => ({ product: r['Product'], units: r['Units'], sales: r['Sales'], profit: r[profitCol] }));
  const bottom5 = sorted.slice(-5).reverse().map(r => ({ product: r['Product'], units: r['Units'], sales: r['Sales'], profit: r[profitCol] }));

  return {
    client: clientName,
    marketplace,
    format,
    n: clean.length,
    sales: round2(sales),
    profit: round2(profit),
    units: Math.round(units) || 0,
    refunds: refunds !== null ? Math.round(refunds) : null,
    margin: margin !== null ? round2(margin) : null,
    roi: roi !== null ? round2(roi) : null,
    top5, bottom5,
    updatedAt: new Date().toISOString(),
  };
}

function round2(n) { return Math.round(n * 100) / 100; }
