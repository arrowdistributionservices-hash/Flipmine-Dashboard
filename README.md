# Flipmine Global Dashboard (Live)

- **Sourcing** — fetched live from Google Sheets on every page load. No upload needed.
- **Sales** — uploaded via `/admin` (password-protected). Persists in a shared Redis database (Upstash, via Vercel Marketplace) so everyone sees the same latest data.

## 1. Google Sheet — enable public read access

Open the Flipmine Deals sheet → **Share** → **General access** → **"Anyone with the link"** → **Viewer**.

This is required for the live fetch to work. It means anyone with the sheet URL can view the raw sourcing data (not edit it) — worth confirming that's acceptable before deploying.

## 2. Push this project to GitHub

```
cd flipmine-dashboard
git init
git add .
git commit -m "Initial commit"
```
Create a new repo on github.com (public or private, either works with Vercel), then:
```
git remote add origin https://github.com/YOUR_USERNAME/flipmine-dashboard.git
git branch -M main
git push -u origin main
```

## 3. Deploy on Vercel

1. Go to vercel.com, sign in (GitHub login is easiest)
2. **Add New → Project → Import** the `flipmine-dashboard` repo
3. Leave build settings as default (Next.js is auto-detected) → **Deploy**
4. First deploy may fail if a dependency has an issue — see "If the build fails" below

## 4. Add the Redis database (for shared sales-side storage)

1. In your Vercel project, go to the **Storage** tab
2. **Create Database → Marketplace Database Providers → Upstash → Redis**
3. Follow the prompts (free tier is enough for this) — Vercel automatically adds the required
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` environment variables to your project
4. Redeploy (Vercel usually does this automatically after a storage integration is added; if not, go to **Deployments → ... → Redeploy**)

## 5. Set the admin token

1. Project → **Settings → Environment Variables**
2. Add `ADMIN_TOKEN` = some password only you and trusted team members know
3. Redeploy for it to take effect

## 6. (Optional) Confirm the sheet ID

The sourcing fetch defaults to the sheet ID already baked into `lib/sourcing.js`. If you ever copy this to
a different sheet, add an environment variable `SOURCING_SHEET_ID` with the new sheet's ID instead of editing code.

## Using it

- **Dashboard**: `https://your-project.vercel.app/` — share this with the team
- **Upload sales data**: `https://your-project.vercel.app/admin` — enter the `ADMIN_TOKEN`, pick client name +
  marketplace, upload the Sellerboard CSV/XLSX. It overwrites that client+marketplace's stored data immediately
  for everyone.

## If the build fails

Since I couldn't run a live build myself before handing this off, here's how to unblock the most likely issues:

- **Dependency resolution error on `xlsx`**: the `xlsx` package on npm is sometimes flagged by security
  scanners due to an old CVE in very old versions. Version `^0.18.5` (pinned here) is the patched one, but if
  Vercel's install still complains, replace it with `exceljs` and I can rewrite the two spots that use `xlsx`
  (`lib/parse.js` isn't affected — it's just `pages/api/upload.js`'s `readRowsFromXlsx` function).
- **`formidable` v3 API mismatch**: if you see an error about `form.parse` not being a function or files not
  populating as arrays, formidable v3's API differs slightly by minor version. Paste me the exact error and
  I'll patch `pages/api/upload.js`.
- **ROI values showing as 0% or absurdly large** on the sourcing side: the sheet's ROI column may export from
  Google as a raw fraction (0.73) or as text ("73%") depending on cell formatting — `lib/sourcing.js`'s `toRoi()`
  guesses based on magnitude. If numbers look wrong, tell me and I'll hardcode the correct interpretation
  once we see a real sample.

Paste me any error output and I'll fix it directly — I just can't pre-empt every possible issue without
being able to run the actual build myself first.
