import { getOpenTrades } from "../db.js";
import { getPricesBatch } from "../data.js";
import { openPositionStats } from "../calc.js";
import { fmt, colorClass, showLoader, hideLoader, getPortfolio, setPortfolio, esc } from "../ui.js";

export async function renderDashboard(root) {
  const portfolio = getPortfolio();

  root.innerHTML = `
    <div class="view-title">📊 Live Portfolio</div>
    <div class="field" style="max-width:240px">
      <label>Portfolio Size ($)</label>
      <input type="number" id="pf-input" value="${portfolio}" step="500" />
    </div>
    <div id="dash-body"><div class="empty-state">Loading positions…</div></div>
  `;

  document.getElementById("pf-input").addEventListener("change", (e) => {
    setPortfolio(parseFloat(e.target.value) || 0);
    renderDashboard(root);
  });

  const body = document.getElementById("dash-body");

  showLoader();
  let trades, prices;
  try {
    trades = await getOpenTrades();
    if (!trades.length) {
      hideLoader();
      body.innerHTML = `<div class="empty-state">No open positions. Add one in <b>New Trade</b>.</div>`;
      return;
    }
    const symbols = [...new Set(trades.map((t) => t.symbol))];
    prices = await getPricesBatch(symbols);
  } finally {
    hideLoader();
  }

  let totalPnl = 0, totalRisk = 0;
  const rows = [];
  const alerts = [];

  for (const t of trades) {
    const cur = prices[t.symbol];
    if (cur == null) {
      rows.push(`<tr><td class="bold">${esc(t.symbol)}</td><td>${t.direction}</td>
        <td>$${fmt.num(t.entry_price)}</td><td class="muted">—</td><td>${t.shares}</td>
        <td class="muted">—</td><td class="muted">—</td><td>$${fmt.num(t.stop_loss)}</td>
        <td>$${fmt.num(t.target)}</td><td class="muted">—</td><td class="muted">⚠ no data</td></tr>`);
      continue;
    }
    const s = openPositionStats(t.direction, t.entry_price, cur, t.stop_loss, t.target, t.shares);
    totalPnl += s.pnl;
    totalRisk += s.risk;
    const cost = t.entry_price * t.shares;
    const pnlPct = (s.pnl / cost) * 100;

    let flag = "";
    if (s.atStop) { flag = `<span class="red bold">🔴 STOP</span>`; alerts.push({ sym: t.symbol, type: "stop" }); }
    else if (s.atTarget) { flag = `<span class="green bold">🟢 TARGET</span>`; alerts.push({ sym: t.symbol, type: "target" }); }

    rows.push(`<tr>
      <td class="bold">${esc(t.symbol)}</td>
      <td>${t.direction}</td>
      <td>$${fmt.num(t.entry_price)}</td>
      <td>$${fmt.num(cur)}</td>
      <td>${t.shares}</td>
      <td class="${colorClass(s.pnl)} bold">${fmt.signMoney(s.pnl)}</td>
      <td class="${colorClass(s.pnl)}">${fmt.pct(pnlPct)}</td>
      <td>$${fmt.num(t.stop_loss)}</td>
      <td>$${fmt.num(t.target)}</td>
      <td class="${colorClass(s.r)}">${s.r.toFixed(2)}R</td>
      <td>${flag}</td>
    </tr>`);
  }

  const pnlPctPf = portfolio > 0 ? (totalPnl / portfolio) * 100 : 0;
  const riskPct = portfolio > 0 ? (totalRisk / portfolio) * 100 : 0;

  body.innerHTML = `
    <div class="cards-grid">
      <div class="stat-card"><div class="label">OPEN POSITIONS</div><div class="value">${trades.length}</div></div>
      <div class="stat-card"><div class="label">TOTAL P&L</div>
        <div class="value ${colorClass(totalPnl)}">${fmt.signMoney(totalPnl)}</div>
        <div class="sub ${colorClass(totalPnl)}">${fmt.pct(pnlPctPf)} of portfolio</div></div>
      <div class="stat-card"><div class="label">ACTIVE RISK</div>
        <div class="value ${riskPct > 10 ? "red" : ""}">${fmt.money(totalRisk)}</div>
        <div class="sub">${riskPct.toFixed(1)}% of portfolio</div></div>
      <div class="stat-card"><div class="label">PORTFOLIO SIZE</div><div class="value">$${portfolio.toLocaleString()}</div></div>
    </div>

    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Symbol</th><th>Side</th><th>Entry</th><th>Current</th><th>Shares</th>
          <th>P&L $</th><th>P&L %</th><th>Stop</th><th>Target</th><th>R</th><th>Alert</th>
        </tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>

    ${alerts.length ? `<div class="spacer"></div><div class="section-title">⚡ Alerts</div>` : ""}
    ${alerts.map((a) => a.type === "stop"
      ? `<div class="alert alert-stop">🔴 <b>${esc(a.sym)}</b> hit the stop loss — consider exiting.</div>`
      : `<div class="alert alert-target">🟢 <b>${esc(a.sym)}</b> reached the target — consider locking profit.</div>`
    ).join("")}
  `;
}
