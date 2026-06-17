// Market data layer — Twelve Data API.
// Ports get_current_price / get_prices_batch / get_auto_checklist_data from data.py.
import { TWELVE_DATA_KEY, FINNHUB_KEY } from "./config.js";

const BASE = "https://api.twelvedata.com";

// Maps Finnhub's `finnhubIndustry` values to the matching SPDR sector ETF.
const INDUSTRY_TO_ETF = {
  "Technology": "XLK", "Semiconductors": "XLK", "Software": "XLK",
  "Hardware": "XLK", "Electronic Equipment": "XLK",
  "Health Care": "XLV", "Healthcare": "XLV", "Pharmaceuticals": "XLV",
  "Biotechnology": "XLV", "Life Sciences Tools & Services": "XLV", "Medical": "XLV",
  "Financial Services": "XLF", "Banking": "XLF", "Insurance": "XLF",
  "Capital Markets": "XLF", "Consumer Finance": "XLF",
  "Consumer Discretionary": "XLY", "Retail": "XLY", "Automobiles": "XLY",
  "Hotels Restaurants & Leisure": "XLY", "Textiles Apparel & Luxury Goods": "XLY",
  "Consumer Staples": "XLP", "Food Products": "XLP", "Beverages": "XLP",
  "Tobacco": "XLP", "Household Products": "XLP", "Consumer products": "XLP",
  "Energy": "XLE", "Oil & Gas": "XLE", "Oil Gas & Consumable Fuels": "XLE",
  "Basic Materials": "XLB", "Chemicals": "XLB", "Metals & Mining": "XLB",
  "Industrials": "XLI", "Machinery": "XLI", "Aerospace & Defense": "XLI",
  "Transportation": "XLI", "Electrical Equipment": "XLI", "Building": "XLI",
  "Real Estate": "XLRE", "REITs": "XLRE",
  "Utilities": "XLU",
  "Communication Services": "XLC", "Media": "XLC", "Telecommunication": "XLC",
  "Communications": "XLC", "Entertainment": "XLC",
};

// 11 SPDR sector ETFs — the user picks one; we auto-check its trend.
export const SECTOR_ETFS = {
  "Technology (XLK)": "XLK",
  "Health Care (XLV)": "XLV",
  "Financials (XLF)": "XLF",
  "Consumer Discretionary (XLY)": "XLY",
  "Consumer Staples (XLP)": "XLP",
  "Energy (XLE)": "XLE",
  "Materials (XLB)": "XLB",
  "Industrials (XLI)": "XLI",
  "Real Estate (XLRE)": "XLRE",
  "Utilities (XLU)": "XLU",
  "Communication Services (XLC)": "XLC",
};

async function apiGet(path, params) {
  const url = new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set("apikey", TWELVE_DATA_KEY);
  const res = await fetch(url);
  const json = await res.json();
  if (json.status === "error") {
    throw new Error(json.message || "API error");
  }
  return json;
}

