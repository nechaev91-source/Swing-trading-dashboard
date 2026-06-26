import { getOpenTrades, getClosedTrades } from "../db.js";
import { getPricesBatch } from "../data.js";
import { openPositionStats, realizedPnl, rMultiple } from "../calc.js";
import { fmt, showLoader, hideLoader, getPortfolio, setPortfolio, esc } from "../ui.js";
import { currentUser } from "../auth.js";

// "Pulse" Overview — landing dashboard. Layout/hierarchy from the Pulse handoff,
// rendered in our own design tokens for consistency, wired to real trade data.

// Chart accent colors (our accent + two harmonious secondaries for multi-segment donuts)
const COL = {
  accent: "#00d4aa", blue: "#4d9fff", lime: "#c6f24e", gray: "#586274",
  green: "#3fb950", red: "#f85149",
};
const RANGES = { "1W": 7, "1M": 30, "3M": 90, "1Y": 365 };

function setupName(strategy) {
  if (!strategy) return "Other";
  const [id, sub] = strategy.split(":");
  if (id === "trend-pullback") return "Trend-Pullback";
  if (id === "trend-line") return sub || "Trend Line";
  if (id === "breakout") return sub || "Breakout";
  if (id === "other") return "Manual";
  return id;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function marketStatus() {
  // US market hours in ET (June = EDT, UTC-4): 9:30–16:00, Mon–Fri
  const now = new Date();
  const et = new Date(now.getTime() - 4 * 3600 * 1000); // approx EDT
  const day = et.getUTCDay();
  const mins = et.getUTCHours() * 60 + et.getUTCMinutes();
  const open = day >= 1 && day <= 5 && mins >= 570 && mins < 960;
  return open ? "markets open" : "markets closed";
}

export async function renderDashboard(root) {
  const portfolioBase = getPortfolio();
  const user = currentUser();
  const name = (user?.email || "trader").split("@")[0];
  const display = name.charAt(0).toUpperCase() + name.slice(1);
  const initials = display.slice(0, 2).toUpperCase();

  showLoader();
  let closed = [], open = [], prices = {};
  try {
    [closed, open] = await Promise.all([getClosedTrades(), getOpenTrades()]);
    const syms = [...new Set(open.map((t) => t.symbol))];
    if (syms.length) prices = await getPricesBatch(syms);
  } finally {
    hideLoader();
  }

  // ── Closed-trade stats ──────────────────────────────────────────────────────
  const recs = closed
    .filter((t) => t.exit_price != null)
    .map((t) => ({
      pnl: realizedPnl(t.direction, t.entry_price, t.exit_price, t.shares),
      r: rMultiple(t.direction, t.entry_price, t.exit_price, t.stop_loss, t.shares),
      exit: t.exit_date || "",
      setup: setupName(t.strategy),
    }))
    .sort((a, b) => (a.exit < b.exit ? -1 : 1));

  const wins = recs.filter((r) => r.pnl > 0).length;
  const losses = recs.length - wins;
  const winRate = recs.length ? Math.round((wins / recs.length) * 100) : 0;
  const grossWin = recs.filter((r) => r.pnl > 0).reduce((s, r) => s + r.pnl, 0);
  const grossLoss = Math.abs(recs.filter((r) => r.pnl <= 0).reduce((s, r) => s + r.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0);
  const expectancy = recs.length ? recs.reduce((s, r) => s + r.r, 0) / recs.length : 0;
  const realizedPnlAll = recs.reduce((s, r) => s + r.pnl, 0);

  // win streak (longest run of consecutive wins)
  let streak = 0, best = 0;
  for (const r of recs) { if (r.pnl > 0) { streak++; best = Math.max(best, streak); } else streak = 0; }

  // equity curve: base + cumulative realized, by exit date
  let cum = portfolioBase;
  const curve = [{ date: recs[0]?.exit || "", equity: portfolioBase }];
  for (const r of recs) { cum += r.pnl; curve.push({ date: r.exit, equity: cum }); }

  // ── Open-trade stats ────────────────────────────────────────────────────────
  let unrealized = 0, deployed = 0;
  const positions = [];
  for (const t of open) {
    const cur = prices[t.symbol];
    const mv = (cur || t.entry_price) * t.shares;
    deployed += mv;
    let chg = null;
    if (cur) {
      const s = openPositionStats(t.direction, t.entry_price, cur, t.stop_loss, t.target, t.shares);
      unrealized += s.pnl;
      chg = ((cur - t.entry_price) / t.entry_price) * 100 * (t.direction === "Short" ? -1 : 1);
    }
    positions.push({ sym: t.symbol, shares: t.shares, entry: t.entry_price, chg, mv });
  }

  const portfolioValue = portfolioBase + realizedPnlAll + unrealized;
  const allTimePnl = realizedPnlAll + unrealized;
  const allTimePct = portfolioBase > 0 ? (allTimePnl / portfolioBase) * 100 : 0;
  const cashDollar = Math.max(0, portfolioValue - deployed);

  // exposure: open positions (by market value) + cash
  const exposurePct = portfolioValue > 0 ? Math.min(100, (deployed / portfolioValue) * 100) : 0;
  const segColors = [COL.accent, COL.blue, COL.lime, "#b07cff", "#e3a93f"];
  let alloc = positions
    .map((p, i) => ({ name: p.sym, pct: portfolioValue > 0 ? (p.mv / portfolioValue) * 100 : 0, col: segColors[i % segColors.length] }))
    .sort((a, b) => b.pct - a.pct);
  if (alloc.length > 4) {
    const top = alloc.slice(0, 4);
    const other = alloc.slice(4).reduce((s, a) => s + a.pct, 0);
    top.push({ name: "Other", pct: other, col: COL.gray });
    alloc = top;
  }
  const cashPct = Math.max(0, 100 - alloc.reduce((s, a) => s + a.pct, 0));
  if (cashPct > 0.5) alloc.push({ name: "Cash", pct: cashPct, col: COL.gray });

  // setup performance
  const bySetup = {};
  recs.forEach((r) => {
    (bySetup[r.setup] ||= { win: 0, n: 0, pnl: 0 });
    bySetup[r.setup].n++; bySetup[r.setup].pnl += r.pnl; if (r.pnl > 0) bySetup[r.setup].win++;
  });
  const setups = Object.entries(bySetup)
    .map(([name, v]) => ({ name, winPct: Math.round((v.win / v.n) * 100), trades: v.n, pnl: v.pnl }))
    .sort((a, b) => b.pnl - a.pnl).slice(0, 5);

  // ── Render ──────────────────────────────────────────────────────────────────
  const pctStr = `${allTimePct >= 0 ? "+" : ""}${allTimePct.toFixed(1)}%`;
  const pfChip = `<span class="pl-chip ${allTimePnl >= 0 ? "up" : "down"}">${allTimePnl >= 0 ? "▲" : "▼"} ${pctStr}</span>`;

  root.innerHTML = `
    <div class="pl-header">
      <div>
        <div class="pl-greeting">${greeting()}, ${esc(display)}</div>
        <div class="pl-sub">${open.length} position${open.length === 1 ? "" : "s"} open · ${marketStatus()}</div>
      </div>
      <div class="pl-avatar">${esc(initials)}</div>
    </div>

    <div class="pl-grid">
      <!-- Equity hero -->
      <div class="card pl-hero">
        <div class="pl-hero-top">
          <div>
            <div class="pl-label">Portfolio value</div>
            <div class="pl-hero-value">${fmt.money(portfolioValue)}</div>
            <div class="pl-hero-chiprow">
              ${pfChip}
              <span class="pl-muted">${fmt.signMoney(allTimePnl)} all time</span>
            </div>
          </div>
          <div class="pl-rangetoggle" id="pl-range">
            ${Object.keys(RANGES).map((r) => `<button data-r="${r}" class="${r === "3M" ? "active" : ""}">${r}</button>`).join("")}
          </div>
        </div>
        <div class="pl-chart-wrap">
          <canvas id="pl-equity"></canvas>
          <div id="pl-chart-empty" class="pl-chart-empty hidden">No closed trades yet — your equity curve builds as you close trades.</div>
        </div>
        <div class="pl-pf-edit">
          <span class="pl-muted">Starting capital</span>
          <input type="number" id="pl-pf" value="${portfolioBase}" step="500" />
        </div>
      </div>

      <!-- Win rate -->
      <div class="card pl-winrate">
        <div class="pl-ring">
          ${ring(winRate)}
          <div class="pl-ring-center"><span class="pl-ring-num">${winRate}%</span><span class="pl-label">win rate</span></div>
        </div>
        <div>
          <div class="pl-legend-row"><span class="pl-dot" style="background:${COL.green}"></span><span class="pl-muted">${wins} wins</span></div>
          <div class="pl-legend-row"><span class="pl-dot" style="background:${COL.red}"></span><span class="pl-muted">${losses} losses</span></div>
        </div>
      </div>

      <!-- Exposure -->
      <div class="card pl-exposure">
        <div class="pl-exposure-row">
          <div class="pl-donut">
            ${donut(alloc)}
            <div class="pl-ring-center"><span class="pl-label">exposure</span><span class="pl-donut-num">${exposurePct.toFixed(0)}%</span></div>
          </div>
          <div class="pl-alloc">
            ${alloc.length ? alloc.map((a) => `
              <div class="pl-alloc-row"><span class="pl-swatch" style="background:${a.col}"></span>
              <span class="pl-muted">${esc(a.name)}</span><span class="pl-alloc-pct">${a.pct.toFixed(0)}%</span></div>`).join("")
              : `<div class="pl-muted">No open exposure</div>`}
          </div>
        </div>
        <div class="pl-cash">💵 Cash <b>${fmt.money(cashDollar)}</b> · Invested ${fmt.money(deployed)}</div>
      </div>

      <!-- KPIs -->
      <div class="pl-kpis">
        ${kpi("Profit factor", profitFactor === Infinity ? "∞" : profitFactor.toFixed(1), profitFactor >= 1.5 ? "Healthy" : "Needs work", profitFactor >= 1.5 ? COL.green : COL.red)}
        ${kpi("Expectancy", (expectancy >= 0 ? "+" : "") + expectancy.toFixed(2) + "R", "per $1 risked", COL.accent)}
        ${kpi("Win streak", String(best), `${recs.length} closed`, COL.lime)}
      </div>

      <!-- Open positions -->
      <div class="card pl-open">
        <div class="pl-open-head">
          <span class="pl-card-title">Open positions</span>
          <a href="#positions" class="pl-link">Manage</a>
        </div>
        <div class="pl-open-list">
          ${positions.length ? positions.map((p) => `
            <div class="pl-open-row">
              <div class="pl-tile">${esc(p.sym.slice(0, 2))}</div>
              <div><div class="pl-open-sym">${esc(p.sym)}</div><div class="pl-faint">${p.shares} sh · $${fmt.num(p.entry)}</div></div>
              <div class="pl-open-chg ${p.chg == null ? "pl-muted" : p.chg >= 0 ? "up" : "down"}">${p.chg == null ? "—" : (p.chg >= 0 ? "+" : "") + p.chg.toFixed(1) + "%"}</div>
            </div>`).join("")
            : `<div class="pl-muted">No open positions. Add one in New Trade.</div>`}
        </div>
      </div>
    </div>

    <!-- Setup performance -->
    <div class="card pl-setups">
      <div class="pl-setups-head"><span class="pl-card-title">Performance by setup</span>
        <span class="pl-faint">where your edge actually comes from</span></div>
      <div class="pl-setups-grid">
        ${setups.length ? setups.map((s) => {
          const fill = s.winPct >= 55 ? `linear-gradient(90deg,${COL.accent},${COL.blue})` : s.winPct >= 45 ? COL.accent : COL.red;
          return `<div>
            <div class="pl-setup-top"><span class="pl-setup-name">${esc(s.name)}</span>
              <span class="pl-setup-pnl ${s.pnl >= 0 ? "up" : "down"}">${fmt.signMoney(s.pnl)}</span></div>
            <div class="pl-bar"><div class="pl-bar-fill" style="width:${s.winPct}%;background:${fill}"></div></div>
            <div class="pl-faint">${s.winPct}% win · ${s.trades} trade${s.trades === 1 ? "" : "s"}</div>
          </div>`;
        }).join("") : `<div class="pl-muted">No closed trades yet — setup stats appear as you close trades.</div>`}
      </div>
    </div>
  `;

  // portfolio edit
  document.getElementById("pl-pf").addEventListener("change", (e) => {
    setPortfolio(parseFloat(e.target.value) || 0);
    renderDashboard(root);
  });

  // ── Equity chart (Chart.js) with range toggle ───────────────────────────────
  let chart = null;
  function drawChart(rangeKey) {
    const days = RANGES[rangeKey];
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    let pts = curve.filter((p) => !p.date || p.date >= cutoff);
    if (pts.length < 2) pts = curve; // not enough in window — show all we have
    const emptyEl = document.getElementById("pl-chart-empty");
    const canvas = document.getElementById("pl-equity");

    if (curve.length < 2) {
      canvas.style.display = "none";
      emptyEl.classList.remove("hidden");
      return;
    }
    canvas.style.display = "block";
    emptyEl.classList.add("hidden");

    if (chart) chart.destroy();
    chart = new Chart(canvas, {
      type: "line",
      data: {
        labels: pts.map((p) => p.date || ""),
        datasets: [{
          data: pts.map((p) => p.equity),
          borderWidth: 3, tension: 0.35, pointRadius: 0, fill: true,
          borderColor: (c) => {
            const { ctx, chartArea } = c.chart;
            if (!chartArea) return COL.accent;
            const g = ctx.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
            g.addColorStop(0, COL.accent); g.addColorStop(1, COL.blue); return g;
          },
          backgroundColor: (c) => {
            const { ctx, chartArea } = c.chart;
            if (!chartArea) return "transparent";
            const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            g.addColorStop(0, "rgba(0,212,170,0.28)"); g.addColorStop(1, "rgba(0,212,170,0)"); return g;
          },
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: { title: (i) => i[0].label, label: (i) => fmt.money(i.parsed.y) },
          },
        },
        scales: {
          x: { display: false },
          y: { display: false, grace: "8%" },
        },
      },
    });
  }
  drawChart("3M");

  document.getElementById("pl-range").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-r]");
    if (!b) return;
    document.querySelectorAll("#pl-range button").forEach((x) => x.classList.toggle("active", x === b));
    drawChart(b.dataset.r);
  });
}

