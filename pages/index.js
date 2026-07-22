import { useEffect, useState } from 'react';
import '../styles/globals.css';

function fmtMoney(v) { if (v === null || v === undefined || isNaN(v)) return '—'; return '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtPct(v) { if (v === null || v === undefined || isNaN(v)) return '—'; return (v * 100).toFixed(1) + '%'; }
function fmtPctRaw(v) { if (v === null || v === undefined || isNaN(v)) return '—'; return v.toFixed(1) + '%'; }

export default function Home() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/data').then(r => r.json()).then(setData).catch(e => setError(String(e)));
  }, []);

  if (error) return <div className="wrap"><p style={{ color: 'var(--rose)' }}>Failed to load: {error}</p></div>;
  if (!data) return <div className="wrap"><p>Loading live data from Google Sheets and stored sales accounts…</p></div>;

  const { sourcing, sales, generatedAt } = data;
  const salesAccounts = Object.values(sales || {}).sort((a, b) => a.profit - b.profit);
  const salesTotalSales = salesAccounts.reduce((a, r) => a + r.sales, 0);
  const salesTotalProfit = salesAccounts.reduce((a, r) => a + r.profit, 0);

  return (
    <div className="wrap">
      <h1>Flipmine — Global Dashboard</h1>
      <div className="subtitle">Live — sourcing refreshed from Google Sheets on every load · sales updated via /admin uploads · generated {new Date(generatedAt).toLocaleString()}</div>

      <div className="kpi-band">
        <div className="kpi"><div className="kpi-label">Deals Bought</div><div className="kpi-value">{sourcing.total_count}</div><div className="kpi-sub">across {sourcing.clients.length} sourcing clients</div></div>
        <div className="kpi"><div className="kpi-label">Sourcing Spend</div><div className="kpi-value">{fmtMoney(sourcing.global.cost)}</div></div>
        <div className="kpi"><div className="kpi-label">Sourcing Profit</div><div className="kpi-value teal">{fmtMoney(sourcing.global.profit)}</div></div>
        <div className="kpi"><div className="kpi-label">Blended Sourcing ROI</div><div className="kpi-value accent">{fmtPct(sourcing.global.roi)}</div><div className="kpi-sub">{fmtPct(sourcing.global.corr_roi)} corrected</div></div>
        <div className="kpi"><div className="kpi-label">Sell-Side Profit</div><div className={`kpi-value ${salesTotalProfit < 0 ? 'rose' : 'teal'}`}>{fmtMoney(salesTotalProfit)}</div><div className="kpi-sub">{salesAccounts.length} accounts loaded</div></div>
      </div>

      <section>
        <h2>Client Leaderboard — Sourcing</h2>
        <div className="card">
          <table>
            <thead><tr><th>Client</th><th className="num">Deals</th><th className="num">Cost</th><th className="num">Profit</th><th className="num">ROI</th></tr></thead>
            <tbody>
              {sourcing.clients.map(c => {
                const d = sourcing.by_client[c];
                return (<tr key={c}><td style={{ fontWeight: 700 }}>{c}</td><td className="num">{d.n}</td><td className="num">{fmtMoney(d.cost)}</td><td className="num pos">{fmtMoney(d.profit)}</td><td className="num pos">{fmtPct(d.roi)}</td></tr>);
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Sourcer Efficiency</h2>
        <div className="card">
          <table>
            <thead><tr><th>Sourcer</th><th className="num">Deals</th><th className="num">Profit</th><th className="num">ROI</th><th>Clients</th></tr></thead>
            <tbody>
              {Object.entries(sourcing.sourcer_efficiency).sort((a, b) => b[1].roi - a[1].roi).map(([s, d]) => (
                <tr key={s}><td style={{ fontWeight: 700 }}>{s}</td><td className="num">{d.n}</td><td className="num pos">{fmtMoney(d.profit)}</td><td className="num pos">{fmtPct(d.roi)}</td><td style={{ color: 'var(--muted)' }}>{d.clients.join(', ')}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Beyond ARRIS — Other Deals Worth a Second Look</h2>
        <div className="card">
          <table>
            <thead><tr><th>Client</th><th>Sourcer</th><th>eBay Title</th><th className="num">Cost</th><th className="num">Profit</th><th className="num">ROI</th></tr></thead>
            <tbody>
              {sourcing.non_arris_outliers.map((o, i) => (
                <tr key={i}><td style={{ fontWeight: 700 }}>{o.client}</td><td>{o.sourcer}</td><td>{o.title || '—'}</td><td className="num">{fmtMoney(o.cost)}</td><td className="num pos">{fmtMoney(o.profit)}</td><td className="num" style={{ color: 'var(--rose)', fontWeight: 700 }}>{fmtPct(o.roi)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Sales &amp; Loss — All Accounts, Ranked by Profit</h2>
        {salesAccounts.length === 0 ? (
          <div className="card"><p style={{ color: 'var(--muted)' }}>No sales accounts uploaded yet. Go to <a href="/admin">/admin</a> to upload the first Sellerboard export.</p></div>
        ) : (
          <>
            <div className="card" style={{ marginBottom: 14 }}>
              <table>
                <thead><tr><th>Account</th><th></th><th className="num">Sales</th><th className="num">Profit</th><th className="num">Margin</th><th className="num">Updated</th></tr></thead>
                <tbody>
                  {salesAccounts.map(a => (
                    <tr key={`${a.client}|${a.marketplace}`}>
                      <td style={{ fontWeight: 700 }}>{a.client}</td>
                      <td><span className={`badge ${a.marketplace.toLowerCase()}`}>{a.marketplace}</span></td>
                      <td className="num">{fmtMoney(a.sales)}</td>
                      <td className={`num ${a.profit < 0 ? 'neg' : 'pos'}`}>{fmtMoney(a.profit)}</td>
                      <td className="num">{fmtPctRaw(a.margin)}</td>
                      <td className="num" style={{ color: 'var(--muted)', fontSize: 11 }}>{new Date(a.updatedAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid-2">
              {salesAccounts.map(a => (
                <div className="card" key={`detail-${a.client}|${a.marketplace}`}>
                  <h3 style={{ fontFamily: 'Sora, sans-serif', fontSize: 14.5, marginBottom: 12 }}>
                    {a.client} · <span className={`badge ${a.marketplace.toLowerCase()}`}>{a.marketplace}</span>
                  </h3>
                  <div className="grid-2">
                    <div>
                      <table><thead><tr><th>Top 5</th><th className="num">Profit</th></tr></thead>
                        <tbody>{a.top5.map((p, i) => <tr key={i}><td>{p.product}</td><td className="num pos">{fmtMoney(p.profit)}</td></tr>)}</tbody>
                      </table>
                    </div>
                    <div>
                      <table><thead><tr><th>Bottom 5</th><th className="num">Profit</th></tr></thead>
                        <tbody>{a.bottom5.map((p, i) => <tr key={i}><td>{p.product}</td><td className={`num ${p.profit < 0 ? 'neg' : 'pos'}`}>{fmtMoney(p.profit)}</td></tr>)}</tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <footer style={{ marginTop: 50, paddingTop: 18, borderTop: '1px solid var(--border)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: 'var(--muted)' }}>
        Sourcing: live from Google Sheets. Sales: last updated per account via /admin. <a href="/admin">Upload new data →</a>
      </footer>
    </div>
  );
}
