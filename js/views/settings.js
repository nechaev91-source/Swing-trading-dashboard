import { getAllTrades, getClosedTrades, getOpenTrades, resetAllData, updateTrade } from "../db.js";
import { getPricesBatch } from "../data.js";
import { tradeNetPnl, openPositionStats, realizedPnl } from "../calc.js";
import { currentUser } from "../auth.js";
import { fmt, getPortfolio, setPortfolio, getCommission, setCommission, showLoader, hideLoader, toast } from "../ui.js";

export async function renderSettings(root) {
  const user = currentUser();
  const base = getPortfolio();
  const comm = getCommission();
  root.innerHTML = `
    <div class="view-title">⚙️ Settings</div>

    <div class="card">
      <div class="section-title">Account</div>
      <div>Signed in as <b>${user.email}</b></div>
      <div class="hint">Your data syncs automatically across every device you sign in on.</div>
    </div>

    <div class="card">
      <div class="section-title">Starting Capital</div>
      <div class="field" style="max-width:240px">
        <label>Starting capital ($)</label>
        <input type="number" id="sc-base" value="${base}" step="500" />
        <div class="hint">Synced across your devices. Drives equity curve & % returns.</div>
      </div>
      <div class="alert alert-ok" style="margin-top:6px">
        <b>Don't know your starting capital?</b> Import your closed trades first, then
        enter your <b>current account value</b> below — I'll work it back for you.
      </div>
      <div class="field-row" style="max-width:420px">
        <div class="field"><label>Current account value ($)</label><input type="number" id="sc-current" placeholder="e.g. 14500" step="100" /></div>
        <div class="field" style="display:flex;align-items:flex-end">
          <button id="sc-derive" class="btn btn-secondary">Compute starting capital</button>
        </div>
      </div>
      <div id="sc-result"></div>
    </div>

    <div class="card">
      <div class="section-title">Commissions</div>
      <div class="field" style="max-width:300px">
        <label>Default commission per trade — round trip ($)</label>
        <input type="number" id="cm-rate" value="${comm}" step="0.5" />
        <div class="hint">Applied automatically to new trades (e.g. $1.5 buy + $1.5 sell = $3). Subtracted from net P&L. For imports, map a Commission column. Edit a trade to change its commission.</div>
      </div>
    </div>

    <div class="card">
      <div class="section-title">Data</div>
      <div id="data-stats" class="hint">Loading…</div>
    </div>

    <div class="card">
      <div class="section-title">Backfill Stops (historical)</div>
      <div class="hint">For closed <b>losing</b> trades with no stop recorded, set the stop = exit price — i.e. assume they were stopped out at −1R. Makes R-based stats meaningful. Skips winners and any trade that already has a stop.</div>
      <div id="bf-info" class="hint" style="margin-top:8px">Checking…</div>
      <button id="bf-btn" class="btn btn-secondary" style="margin-top:8px">Backfill stops for losing trades</button>
      <div id="bf-result"></div>
    </div>

    <div class="card">
      <div class="section-title">Reset Data</div>
      <div class="alert alert-warn">⚠️ This permanently deletes ALL your trades on every device. Cannot be undone.</div>
      <div class="field"><label>Type <b>RESET</b> to confirm</label><input id="reset-confirm" placeholder="RESET" /></div>
      <button id="reset-btn" class="btn btn-danger" disabled>Reset All Data</button>
    </div>

    <div class="card">
      <div class="section-title">Checklist</div>
      <div class="hint">Strategies and their checklists are defined in <code>strategies.json</code>. Edit that file in the repo to add, remove, or reorder items, then redeploy.</div>
    </div>
  `;

  // data stats
  try {
    const trades = await getAllTrades();
    const open = trades.filter((t) => t.status === "open").length;
    const closed = trades.length - open;
    const charts = trades.filter((t) => t.chart_url).length;
    document.getElementById("data-stats").innerHTML =
      `${trades.length} trades total — <b>${open}</b> open, <b>${closed}</b> closed · ${charts} chart image(s).`;
  } catch {
    document.getElementById("data-stats").textContent = "Could not load stats.";
  }

  // ── Starting capital: direct edit ───────────────────────────────────────────
  document.getElementById("sc-base").addEventListener("change", (e) => {
    setPortfolio(parseFloat(e.target.value) || 0);
    toast("Starting capital saved", "success");
  });

  // ── Commission rate ─────────────────────────────────────────────────────────
  document.getElementById("cm-rate").addEventListener("change", (e) => {
    setCommission(parseFloat(e.target.value) || 0);
    toast("Commission saved", "success");
  });

  // ── Starting capital: derive from current balance ───────────────────────────
  document.getElementById("sc-derive").addEventListener("click", async () => {
    const current = parseFloat(document.getElementById("sc-current").value);
    const out = document.getElementById("sc-result");
    if (!isFinite(current) || current <= 0) { out.innerHTML = `<div class="alert alert-warn">Enter your current account value.</div>`; return; }
    showLoader();
    try {
      const [closed, open] = await Promise.all([getClosedTrades(), getOpenTrades()]);
      const realized = closed
        .filter((t) => t.exit_price != null)
        .reduce((s, t) => s + tradeNetPnl(t), 0);

      let unrealized = 0;
      const syms = [...new Set(open.map((t) => t.symbol))];
      const prices = syms.length ? await getPricesBatch(syms) : {};
      for (const t of open) {
        const cur = prices[t.symbol];
        if (cur) unrealized += openPositionStats(t.direction, t.entry_price, cur, t.stop_loss, t.target, t.shares).pnl;
      }

      const derived = current - realized - unrealized;
      setPortfolio(Math.round(derived));
      document.getElementById("sc-base").value = Math.round(derived);

      out.innerHTML = `
        <div class="alert alert-ok" style="margin-top:8px">
          <b>Starting capital set to ${fmt.money(Math.round(derived))}</b><br>
          <span class="hint">${fmt.money(current)} current − ${fmt.signMoney(realized)} realized${unrealized ? " − " + fmt.signMoney(unrealized) + " open" : ""} = ${fmt.money(Math.round(derived))}</span>
        </div>`;
      toast("Starting capital computed & saved", "success");
    } catch (e) {
      out.innerHTML = `<div class="alert alert-stop">Failed: ${e.message}</div>`;
    } finally {
      hideLoader();
    }
  });

  // ── Backfill stops for stop-less losing trades ──────────────────────────────
  function losingNoStop(closed) {
    return closed.filter((t) => t.exit_price != null && t.stop_loss == null &&
      realizedPnl(t.direction, t.entry_price, t.exit_price, t.shares) < 0);
  }
  (async () => {
    try {
      const targets = losingNoStop(await getClosedTrades());
      document.getElementById("bf-info").textContent = targets.length
        ? `${targets.length} closed losing trade(s) have no stop — these will get stop = exit (−1R).`
        : "No stop-less losing trades found.";
      document.getElementById("bf-btn").disabled = targets.length === 0;
    } catch { document.getElementById("bf-info").textContent = "Could not check trades."; }
  })();

  document.getElementById("bf-btn").addEventListener("click", async () => {
    const targets = losingNoStop(await getClosedTrades());
    if (!targets.length) return;
    if (!confirm(`Set stop = exit price on ${targets.length} losing trade(s)? (Winners and trades with a stop are untouched.)`)) return;
    showLoader();
    let n = 0;
    try {
      for (const t of targets) { await updateTrade(t.id, { stop_loss: t.exit_price, current_stop: t.exit_price }); n++; }
      document.getElementById("bf-result").innerHTML = `<div class="alert alert-ok">Set stops on ${n} losing trade(s) — each now registers as −1R.</div>`;
      document.getElementById("bf-info").textContent = "No stop-less losing trades found.";
      document.getElementById("bf-btn").disabled = true;
      toast(`Backfilled ${n} stops`, "success");
    } catch (e) {
      document.getElementById("bf-result").innerHTML = `<div class="alert alert-stop">Failed after ${n}: ${e.message}</div>`;
    } finally { hideLoader(); }
  });

  const confirmEl = document.getElementById("reset-confirm");
  const btn = document.getElementById("reset-btn");
  confirmEl.addEventListener("input", () => { btn.disabled = confirmEl.value !== "RESET"; });

  btn.addEventListener("click", async () => {
    showLoader();
    try {
      await resetAllData();
      toast("All data cleared — starting fresh", "success");
      renderSettings(root);
    } catch (e) {
      toast("Reset failed: " + e.message, "error");
    } finally {
      hideLoader();
    }
  });
}
