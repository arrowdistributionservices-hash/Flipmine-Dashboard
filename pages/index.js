import { useEffect, useMemo, useRef, useState, Fragment } from 'react';
import Script from 'next/script';

// ---------------- Formatting ----------------
function fmtMoney(v) {
  if (v === null || v === undefined || isNaN(v)) return '–';
  const sign = v < 0 ? '−' : '';
  return sign + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtMoney0(v) {
  if (v === null || v === undefined || isNaN(v)) return '–';
  const sign = v < 0 ? '−' : '';
  return sign + '$' + Math.round(Math.abs(v)).toLocaleString('en-US');
}
function fmtMoneyShort(v) {
  if (v === null || v === undefined || isNaN(v)) return '–';
  const a = Math.abs(v);
  if (a >= 1000) return (v < 0 ? '−' : '') + '$' + (a / 1000).toFixed(1) + 'K';
  return fmtMoney0(v);
}
function fmtPct(v) { if (v === null || v === undefined || isNaN(v)) return '–'; return (v * 100).toFixed(1) + '%'; }
function fmtPctRaw(v) { if (v === null || v === undefined || isNaN(v)) return '–'; return v.toFixed(1) + '%'; }
function plural(n, one, many) { return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`; }

// ---------------- Dates ----------------
function parseUsDate(s) {
  if (!s) return null;
  const parts = String(s).split('/');
  if (parts.length !== 3) return null;
  const d = new Date(parseInt(parts[2], 10), parseInt(parts[0], 10) - 1, parseInt(parts[1], 10));
  return isNaN(d.getTime()) ? null : d;
}
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d) { return addDays(startOfDay(d), -((d.getDay() + 6) % 7)); } // Monday
function daysBetween(a, b) { return Math.round((startOfDay(b) - startOfDay(a)) / 86400000); }
function usKey(d) { return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`; }
function isoKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function fromIso(s) { const [y, m, d] = String(s || '').split('-').map(Number); return y && m && d ? new Date(y, m - 1, d) : null; }
function fmtDay(d) { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function fmtDow(d) { return d.toLocaleDateString('en-US', { weekday: 'short' }); }

// Purchasing Log keys -> display names. Brands added to the sheet later show under their own name.
const SOURCE_LABELS = { Nabeel: 'Nabeel (LEGO)', Hasan: 'Hasan', Faqahat: 'Faqahat (Arris)', Google: 'Google', Mattel: 'Mattel', Hasbro: 'Hasbro', StarWars: 'Star Wars' };
const sourceLabel = (k) => SOURCE_LABELS[k] || k;
const SOURCERS = ['Hasan', 'Nabeel', 'Faqahat', 'Scraper/Automated'];

// One entry per logged day, oldest first, with the per-buyer split.
function buildDays(bySource) {
  const map = {};
  Object.entries(bySource || {}).forEach(([src, dates]) => {
    Object.entries(dates || {}).forEach(([key, v]) => {
      const date = parseUsDate(key);
      if (!date) return;
      if (!map[key]) map[key] = { key, date, purchasing: 0, profit: 0, bySrc: {} };
      map[key].purchasing += v.purchasing || 0;
      map[key].profit += v.profit || 0;
      map[key].bySrc[src] = v;
    });
  });
  return Object.values(map).sort((a, b) => a.date - b.date);
}

function sumRange(days, start, end) {
  let p = 0, f = 0, n = 0;
  days.forEach(d => { if (d.date >= start && d.date <= end) { p += d.purchasing; f += d.profit; n++; } });
  return { p, f, n, roi: p ? f / p : null };
}

const PRESETS = [
  ['week', 'This week'], ['lastweek', 'Last week'], ['month', 'This month'], ['30d', 'Last 30 days'], ['custom', 'Custom…'],
];

function computeRange(preset, today, custom) {
  if (preset === 'week') {
    const start = startOfWeek(today);
    return { start, end: today, prevStart: addDays(start, -7), prevEnd: addDays(today, -7), short: 'this week', compare: 'same days last week' };
  }
  if (preset === 'lastweek') {
    const start = addDays(startOfWeek(today), -7);
    return { start, end: addDays(start, 6), prevStart: addDays(start, -7), prevEnd: addDays(start, -1), short: 'last week', compare: 'the week before' };
  }
  if (preset === 'month') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const prevStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const prevMonthEnd = addDays(start, -1);
    const prevEnd = addDays(prevStart, daysBetween(start, today));
    return { start, end: today, prevStart, prevEnd: prevEnd < prevMonthEnd ? prevEnd : prevMonthEnd, short: 'this month', compare: 'same days last month' };
  }
  if (preset === 'custom') {
    const s = fromIso(custom.from), e = fromIso(custom.to);
    if (s && e && s <= e) {
      const len = daysBetween(s, e) + 1;
      return { start: s, end: e, prevStart: addDays(s, -len), prevEnd: addDays(s, -1), short: `${fmtDay(s)} to ${fmtDay(e)}`, compare: `the ${len} days before` };
    }
  }
  const start = addDays(today, -29);
  return { start, end: today, prevStart: addDays(start, -30), prevEnd: addDays(start, -1), short: 'last 30 days', compare: 'the 30 days before' };
}

export default function Home() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [chartReady, setChartReady] = useState(false);
  const [mode, setMode] = useState('recorded');
  const [tab, setTab] = useState('overview');

  // Each tab is its own view; the URL hash (#purchasing etc.) keeps the open tab on reload and makes it linkable.
  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.replace('#', '');
      setTab(TABS.some(([t]) => t === id) ? id : 'overview');
      window.scrollTo(0, 0);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);

  useEffect(() => {
    fetch('/api/data')
      .then(r => r.json().then(j => ({ ok: r.ok, body: j })))
      .then(({ ok, body }) => {
        if (!ok || !body || !body.sourcing) { setError((body && (body.error || body.detail)) || 'Unexpected response'); return; }
        setData(body);
      })
      .catch(e => setError(String(e)));
  }, []);

  const days = useMemo(() => buildDays(data && data.purchasing && data.purchasing.bySource), [data]);

  if (error) {
    return (
      <div className="wrap" style={{ maxWidth: 640 }}>
        <h1>Flipmine</h1>
        <p className="section-note" style={{ marginTop: 16 }}>Couldn&apos;t load live data: {error}</p>
        <p className="subtitle">The Flipmine Deals sheet must be shared as &quot;Anyone with the link can view&quot; for the dashboard to read it.</p>
      </div>
    );
  }
  if (!data) return <div className="wrap" style={{ color: 'var(--muted)' }}>Loading live data…</div>;

  const { sourcing, sales, purchasing, generatedAt } = data;
  const salesAccounts = Object.values(sales || {});
  const lastEntry = days.length ? days[days.length - 1].date : null;

  return (
    <>
      <Script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js" strategy="afterInteractive" onLoad={() => setChartReady(true)} />
      <GlobalNav lastEntry={lastEntry} active={tab} />
      <main className="gsection">
        {tab === 'overview' && (
          <Overview sourcing={sourcing} days={days} weekly={(purchasing && purchasing.weekly) || []} bySource={(purchasing && purchasing.bySource) || {}}
            salesAccounts={salesAccounts} mode={mode} setMode={setMode} generatedAt={generatedAt} chartReady={chartReady} />
        )}
        {tab === 'purchasing' && <PurchasingSection days={days} weekly={(purchasing && purchasing.weekly) || []} />}
        {tab === 'clients' && <ClientsSection sourcing={sourcing} mode={mode} setMode={setMode} chartReady={chartReady} />}
        {tab === 'sales' && <SalesLoss salesAccounts={salesAccounts} sourcing={sourcing} />}
      </main>
    </>
  );
}

