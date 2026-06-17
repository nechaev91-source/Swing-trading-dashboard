"""
Swing Pullback Strategy — Python backtester (long-only, US stocks)
Mirrors the TradingView Pine strategy so results are comparable, but runs
autonomously over a whole basket of stocks. No look-ahead: signals are
evaluated on a bar's close and the trade is entered at the NEXT bar's open.

Edge test logic:
  - Trend filter : Close > SMA(slow) AND SMA(fast) > SMA(slow)
  - Pullback     : min(RSI, lookback) < rsi_thresh   (a real dip happened)
  - Trigger      : Close crosses above EMA(ema_len)   (resumption)
  - Stop         : lowest low over swing_len  -  atr_buf * ATR
  - Target       : entry + r_mult * (entry - stop)    (fixed R take-profit)
  - Sizing       : risk_pct % of equity per trade (portfolio sim only)

The key metric is EXPECTANCY in R (avg R per trade): it isolates the edge
independently of position size.
"""

import numpy as np
import pandas as pd
import yfinance as yf

# ----------------------------- Parameters -----------------------------------
PARAMS = dict(
    sma_slow=200, sma_fast=50, ema_len=20,
    rsi_len=14, rsi_thresh=40, rsi_lookback=5,
    swing_len=10, atr_len=14, atr_buf=0.5,
    r_mult=2.0,
)

BASKET = [
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "JPM", "V", "JNJ", "PG",
    "XOM", "WMT", "HD", "KO", "DIS", "NFLX", "AMD", "CRM", "COST", "UNH",
]
START = "2005-01-01"
END = "2026-06-17"

RISK_PCT = 1.0          # % of equity risked per trade (portfolio sim)
INIT_CAPITAL = 100_000
MAX_CONCURRENT = 8      # cap on simultaneously open positions (portfolio sim)


# ----------------------------- Indicators -----------------------------------
def wilder_rma(series, length):
    """Wilder's smoothing (RMA) — what Pine's ta.rsi / ta.atr use internally."""
    return series.ewm(alpha=1 / length, adjust=False).mean()


def rsi(close, length):
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    rs = wilder_rma(gain, length) / wilder_rma(loss, length)
    return 100 - 100 / (1 + rs)


def atr(high, low, close, length):
    prev_close = close.shift(1)
    tr = pd.concat([high - low, (high - prev_close).abs(),
                    (low - prev_close).abs()], axis=1).max(axis=1)
    return wilder_rma(tr, length)


# ----------------------------- Trade generation ------------------------------
def generate_trades(df, p, max_hold=0):
    """Return a list of non-overlapping trades for one symbol.

    max_hold > 0 adds a time stop: if neither stop nor target is hit within
    max_hold bars, exit at that bar's close (keeps holding period short).
    """
    c, h, l, o = df["Close"], df["High"], df["Low"], df["Open"]

    sma_slow = c.rolling(p["sma_slow"]).mean()
    sma_fast = c.rolling(p["sma_fast"]).mean()
    ema = c.ewm(span=p["ema_len"], adjust=False).mean()
    r = rsi(c, p["rsi_len"])
    a = atr(h, l, c, p["atr_len"])

    trend_up = (c > sma_slow) & (sma_fast > sma_slow)
    pullback = r.rolling(p["rsi_lookback"]).min() < p["rsi_thresh"]
    reclaim = (c > ema) & (c.shift(1) <= ema.shift(1))
    signal = trend_up & pullback & reclaim

    swing_low = l.rolling(p["swing_len"]).min()

    dates = df.index
    n = len(df)
    trades = []
    i = 0
    # iterate by position; enter at NEXT bar open after a signal bar
    while i < n - 1:
        if bool(signal.iloc[i]) and not np.isnan(a.iloc[i]):
            stop = swing_low.iloc[i] - p["atr_buf"] * a.iloc[i]
            entry = o.iloc[i + 1]                      # next bar open
            if not (entry > stop):                     # invalid stop, skip
                i += 1
                continue
            risk = entry - stop
            target = entry + p["r_mult"] * risk
            # walk forward until stop or target hit
            j = i + 1
            exit_price = exit_date = None
            while j < n:
                if l.iloc[j] <= stop:                  # stop first (conservative)
                    exit_price, exit_date = stop, dates[j]
                    break
                if h.iloc[j] >= target:
                    exit_price, exit_date = target, dates[j]
                    break
                if max_hold and (j - (i + 1)) >= max_hold:   # time stop
                    exit_price, exit_date = c.iloc[j], dates[j]
                    break
                j += 1
            if exit_price is None:                     # still open at series end
                exit_price, exit_date = c.iloc[-1], dates[-1]
                j = n - 1
            trades.append(dict(
                ticker=df.attrs.get("ticker", "?"),
                entry_date=dates[i + 1], entry=entry, stop=stop, target=target,
                exit_date=exit_date, exit=exit_price,
                r=(exit_price - entry) / risk,
                bars=j - (i + 1),
            ))
            i = j + 1                                  # no overlap within a symbol
        else:
            i += 1
    return trades


