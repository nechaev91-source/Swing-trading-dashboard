"""
Daily signal scanner — run after the US close.
For each watchlist symbol it checks whether TODAY's bar fired an entry for the
chosen strategy, and prints a ready-to-trade ticket.

ENTRY METHOD: buy-limit order
  - Place a limit order at today's close price (the LIMIT column).
  - The limit is good for the next session only (limit_days=1).
  - If the stock opens at or below the limit -> fills at open (better price).
  - If the stock gaps up above the limit -> order expires, no fill, no regret.
  - Shares are pre-sized so that max loss at the stop <= $120 (RISK_DOLLARS).
    You never need to recalculate after the fill.

Usage:
    python scanner.py            # TREND strategy (default)
    python scanner.py meanrev    # MEANREV strategy
"""

import sys
import pandas as pd
import numpy as np
import yfinance as yf

import backtest as bt
from backtest import rsi, atr

RISK_DOLLARS = 120.0           # hard max loss per trade (buy-limit sizing)
ACCOUNT = 10_000.0
LOOKBACK_DAYS = 400            # enough history for SMA200
EARNINGS_WARN_DAYS = 14        # flag a signal if earnings fall within this window


def load_recent(tk):
    df = yf.download(tk, period=f"{LOOKBACK_DAYS}d", interval="1d",
                     progress=False, auto_adjust=True)
    if df.empty:
        return None
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    return df[["Open", "High", "Low", "Close"]].dropna()


def get_universe():
    """Full S&P 500 ticker list (live from Wikipedia). Falls back to the
    20-stock basket if the fetch fails, so the scanner never goes dark."""
    try:
        import requests
        from io import StringIO
        url = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
        html = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=30).text
        df = pd.read_html(StringIO(html))[0]
        tickers = df["Symbol"].astype(str).str.replace(".", "-", regex=False).tolist()
        return sorted(set(tickers))
    except Exception:
        return list(bt.BASKET)


def download_universe(tickers):
    """Batch-download recent OHLC for the whole universe (50 at a time)."""
    data = {}
    B = 50
    for k in range(0, len(tickers), B):
        batch = tickers[k:k + B]
        try:
            raw = yf.download(batch, period=f"{LOOKBACK_DAYS}d", interval="1d",
                              progress=False, auto_adjust=True,
                              group_by="ticker", threads=True)
        except Exception:
            continue
        for tk in batch:
            try:
                df = raw if len(batch) == 1 else raw[tk]
                df = df[["Open", "High", "Low", "Close"]].dropna()
                if len(df) >= 210:
                    data[tk] = df
            except Exception:
                pass
    return data


def market_riskon():
    """True if SPY closed above its 200-day SMA (regime filter). None if unknown."""
    try:
        df = load_recent("SPY")
        if df is None or len(df) < 205:
            return None
        c = df["Close"]
        return bool(c.iloc[-1] > c.rolling(200).mean().iloc[-1])
    except Exception:
        return None


def days_to_earnings(tk):
    """Calendar days until the next scheduled earnings report, or None."""
    try:
        ed = yf.Ticker(tk).get_earnings_dates(limit=8)
        if ed is None or ed.empty:
            return None
        idx = ed.index
        now = pd.Timestamp.now(tz=idx.tz) if idx.tz is not None else pd.Timestamp.now()
        future = [d for d in idx if d >= now]
        return (min(future) - now).days if future else None
    except Exception:
        return None


def trend_signal(df):
    p = bt.PARAMS
    c, h, l = df["Close"], df["High"], df["Low"]
    sma_slow = c.rolling(p["sma_slow"]).mean()
    sma_fast = c.rolling(p["sma_fast"]).mean()
    ema = c.ewm(span=p["ema_len"], adjust=False).mean()
    r = rsi(c, p["rsi_len"])
    a = atr(h, l, c, p["atr_len"])
    swing_low = l.rolling(p["swing_len"]).min()
    trend_up = c.iloc[-1] > sma_slow.iloc[-1] and sma_fast.iloc[-1] > sma_slow.iloc[-1]
    pullback = r.iloc[-p["rsi_lookback"]:].min() < p["rsi_thresh"]
    reclaim = c.iloc[-1] > ema.iloc[-1] and c.iloc[-2] <= ema.iloc[-2]
    if trend_up and pullback and reclaim:
        stop = swing_low.iloc[-1] - p["atr_buf"] * a.iloc[-1]
        return c.iloc[-1], stop
    return None


def meanrev_signal(df):
    c, h, l = df["Close"], df["High"], df["Low"]
    sma_t = c.rolling(200).mean()
    r = rsi(c, 2)
    a = atr(h, l, c, 14)
    if c.iloc[-1] > sma_t.iloc[-1] and r.iloc[-1] < 10:
        entry = c.iloc[-1]
        return entry, entry - 2.0 * a.iloc[-1]
    return None


def scan(mode="trend"):
    """Return (regime_ok, hits) where hits is a list of dicts. Used by notify.py."""
    sig_fn = meanrev_signal if mode == "meanrev" else trend_signal
    ro = market_riskon()
    if ro is False:
        return ro, []
    universe = get_universe()
    data = download_universe(universe)
    hits = []
    for tk, df in data.items():
        if df is None or len(df) < 210:
            continue
        res = sig_fn(df)
        if res:
            limit, stop = res
            psr = limit - stop
            if psr <= 0:
                continue
            shares = int(np.floor(RISK_DOLLARS / psr))
            if shares < 1:
                continue
            ern = days_to_earnings(tk)
            skip = ern is not None and ern <= EARNINGS_WARN_DAYS
            hits.append(dict(ticker=tk, limit=round(limit, 2), stop=round(stop, 2),
                             shares=shares, cost=round(shares * limit, 0),
                             stop_pct=round((limit - stop) / limit * 100, 1),
                             earnings_days=ern, skip=skip))
    return ro, hits


def main():
    mode = sys.argv[1].lower() if len(sys.argv) > 1 else "trend"
    print(f"=== Signal scan | strategy: {mode.upper()} | "
          f"risk ${RISK_DOLLARS:.0f}/trade | account ${ACCOUNT:,.0f} ===")

    ro, hits = scan(mode)

    if ro is False:
        print("\nMARKET RISK-OFF: SPY is below its 200-day SMA.")
        print("Per the strategy, take NO new long entries today. (Manage open trades only.)")
        return
    print(f"Market regime: {'RISK-ON (SPY>200SMA)' if ro else 'unknown - check SPY manually'}\n")

    if not hits:
        print("No entry signals today. (Normal - most days nothing fires.)")
        return

    print(f"{'SYM':>6} {'LIMIT':>9} {'stop':>9} {'stop%':>6} {'shares':>7} {'cost$':>9} {'earnings':>10}")
    for h in hits:
        ern = h["earnings_days"]
        etag = f"{ern}d !SKIP" if h["skip"] else (f"{ern}d ok" if ern else "n/a")
        print(f"{h['ticker']:>6} {h['limit']:>9.2f} {h['stop']:>9.2f} {h['stop_pct']:>5.1f}% "
              f"{h['shares']:>7d} {h['cost']:>9.0f} {etag:>10}")
    print(f"\n{len(hits)} signal(s). Action: place a buy-limit order at the LIMIT price, "
          f"good for tomorrow's session only.")
    print(f"Stop order: place simultaneously at the stop price shown (GTC).")
    print(f"'!SKIP' = earnings within {EARNINGS_WARN_DAYS} days — skip those entirely.")
    print(f"Max 4 concurrent positions / $10K account — prioritize by stop% (tightest = "
          f"best R per dollar deployed).")


if __name__ == "__main__":
    main()
