"""
Daily trailing-stop updater for open positions — TREND trail-3ATR strategy.

Run this after the US close alongside scanner.py. It checks each open position
and tells you whether to raise the stop at your broker.

HOW IT WORKS:
  The stop ratchets up each day: stop = max(stop, today's high - 3 * ATR(14))
  It never moves down. You just replace the old GTC stop with the new one.

HOW TO MAINTAIN POSITIONS:
  Edit positions.json in the same folder. Each row is one open trade:
    {"ticker": "AAPL", "entry_date": "2026-06-10", "entry": 192.40, "stop": 186.10}

  - ADD a row when you enter a trade.
  - UPDATE "stop" when you raise the stop (after running this script).
  - DELETE the row when the position closes (stop hit or any other exit).

Usage:
    python positions.py
"""

import json
import os
import numpy as np
import pandas as pd
import yfinance as yf
from backtest import atr

TRAIL_K = 3.0       # must match the backtest (trail-3ATR)
LOOKBACK_DAYS = 60  # enough history for ATR(14)

POSITIONS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "positions.json")


def load_positions():
    if not os.path.exists(POSITIONS_FILE):
        return []
    with open(POSITIONS_FILE) as f:
        return json.load(f)


def save_positions(positions):
    with open(POSITIONS_FILE, "w") as f:
        json.dump(positions, f, indent=2)


def load_price_data(tk):
    df = yf.download(tk, period=f"{LOOKBACK_DAYS}d", interval="1d",
                     progress=False, auto_adjust=True)
    if df.empty:
        return None
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    return df[["High", "Low", "Close"]].dropna()


def compute_trail(df_full, df_since_entry, cur_stop):
    """Walk the chandelier trail from entry date to today. Only ratchets up."""
    a = atr(df_full["High"], df_full["Low"], df_full["Close"], 14)
    idx_naive = a.index.tz_localize(None) if a.index.tz else a.index
    a_map = dict(zip(idx_naive, a.values))
    stop = cur_stop
    for raw_idx in df_since_entry.index:
        idx = raw_idx.tz_localize(None) if raw_idx.tzinfo else raw_idx
        hi = df_since_entry.loc[raw_idx, "High"]
        atr_val = a_map.get(idx, np.nan)
        if np.isnan(atr_val):
            continue
        stop = max(stop, hi - TRAIL_K * atr_val)
    return stop


def check_stops():
    """Return list of result dicts for all open positions. Used by notify.py."""
    positions = load_positions()
    results = []
    for pos in positions:
        tk = pos["ticker"]
        entry_date = pos["entry_date"]
        entry_price = float(pos["entry"])
        cur_stop = float(pos["stop"])

        df = load_price_data(tk)
        if df is None or len(df) < 20:
            results.append({**pos, "price": None, "new_stop": cur_stop,
                             "open_r": None, "raise": False, "error": "no data"})
            continue

        df_idx = df.index.tz_localize(None) if df.index.tz else df.index
        entry_ts = pd.Timestamp(entry_date)
        mask = df_idx >= entry_ts
        df_since = df[mask]

        if df_since.empty:
            results.append({**pos, "price": None, "new_stop": cur_stop,
                             "open_r": None, "raise": False, "error": "no bars since entry"})
            continue

        new_stop = round(compute_trail(df, df_since, cur_stop), 2)
        price = round(float(df["Close"].iloc[-1]), 2)
        initial_risk = entry_price - cur_stop
        open_r = round((price - entry_price) / initial_risk, 1) if initial_risk > 0 else 0.0

        results.append({**pos, "price": price, "new_stop": new_stop,
                         "open_r": open_r, "raise": new_stop > cur_stop + 0.005, "error": None})
    return results


def main():
    positions = load_positions()
    if not positions:
        print("No open positions. Edit positions.json to add trades.")
        return

    print(f"=== Trailing stop update | trail-{TRAIL_K}ATR | {pd.Timestamp.now().strftime('%Y-%m-%d')} ===\n")
    print(f"{'SYM':>6} {'entry':>8} {'cur_stop':>9} {'new_stop':>9} {'price':>8} {'open R':>7}  action")
    print("-" * 62)

    results = check_stops()
    any_raise = False
    for r in results:
        if r["error"]:
            print(f"{r['ticker']:>6}  — {r['error']}")
            continue
        action = f"RAISE → {r['new_stop']:.2f}" if r["raise"] else "hold"
        if r["raise"]:
            any_raise = True
        print(f"{r['ticker']:>6} {r['entry']:>8.2f} {r['stop']:>9.2f} {r['new_stop']:>9.2f} "
              f"{r['price']:>8.2f} {r['open_r']:>+6.1f}R  {action}")

    print()
    if any_raise:
        print("For each RAISE row:")
        print("  1. Log in to your broker, cancel the old GTC stop, place new one.")
        print("  2. Update 'stop' in positions.json to the new_stop value shown.")
    else:
        print("No stops to raise today.")


if __name__ == "__main__":
    main()
