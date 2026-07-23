import { useEffect, useRef, useState, Fragment } from 'react';
import Script from 'next/script';

function fmtMoney(v) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  const sign = v < 0 ? '−' : '';
  return sign + '$' + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtMoneyShort(v) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  if (a >= 1000) return sign + '$' + (a / 1000).toFixed(1) + 'K';
  return sign + '$' + a.toFixed(0);
}
function fmtPct(v) { if (v === null || v === undefined || isNaN(v)) return '—'; return (v * 100).toFixed(1) + '%'; }
function fmtPctRaw(v) { if (v === null || v === undefined || isNaN(v)) return '—'; return v.toFixed(1) + '%'; }

const PALETTE = ['#6d7ff9', '#38c9b9', '#f0b74a', '#b085f5', '#9c7bd6', '#5fa8d3', '#5fd39c', '#f36c7a', '#e0a458', '#7ad1e0'];
function hashColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
const SOURCER_COLORS = { Hasan: '#6d7ff9', Nabeel: '#b085f5', Faqahat: '#38c9b9', 'Scraper/Automated': '#8991a8' };

export default function Home() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [chartReady, setChartReady] = useState(false);
  const [mode, setMode] = useState('recorded');
  const [breakdown, setBreakdown] = useState('mkt');

  useEffect(() => {
    fetch('/api/data')
      .then(r => r.json().then(j => ({ ok: r.ok, body: j })))
      .then(({ ok, body }) => {
        if (!ok || !body || !body.sourcing) { setError((body && (body.error || body.detail)) || 'Unexpected response'); return; }
        setData(body);
      })
      .catch(e => setError(String(e)));
  }, []);

  if (error) {
    return (
      <div style={{ padding: '40px 5vw' }}>
        <h1>Flipmine — Global Dashboard</h1>
        <p style={{ color: 'var(--rose)', marginTop: 16 }}>Couldn&apos;t load live data yet: {error}</p>
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>This is expected until the Google Sheet is shared publicly and the database is connected.</p>
      </div>
    );
  }
  if (!data) return <div style={{ padding: '40px 5vw', color: 'var(--muted)' }}>Loading live data…</div>;

  const { sourcing, sales, purchasing, generatedAt } = data;
  const salesAccounts = Object.values(sales || {});
  const clientColor = (name) => SOURCER_COLORS[name] ? SOURCER_COLORS[name] : hashColor(name);

  return (
    <>
      <Script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js" strategy="afterInteractive" onLoad={() => setChartReady(true)} />
      <GlobalNav />
      <div className="gsection" id="overview">
        <Overview sourcing={sourcing} salesAccounts={salesAccounts} purchasing={purchasing} generatedAt={generatedAt} clientColor={clientColor} />
      </div>
      <hr className="gdivider" />
      <div className="gsection" id="sourcing">
        <div className="gsection-label">Section 02 — Sourcing Pipeline (Deals Bought)</div>
        <SourcingPipeline sourcing={sourcing} mode={mode} setMode={setMode} breakdown={breakdown} setBreakdown={setBreakdown} chartReady={chartReady} clientColor={clientColor} />
      </div>
      <hr className="gdivider" />
      <div className="gsection" id="sales">
        <div className="gsection-label">Section 03 — Sales &amp; Loss (Live Marketplace Performance)</div>
        <SalesLoss salesAccounts={salesAccounts} sourcing={sourcing} clientColor={clientColor} />
      </div>
    </>
  );
}

function GlobalNav() {
  return (
    <div className="gnav">
      <div className="gnav-inner">
        <span className="gnav-brand">FLIPMINE</span>
        <a href="#overview">Overview</a>
        <a href="#sourcing">Sourcing Pipeline</a>
        <a href="#sales">Sales &amp; Loss</a>
      </div>
    </div>
  );
}