# ----------------------------- Run over basket -------------------------------
def load(ticker):
    df = yf.download(ticker, start=START, end=END, progress=False, auto_adjust=True)
    if df.empty:
        return None
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df = df[["Open", "High", "Low", "Close", "Volume"]].dropna()
    df.attrs["ticker"] = ticker
    return df


def edge_report(trades):
    if not trades:
        print("No trades.")
        return
    t = pd.DataFrame(trades)
    wins = t[t.r > 0]
    losses = t[t.r <= 0]
    pf = wins.r.sum() / abs(losses.r.sum()) if len(losses) and losses.r.sum() != 0 else float("inf")
    print("\n================ EDGE TEST (pooled trades, R-based) ================")
    print(f"Symbols tested      : {t.ticker.nunique()}")
    print(f"Total trades        : {len(t)}")
    print(f"Win rate            : {len(wins)/len(t)*100:.1f}%  ({len(wins)}/{len(t)})")
    print(f"Profit factor       : {pf:.2f}")
    print(f"Expectancy / trade  : {t.r.mean():+.3f} R   <-- the key number")
    print(f"Avg win / avg loss  : {wins.r.mean():+.2f} R / {losses.r.mean():+.2f} R")
    print(f"Avg holding (bars)  : {t.bars.mean():.1f}")
    print(f"Best / worst trade  : {t.r.max():+.2f} R / {t.r.min():+.2f} R")

    print("\n---- Per-symbol breakdown ----")
    g = t.groupby("ticker").agg(trades=("r", "size"),
                                win_rate=("r", lambda x: (x > 0).mean() * 100),
                                expectancy_R=("r", "mean"),
                                total_R=("r", "sum")).round(2)
    print(g.sort_values("total_R", ascending=False).to_string())
    return t


def portfolio_sim(trades):
    """Single shared account, 1% risk/trade, concurrent positions capped."""
    t = pd.DataFrame(trades).sort_values("entry_date").reset_index(drop=True)
    equity = INIT_CAPITAL
    open_positions = []     # list of (exit_date, pnl)
    curve = []              # (date, equity_realized)
    # event list: process entries in order, realize PnL at exits along the way
    events = []
    for k, row in t.iterrows():
        events.append((row.entry_date, "entry", k))
    events.sort(key=lambda x: x[0])

    realized = INIT_CAPITAL
    peak = INIT_CAPITAL
    max_dd = 0.0
    for date, _, k in events:
        # realize any positions that exited on/before this entry date
        still_open = []
        for ed, pnl in open_positions:
            if ed <= date:
                realized += pnl
                peak = max(peak, realized)
                max_dd = max(max_dd, (peak - realized) / peak)
            else:
                still_open.append((ed, pnl))
        open_positions = still_open
        if len(open_positions) >= MAX_CONCURRENT:
            continue                                   # at capacity, skip signal
        row = t.loc[k]
        risk_dollars = RISK_PCT / 100 * realized
        per_share_risk = row.entry - row.stop
        shares = np.floor(risk_dollars / per_share_risk)
        if shares < 1:
            continue
        pnl = shares * (row.exit - row.entry)
        open_positions.append((row.exit_date, pnl))
    # close out remaining
    for ed, pnl in open_positions:
        realized += pnl
        peak = max(peak, realized)
        max_dd = max(max_dd, (peak - realized) / peak)

    years = (pd.to_datetime(END) - pd.to_datetime(START)).days / 365.25
    cagr = (realized / INIT_CAPITAL) ** (1 / years) - 1
    print("\n================ PORTFOLIO SIM (1% risk, shared account) ================")
    print(f"Final equity        : ${realized:,.0f}  (from ${INIT_CAPITAL:,})")
    print(f"Total return        : {(realized/INIT_CAPITAL-1)*100:+.1f}%  over {years:.1f} yrs")
    print(f"CAGR                : {cagr*100:+.2f}% / yr")
    print(f"Max drawdown        : {max_dd*100:.1f}%")


def main():
    all_trades = []
    for tk in BASKET:
        df = load(tk)
        if df is None or len(df) < 250:
            print(f"  skip {tk} (no data)")
            continue
        tr = generate_trades(df, PARAMS)
        all_trades.extend(tr)
        print(f"  {tk:5s}: {len(tr):3d} trades")
    edge_report(all_trades)
    portfolio_sim(all_trades)


if __name__ == "__main__":
    main()
