import { useState } from 'react';
import '../styles/globals.css';

export default function Admin() {
  const [token, setToken] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [clientName, setClientName] = useState('');
  const [marketplace, setMarketplace] = useState('Amazon');
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleUpload(e) {
    e.preventDefault();
    if (!clientName || !file) { setStatus({ ok: false, msg: 'Client name and file are required.' }); return; }
    setBusy(true); setStatus(null);
    const fd = new FormData();
    fd.append('clientName', clientName);
    fd.append('marketplace', marketplace);
    fd.append('file', file);
    try {
      const res = await fetch('/api/upload', { method: 'POST', headers: { 'x-admin-token': token }, body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Upload failed');
      setStatus({ ok: true, msg: `Saved: ${clientName} · ${marketplace} — Sales ${j.summary.sales}, Profit ${j.summary.profit}` });
      setFile(null);
    } catch (err) {
      setStatus({ ok: false, msg: String(err.message || err) });
    } finally {
      setBusy(false);
    }
  }

  if (!unlocked) {
    return (
      <div className="wrap" style={{ maxWidth: 420 }}>
        <h1>Admin — Sales Data Upload</h1>
        <p className="subtitle">Enter the admin token to continue.</p>
        <div className="card">
          <div className="form-row">
            <label>Admin token</label>
            <input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="Admin token" />
          </div>
          <button className="btn" onClick={() => setUnlocked(true)} disabled={!token}>Continue</button>
          <p style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 10 }}>The token is checked server-side on upload — entering the wrong one just means uploads will fail with "Unauthorized."</p>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap" style={{ maxWidth: 480 }}>
      <h1>Upload Sellerboard Export</h1>
      <p className="subtitle">Overwrites the stored data for this client + marketplace. Everyone viewing the dashboard sees the update immediately.</p>
      <form className="card" onSubmit={handleUpload}>
        <div className="form-row">
          <label>Client name</label>
          <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="e.g. Kyle" />
        </div>
        <div className="form-row">
          <label>Marketplace</label>
          <select value={marketplace} onChange={e => setMarketplace(e.target.value)}>
            <option>Amazon</option>
            <option>Walmart</option>
          </select>
        </div>
        <div className="form-row">
          <label>Sellerboard file (.csv or .xlsx)</label>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={e => setFile(e.target.files[0])} />
        </div>
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Uploading…' : 'Upload & Publish'}</button>
        {status && <p className={`status-msg ${status.ok ? 'ok' : 'err'}`}>{status.msg}</p>}
      </form>
      <p style={{ marginTop: 20 }}><a href="/">← Back to dashboard</a></p>
    </div>
  );
}
