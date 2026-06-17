"""
Daily trading digest — sends to Telegram.

Env vars required (set as GitHub Actions secrets):
    TELEGRAM_BOT_TOKEN   token from @BotFather
    TELEGRAM_CHAT_ID     your personal chat ID (number)

Usage:
    python notify.py            # TREND strategy (default)
    python notify.py meanrev
"""

import os
import sys
import requests
from datetime import datetime

from scanner import scan, EARNINGS_WARN_DAYS, RISK_DOLLARS
from positions import check_stops

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
CHAT_ID   = os.environ.get("TELEGRAM_CHAT_ID", "")


def send_telegram(text):
    if not BOT_TOKEN or not CHAT_ID:
        print("Telegram credentials not set. Printing to stdout instead.\n")
        print(text)
        return
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    resp = requests.post(url, json={"chat_id": CHAT_ID, "text": text,
                                    "parse_mode": "HTML"}, timeout=10)
    if resp.ok:
        print("Telegram message sent.")
    else:
        print(f"Telegram error: {resp.status_code} {resp.text}")


def build_message(mode, ro, signals, stops):
    date_str = datetime.now().strftime("%a %d %b %Y")

    if ro is True:
        regime = "RISK-ON ✅  SPY &gt; 200SMA"
    elif ro is False:
        regime = "RISK-OFF 🛑  SPY BELOW 200SMA — NO NEW ENTRIES"
    else:
        regime = "REGIME UNKNOWN ⚠️  Check SPY manually"

    lines = [
        f"📊 <b>Trading Digest — {date_str}</b>",
        f"Market: {regime}",
        "",
    ]

    # ── signals ──────────────────────────────────────────────────────────────
    lines.append(f"━━ SIGNALS ({mode.upper()}, ${RISK_DOLLARS:.0f} risk) ━━")
    if ro is False:
        lines.append("No new entries — market risk-off.")
    elif not signals:
        lines.append("No signals today.")
    else:
        lines.append("<pre>")
        lines.append(f"{'SYM':<6} {'LIMIT':>7} {'STOP':>7} {'ST%':>5} {'SH':>4} {'COST':>7}  EARN")
        for h in signals:
            ern = h["earnings_days"]
            etag = f"⚠{ern}d" if h["skip"] else (f"{ern}d" if ern else "n/a")
            lines.append(
                f"{h['ticker']:<6} {h['limit']:>7.2f} {h['stop']:>7.2f} "
                f"{h['stop_pct']:>4.1f}% {h['shares']:>4d} "
                f"${h['cost']:>6,.0f}  {etag}"
            )
        lines.append("</pre>")
        skips = [h["ticker"] for h in signals if h["skip"]]
        if skips:
            lines.append(f"⚠️ Skip (earnings &lt;{EARNINGS_WARN_DAYS}d): {', '.join(skips)}")
        lines.append("Place buy-limit at LIMIT price, valid tomorrow only. Stop GTC simultaneously.")

    lines.append("")

    # ── open positions ────────────────────────────────────────────────────────
    lines.append("━━ OPEN POSITIONS ━━")
    if not stops:
        lines.append("No positions tracked. Add entries to positions.json.")
    else:
        any_raise = any(s["raise"] for s in stops if not s.get("error"))
        lines.append("<pre>")
        lines.append(f"{'SYM':<6} {'ENTRY':>7} {'CUR STP':>8} {'NEW STP':>8} {'PRICE':>7} {'R':>5}  ACTION")
        for s in stops:
            if s.get("error"):
                lines.append(f"{s['ticker']:<6}  error: {s['error']}")
                continue
            action = f"RAISE→{s['new_stop']:.2f}" if s["raise"] else "hold"
            lines.append(
                f"{s['ticker']:<6} {s['entry']:>7.2f} {s['stop']:>8.2f} "
                f"{s['new_stop']:>8.2f} {s['price']:>7.2f} {s['open_r']:>+4.1f}R  {action}"
            )
        lines.append("</pre>")
        if any_raise:
            raise_tickers = [s["ticker"] for s in stops if s.get("raise")]
            lines.append(f"⬆️ Raise stops: {', '.join(raise_tickers)}. Update positions.json after.")

    return "\n".join(lines)


def main():
    mode = sys.argv[1].lower() if len(sys.argv) > 1 else "trend"
    print(f"Running scan ({mode.upper()})...")
    ro, signals = scan(mode)

    print("Checking open positions...")
    stops = check_stops()

    msg = build_message(mode, ro, signals, stops)
    send_telegram(msg)


if __name__ == "__main__":
    main()
