# Swing Trading Dashboard (Web)

A static web app for swing-trading decision support: live portfolio, a breakout
entry checklist with auto-fill, a trade journal, and analytics. Runs entirely in
the browser — accessible from desktop and phone, synced across devices.

**Stack:** HTML/CSS/vanilla JS · Firebase (Auth + Firestore) · Twelve Data (market data) · Chart.js

> No credit card required. Chart screenshots are compressed in the browser and
> stored directly in Firestore, so Firebase Storage (which now needs a paid plan)
> is not used.

---

## One-time setup

### 1. Firebase (sync + login + chart storage)

1. Go to <https://console.firebase.google.com> → **Add project** (any name).
2. **Build → Authentication → Get started → Email/Password → Enable.**
3. **Build → Firestore Database → Create database** → *Standard edition* →
   *Production mode* → pick a region (Tel Aviv if available).
4. **Project settings (gear icon) → General → Your apps → Web (`</>`)** → register an
   app → copy the `firebaseConfig` object.
5. Paste those values into `js/config.js` (the `firebaseConfig` block).

**Security rules** — copy the contents of `firestore.rules` into
*Firestore → Rules*, then **Publish**. This ensures every user can only
read/write their own data.

### 2. Twelve Data (stock prices + auto-checklist)

1. Sign up free at <https://twelvedata.com> (800 API calls/day on the free plan).
2. Copy your API key → paste into `js/config.js` (`TWELVE_DATA_KEY`).

> Why Twelve Data and not Finnhub? Finnhub's free tier no longer serves historical
> candles, which the auto-checklist needs (50-day volume average, SPY / sector
> 50-day MA). Twelve Data's free tier includes them.

### 3. App icons (optional, for "Add to Home Screen")

Drop two PNGs into `icons/`: `icon-192.png` and `icon-512.png`. Any square logo works.

---

## Run locally

Because the app uses ES modules, open it through a local server (not `file://`):

```bash
# Python (any version)
python -m http.server 8000
# then visit http://localhost:8000
```

---

## Deploy to GitHub Pages

1. Create a new GitHub repo and push this folder's contents.
2. Repo → **Settings → Pages** → *Source: Deploy from a branch* → branch `main`,
   folder `/ (root)` → **Save**.
3. After a minute you get a URL like `https://<username>.github.io/<repo>/`.
4. Open it on your phone too, sign in with the same email — your trades sync.

> Firebase note: in **Authentication → Settings → Authorized domains**, add your
> `github.io` domain so login works from the deployed site.

### Add to phone home screen
Open the site in the phone browser → *Share / menu → Add to Home Screen*. It then
launches full-screen like an app (PWA).

---

## How the auto-checklist works

On the **New Trade** screen, enter a ticker, optionally pick its **Sector ETF**,
then click **⚡ Auto-fill from Market Data**. The app queries Twelve Data and
auto-checks:

| Checklist item | Source |
|---|---|
| Volume 40%+ above 50-day avg | quote volume vs average volume |
| S&P 500 above 50-day MA | SPY daily candles |
| Within 5% of 52-week high | quote 52-week high |
| Sector ETF above 50-day MA | selected ETF daily candles |

Pattern-based items (base, pivot, handle, breakout candle) stay manual — those
need your eyes on the chart.

---

## Files

```
index.html            App shell + auth screen
css/style.css         Dark theme, responsive
js/config.js          ← your Firebase + Twelve Data keys
js/firebase.js        Firebase init
js/auth.js            Login / signup / logout
js/db.js              Firestore CRUD
js/data.js            Twelve Data wrapper + auto-checklist
js/calc.js            Position sizing + R math (pure)
js/ui.js              Loader, toast, formatting helpers
js/app.js             Auth gate + hash router
js/views/*.js         One module per screen
strategies.json       Strategies + their checklists (editable)
firestore.rules       Firestore security rules
manifest.json         PWA manifest
```