// ── Single current price ──────────────────────────────────────────────────────
export async function getCurrentPrice(symbol) {
  try {
    const j = await apiGet("/price", { symbol });
    const p = parseFloat(j.price);
    return isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

// ── Batch prices (dashboard) ──────────────────────────────────────────────────
export async function getPricesBatch(symbols) {
  if (!symbols.length) return {};
  try {
    const j = await apiGet("/price", { symbol: symbols.join(",") });
    const out = {};
    if (symbols.length === 1) {
      const p = parseFloat(j.price);
      out[symbols[0]] = isFinite(p) ? p : null;
    } else {
      for (const s of symbols) {
        const p = parseFloat(j[s]?.price);
        out[s] = isFinite(p) ? p : null;
      }
    }
    return out;
  } catch {
    // fallback: one by one
    const out = {};
    for (const s of symbols) out[s] = await getCurrentPrice(s);
    return out;
  }
}

// Helper: average close / volume over the last N daily candles
async function dailySeries(symbol, outputsize = 60) {
  const j = await apiGet("/time_series", {
    symbol,
    interval: "1day",
    outputsize,
  });
  const vals = (j.values || []).map((v) => ({
    datetime: v.datetime,
    close: parseFloat(v.close),
    volume: parseFloat(v.volume),
  }));
  return vals; // newest first
}

function isAbove50ma(series) {
  if (series.length < 50) return null;
  const last = series[0].close;
  const ma50 = series.slice(0, 50).reduce((s, v) => s + v.close, 0) / 50;
  return { ok: last > ma50, last, ma50 };
}

// Auto-detect a stock's sector ETF via Finnhub's free company-profile endpoint.
// Returns { etf, industry } or null if unavailable / not configured.
export function finnhubConfigured() {
  return FINNHUB_KEY && !FINNHUB_KEY.startsWith("YOUR_");
}

export async function detectSectorEtf(symbol) {
  if (!finnhubConfigured()) return null;
  try {
    const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`;
    const res = await fetch(url);
    const j = await res.json();
    const industry = j.finnhubIndustry;
    if (!industry) return null;
    return { etf: INDUSTRY_TO_ETF[industry] || null, industry };
  } catch {
    return null;
  }
}

// Days until the next earnings report (Finnhub free calendar). null if unknown.
export async function getNextEarnings(symbol) {
  if (!finnhubConfigured()) return null;
  try {
    const today = new Date();
    const from = today.toISOString().slice(0, 10);
    const to = new Date(today.getTime() + 120 * 86400000).toISOString().slice(0, 10);
    const url = `https://finnhub.io/api/v1/calendar/earnings?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${FINNHUB_KEY}`;
    const res = await fetch(url);
    const j = await res.json();
    const dates = (j.earningsCalendar || []).map((e) => e.date).filter(Boolean).sort();
    if (!dates.length) return null;
    const next = dates[0];
    const days = Math.round((new Date(next) - today) / 86400000);
    return { next, days };
  } catch {
    return null;
  }
}

// ── Auto-checklist signals ────────────────────────────────────────────────────
// sectorEtf: a specific ETF the user picked, or null to auto-detect via Finnhub.
export async function getAutoChecklistData(symbol, sectorEtf) {
  const signals = {};
  const detail = {};

  // Auto-detect sector if the user didn't pick one
  if (!sectorEtf) {
    const detected = await detectSectorEtf(symbol);
    if (detected) {
      sectorEtf = detected.etf;
      detail.sector_name = detected.etf
        ? `${detected.industry} → ${detected.etf} (auto)`
        : `${detected.industry} (no matching ETF)`;
    }
  }

  // Fetch the stock's ~1-year daily history once — used for the RS line below.
  let stockSeries = null;
  try {
    stockSeries = await dailySeries(symbol, 260);
  } catch (e) {
    detail.series_error = e.message;
  }

  // Quote: 52-week high proximity.
  // (Volume is intentionally NOT auto-checked — the free intraday feed is
  //  delayed and doesn't match TradingView, so volume stays a manual item.)
  try {
    const q = await apiGet("/quote", { symbol });
    const close = parseFloat(q.close);
    const high52 = parseFloat(q.fifty_two_week?.high);
    if (isFinite(close) && isFinite(high52) && high52 > 0) {
      const pct = (close / high52 - 1) * 100;
      signals.near_high = pct >= -5;
      detail["52w_high"] = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% from 52-wk high ($${high52.toFixed(2)})`;
    }
  } catch (e) {
    detail.quote_error = e.message;
  }

  // SPY trend — fetch ~1 year once, reuse for both the 50-day MA and RS line
  let spySeries = null;
  try {
    spySeries = await dailySeries("SPY", 260);
    const r = isAbove50ma(spySeries);
    if (r) {
      signals.spy_above_50ma = r.ok;
      detail.spy = `SPY $${r.last.toFixed(2)} vs 50MA $${r.ma50.toFixed(2)} (${r.ok ? "above" : "below"})`;
    }
  } catch (e) {
    detail.spy_error = e.message;
  }

  // Relative Strength line (stock / SPY ratio) at or near its 1-year high
  if (spySeries && spySeries.length >= 60 && stockSeries && stockSeries.length >= 60) {
    try {
      const len = Math.min(stockSeries.length, spySeries.length);
      if (len >= 60) {
        const ratio = [];
        for (let i = 0; i < len; i++) {
          const denom = spySeries[i].close;
          if (denom > 0) ratio.push(stockSeries[i].close / denom);
        }
        const current = ratio[0];
        const maxRatio = Math.max(...ratio);
        const pct = (current / maxRatio - 1) * 100; // 0% = at new RS high
        signals.rs_near_high = pct >= -5;
        detail.rs = `RS line ${pct >= -0.05 ? "at new high" : pct.toFixed(1) + "% below 1y RS high"} (vs SPY)`;
      }
    } catch (e) {
      detail.rs_error = e.message;
    }
  }

  // Sector ETF trend (user-selected)
  if (sectorEtf) {
    try {
      const etf = await dailySeries(sectorEtf, 55);
      const r = isAbove50ma(etf);
      if (r) {
        signals.sector_above_50ma = r.ok;
        detail.sector = `${sectorEtf} $${r.last.toFixed(2)} vs 50MA $${r.ma50.toFixed(2)} (${r.ok ? "above" : "below"})`;
      }
    } catch (e) {
      detail.sector_error = e.message;
    }
  } else {
    detail.sector = finnhubConfigured()
      ? "Could not auto-detect sector — pick one manually to check its trend"
      : "Pick a sector ETF to check its trend (or add a Finnhub key for auto-detect)";
  }

  // Earnings within 3 weeks (Finnhub)
  const earn = await getNextEarnings(symbol);
  if (earn) {
    signals.no_earnings_3w = earn.days > 21;
    detail.earnings = `Next earnings in ${earn.days} days (${earn.next})`;
  } else if (finnhubConfigured()) {
    detail.earnings = "No earnings scheduled in the next ~4 months";
  }

  return { signals, detail };
}