// ── SVG helpers ───────────────────────────────────────────────────────────────
function ring(pct) {
  const r = 52, c = 2 * Math.PI * r;
  return `<svg width="124" height="124" viewBox="0 0 124 124">
    <circle cx="62" cy="62" r="${r}" fill="none" stroke="var(--border)" stroke-width="12"/>
    <circle cx="62" cy="62" r="${r}" fill="none" stroke="${COL.accent}" stroke-width="12" stroke-linecap="round"
      stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - pct / 100)).toFixed(1)}" transform="rotate(-90 62 62)"/>
  </svg>`;
}

function donut(alloc) {
  const r = 46, c = 2 * Math.PI * r;
  let acc = 0;
  const arcs = alloc.map((a) => {
    const off = c * (1 - a.pct / 100), rot = (acc / 100) * 360 - 90;
    acc += a.pct;
    return `<circle cx="58" cy="58" r="${r}" fill="none" stroke="${a.col}" stroke-width="14"
      stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(${rot.toFixed(1)} 58 58)"/>`;
  }).join("");
  return `<svg width="116" height="116" viewBox="0 0 116 116">
    <circle cx="58" cy="58" r="${r}" fill="none" stroke="var(--border)" stroke-width="14"/>${arcs}</svg>`;
}

function kpi(label, value, chip, chipCol) {
  return `<div class="card pl-kpi">
    <div class="pl-label">${label}</div>
    <div class="pl-kpi-val">${value}</div>
    <span class="pl-kpi-chip" style="color:${chipCol};background:${chipCol}1e">${chip}</span>
  </div>`;
}
