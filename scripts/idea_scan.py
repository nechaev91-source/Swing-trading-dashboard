"""
Trend-line idea scanner.

Pulls published "Trend Lines"-tagged chart ideas from TradingView's public Ideas
feed, keeps the ones on US stocks, and ranks them by author popularity + post
engagement (followers, likes, comments). Writes the top results to
  signals/trendline_ideas.json
which the dashboard's Ideas tab reads.

This parses TradingView's public HTML (they have no official API). It is meant
for personal use; it degrades gracefully (writes an empty list) if the markup
changes or the fetch fails, so the daily workflow never hard-fails.

Usage:  python idea_scan.py
"""

import json
import re
import sys
import time
from pathlib import Path
from datetime import datetime, timezone
from urllib.request import Request, urlopen

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
TAG_PAGES = 3             # pages of the trend-line tag feed (all are trend-line)
STOCK_PAGES = 3           # pages of the US-stocks feed (keyword-filtered)
TOP_N = 18                # how many ideas to keep
US_EXCHANGES = {"NASDAQ", "NYSE", "AMEX", "NYSE ARCA", "ARCA", "BATS", "CBOE"}
# Words that mark a stock idea as trend-line-based (for the general stocks feed)
TREND_KEYWORDS = ("trend line", "trendline", "trend-line", "ascending",
                  "descending", "channel", "support line", "resistance line")
OUT = Path(__file__).resolve().parent.parent / "signals" / "trendline_ideas.json"


def fetch(url):
    req = Request(url, headers={"User-Agent": UA})
    with urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", "replace")


def extract_items(html):
    """Pull the ideas array (data.ideas.data.items) out of the embedded JSON."""
    marker = '"items":['
    start = html.find(marker)
    if start == -1:
        return []
    i = start + len(marker) - 1          # position of the opening '['
    depth, in_str, esc = 0, False, False
    for j in range(i, len(html)):
        ch = html[j]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        else:
            if ch == '"':
                in_str = True
            elif ch == "[":
                depth += 1
            elif ch == "]":
                depth -= 1
                if depth == 0:
                    arr = html[i:j + 1]
                    try:
                        return json.loads(arr)
                    except json.JSONDecodeError:
                        return []
    return []


def load_sp500():
    try:
        html = fetch("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies")
        # ticker cells link to the exchange quote page with rel="nofollow"
        syms = re.findall(r'rel="nofollow"[^>]*>([A-Z][A-Z.\-]{0,5})</a>', html)
        return {s.replace(".", "-") for s in syms}
    except Exception:
        return set()


def parse_ideas(items, sp500, require_keyword=False):
    out = []
    for it in items:
        symd = it.get("symbol")
        if not isinstance(symd, dict) or symd.get("type") != "stock":
            continue
        exch = (symd.get("exchange") or "").upper()
        if exch not in US_EXCHANGES:
            continue
        text = ((it.get("name") or "") + " " + (it.get("description") or "")).lower()
        if require_keyword and not any(k in text for k in TREND_KEYWORDS):
            continue
        ticker = symd.get("short_name") or ""
        u = it.get("user") or {}
        author = u.get("username", "?")
        badges = u.get("badges") or []
        premium = bool(u.get("is_pro")) or any("premium" in (b.get("name", "")) for b in badges)
        likes = int(it.get("likes_count", 0) or 0)
        comments = int(it.get("comments_count", 0) or 0)
        editors_pick = bool(it.get("is_picked"))
        img = it.get("image_url", "")
        out.append({
            "ticker": ticker,
            "exchange": exch,
            "title": (it.get("name") or "").strip(),
            "author": author,
            "premium": premium,
            "likes": likes,
            "comments": comments,
            "is_sp500": ticker in sp500,
            "is_hot": bool(it.get("is_hot")),
            "editors_pick": editors_pick,
            "summary": (it.get("description") or "").strip().replace("\n", " ")[:160],
            "chart_url": it.get("chart_url", ""),
            # TV stores snapshots under a 1-letter subdir = lowercase first char of the id
            "image": f"https://s3.tradingview.com/{img[0].lower()}/{img}_mid.webp" if img else "",
            "created_at": it.get("created_at", ""),
            # engagement-weighted; Premium author + editor's pick add credibility
            "score": likes + 2 * comments + (5 if premium else 0) + (15 if editors_pick else 0),
        })
    return out


def scan_feed(base, pages, sp500, require_keyword):
    found = []
    for p in range(1, pages + 1):
        url = base + (f"page-{p}/" if p > 1 else "")
        try:
            html = fetch(url)
        except Exception as e:
            print(f"{url}: fetch failed ({e})", file=sys.stderr)
            continue
        found += parse_ideas(extract_items(html), sp500, require_keyword)
        time.sleep(1)
    return found


def main():
    sp500 = load_sp500()
    # Source 1: the Trend-Lines tag feed (every post is trend-line; keep US stocks)
    # Source 2: the US-stocks feed, kept only when the text mentions a trend line
    raw = scan_feed("https://www.tradingview.com/ideas/trendline/", TAG_PAGES, sp500, False) \
        + scan_feed("https://www.tradingview.com/markets/stocks-usa/ideas/", STOCK_PAGES, sp500, True)

    seen, ideas = set(), []
    for idea in raw:
        key = (idea["ticker"], idea["title"])
        if key in seen:
            continue
        seen.add(key)
        ideas.append(idea)

    ideas.sort(key=lambda x: x["score"], reverse=True)
    ideas = ideas[:TOP_N]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "TradingView Ideas — Trend Lines tag (US stocks)",
        "count": len(ideas),
        "ideas": ideas,
    }, indent=2), encoding="utf-8")
    print(f"Wrote {len(ideas)} US-stock trend-line ideas to {OUT}")
    for i in ideas[:12]:
        flag = "*" if i["editors_pick"] else ("!" if i["is_hot"] else " ")
        sp = "SP500" if i["is_sp500"] else "     "
        pr = "PRO" if i["premium"] else "   "
        print(f"{flag} {i['ticker']:6} {sp} {pr} {i['likes']:>4}L {i['comments']:>3}C  "
              f"@{i['author']:<20} {i['title'][:46]}")


if __name__ == "__main__":
    main()