function Overview({ sourcing, salesAccounts, purchasing, generatedAt, clientColor }) {
  const totalSalesProfit = salesAccounts.reduce((a, r) => a + (r.profit || 0), 0);
  const totalSales = salesAccounts.reduce((a, r) => a + (r.sales || 0), 0);
  const losers = salesAccounts.filter(a => a.profit < 0).sort((a, b) => a.profit - b.profit);

  const clientsSorted = [...sourcing.clients].sort((a, b) => sourcing.by_client[b].profit - sourcing.by_client[a].profit);
  const maxProfit = Math.max(...clientsSorted.map(c => sourcing.by_client[c].profit), 1);

  const sourcerRows = Object.entries(sourcing.sourcer_efficiency).sort((a, b) => b[1].roi - a[1].roi);
  const rankedAccounts = [...salesAccounts].sort((a, b) => b.profit - a.profit);

  return (
    <>
      <div className="masthead">
        <div>
          <div className="brand">Flipmine · Mission Control</div>
          <h1>Business Snapshot</h1>
          <p className="tagline">One page for the whole team — sourcing pipeline, sell-side performance, and where each client stands. No spreadsheets to dig through.</p>
        </div>
        <div className="meta">UPDATED <b>{new Date(generatedAt).toLocaleString()}</b><br />SOURCING <b>Live — Google Sheets</b><br />SELL-SIDE <b>{salesAccounts.length} accounts loaded</b></div>
      </div>

      {salesAccounts.length > 0 && (
        <div className={`alert ${totalSalesProfit < 0 ? '' : 'good'}`}>
          <div className="big">{fmtMoney(totalSalesProfit)}</div>
          <div className="txt">
            <b>{totalSalesProfit < 0 ? 'Combined net loss' : 'Combined net profit'} across all {salesAccounts.length} loaded accounts</b>, on {fmtMoney(totalSales)} in sales.
            {losers.length > 0 && (
              <p>{losers.slice(0, 2).map(l => `${l.client}'s ${l.marketplace} account (${fmtMoney(l.profit)})`).join(' and ')} {losers.length > 1 ? 'are' : 'is'} the main drag{losers.length > 1 ? 's' : ''} — see Sell-Side Snapshot below.</p>
            )}
          </div>
        </div>
      )}

      <div className="kpi-band">
        <div className="kpi"><div className="kpi-label">Deals Bought</div><div className="kpi-value">{sourcing.total_count.toLocaleString()}</div><div className="kpi-sub">across {sourcing.clients.length} sourcing clients</div></div>
        <div className="kpi"><div className="kpi-label">Sourcing Spend</div><div className="kpi-value">{fmtMoneyShort(sourcing.global.cost)}</div><div className="kpi-sub">recorded cost</div></div>
        <div className="kpi"><div className="kpi-label">Sourcing Profit</div><div className="kpi-value teal">{fmtMoneyShort(sourcing.global.profit)}</div><div className="kpi-sub">on paper, pre-fees</div></div>
        <div className="kpi"><div className="kpi-label">Blended Sourcing ROI</div><div className="kpi-value accent">{fmtPct(sourcing.global.roi)}</div><div className="kpi-sub">{fmtPct(sourcing.global.corr_roi)} corrected</div></div>
        <div className="kpi"><div className="kpi-label">Sell-Side Profit</div><div className={`kpi-value ${totalSalesProfit < 0 ? 'rose' : 'teal'}`}>{fmtMoneyShort(totalSalesProfit)}</div><div className="kpi-sub">{salesAccounts.length} accounts, net</div></div>
      </div>

      <section>
        <div className="section-head"><span className="section-title">Client Leaderboard</span><span className="section-desc">Sourcing side — cost, profit, ROI</span></div>
        <div className="grid-2">
          <div className="card">
            <h3>Profit by client</h3>
            {clientsSorted.map(c => {
              const d = sourcing.by_client[c];
              return (
                <div className="lb-row" key={c}>
                  <div className="lb-name" style={{ color: clientColor(c) }}>{c}</div>
                  <div className="lb-track"><div className="lb-fill" style={{ width: `${Math.max(4, (d.profit / maxProfit) * 100)}%`, background: clientColor(c) }} /></div>
                  <div className="lb-profit">{fmtMoney(d.profit)}</div>
                  <div className="lb-roi">{fmtPct(d.roi)}</div>
                </div>
              );
            })}
          </div>
          <div className="card">
            <h3>Sourcer efficiency</h3>
            <table>
              <thead><tr><th>Sourcer</th><th className="num">Deals</th><th className="num">Profit</th><th className="num">ROI</th></tr></thead>
              <tbody>
                {sourcerRows.map(([s, d]) => (
                  <tr key={s}><td style={{ color: SOURCER_COLORS[s] || '#ccc', fontWeight: 600 }}>{s}</td><td className="num">{d.n}</td><td className="num">{fmtMoney(d.profit)}</td><td className="num roi-cell">{fmtPct(d.roi)}</td></tr>
                ))}
              </tbody>
            </table>
            {sourcerRows.length > 1 && (
              <div className="callout" style={{ marginTop: 14 }}>
                {sourcerRows[0][0]} runs at the highest ROI ({fmtPct(sourcerRows[0][1].roi)}) across {sourcerRows[0][1].n} deals — worth understanding what makes that work and whether it can scale.
              </div>
            )}
          </div>
        </div>
      </section>

      <section>
        <div className="section-head"><span className="section-title">Purchasing Breakdown</span><span className="section-desc">By brand, by day, by week</span></div>
        <div className="grid-2 even">
          <BrandBreakdownCard brands={sourcing.brand_breakdown || []} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <DailyPurchasingCard daily={(purchasing && purchasing.daily) || []} bySource={purchasing && purchasing.bySource} />
            <WeeklyPurchasingCard weekly={(purchasing && purchasing.weekly) || []} />
          </div>
        </div>
      </section>

      <section>
        <div className="section-head"><span className="section-title">Sell-Side Snapshot</span><span className="section-desc">What&apos;s actually landed so far</span></div>
        {salesAccounts.length === 0 ? (
          <div className="card"><p style={{ color: 'var(--muted)' }}>No sell-side accounts uploaded yet. Go to <a href="/admin">/admin</a> to upload the first Sellerboard export.</p></div>
        ) : (
          <div className="grid-2">
            <div className="card">
              <h3>All accounts, ranked by net profit</h3>
              <table>
                <thead><tr><th>Account</th><th className="num">Sales</th><th className="num">Profit</th><th className="num">Margin</th></tr></thead>
                <tbody>
                  {rankedAccounts.map(a => (
                    <tr key={`${a.client}|${a.marketplace}`}>
                      <td style={{ color: clientColor(a.client), fontWeight: 600 }}>{a.client} · {a.marketplace}</td>
                      <td className="num">{fmtMoney(a.sales)}</td>
                      <td className={`num ${a.profit < 0 ? 'neg' : 'roi-cell'}`}>{fmtMoney(a.profit)}</td>
                      <td className="num">{fmtPctRaw(a.margin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card">
              <h3>Coverage — 13 managed accounts</h3>
              <div className="coverage-grid">
                {rankedAccounts.map(a => (
                  <div className="tile live" key={`${a.client}|${a.marketplace}`} style={{ background: clientColor(a.client) }} title={`${a.client} — ${a.marketplace}`}>
                    {a.client.slice(0, 3).toUpperCase()}
                  </div>
                ))}
                {Array.from({ length: Math.max(0, 13 - rankedAccounts.length) }).map((_, i) => <div className="tile" key={i}>·</div>)}
              </div>
              <p style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 12 }}>{rankedAccounts.length} of 13 accounts loaded.</p>
            </div>
          </div>
        )}
      </section>

      <footer>
        <span>Sources: Flipmine Deals (Google Sheets, live) · Sellerboard/ThreeColts uploads</span>
        <span>Internal — for Flipmine team use</span>
      </footer>
    </>
  );
}

const BRAND_TILE_COLORS = { ARRIS: '#38c9b9', LEGO: '#f0b74a', Google: '#6d7ff9', Honeywell: '#b085f5' };

function BrandBreakdownCard({ brands }) {
  const sortedByCost = [...brands].sort((a, b) => b.cost - a.cost);
  const maxCost = Math.max(...sortedByCost.map(b => b.cost), 1);
  return (
    <div className="card">
      <h3>Purchases by brand</h3>
      {brands.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 12.5 }}>No branded deals matched yet (ARRIS, LEGO, Google, Honeywell).</p>
      ) : (
        <>
          {sortedByCost.map(b => (
            <div className="lb-row" key={b.brand}>
              <div className="lb-name" style={{ color: BRAND_TILE_COLORS[b.brand] || '#ccc' }}>{b.brand}</div>
              <div className="lb-track"><div className="lb-fill" style={{ width: `${Math.max(4, (b.cost / maxCost) * 100)}%`, background: BRAND_TILE_COLORS[b.brand] || '#ccc' }} /></div>
              <div className="lb-profit">{fmtMoney(b.cost)}</div>
              <div className="lb-roi">{b.n} deals</div>
            </div>
          ))}
          <table style={{ marginTop: 14 }}>
            <thead><tr><th>Brand</th><th className="num">Deals</th><th className="num">Cost</th><th className="num">Profit</th><th className="num">ROI</th></tr></thead>
            <tbody>
              {sortedByCost.map(b => (
                <tr key={b.brand}>
                  <td style={{ color: BRAND_TILE_COLORS[b.brand] || '#ccc', fontWeight: 600 }}>{b.brand}</td>
                  <td className="num">{b.n}</td>
                  <td className="num">{fmtMoney(b.cost)}</td>
                  <td className="num">{fmtMoney(b.profit)}</td>
                  <td className="num roi-cell">{fmtPct(b.roi)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

const SOURCE_LABELS = { Nabeel: 'Nabeel (LEGO)', Hasan: 'Hasan (LEGO)', Faqahat: 'Faqahat (ARRIS)', Google: 'Google Sourcing' };
const SOURCE_ORDER = ['Nabeel', 'Hasan', 'Faqahat', 'Google'];

function DailyPurchasingCard({ daily, bySource }) {
  const [openDate, setOpenDate] = useState(null);
  const last7 = daily.slice(-7);

  return (
    <div className="card">
      <h3>Daily purchasing — last {last7.length || 7} days</h3>
      {last7.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 12.5 }}>No daily data available from the sheet yet.</p>
      ) : (
        <>
          <table>
            <thead><tr><th>Date</th><th className="num">Purchasing</th><th className="num">Est. Profit</th><th className="num">Est. ROI</th></tr></thead>
            <tbody>
              {last7.map((d, i) => (
                <Fragment key={i}>
                  <tr onClick={() => setOpenDate(openDate === d.date ? null : d.date)} style={{ cursor: 'pointer' }}>
                    <td>{new Date(d.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} <span style={{ color: 'var(--muted)', fontSize: 10 }}>{openDate === d.date ? '▾' : '▸'}</span></td>
                    <td className="num" style={{ textDecoration: 'underline', textDecorationStyle: 'dotted', textDecorationColor: 'var(--muted)' }}>{fmtMoney(d.purchasing)}</td>
                    <td className="num pos">{fmtMoney(d.profit)}</td>
                    <td className="num roi-cell">{d.roi !== null ? fmtPct(d.roi) : '—'}</td>
                  </tr>
                  {openDate === d.date && (
                    <tr>
                      <td colSpan={4} style={{ background: '#10131c', padding: '10px 14px' }}>
                        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10.5, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Breakdown by sourcing line — {new Date(d.date).toLocaleDateString()}
                        </div>
                        {SOURCE_ORDER.map(src => {
                          const v = bySource && bySource[src] && bySource[src][d.date];
                          if (!v) return null;
                          return (
                            <div key={src} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0' }}>
                              <span style={{ color: SOURCER_COLORS[src] || clientColorFallback(src) }}>{SOURCE_LABELS[src]}</span>
                              <span className="num">{fmtMoney(v.purchasing)}</span>
                            </div>
                          );
                        })}
                        {SOURCE_ORDER.every(src => !(bySource && bySource[src] && bySource[src][d.date])) && (
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>No per-source detail for this date.</div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>Click a date to see the per-sourcer split. Each line is single-brand: Nabeel &amp; Hasan source LEGO, Faqahat sources ARRIS, Google Sourcing covers Google/Nest.</p>
        </>
      )}
    </div>
  );
}
function clientColorFallback(name) { return hashColor(name); }

function WeeklyPurchasingCard({ weekly }) {
  return (
    <div className="card">
      <h3>Weekly purchasing</h3>
      {weekly.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 12.5 }}>No weekly data available from the sheet yet.</p>
      ) : (
        <table>
          <thead><tr><th>Week</th><th className="num">E2A &amp; E2W</th><th className="num">Wholesale</th><th className="num">Total</th></tr></thead>
          <tbody>
            {weekly.map((w, i) => (
              <tr key={i}>
                <td>{w.week}</td>
                <td className="num">{w.e2aE2w !== null ? fmtMoney(w.e2aE2w) : '—'}</td>
                <td className="num">{w.wholesale !== null ? fmtMoney(w.wholesale) : '—'}</td>
                <td className="num roi-cell">{fmtMoney(w.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SourcingPipeline({ sourcing, mode, setMode, breakdown, setBreakdown, chartReady, clientColor }) {
  const profitChartRef = useRef(null);
  const roiChartRef = useRef(null);
  const sourcerChartRef = useRef(null);
  const chartInstances = useRef({});

  const val = (d, recKey, corrKey) => (mode === 'recorded' ? d[recKey] : (d[corrKey] ?? d[recKey]));

  useEffect(() => {
    if (!chartReady || typeof window === 'undefined' || !window.Chart) return;
    const Chart = window.Chart;
    Chart.defaults.color = '#8991a8';
    Chart.defaults.borderColor = '#262c3d';
    Chart.defaults.font.family = "'Inter', sans-serif";

    const labels = sourcing.clients;
    const profits = labels.map(c => val(sourcing.by_client[c], 'profit', 'corr_profit'));
    const rois = labels.map(c => val(sourcing.by_client[c], 'roi', 'corr_roi'));
    const bg = labels.map(c => clientColor(c));

    if (chartInstances.current.profit) chartInstances.current.profit.destroy();
    if (profitChartRef.current) {
      chartInstances.current.profit = new Chart(profitChartRef.current, {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Profit ($)', data: profits, backgroundColor: bg, borderRadius: 6 }] },
        options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtMoney(ctx.raw) } } },
          scales: { y: { ticks: { callback: v => '$' + v.toLocaleString() }, grid: { color: '#262c3d' } }, x: { grid: { display: false } } } }
      });
    }

    if (chartInstances.current.roi) chartInstances.current.roi.destroy();
    if (roiChartRef.current) {
      chartInstances.current.roi = new Chart(roiChartRef.current, {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Avg ROI', data: rois, backgroundColor: bg, borderRadius: 6 }] },
        options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtPct(ctx.raw) } } },
          scales: { y: { ticks: { callback: v => (v * 100).toFixed(0) + '%' }, grid: { color: '#262c3d' } }, x: { grid: { display: false } } } }
      });
    }

    const sourcers = Object.keys(sourcing.sourcer_efficiency).sort((a, b) => sourcing.sourcer_efficiency[b].roi - sourcing.sourcer_efficiency[a].roi);
    const srois = sourcers.map(s => sourcing.sourcer_efficiency[s].roi);
    const sbg = sourcers.map(s => SOURCER_COLORS[s] || '#999');

    if (chartInstances.current.sourcer) chartInstances.current.sourcer.destroy();
    if (sourcerChartRef.current) {
      chartInstances.current.sourcer = new Chart(sourcerChartRef.current, {
        type: 'bar',
        data: { labels: sourcers, datasets: [{ label: 'Avg ROI', data: srois, backgroundColor: sbg, borderRadius: 6 }] },
        options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtPct(ctx.raw) } } },
          scales: { x: { ticks: { callback: v => (v * 100).toFixed(0) + '%' }, grid: { color: '#262c3d' } }, y: { grid: { display: false } } } }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartReady, mode, sourcing]);

  const dims = breakdown === 'mkt' ? ['Amazon', 'Walmart'] : ['Hasan', 'Nabeel', 'Faqahat', 'Scraper/Automated'];
  const srcMap = breakdown === 'mkt' ? sourcing.by_client_mkt : sourcing.by_client_src;

  const sourcerRows = Object.entries(sourcing.sourcer_efficiency).sort((a, b) => b[1].roi - a[1].roi);
  const top = sourcerRows[0], bottom = sourcerRows[sourcerRows.length - 1];

  return (
    <>
      <h1>Flipmine — Sourcing Dashboard</h1>
      <div className="subtitle">All {sourcing.total_count.toLocaleString()} bought deals across {sourcing.clients.join(', ')} — recorded vs. corrected ($2/unit actual prep cost)</div>

      <div className="toggle-row">
        <span style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 600 }}>VIEW:</span>
        <div className={`toggle-btn ${mode === 'recorded' ? 'active' : ''}`} onClick={() => setMode('recorded')}>Recorded</div>
        <div className={`toggle-btn ${mode === 'corrected' ? 'active' : ''}`} onClick={() => setMode('corrected')}>Corrected ($2/unit prep)</div>
      </div>

      <div className="hero">
        <div className="hero-label">Global — All Clients Combined</div>
        <div className="hero-grid">
          <div className="hero-stat deals"><div className="num">{sourcing.global.n.toLocaleString()}</div><div className="lbl">Total Bought Deals</div></div>
          <div className="hero-stat cost"><div className="num">{fmtMoney(val(sourcing.global, 'cost', 'corr_cost'))}</div><div className="lbl">Total Cost</div></div>
          <div className="hero-stat profit"><div className="num">{fmtMoney(val(sourcing.global, 'profit', 'corr_profit'))}</div><div className="lbl">Total Profit</div></div>
          <div className="hero-stat roi"><div className="num">{fmtPct(val(sourcing.global, 'roi', 'corr_roi'))}</div><div className="lbl">Blended ROI</div></div>
        </div>
      </div>

      <div className="cards">
        {sourcing.clients.map(c => {
          const d = sourcing.by_client[c];
          const profit = val(d, 'profit', 'corr_profit');
          return (
            <div className="card client-card" key={c} style={{ borderTop: `3px solid ${clientColor(c)}` }}>
              <div className="client-name" style={{ color: clientColor(c) }}>{c}</div>
              <div className="metric-row"><span className="metric-label">Cost</span><span className="metric-value">{fmtMoney(val(d, 'cost', 'corr_cost'))}</span></div>
              <div className="metric-row"><span className="metric-label">Profit</span><span className="metric-value">{fmtMoney(profit)}</span></div>
              <div className="metric-row"><span className="metric-label">Avg ROI</span><span className="roi-value">{fmtPct(val(d, 'roi', 'corr_roi'))}</span></div>
              <div className="deal-count">{d.n} bought deals{mode === 'corrected' ? ` · overage +${fmtMoney(d.corr_profit - d.profit)}` : ''}</div>
            </div>
          );
        })}
      </div>

      <div className="charts-grid">
        <div className="chart-card"><h3>Profit by Client ($)</h3><canvas ref={profitChartRef} /></div>
        <div className="chart-card"><h3>Average ROI by Client</h3><canvas ref={roiChartRef} /></div>
      </div>

      <div className="breakdown-section">
        <div className="breakdown-tabs">
          <div className={`btab ${breakdown === 'mkt' ? 'active' : ''}`} onClick={() => setBreakdown('mkt')}>By Marketplace</div>
          <div className={`btab ${breakdown === 'src' ? 'active' : ''}`} onClick={() => setBreakdown('src')}>By Sourcer</div>
        </div>
        <table>
          <thead><tr><th>Client</th><th>{breakdown === 'mkt' ? 'Marketplace' : 'Sourcer'}</th><th className="num">Deals</th><th className="num">Cost</th><th className="num">Profit</th><th className="num">Avg ROI</th></tr></thead>
          <tbody>
            {sourcing.clients.map(client => dims.map(dim => {
              const d = srcMap[`${client}|${dim}`];
              if (!d || d.n === 0) return null;
              return (
                <tr key={`${client}|${dim}`}>
                  <td style={{ color: clientColor(client), fontWeight: 600 }}>{client}</td>
                  <td>{dim}</td>
                  <td className="num">{d.n}</td>
                  <td className="num">{fmtMoney(val(d, 'cost', 'corr_cost'))}</td>
                  <td className="num">{fmtMoney(val(d, 'profit', 'corr_profit'))}</td>
                  <td className="num roi-cell">{fmtPct(val(d, 'roi', 'corr_roi'))}</td>
                </tr>
              );
            }))}
          </tbody>
        </table>
      </div>

      <div className="breakdown-section">
        <h2 className="section-title">Sourcer Efficiency — Across All Clients</h2>
        <div className="section-note">Who&apos;s actually best at finding profitable deals, independent of which client they were sourcing for.</div>
        <div className="charts-grid">
          <div className="chart-card"><h3>Avg ROI by Sourcer</h3><canvas ref={sourcerChartRef} /></div>
          <div className="chart-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <table>
              <thead><tr><th>Sourcer</th><th className="num">Deals</th><th className="num">Profit</th><th className="num">Avg ROI</th><th>Clients</th></tr></thead>
              <tbody>
                {sourcerRows.map(([s, d]) => (
                  <tr key={s}><td style={{ color: SOURCER_COLORS[s] || '#ccc', fontWeight: 600 }}>{s}</td><td className="num">{d.n}</td><td className="num">{fmtMoney(d.profit)}</td><td className="num roi-cell">{fmtPct(d.roi)}</td><td className="muted-cell">{d.clients.join(', ')}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {top && bottom && (
          <div className="callout" style={{ marginTop: 14 }}>
            {top[0]} runs at the highest ROI ({fmtPct(top[1].roi)}) across {top[1].n} deals, while {bottom[0]} sits lowest ({fmtPct(bottom[1].roi)}). Worth understanding what&apos;s different — category, negotiation, timing — and whether the top performer&apos;s approach can scale to more volume.
          </div>
        )}
      </div>

      <div className="breakdown-section">
        <h2 className="section-title">Beyond ARRIS — other deals worth a second look</h2>
        <div className="section-note">ARRIS modems removed — that pattern&apos;s already known and tracked separately. These are the next-best {sourcing.non_arris_outliers.length} deals by ROI once ARRIS is excluded, no minimum threshold.</div>
        <table>
          <thead><tr><th>Client</th><th>Sourcer</th><th>eBay Title</th><th className="num">Cost</th><th className="num">Profit</th><th className="num">ROI</th></tr></thead>
          <tbody>
            {sourcing.non_arris_outliers.map((o, i) => (
              <tr key={i}>
                <td style={{ color: clientColor(o.client), fontWeight: 600 }}>{o.client}</td>
                <td>{o.sourcer}</td>
                <td style={{ maxWidth: 320 }}>{o.title || '—'}</td>
                <td className="num">{fmtMoney(o.cost)}</td>
                <td className="num">{fmtMoney(o.profit)}</td>
                <td className="num" style={{ color: 'var(--rose)', fontWeight: 700 }}>{fmtPct(o.roi)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer>Source: Flipmine Deals — Google Sheets (live, refreshed on load). Companion section: Sales &amp; Loss.</footer>
    </>
  );
}

function SalesLoss({ salesAccounts, sourcing, clientColor }) {
  const totalProfit = salesAccounts.reduce((a, r) => a + (r.profit || 0), 0);
  const totalSales = salesAccounts.reduce((a, r) => a + (r.sales || 0), 0);
  const ranked = [...salesAccounts].sort((a, b) => b.profit - a.profit);
  const maxAbs = Math.max(...ranked.map(a => Math.abs(a.profit)), 1);

  const byClient = {};
  salesAccounts.forEach(a => { (byClient[a.client] = byClient[a.client] || []).push(a); });
  const clientNames = Object.keys(byClient).sort((a, b) => {
    const pa = byClient[a].reduce((s, x) => s + x.profit, 0);
    const pb = byClient[b].reduce((s, x) => s + x.profit, 0);
    return pb - pa;
  });

  const sourcingClientsWithoutSales = sourcing.clients.filter(c => !byClient[c]);

  return (
    <>
      <h1>Flipmine — Sales &amp; Loss Dashboard</h1>
      <div className="subtitle">Live marketplace performance and reimbursement recovery, per client → account.</div>

      {salesAccounts.length === 0 ? (
        <div className="card"><p style={{ color: 'var(--muted)' }}>No sales accounts uploaded yet. Go to <a href="/admin">/admin</a> to upload the first Sellerboard export.</p></div>
      ) : (
        <>
          <div className={`alert ${totalProfit < 0 ? '' : 'good'}`}>
            <div className="big">{fmtMoney(totalProfit)}</div>
            <div className="txt">
              <b>Combined net {totalProfit < 0 ? 'loss' : 'profit'} across all {salesAccounts.length} loaded accounts</b>, on {fmtMoney(totalSales)} in sales.
            </div>
          </div>

          <div className="coverage">
            <span className="lbl">Coverage</span>
            <div className="dots">
              {ranked.map(a => <div className="dot live" key={`${a.client}|${a.marketplace}`} style={{ background: clientColor(a.client) }} title={`${a.client} — ${a.marketplace}`} />)}
              {Array.from({ length: Math.max(0, 13 - ranked.length) }).map((_, i) => <div className="dot" key={i} title="Pending" />)}
            </div>
            <span className="status">{ranked.length} of 13 accounts live</span>
          </div>

          <div className="rank-strip">
            <h2 style={{ marginBottom: 14 }}>All accounts, ranked by net profit</h2>
            {ranked.map(a => (
              <div className="rank-row" key={`${a.client}|${a.marketplace}`}>
                <div className="rank-name" style={{ color: clientColor(a.client) }}>{a.client} · {a.marketplace}</div>
                <div className="rank-track"><div className={`rank-fill ${a.profit < 0 ? 'neg' : 'pos'}`} style={{ width: `${Math.max(4, (Math.abs(a.profit) / maxAbs) * 100)}%` }} /></div>
                <div className={`rank-profit ${a.profit < 0 ? 'neg' : 'pos'}`}>{fmtMoney(a.profit)}</div>
                <div className="rank-margin">{fmtPctRaw(a.margin)}</div>
              </div>
            ))}
          </div>

          {clientNames.map(client => (
            <div className="client-block" key={client}>
              <div className="client-head">
                <div className="client-dot" style={{ background: clientColor(client) }} />
                <div className="client-name" style={{ color: clientColor(client) }}>{client}</div>
                <div className="client-sub">{byClient[client].length} account{byClient[client].length > 1 ? 's' : ''}{sourcing.by_client[client] ? ` · ${sourcing.by_client[client].n} sourced deals` : ''}</div>
              </div>
              {byClient[client].map(a => (
                <div className="account-block" key={`${a.client}|${a.marketplace}`}>
                  <div className="account-head">
                    <span className={`account-tag ${a.marketplace.toLowerCase()}`}>{a.marketplace}</span>
                    <span className="account-title">{a.client} — {a.marketplace}</span>
                    <span className="account-period">Sellerboard</span>
                  </div>
                  <div className="kpi-row">
                    <div className="kpi"><div className="kpi-label">Sales</div><div className="kpi-value">{fmtMoney(a.sales)}</div><div className="kpi-sub">{a.n} SKUs, {a.units} units</div></div>
                    <div className="kpi"><div className="kpi-label">Net Profit</div><div className={`kpi-value ${a.profit < 0 ? 'rose' : 'teal'}`}>{fmtMoney(a.profit)}</div><div className="kpi-sub">{fmtPctRaw(a.margin)} margin</div></div>
                    {a.roi !== null && <div className="kpi"><div className="kpi-label">ROI</div><div className={`kpi-value ${a.roi < 0 ? 'rose' : 'teal'}`}>{fmtPctRaw(a.roi)}</div></div>}
                    {a.refunds !== null && <div className="kpi"><div className="kpi-label">Refund Units</div><div className="kpi-value rose">{a.refunds}</div><div className="kpi-sub">of {a.units} sold</div></div>}
                  </div>
                  <div className="grid-2 even">
                    <table>
                      <thead><tr><th>Top 5</th><th className="num">Profit</th></tr></thead>
                      <tbody>{a.top5.map((p, i) => <tr key={i}><td>{p.product}</td><td className="num pos">{fmtMoney(p.profit)}</td></tr>)}</tbody>
                    </table>
                    <table>
                      <thead><tr><th>Bottom 5</th><th className="num">Profit</th></tr></thead>
                      <tbody>{a.bottom5.map((p, i) => <tr key={i}><td>{p.product}</td><td className={`num ${p.profit < 0 ? 'neg' : 'pos'}`}>{fmtMoney(p.profit)}</td></tr>)}</tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </>
      )}

      {sourcingClientsWithoutSales.length > 0 && (
        <div className="client-block">
          <div className="client-head">
            <div className="client-dot" style={{ background: '#484f66' }} />
            <div className="client-name" style={{ color: 'var(--muted)' }}>{sourcingClientsWithoutSales.join(' · ')}</div>
            <div className="client-sub">no sell-side account loaded yet</div>
          </div>
          <div className="pending">
            {sourcingClientsWithoutSales.map(c => `${c} (${sourcing.by_client[c].n} bought deals, ${fmtPct(sourcing.by_client[c].roi)} avg ROI)`).join(' · ')} — has real sourcing volume but no Sellerboard export uploaded yet. Go to <a href="/admin">/admin</a> to add one.
          </div>
        </div>
      )}

      <footer>Sources: Sellerboard/ThreeColts uploads via /admin. Companion section: Sourcing Pipeline.</footer>
    </>
  );
}
