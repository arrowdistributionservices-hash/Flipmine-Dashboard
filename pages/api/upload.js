import { Redis } from '@upstash/redis';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { detectFormat, summarizeAccount } from '../../lib/parse';
import formidable from 'formidable';
import fs from 'fs';

const kv = Redis.fromEnv(); // reads UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN

export const config = { api: { bodyParser: false } };

function readRowsFromCsv(buffer) {
  // Sellerboard Amazon exports are semicolon-delimited; Walmart exports are usually comma or native xlsx.
  const text = buffer.toString('utf-8').replace(/^\uFEFF/, '');
  let parsed = Papa.parse(text, { header: true, skipEmptyLines: true, delimiter: ';' });
  if (!parsed.meta.fields || parsed.meta.fields.length < 3) {
    parsed = Papa.parse(text, { header: true, skipEmptyLines: true }); // fallback: auto-detect delimiter
  }
  return { rows: parsed.data, headers: parsed.meta.fields || [] };
}

function readRowsFromXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { rows, headers };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const auth = req.headers['x-admin-token'];
  if (!auth || auth !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const form = formidable({ multiples: false });
  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(400).json({ error: 'Upload parse failed', detail: String(err) });

    const clientName = String(fields.clientName || '').trim();
    const marketplace = String(fields.marketplace || '').trim(); // 'Amazon' | 'Walmart'
    const file = files.file?.[0] || files.file;
    if (!clientName || !marketplace || !file) {
      return res.status(400).json({ error: 'clientName, marketplace, and file are required' });
    }

    try {
      const buffer = fs.readFileSync(file.filepath);
      const isXlsx = (file.originalFilename || '').toLowerCase().endsWith('.xlsx') ||
                     (file.originalFilename || '').toLowerCase().endsWith('.xls');
      const { rows, headers } = isXlsx ? readRowsFromXlsx(buffer) : readRowsFromCsv(buffer);
      const format = detectFormat(headers);
      const summary = summarizeAccount(rows, format, clientName, marketplace);

      const key = `${clientName}|${marketplace}`;
      const existing = (await kv.get('sales_accounts')) || {};
      existing[key] = summary;
      await kv.set('sales_accounts', existing);

      return res.status(200).json({ ok: true, key, summary });
    } catch (e) {
      return res.status(500).json({ error: 'Processing failed', detail: String(e) });
    }
  });
}