const TABS = [['overview', 'Overview'], ['purchasing', 'Purchasing'], ['clients', 'Clients'], ['sales', 'Sales']];

function GlobalNav({ lastEntry, active }) {
  const today = startOfDay(new Date());
  const gap = lastEntry ? daysBetween(lastEntry, today) : null;
  let warning = null;
  if (gap === 2) warning = `Nothing logged for ${fmtDay(addDays(lastEntry, 1))}`;
  else if (gap > 2) warning = `Nothing logged since ${fmtDay(lastEntry)}`;

  return (
    <header className="gnav">
      <div className="gnav-inner">
        <span className="gnav-brand">Flipmine</span>
        <nav className="gnav-links">
          {TABS.map(([id, label]) => (
            <a key={id} href={`#${id}`} className={active === id ? 'active' : ''} aria-current={active === id ? 'page' : undefined}>{label}</a>
          ))}
        </nav>
        <div className="gnav-status">
          {lastEntry && <span>Last purchase logged: {fmtDow(lastEntry)}, {fmtDay(lastEntry)}</span>}
          {warning && (
            <span className="pill-warn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5" /><path d="M12 16h.01" /></svg>
              {warning}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}

function Delta({ cur, prev, compare, kind }) {
  if (!prev || prev.n === 0) return <div className="kpi-sub">Nothing logged in {compare}</div>;
  if (kind === 'roi') {
    if (cur.roi === null || prev.roi === null) return <div className="kpi-sub">vs {compare}</div>;
    const pts = (cur.roi - prev.roi) * 100;
    return <div className="kpi-sub"><span className={pts >= 0 ? 'up' : 'down'}>{pts >= 0 ? '▲' : '▼'} {Math.abs(pts).toFixed(1)} pts</span> vs {compare} ({fmtPct(prev.roi)})</div>;
  }
  const a = kind === 'profit' ? cur.f : cur.p;
  const b = kind === 'profit' ? prev.f : prev.p;
  if (!b) return <div className="kpi-sub">vs {compare}</div>;
  const pct = ((a - b) / b) * 100;
  return <div className="kpi-sub"><span className={pct >= 0 ? 'up' : 'down'}>{pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(0)}%</span> vs {compare} ({fmtMoney0(b)})</div>;
}

function Overview({ sourcing, days, weekly, bySource, salesAccounts, mode, setMode, generatedAt, chartReady }) {
  const [preset, setPreset] = useState('week');
  const today = startOfDay(new Date());
  const [custom, setCustom] = useState({ from: isoKey(addDays(today, -13)), to: isoKey(today) });
  const range = computeRange(preset, today, custom);
  const cur = sumRange(days, range.start, range.end);
  const prev = sumRange(days, range.prevStart, range.prevEnd);
  const avg = cur.n ? cur.p / cur.n : null;

  return (
    <>
      <div className="page-head">
        <h1>Overview</h1>
        <div className="seg" role="group" aria-label="Date range">
          {PRESETS.map(([id, label]) => (
            <button key={id} type="button" className={preset === id ? 'active' : ''} aria-pressed={preset === id} onClick={() => setPreset(id)}>{label}</button>
          ))}
        </div>
      </div>
      {preset === 'custom' && (
        <div className="custom-range">
          <label>From <input type="date" value={custom.from} onChange={e => setCustom(c => ({ ...c, from: e.target.value }))} /></label>
          <label>To <input type="date" value={custom.to} onChange={e => setCustom(c => ({ ...c, to: e.target.value }))} /></label>
        </div>
      )}

      <section className="kpis" aria-label="Purchasing in the selected period">
        <div className="kpi"><div className="kpi-label">Purchasing {range.short}</div><div className="kpi-value">{fmtMoney0(cur.p)}</div><Delta cur={cur} prev={prev} compare={range.compare} kind="spend" /></div>
        <div className="kpi"><div className="kpi-label">Est. profit {range.short}</div><div className="kpi-value">{fmtMoney0(cur.f)}</div><Delta cur={cur} prev={prev} compare={range.compare} kind="profit" /></div>
        <div className="kpi"><div className="kpi-label">Est. ROI {range.short}</div><div className="kpi-value">{fmtPct(cur.roi)}</div><Delta cur={cur} prev={prev} compare={range.compare} kind="roi" /></div>
        <div className="kpi"><div className="kpi-label">Daily average, {range.short}</div><div className="kpi-value">{fmtMoney0(avg)}</div><div className="kpi-sub">{plural(cur.n, 'buying day', 'buying days')}, {fmtDay(range.start)} to {fmtDay(range.end)}</div></div>
      </section>

      <WeeklyChart weekly={weekly} today={today} />

      <BrandsCard sourcing={sourcing} bySource={bySource} lastEntry={days.length ? days[days.length - 1].date : null} chartReady={chartReady} />

      <div className="row">
        <RecentDays days={days} />
        <BuyersCard bySource={bySource} range={range} today={today} />
      </div>

      <ClientsTable sourcing={sourcing} mode={mode} setMode={setMode} />

      {salesAccounts.length === 0 ? (
        <div className="empty-line">
          <span>Sell-side results appear here once a Sellerboard export is uploaded.</span>
          <a href="/admin" className="strong">Upload in Admin</a>
        </div>
      ) : (
        <div className="empty-line">
          <span>{plural(salesAccounts.length, 'sell-side account', 'sell-side accounts')} loaded, net {fmtMoney0(salesAccounts.reduce((a, r) => a + (r.profit || 0), 0))}.</span>
          <a href="#sales" className="strong">See sales</a>
        </div>
      )}

      <footer>
        Purchasing figures come from the Purchasing Log tab. Deal, brand and client figures come from rows marked Bought across the Flipmine Deals sheet. Data loaded {new Date(generatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.
      </footer>
    </>
  );
}

function WeeklyChart({ weekly, today }) {
  const weeks = weekly.slice(-12);
  const thisWeek = usKey(startOfWeek(today));
  const max = Math.max(...weeks.map(w => w.total || 0), 1);
  const hasWholesale = weeks.some(w => w.wholesale);
  const PX = 190;
  return (
    <section className="card" aria-labelledby="weekly-h">
      <div className="section-head">
        <h2 id="weekly-h">Weekly purchasing</h2>
        <span className="section-desc">Last {weeks.length} weeks, Monday to Sunday</span>
        <a href="#purchasing" className="push" style={{ fontSize: 13, fontWeight: 500 }}>See all weeks</a>
      </div>
      {weeks.length === 0 ? <p className="section-note" style={{ marginTop: 16 }}>No purchasing logged yet.</p> : (
        <>
          <div className="bars">
            {weeks.map(w => {
              const current = w.start === thisWeek;
              const main = w.e2aE2w || 0, whole = w.wholesale || 0;
              return (
                <div className="bar-col" key={w.week} title={`${w.week}: ${fmtMoney0(w.total)}`}>
                  <div className="bar-val">{fmtMoneyShort(w.total)}{current ? ' so far' : ''}</div>
                  <div className="bar-stack">
                    {whole > 0 && <div className="bar-seg" style={{ height: Math.round((whole / max) * PX), background: 'var(--grey-bar)' }} />}
                    <div className="bar-seg" style={{ height: Math.max(3, Math.round((main / max) * PX)), background: current ? 'var(--accent-light)' : 'var(--accent)' }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="bar-labels">{weeks.map(w => <div key={w.week}>{w.week.split(' - ')[0]}</div>)}</div>
          <div className="legend">
            <span><i className="swatch" style={{ background: 'var(--accent)' }} />Full week</span>
            <span><i className="swatch" style={{ background: 'var(--accent-light)' }} />This week so far</span>
            {hasWholesale && <span><i className="swatch" style={{ background: 'var(--grey-bar)' }} />Wholesale</span>}
          </div>
        </>
      )}
    </section>
  );
}

function DayRows({ list }) {
  const [open, setOpen] = useState(null);
  return list.map(d => (
    <Fragment key={d.key}>
      <tr className="clickable" onClick={() => setOpen(open === d.key ? null : d.key)} aria-expanded={open === d.key}>
        <td><span className="strong">{fmtDay(d.date)}</span> <span className="muted-cell" style={{ fontSize: 13 }}>{fmtDow(d.date)}</span> <span className="muted-cell" style={{ fontSize: 11 }}>{open === d.key ? '▾' : '▸'}</span></td>
        <td className="num">{fmtMoney0(d.purchasing)}</td>
        <td className="num">{fmtMoney0(d.profit)}</td>
        <td className="num">{fmtPct(d.purchasing ? d.profit / d.purchasing : null)}</td>
      </tr>
      {open === d.key && (
        <tr className="detail"><td colSpan={4}>
          {Object.entries(d.bySrc).sort((a, b) => b[1].purchasing - a[1].purchasing).map(([src, v]) => (
            <div className="detail-line" key={src}><span>{sourceLabel(src)}</span><span className="num">{fmtMoney0(v.purchasing)} · {fmtMoney0(v.profit)} profit</span></div>
          ))}
        </td></tr>
      )}
    </Fragment>
  ));
}

function RecentDays({ days }) {
  const last7 = days.slice(-7).reverse();
  return (
    <section className="card half" aria-labelledby="days-h">
      <div className="section-head"><h2 id="days-h">Last 7 buying days</h2></div>
      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table>
          <thead><tr><th>Day</th><th className="num">Purchasing</th><th className="num">Profit</th><th className="num">ROI</th></tr></thead>
          <tbody><DayRows list={last7} /></tbody>
        </table>
      </div>
    </section>
  );
}

function BuyersCard({ bySource, range, today }) {
  const cutoff = addDays(today, -29);
  const rows = Object.entries(bySource).map(([src, dates]) => {
    let spend = 0, last = null, recent = 0;
    Object.entries(dates || {}).forEach(([k, v]) => {
      const d = parseUsDate(k);
      if (!d) return;
      if (d >= range.start && d <= range.end) spend += v.purchasing || 0;
      if (d >= cutoff) recent += v.purchasing || 0;
      if (!last || d > last) last = d;
    });
    return { src, spend, last, active: recent > 0 };
  }).filter(r => r.last).sort((a, b) => b.last - a.last);
  const active = rows.filter(r => r.active);
  let summary = 'No buyer has logged purchasing in the last 30 days.';
  if (active.length === 1) summary = `Only ${sourceLabel(active[0].src)} has logged purchasing in the last 30 days.`;
  else if (active.length > 1) summary = `${active.length} of ${rows.length} buyers logged purchasing in the last 30 days.`;
  return (
    <section className="card half" aria-labelledby="buyers-h">
      <div className="section-head"><h2 id="buyers-h">Buyers</h2><span className="section-desc">From the Purchasing Log</span></div>
      <p className="section-note" style={{ marginTop: 10 }}>{summary}</p>
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table>
          <thead><tr><th>Buyer / brand</th><th className="num">Purchasing, {range.short}</th><th className="num">Last entry</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.src} style={{ color: r.active ? 'var(--text)' : 'var(--muted)' }}>
                <td className="strong">{sourceLabel(r.src)}</td>
                <td className="num">{r.spend ? fmtMoney0(r.spend) : '–'}</td>
                <td className="num">{fmtDay(r.last)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Categorical colours in a fixed order, tied to the entity (never to its rank), so a brand keeps
// its colour across periods. Validated for colour-blind separation; slices beyond these fold into Other.
const SLICE_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const OTHER_COLOR = '#8A93A3';
const BRAND_COLOR = { LEGO: 0, Google: 1, ARRIS: 2, Honeywell: 3, DeWalt: 4, Milwaukee: 5, Ninja: 6, PoolGuard: 7 };
const BUYER_COLOR = { Nabeel: 0, Google: 1, Faqahat: 2, Hasan: 3, Mattel: 4, Hasbro: 5, StarWars: 6 };

const PERIODS = [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['all', 'All time'], ['custom', 'Custom…']];

function periodRange(period, anchor, custom) {
  if (period === 'day') return { start: anchor, end: anchor, label: `${fmtDow(anchor)}, ${fmtDay(anchor)}` };
  if (period === 'week') { const s = startOfWeek(anchor); const e = addDays(s, 6); return { start: s, end: e, label: `${fmtDay(s)} to ${fmtDay(e)}` }; }
  if (period === 'month') {
    const s = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    return { start: s, end: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0), label: s.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
  }
  if (period === 'custom') {
    const s = fromIso(custom.from), e = fromIso(custom.to);
    if (s && e && s <= e) return { start: s, end: e, label: `${fmtDay(s)} to ${fmtDay(e)}` };
  }
  return null; // all time
}

function shiftAnchor(period, anchor, dir) {
  if (period === 'day') return addDays(anchor, dir);
  if (period === 'week') return addDays(anchor, 7 * dir);
  return new Date(anchor.getFullYear(), anchor.getMonth() + dir, Math.min(anchor.getDate(), 28));
}

function BrandsCard({ sourcing, bySource, lastEntry, chartReady }) {
  const [period, setPeriod] = useState('week');
  const [anchor, setAnchor] = useState(() => lastEntry || startOfDay(new Date()));
  const [custom, setCustom] = useState(() => ({ from: isoKey(addDays(anchor, -13)), to: isoKey(anchor) }));
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  const range = periodRange(period, anchor, custom);
  const inRange = (key) => { const d = parseUsDate(key); return d && (!range || (d >= range.start && d <= range.end)); };

  // Real brands where purchases carry a date; otherwise the Purchasing Log's split by buyer.
  const brandRows = [];
  if (!range) {
    (sourcing.brand_breakdown || []).forEach(b => brandRows.push({ key: b.brand, name: b.brand, cost: b.cost, profit: b.profit, n: b.n }));
    // Deals whose title matches no brand, so the total agrees with the Clients table.
    const g = sourcing.global || {};
    const other = { cost: (g.cost || 0) - brandRows.reduce((a, r) => a + r.cost, 0), profit: (g.profit || 0) - brandRows.reduce((a, r) => a + r.profit, 0), n: (g.n || 0) - brandRows.reduce((a, r) => a + r.n, 0) };
    if (other.cost > 0.5) brandRows.push({ key: 'Other', name: 'Other', ...other });
  } else {
    Object.entries(sourcing.brand_by_day || {}).forEach(([brand, dates]) => {
      let cost = 0, profit = 0, n = 0;
      Object.entries(dates).forEach(([k, v]) => { if (inRange(k)) { cost += v.cost; profit += v.profit; n += v.n; } });
      if (cost > 0) brandRows.push({ key: brand, name: brand, cost, profit, n });
    });
  }
  const logRows = [];
  if (range) {
    Object.entries(bySource || {}).forEach(([src, dates]) => {
      let cost = 0, profit = 0;
      Object.entries(dates || {}).forEach(([k, v]) => { if (inRange(k)) { cost += v.purchasing || 0; profit += v.profit || 0; } });
      if (cost > 0) logRows.push({ key: src, name: sourceLabel(src), cost, profit, n: null });
    });
  }
  const brandTotal = brandRows.reduce((a, r) => a + r.cost, 0);
  const logTotal = logRows.reduce((a, r) => a + r.cost, 0);
  // Dated deals must account for nearly all of the period's logged spend, or the brand split would undercount.
  const useBrands = !range || (brandTotal > 0 && brandTotal >= 0.9 * logTotal);
  const source = useBrands ? 'brands' : 'buyers';
  const colorIdx = useBrands ? BRAND_COLOR : BUYER_COLOR;

  let rows = (useBrands ? brandRows : logRows).sort((a, b) => b.cost - a.cost);
  const named = rows.filter(r => colorIdx[r.key] !== undefined);
  const rest = rows.filter(r => colorIdx[r.key] === undefined);
  rows = named.map(r => ({ ...r, color: SLICE_COLORS[colorIdx[r.key]] }));
  if (rest.length) {
    rows.push(rest.reduce((o, r) => ({ ...o, cost: o.cost + r.cost, profit: o.profit + r.profit, n: o.n === null ? null : o.n + (r.n || 0) }),
      { key: 'Other', name: rest.length === 1 && rest[0].key !== 'Other' ? rest[0].name : 'Other', cost: 0, profit: 0, n: useBrands ? 0 : null, color: OTHER_COLOR }));
  }
  const total = rows.reduce((a, r) => a + r.cost, 0);
  const sig = rows.map(r => `${r.key}:${r.cost.toFixed(2)}`).join('|');

  useEffect(() => {
    if (!chartReady || !window.Chart || !canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = null;
    if (!rows.length) return;
    chartRef.current = new window.Chart(canvasRef.current, {
      type: 'pie',
      data: { labels: rows.map(r => r.name), datasets: [{ data: rows.map(r => r.cost), backgroundColor: rows.map(r => r.color), borderColor: '#FFFFFF', borderWidth: 2 }] },
      options: { maintainAspectRatio: false, animation: false, plugins: { legend: { display: false },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmtMoney0(ctx.raw)} (${fmtPct(total ? ctx.raw / total : 0)})` } } } },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartReady, sig]);
  useEffect(() => () => { if (chartRef.current) chartRef.current.destroy(); }, []);

  const stepLabel = { day: 'day', week: 'week', month: 'month' }[period];
  return (
    <section className="card" aria-labelledby="brands-h">
      <div className="section-head">
        <h2 id="brands-h">Purchases by brand</h2>
        <div className="seg push" role="group" aria-label="Brand period">
          {PERIODS.map(([id, label]) => (
            <button key={id} type="button" className={period === id ? 'active' : ''} aria-pressed={period === id} onClick={() => setPeriod(id)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="period-bar">
        {stepLabel && <button type="button" className="step-btn" aria-label={`Previous ${stepLabel}`} onClick={() => setAnchor(a => shiftAnchor(period, a, -1))}>‹</button>}
        {period === 'custom' ? (
          <div className="custom-range">
            <label>From <input type="date" value={custom.from} onChange={e => setCustom(c => ({ ...c, from: e.target.value }))} /></label>
            <label>To <input type="date" value={custom.to} onChange={e => setCustom(c => ({ ...c, to: e.target.value }))} /></label>
          </div>
        ) : <span className="period-label">{range ? range.label : 'All time'}</span>}
        {stepLabel && <button type="button" className="step-btn" aria-label={`Next ${stepLabel}`} onClick={() => setAnchor(a => shiftAnchor(period, a, 1))}>›</button>}
        <span className="section-desc">{source === 'brands' ? `Bought deals${range ? ' with a purchase date' : ''}` : 'Split by buyer, from the Purchasing Log'}</span>
      </div>
      {rows.length === 0 ? <p className="section-note" style={{ marginTop: 12 }}>Nothing purchased in this period.</p> : (
        <div className="pie-layout">
          <div className="pie-box"><canvas ref={canvasRef} aria-label={`Pie chart of purchasing by ${source === 'brands' ? 'brand' : 'buyer'}`} role="img" /></div>
          <div className="table-wrap" style={{ flex: '1 1 340px', minWidth: 0 }}>
            <table>
              <thead><tr><th>{source === 'brands' ? 'Brand' : 'Buyer / brand'}</th><th className="num">Purchasing</th><th className="num">Share</th>{source === 'brands' && <th className="num">Deals</th>}<th className="num">Profit</th><th className="num">ROI</th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.key}>
                    <td className="strong" style={{ whiteSpace: 'nowrap' }}><span className="swatch" style={{ background: r.color, marginRight: 8 }} />{r.name}</td>
                    <td className="num">{fmtMoney0(r.cost)}</td>
                    <td className="num">{fmtPct(total ? r.cost / total : null)}</td>
                    {source === 'brands' && <td className="num">{(r.n || 0).toLocaleString('en-US')}</td>}
                    <td className="num">{fmtMoney0(r.profit)}</td>
                    <td className="num">{fmtPct(r.cost ? r.profit / r.cost : null)}</td>
                  </tr>
                ))}
                <tr className="total"><td>Total</td><td className="num">{fmtMoney0(total)}</td><td className="num">100%</td>{source === 'brands' && <td className="num">{rows.reduce((a, r) => a + (r.n || 0), 0).toLocaleString('en-US')}</td>}<td className="num">{fmtMoney0(rows.reduce((a, r) => a + r.profit, 0))}</td><td className="num">{fmtPct(total ? rows.reduce((a, r) => a + r.profit, 0) / total : null)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
      {source === 'buyers' && (
        <p className="section-note" style={{ marginTop: 12, fontSize: 13, color: 'var(--muted)' }}>
          Most purchases in this period have no Purchase Date on the sheet yet, so this shows the split by buyer. It switches to real brands once the manual tabs&apos; Purchase Date column is filled in.
        </p>
      )}
    </section>
  );
}

function ClientsTable({ sourcing, mode, setMode }) {
  const [sort, setSort] = useState({ key: 'cost', dir: -1 });
  const val = (d, rec, corr) => (mode === 'recorded' ? d[rec] : (d[corr] ?? d[rec]));
  const rows = sourcing.clients.map(c => {
    const d = sourcing.by_client[c];
    const mkts = ['Walmart', 'Amazon'].filter(m => sourcing.by_client_mkt && sourcing.by_client_mkt[`${c}|${m}`] && sourcing.by_client_mkt[`${c}|${m}`].n > 0);
    return { name: c, mkt: mkts.join(', '), n: d.n, cost: val(d, 'cost', 'corr_cost'), profit: val(d, 'profit', 'corr_profit'), roi: val(d, 'roi', 'corr_roi') };
  });
  rows.sort((a, b) => (sort.key === 'name' ? a.name.localeCompare(b.name) : a[sort.key] - b[sort.key]) * sort.dir);
  const maxProfit = Math.max(...rows.map(r => r.profit), 1);
  const g = sourcing.global;
  const head = (key, label, num) => (
    <th className={num ? 'num' : ''} aria-sort={sort.key === key ? (sort.dir < 0 ? 'descending' : 'ascending') : 'none'}>
      <button type="button" className={`sort-btn ${sort.key === key ? 'active' : ''}`} onClick={() => setSort(s => ({ key, dir: s.key === key ? -s.dir : (key === 'name' ? 1 : -1) }))}>
        {label}{sort.key === key ? (sort.dir < 0 ? ' ▼' : ' ▲') : ''}
      </button>
    </th>
  );
  return (
    <section className="card" aria-labelledby="clients-h">
      <div className="section-head">
        <h2 id="clients-h">Clients</h2>
        <span className="section-desc">Bought deals, all time</span>
        <label className="check push">
          <input type="checkbox" checked={mode === 'corrected'} onChange={e => setMode(e.target.checked ? 'corrected' : 'recorded')} />
          Use $2/unit actual prep cost
        </label>
      </div>
      <div className="table-wrap" style={{ marginTop: 8 }}>
        <table>
          <thead><tr>{head('name', 'Client')}<th>Marketplace</th>{head('n', 'Deals', true)}{head('cost', 'Cost', true)}{head('profit', 'Profit', true)}{head('roi', 'ROI', true)}<th style={{ width: '20%' }}>Share of profit</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.name}>
                <td className="strong">{r.name}</td>
                <td className="muted-cell">{r.mkt}</td>
                <td className="num">{r.n.toLocaleString('en-US')}</td>
                <td className="num">{fmtMoney0(r.cost)}</td>
                <td className="num">{fmtMoney0(r.profit)}</td>
                <td className="num">{fmtPct(r.roi)}</td>
                <td><div className="share"><div style={{ width: `${Math.max(0, r.profit / maxProfit) * 100}%` }} /></div></td>
              </tr>
            ))}
            <tr className="total">
              <td>All clients</td><td />
              <td className="num">{g.n.toLocaleString('en-US')}</td>
              <td className="num">{fmtMoney0(val(g, 'cost', 'corr_cost'))}</td>
              <td className="num">{fmtMoney0(val(g, 'profit', 'corr_profit'))}</td>
              <td className="num">{fmtPct(val(g, 'roi', 'corr_roi'))}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PurchasingSection({ days, weekly }) {
  const weeksDesc = [...weekly].reverse();
  const last30 = days.slice(-30).reverse();
  return (
    <>
      <div className="page-head"><h1>Purchasing</h1></div>
      <div className="row">
        <section className="card half" aria-labelledby="allweeks-h">
          <div className="section-head"><h2 id="allweeks-h">Every week</h2><span className="section-desc">Monday to Sunday, newest first</span></div>
          <div className="table-wrap" style={{ marginTop: 16 }}>
            <table>
              <thead><tr><th>Week</th><th className="num">E2A &amp; E2W</th><th className="num">Wholesale</th><th className="num">Total</th></tr></thead>
              <tbody>
                {weeksDesc.map(w => (
                  <tr key={w.week}>
                    <td className="strong">{w.week}</td>
                    <td className="num">{fmtMoney0(w.e2aE2w)}</td>
                    <td className="num muted-cell">{w.wholesale ? fmtMoney0(w.wholesale) : '–'}</td>
                    <td className="num strong">{fmtMoney0(w.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card half" aria-labelledby="alldays-h">
          <div className="section-head"><h2 id="alldays-h">Last 30 buying days</h2><span className="section-desc">Click a day for the split by buyer</span></div>
          <div className="table-wrap" style={{ marginTop: 16 }}>
            <table>
              <thead><tr><th>Day</th><th className="num">Purchasing</th><th className="num">Profit</th><th className="num">ROI</th></tr></thead>
              <tbody><DayRows list={last30} /></tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

function ClientsSection({ sourcing, mode, setMode, chartReady }) {
  const [breakdown, setBreakdown] = useState('mkt');
  const profitChartRef = useRef(null);
  const roiChartRef = useRef(null);
  const chartInstances = useRef({});

  const val = (d, recKey, corrKey) => (mode === 'recorded' ? d[recKey] : (d[corrKey] ?? d[recKey]));

  // The tab unmounts when another tab opens; free its charts with it.
  useEffect(() => () => Object.values(chartInstances.current).forEach(c => c && c.destroy()), []);

  useEffect(() => {
    if (!chartReady || typeof window === 'undefined' || !window.Chart) return;
    const Chart = window.Chart;
    Chart.defaults.color = '#5B6372';
    Chart.defaults.borderColor = '#E3E6EB';
    Chart.defaults.font.family = "'IBM Plex Sans', sans-serif";
    const accent = '#2F5BEA';

    const labels = [...sourcing.clients].sort((a, b) => val(sourcing.by_client[b], 'profit', 'corr_profit') - val(sourcing.by_client[a], 'profit', 'corr_profit'));
    const profits = labels.map(c => val(sourcing.by_client[c], 'profit', 'corr_profit'));
    const rois = labels.map(c => val(sourcing.by_client[c], 'roi', 'corr_roi'));
    const grid = { color: '#EEF0F3' };

    const make = (key, ref, config) => {
      if (chartInstances.current[key]) chartInstances.current[key].destroy();
      if (ref.current) chartInstances.current[key] = new Chart(ref.current, config);
    };
    make('profit', profitChartRef, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Profit', data: profits, backgroundColor: accent, borderRadius: 4 }] },
      options: { maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtMoney0(ctx.raw) } } },
        scales: { y: { ticks: { callback: v => fmtMoneyShort(v) }, grid }, x: { grid: { display: false } } } },
    });
    make('roi', roiChartRef, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'ROI', data: rois, backgroundColor: accent, borderRadius: 4 }] },
      options: { maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtPct(ctx.raw) } } },
        scales: { y: { ticks: { callback: v => (v * 100).toFixed(0) + '%' }, grid }, x: { grid: { display: false } } } },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartReady, mode, sourcing]);

  const dims = breakdown === 'mkt' ? ['Amazon', 'Walmart'] : SOURCERS;
  const srcMap = breakdown === 'mkt' ? sourcing.by_client_mkt : sourcing.by_client_src;
  return (
    <>
      <div className="page-head">
        <h1>Clients</h1>
        <label className="check push" style={{ marginLeft: 'auto' }}>
          <input type="checkbox" checked={mode === 'corrected'} onChange={e => setMode(e.target.checked ? 'corrected' : 'recorded')} />
          Use $2/unit actual prep cost
        </label>
      </div>

      <div className="charts-grid">
        <div className="card"><h3>Profit by client</h3><div className="chart-box"><canvas ref={profitChartRef} /></div></div>
        <div className="card"><h3>ROI by client</h3><div className="chart-box"><canvas ref={roiChartRef} /></div></div>
      </div>

      <section className="card" aria-labelledby="split-h">
        <div className="section-head">
          <h2 id="split-h">Each client, split by {breakdown === 'mkt' ? 'marketplace' : 'sourcer'}</h2>
          <div className="toggle-row push">
            <button type="button" className={`btab ${breakdown === 'mkt' ? 'active' : ''}`} aria-pressed={breakdown === 'mkt'} onClick={() => setBreakdown('mkt')}>By marketplace</button>
            <button type="button" className={`btab ${breakdown === 'src' ? 'active' : ''}`} aria-pressed={breakdown === 'src'} onClick={() => setBreakdown('src')}>By sourcer</button>
          </div>
        </div>
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table>
            <thead><tr><th>Client</th><th>{breakdown === 'mkt' ? 'Marketplace' : 'Sourcer'}</th><th className="num">Deals</th><th className="num">Cost</th><th className="num">Profit</th><th className="num">ROI</th></tr></thead>
            <tbody>
              {sourcing.clients.map(client => dims.map(dim => {
                const d = srcMap[`${client}|${dim}`];
                if (!d || d.n === 0) return null;
                return (
                  <tr key={`${client}|${dim}`}>
                    <td className="strong">{client}</td>
                    <td>{dim}</td>
                    <td className="num">{d.n.toLocaleString('en-US')}</td>
                    <td className="num">{fmtMoney0(val(d, 'cost', 'corr_cost'))}</td>
                    <td className="num">{fmtMoney0(val(d, 'profit', 'corr_profit'))}</td>
                    <td className="num">{fmtPct(val(d, 'roi', 'corr_roi'))}</td>
                  </tr>
                );
              }))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" aria-labelledby="outliers-h">
        <div className="section-head">
          <h2 id="outliers-h">Highest-ROI deals outside ARRIS</h2>
          <span className="section-desc">Top {sourcing.non_arris_outliers.length} bought deals by ROI</span>
        </div>
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table>
            <thead><tr><th>Client</th><th>Sourcer</th><th>Title</th><th className="num">Cost</th><th className="num">Profit</th><th className="num">ROI</th></tr></thead>
            <tbody>
              {sourcing.non_arris_outliers.map((o, i) => (
                <tr key={i}>
                  <td className="strong">{o.client}</td>
                  <td>{o.sourcer}</td>
                  <td style={{ minWidth: 260 }}>{o.title || '–'}</td>
                  <td className="num">{fmtMoney(o.cost)}</td>
                  <td className="num">{fmtMoney(o.profit)}</td>
                  <td className="num strong">{fmtPct(o.roi)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function SalesLoss({ salesAccounts, sourcing }) {
  if (salesAccounts.length === 0) {
    return (
      <>
        <div className="page-head"><h1>Sales</h1></div>
        <div className="empty-line">
          <span>No sell-side accounts uploaded yet.</span>
          <a href="/admin" className="strong">Upload a Sellerboard export in Admin</a>
        </div>
      </>
    );
  }

  const totalProfit = salesAccounts.reduce((a, r) => a + (r.profit || 0), 0);
  const totalSales = salesAccounts.reduce((a, r) => a + (r.sales || 0), 0);
  const ranked = [...salesAccounts].sort((a, b) => b.profit - a.profit);
  const maxAbs = Math.max(...ranked.map(a => Math.abs(a.profit)), 1);

  const byClient = {};
  salesAccounts.forEach(a => { (byClient[a.client] = byClient[a.client] || []).push(a); });
  const clientNames = Object.keys(byClient).sort((a, b) => byClient[b].reduce((s, x) => s + x.profit, 0) - byClient[a].reduce((s, x) => s + x.profit, 0));
  const withoutSales = sourcing.clients.filter(c => !byClient[c]);

  return (
    <>
      <div className="page-head"><h1>Sales</h1></div>

      <div className={`alert ${totalProfit < 0 ? '' : 'good'}`}>
        <div className="big">{fmtMoney0(totalProfit)}</div>
        <div className="txt">Net {totalProfit < 0 ? 'loss' : 'profit'} across {plural(salesAccounts.length, 'account', 'accounts')}, on {fmtMoney0(totalSales)} in sales.</div>
      </div>

      <div className="coverage">
        <span className="lbl">Accounts loaded</span>
        <div className="dots">
          {ranked.map(a => <div className="dot live" key={`${a.client}|${a.marketplace}`} title={`${a.client}, ${a.marketplace}`} />)}
          {Array.from({ length: Math.max(0, 13 - ranked.length) }).map((_, i) => <div className="dot" key={i} title="Not loaded" />)}
        </div>
        <span className="status">{ranked.length} of 13</span>
      </div>

      <section className="card" aria-labelledby="ranked-h">
        <h3 id="ranked-h">All accounts by net profit</h3>
        {ranked.map(a => (
          <div className="rank-row" key={`${a.client}|${a.marketplace}`}>
            <div className="rank-name">{a.client}, {a.marketplace}</div>
            <div className="rank-track"><div className={`rank-fill ${a.profit < 0 ? 'neg' : 'pos'}`} style={{ width: `${Math.max(2, (Math.abs(a.profit) / maxAbs) * 100)}%` }} /></div>
            <div className={`rank-profit ${a.profit < 0 ? 'neg' : ''}`}>{fmtMoney0(a.profit)}</div>
            <div className="rank-margin">{fmtPctRaw(a.margin)}</div>
          </div>
        ))}
      </section>

      {clientNames.map(client => (
        <section className="card" key={client} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="client-head">
            <div className="client-name">{client}</div>
            <div className="client-sub">{plural(byClient[client].length, 'account', 'accounts')}{sourcing.by_client[client] ? `, ${plural(sourcing.by_client[client].n, 'sourced deal', 'sourced deals')}` : ''}</div>
          </div>
          {byClient[client].map(a => (
            <div key={`${a.client}|${a.marketplace}`} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="account-head">
                <span className="account-tag">{a.marketplace}</span>
                <span className="account-title">{a.client}, {a.marketplace}</span>
                <span className="account-period">Sellerboard</span>
              </div>
              <div className="kpi-row">
                <div className="kpi"><div className="kpi-label">Sales</div><div className="kpi-value">{fmtMoney0(a.sales)}</div><div className="kpi-sub">{a.n} SKUs, {a.units} units</div></div>
                <div className="kpi"><div className="kpi-label">Net profit</div><div className={`kpi-value ${a.profit < 0 ? 'neg' : ''}`}>{fmtMoney0(a.profit)}</div><div className="kpi-sub">{fmtPctRaw(a.margin)} margin</div></div>
                {a.roi !== null && <div className="kpi"><div className="kpi-label">ROI</div><div className={`kpi-value ${a.roi < 0 ? 'neg' : ''}`}>{fmtPctRaw(a.roi)}</div></div>}
                {a.refunds !== null && <div className="kpi"><div className="kpi-label">Refund units</div><div className="kpi-value">{a.refunds}</div><div className="kpi-sub">of {a.units} sold</div></div>}
              </div>
              <div className="row">
                <div className="table-wrap half">
                  <table>
                    <thead><tr><th>Top 5</th><th className="num">Profit</th></tr></thead>
                    <tbody>{a.top5.map((p, i) => <tr key={i}><td>{p.product}</td><td className="num">{fmtMoney(p.profit)}</td></tr>)}</tbody>
                  </table>
                </div>
                <div className="table-wrap half">
                  <table>
                    <thead><tr><th>Bottom 5</th><th className="num">Profit</th></tr></thead>
                    <tbody>{a.bottom5.map((p, i) => <tr key={i}><td>{p.product}</td><td className={`num ${p.profit < 0 ? 'neg' : ''}`}>{fmtMoney(p.profit)}</td></tr>)}</tbody>
                  </table>
                </div>
              </div>
            </div>
          ))}
        </section>
      ))}

      {withoutSales.length > 0 && (
        <div className="pending">
          No sell-side account loaded yet for {withoutSales.join(', ')}. <a href="/admin">Upload in Admin</a>.
        </div>
      )}
    </>
  );
}
