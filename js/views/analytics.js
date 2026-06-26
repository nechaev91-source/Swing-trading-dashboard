import { getClosedTrades } from "../db.js";
import { tradeNetPnl, tradeR } from "../calc.js";
import { fmt, colorClass, showLoader, hideLoader, esc } from "../ui.js";

function setupName(strategy) {
  if (!strategy) return "Other";
  const [id, sub] = strategy.split(":");
  if (id === "trend-pullback") return "Trend-Pullback";
  if (id === "trend-line") return sub || "Trend Line";
  if (id === "breakout") return sub || "Breakout";
  if (id === "other") return "Manual";
  return id;
}

export async function renderAnalytics(root) {
  root.innerHTML = `<div class="view-title">📉 Analytics</div><div id="an-body"><div class="empty-state">Loading…</div></div>`;
  const body = document.getElementById("an-body");

  showLoader();
  let trades;
  try { trades = await getClosedTrades(); }
  finally { hideLoader(); }

  if (trades.length < 2) {
    body.innerHTML = `<div class="empty-state">Need at least 2 closed trades for analytics.<br>
      This screen answers one question: <b>is your edge real, and where does it come from?</b></div>`;
    return;
  }

  const recs = trades.filter((t) => t.exit_price != null).map((t) => ({
    symbol: t.symbol, direction: t.direction, exit_date: t.exit_date,
    pnl: tradeNetPnl(t), r: tradeR(t), hasStop: t.stop_loss != null && isFinite(t.stop_loss),
    won: tradeNetPnl(t) > 0, score: t.checklist_score, setup: setupName(t.strategy),
  })).sort((a, b) => (a.exit_date < b.exit_date ? -1 : 1));

  let cum = 0;
  const equity = recs.map((x) => { cum += x.pnl; return cum; });

  const n = recs.length;
  const wins = recs.filter((x) => x.won).length;
  const losses = n - wins;
  const wr = (wins / n) * 100;
  const rB = recs.filter((x) => x.hasStop);
  const avgR = rB.length ? rB.reduce((s, x) => s + x.r, 0) / rB.length : 0;
  const total = recs.reduce((s, x) => s + x.pnl, 0);
  const grossW = recs.filter((x) => x.won).reduce((s, x) => s + x.pnl, 0);
  const grossL = Math.abs(recs.filter((x) => !x.won).reduce((s, x) => s + x.pnl, 0));
  const pf = grossL > 0 ? grossW / grossL : Infinity;
  const avgWin = wins ? grossW / wins : 0;
  const avgLoss = losses ? -grossL / losses : 0;
  const payoff = avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : 0;
  const largestLoss = Math.min(...recs.map((x) => x.pnl));
  const commPaid = trades.filter((t) => t.exit_price != null).reduce((s, t) => s + (t.commission || 0), 0);

  // ── Auto-insights ───────────────────────────────────────────────────────────
  const insights = [];
  // 1. Overall edge
  if (pf >= 1.5 && total > 0)
    insights.push(["ok", `<b>Your system has a real edge.</b> Profit factor ${pf === Infinity ? "∞" : pf.toFixed(2)} means you earn $${(pf === Infinity ? 0 : pf).toFixed(2)} for every $1 you lose. Keep doing what works.`]);
  else if (total < 0 || pf < 1)
    insights.push(["warn", `<b>You're net negative so far.</b> Profit factor ${pf.toFixed(2)} (below 1.0). The leak is usually a few oversized losers or a win rate too low for your payoff — see below.`]);
  else
    insights.push(["warn", `<b>Roughly break-even.</b> Profit factor ${pf.toFixed(2)}. The edge isn't proven yet — more disciplined trades will tell.`]);

  // 2. Win rate vs payoff profile
  if (payoff > 0) {
    if (wr < 45 && payoff >= 1.8)
      insights.push(["ok", `Low win rate (${wr.toFixed(0)}%) but winners are ${payoff.toFixed(1)}× your losers — that's a valid trend profile. Don't let frequent small losses shake you off the system.`]);
    else if (wr >= 55 && payoff < 1)
      insights.push(["warn", `You win often (${wr.toFixed(0)}%) but your average loser is bigger than your average winner (${payoff.toFixed(1)}×). One bad loss can erase many wins — cut losers faster.`]);
    else
      insights.push(["", `Profile: win ${wr.toFixed(0)}% of the time, winners ${payoff.toFixed(1)}× the size of losers. Win rate × payoff is what makes the edge.`]);
  }

  // 3. Best / worst setup
  const setupGroups = {};
  recs.forEach((x) => { (setupGroups[x.setup] ||= []).push(x); });
  const setupStats = Object.entries(setupGroups)
    .filter(([, a]) => a.length >= 3)
    .map(([k, a]) => ({ k, n: a.length, pnl: a.reduce((s, x) => s + x.pnl, 0), wr: a.filter((x) => x.won).length / a.length * 100 }))
    .sort((a, b) => b.pnl - a.pnl);
  if (setupStats.length) {
    const best = setupStats[0], worst = setupStats[setupStats.length - 1];
    insights.push(["ok", `Your edge comes from <b>${esc(best.k)}</b>: ${fmt.signMoney(best.pnl)} over ${best.n} trades (${best.wr.toFixed(0)}% win).`]);
    if (worst.k !== best.k && worst.pnl < 0)
      insights.push(["warn", `<b>${esc(worst.k)}</b> is a drag: ${fmt.signMoney(worst.pnl)} over ${worst.n} trades. Consider trading it less or refining the entry.`]);
  }

  // 4. Checklist effectiveness
  const scored = recs.filter((x) => x.score != null);
  if (scored.length >= 6) {
    const hi = scored.filter((x) => x.score >= 7), lo = scored.filter((x) => x.score < 7);
    if (hi.length >= 2 && lo.length >= 2) {
      const hiWr = hi.filter((x) => x.won).length / hi.length * 100;
      const loWr = lo.filter((x) => x.won).length / lo.length * 100;
      if (hiWr - loWr >= 10)
        insights.push(["ok", `Your checklist works: trades scoring ≥7 win ${hiWr.toFixed(0)}% vs ${loWr.toFixed(0)}% below 7. Trust higher-conviction setups, skip the marginal ones.`]);
      else
        insights.push(["warn", `Your checklist isn't separating winners yet: ≥7 wins ${hiWr.toFixed(0)}% vs ${loWr.toFixed(0)}% below. The criteria may need tuning (or more data).`]);
    }
  }

  // 5. Tail-risk check
  if (avgLoss !== 0 && Math.abs(largestLoss) > 2.5 * Math.abs(avgLoss))
    insights.push(["warn", `Your worst loss (${fmt.signMoney(largestLoss)}) is ${(Math.abs(largestLoss) / Math.abs(avgLoss)).toFixed(1)}× your average loser. Watch position sizing and honor your stops — one outlier can undo months.`]);

  const kpi = (label, val, sub, color) => `
    <div class="stat-card"><div class="label">${label}</div>
      <div class="value ${color}">${val}</div><div class="sub">${sub}</div></div>`;

  body.innerHTML = `
    <div class="card">
      <div class="section-title">What this tells you</div>
      ${insights.map(([t, msg]) => `<div class="alert ${t === "ok" ? "alert-ok" : t === "warn" ? "alert-warn" : ""}" style="${t ? "" : "background:var(--bg);border-left:3px solid var(--border)"}">${msg}</div>`).join("")}
    </div>

    <div class="cards-grid" style="grid-template-columns:repeat(5,1fr)">
      ${kpi("TRADES", n, `${wins}W / ${losses}L`, "")}
      ${kpi("WIN RATE", wr.toFixed(1) + "%", "% of trades that profit", wr >= 50 ? "green" : "red")}
      ${kpi("PROFIT FACTOR", pf === Infinity ? "∞" : pf.toFixed(2), "$ won per $ lost", pf >= 1.5 ? "green" : "red")}
      ${kpi("AVG R", (avgR >= 0 ? "+" : "") + avgR.toFixed(2) + "R", "avg return per $ risked", avgR > 0 ? "green" : "red")}
      ${kpi("TOTAL P&L", fmt.signMoney(total), "net of commissions", colorClass(total))}
    </div>

    <div class="card">
      <div class="section-title">Equity Curve</div>
      <div class="hint" style="margin-bottom:8px">Your cumulative P&L over time. You want a line that climbs steadily from bottom-left to top-right; deep, jagged drops mean inconsistent risk.</div>
      <canvas id="eq-chart" height="90"></canvas>
    </div>

    <div class="two-col">
      <div class="card">
        <div class="section-title">R Distribution</div>
        <div class="hint" style="margin-bottom:8px">How big your wins/losses are in units of risk (R), each bar rounded to the nearest R (so −1.05R counts as −1R). Only trades with a stop are counted. Healthy systems cut losers near −1R and let winners run to +2R and beyond.</div>
        <canvas id="r-chart" height="120"></canvas>
      </div>
      <div>
        <div class="card"><div class="section-title">By Setup — where your edge is</div>
          <div id="setup-table"></div>
          <div class="hint" style="margin-top:6px">Double down on setups with positive P&L and high Avg R; cut the ones bleeding money.</div></div>
        <div class="card"><div class="section-title">Long vs Short</div><div id="dir-table"></div></div>
        <div class="card"><div class="section-title">Checklist Score vs Results</div>
          <div id="score-table"></div>
          <div class="hint" style="margin-top:6px">Do higher-conviction trades actually win more? If yes, your checklist is earning its keep.</div></div>
        <div class="card"><div class="section-title">Win / Loss Breakdown</div>
          <table><tbody>
            <tr><td class="muted">Avg Win</td><td class="green bold">${fmt.signMoney(avgWin)}</td></tr>
            <tr><td class="muted">Avg Loss</td><td class="red bold">${fmt.signMoney(avgLoss)}</td></tr>
            <tr><td class="muted">Largest Win</td><td class="green">${fmt.signMoney(Math.max(...recs.map(x=>x.pnl)))}</td></tr>
            <tr><td class="muted">Largest Loss</td><td class="red">${fmt.signMoney(largestLoss)}</td></tr>
          </tbody></table>
        </div>
        <div class="card"><div class="section-title">P&L & Commissions</div>
          <table><tbody>
            <tr><td class="muted">Gross P&L (before fees)</td><td class="${colorClass(total + commPaid)}">${fmt.signMoney(total + commPaid)}</td></tr>
            <tr><td class="muted">Commissions paid</td><td class="red">−${fmt.money(commPaid)}</td></tr>
            <tr><td class="muted bold">Net P&L</td><td class="${colorClass(total)} bold">${fmt.signMoney(total)}</td></tr>
          </tbody></table>
          <div class="hint" style="margin-top:6px">Commissions are subtracted from every trade — all P&L across the app is already net of them.</div>
        </div>
      </div>
    </div>
  `;

  // ── Grouping tables ─────────────────────────────────────────────────────────
  function groupTable(rowsArr, keyFn, container) {
    const groups = {};
    rowsArr.forEach((x) => { const k = keyFn(x); (groups[k] ||= []).push(x); });
    const rows = Object.entries(groups).map(([k, arr]) => {
      const gPnl = arr.reduce((s, x) => s + x.pnl, 0);
      const gWr = (arr.filter((x) => x.won).length / arr.length) * 100;
      const rb = arr.filter((x) => x.hasStop);
      const gR = rb.length ? rb.reduce((s, x) => s + x.r, 0) / rb.length : 0;
      return `<tr><td>${esc(k)}</td><td>${arr.length}</td>
        <td class="${colorClass(gPnl)}">${fmt.signMoney(gPnl)}</td>
        <td>${gWr.toFixed(0)}%</td><td class="${colorClass(gR)}">${gR.toFixed(2)}</td></tr>`;
    }).join("");
    document.getElementById(container).innerHTML =
      `<table><thead><tr><th>Group</th><th>Trades</th><th>P&L</th><th>Win%</th><th>Avg R</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  groupTable(recs, (x) => x.setup, "setup-table");
  groupTable(recs, (x) => x.direction, "dir-table");
  const scoredRecs = recs.filter((x) => x.score != null);
  if (scoredRecs.length)
    groupTable(scoredRecs, (x) => (x.score >= 8 ? "Score ≥8" : x.score >= 6 ? "Score 6-7" : "Score <6"), "score-table");
  else
    document.getElementById("score-table").innerHTML = `<div class="hint">No checklist-scored trades yet (manual/imported trades have no score).</div>`;

  // ── Charts ──────────────────────────────────────────────────────────────────
  const grid = "#21262d", muted = "#8b949e";
  const eqColor = total >= 0 ? "#3fb950" : "#f85149";

  new Chart(document.getElementById("eq-chart"), {
    type: "line",
    data: {
      labels: recs.map((x) => x.exit_date),
      datasets: [{
        data: equity, borderColor: eqColor, borderWidth: 2,
        pointBackgroundColor: recs.map((x) => (x.pnl >= 0 ? "#3fb950" : "#f85149")),
        pointRadius: 4, fill: true,
        backgroundColor: total >= 0 ? "rgba(63,185,80,0.06)" : "rgba(248,81,73,0.06)",
        tension: 0.2,
      }],
    },
    options: {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (i) => "Cumulative " + fmt.money(i.parsed.y) } } },
      scales: {
        x: { grid: { color: grid }, ticks: { color: muted, maxTicksLimit: 8 } },
        y: { grid: { color: grid }, ticks: { color: muted, callback: (v) => (Math.abs(v) >= 1000 ? "$" + (v / 1000).toFixed(1) + "k" : "$" + v) } },
      },
    },
  });

  const rCanvas = document.getElementById("r-chart");
  const rs = recs.filter((x) => x.hasStop).map((x) => x.r);
  if (!rs.length) {
    rCanvas.outerHTML = `<div class="hint">No trades with a stop yet — R can't be computed without an entry-to-stop distance. Add stops in New Trade (or via Edit) and this fills in.</div>`;
  } else {
    const min = Math.round(Math.min(...rs)), max = Math.round(Math.max(...rs));
    const keys = [];
    for (let b = min; b <= max; b++) keys.push(b);           // explicit numeric order
    const counts = Object.fromEntries(keys.map((b) => [b, 0]));
    rs.forEach((r) => { const b = Math.max(min, Math.min(max, Math.round(r))); counts[b]++; });  // nearest R
    new Chart(rCanvas, {
      type: "bar",
      data: {
        labels: keys.map((b) => `${b >= 0 ? "+" : ""}${b}R`),
        datasets: [{ data: keys.map((b) => counts[b]), backgroundColor: keys.map((b) => (b < 0 ? "#f85149" : b === 0 ? "#586274" : "#00d4aa")) }],
      },
      options: {
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: (i) => { const b = parseInt(i[0].label); return `${(b - 0.5).toFixed(1)}R to ${(b + 0.5).toFixed(1)}R`; }, label: (i) => `${i.parsed.y} trade(s)` } } },
        scales: {
          x: { grid: { color: grid }, ticks: { color: muted } },
          y: { grid: { color: grid }, ticks: { color: muted, stepSize: 1 } },
        },
      },
    });
  }
}
