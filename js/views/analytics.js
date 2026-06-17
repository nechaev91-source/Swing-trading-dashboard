import { getClosedTrades } from "../db.js";
import { realizedPnl, rMultiple } from "../calc.js";
import { fmt, colorClass, showLoader, hideLoader, esc } from "../ui.js";

export async function renderAnalytics(root) {
  root.innerHTML = `<div class="view-title">📉 Analytics</div><div id="an-body"><div class="empty-state">Loading…</div></div>`;
  const body = document.getElementById("an-body");

  showLoader();
  let trades;
  try { trades = await getClosedTrades(); }
  finally { hideLoader(); }

  if (trades.length < 2) {
    body.innerHTML = `<div class="empty-state">Need at least 2 closed trades for analytics.</div>`;
    return;
  }

  // Build records, oldest first for equity curve
  const recs = trades.map((t) => {
    const pnl = realizedPnl(t.direction, t.entry_price, t.exit_price, t.shares);
    const r = rMultiple(t.direction, t.entry_price, t.exit_price, t.stop_loss, t.shares);
    return { symbol: t.symbol, direction: t.direction, exit_date: t.exit_date, pnl, r, won: pnl > 0, score: t.checklist_score };
  }).sort((a, b) => (a.exit_date < b.exit_date ? -1 : 1));

  let cum = 0;
  const equity = recs.map((x) => { cum += x.pnl; return cum; });

  const n = recs.length;
  const wins = recs.filter((x) => x.won).length;
  const losses = n - wins;
  const wr = (wins / n) * 100;
  const avgR = recs.reduce((s, x) => s + x.r, 0) / n;
  const total = recs.reduce((s, x) => s + x.pnl, 0);
  const grossW = recs.filter((x) => x.won).reduce((s, x) => s + x.pnl, 0);
  const grossL = Math.abs(recs.filter((x) => !x.won).reduce((s, x) => s + x.pnl, 0));
  const pf = grossL > 0 ? grossW / grossL : Infinity;
  const avgWin = wins ? grossW / wins : 0;
  const avgLoss = losses ? -grossL / losses : 0;

  const kpi = (label, val, sub, color) => `
    <div class="stat-card"><div class="label">${label}</div>
      <div class="value ${color}">${val}</div><div class="sub">${sub}</div></div>`;

  body.innerHTML = `
    <div class="cards-grid" style="grid-template-columns:repeat(5,1fr)">
      ${kpi("TRADES", n, `${wins}W / ${losses}L`, "")}
      ${kpi("WIN RATE", wr.toFixed(1) + "%", "", wr >= 50 ? "green" : "red")}
      ${kpi("PROFIT FACTOR", pf === Infinity ? "∞" : pf.toFixed(2), "", pf >= 1.5 ? "green" : "red")}
      ${kpi("AVG R", (avgR >= 0 ? "+" : "") + avgR.toFixed(2) + "R", "", avgR > 0 ? "green" : "red")}
      ${kpi("TOTAL P&L", fmt.signMoney(total), "", colorClass(total))}
    </div>

    <div class="card"><div class="section-title">Equity Curve</div><canvas id="eq-chart" height="90"></canvas></div>

    <div class="two-col">
      <div class="card"><div class="section-title">R Distribution</div><canvas id="r-chart" height="120"></canvas></div>
      <div>
        <div class="card"><div class="section-title">Long vs Short</div><div id="dir-table"></div></div>
        <div class="card"><div class="section-title">Checklist Score vs Results</div><div id="score-table"></div></div>
        <div class="card"><div class="section-title">Win / Loss Breakdown</div>
          <table><tbody>
            <tr><td class="muted">Avg Win</td><td class="green bold">${fmt.signMoney(avgWin)}</td></tr>
            <tr><td class="muted">Avg Loss</td><td class="red bold">${fmt.signMoney(avgLoss)}</td></tr>
            <tr><td class="muted">Largest Win</td><td class="green">${fmt.signMoney(Math.max(...recs.map(x=>x.pnl)))}</td></tr>
            <tr><td class="muted">Largest Loss</td><td class="red">${fmt.signMoney(Math.min(...recs.map(x=>x.pnl)))}</td></tr>
          </tbody></table>
        </div>
      </div>
    </div>
  `;

  // ── Grouping tables ─────────────────────────────────────────────────────────
  function groupTable(keyFn, container) {
    const groups = {};
    recs.forEach((x) => {
      const k = keyFn(x);
      (groups[k] ||= []).push(x);
    });
    const rows = Object.entries(groups).map(([k, arr]) => {
      const gPnl = arr.reduce((s, x) => s + x.pnl, 0);
      const gWr = (arr.filter((x) => x.won).length / arr.length) * 100;
      const gR = arr.reduce((s, x) => s + x.r, 0) / arr.length;
      return `<tr><td>${esc(k)}</td><td>${arr.length}</td>
        <td class="${colorClass(gPnl)}">${fmt.signMoney(gPnl)}</td>
        <td>${gWr.toFixed(0)}%</td><td class="${colorClass(gR)}">${gR.toFixed(2)}</td></tr>`;
    }).join("");
    document.getElementById(container).innerHTML =
      `<table><thead><tr><th>Group</th><th>Trades</th><th>P&L</th><th>Win%</th><th>Avg R</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  groupTable((x) => x.direction, "dir-table");
  groupTable((x) => (x.score >= 8 ? "Score ≥8" : x.score >= 6 ? "Score 6-7" : "Score <6"), "score-table");

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
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: grid }, ticks: { color: muted } },
        y: { grid: { color: grid }, ticks: { color: muted, callback: (v) => "$" + v } },
      },
    },
  });

  // R histogram (manual bins)
  const rs = recs.map((x) => x.r);
  const min = Math.floor(Math.min(...rs)), max = Math.ceil(Math.max(...rs));
  const bins = {};
  for (let b = min; b < max; b++) bins[b] = 0;
  rs.forEach((r) => { const b = Math.floor(r); bins[b] = (bins[b] || 0) + 1; });

  new Chart(document.getElementById("r-chart"), {
    type: "bar",
    data: {
      labels: Object.keys(bins).map((b) => `${b}R`),
      datasets: [{ data: Object.values(bins), backgroundColor: "#00d4aa" }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: grid }, ticks: { color: muted } },
        y: { grid: { color: grid }, ticks: { color: muted, stepSize: 1 } },
      },
    },
  });
}
