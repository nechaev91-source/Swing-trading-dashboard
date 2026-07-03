import { getOpenTrades, updateTradeStop, updateTrade, recordExit } from "../db.js";
import { realizedPnl, remainingShares, exitedShares, tradeNetPnl } from "../calc.js";
import { fmt, colorClass, showLoader, hideLoader, toast, esc, getCommission } from "../ui.js";

function stratLabel(strategy) {
  if (!strategy) return ["Other", "#8b949e"];
  const [id, sub] = strategy.split(":");
  if (id === "trend-pullback") return ["Trend-Pullback", "#3fb950"];
  if (id === "trend-line") return [sub || "Trend Line", "#58a6ff"];
  if (id === "breakout") return [sub || "Breakout", "#58a6ff"];
  if (id === "ma20-pullback") return ["20-MA Pullback", "#d29922"];
  if (id === "other") return ["Manual", "#8b949e"];
  return [id, "#8b949e"];
}
const money = (v) => (v != null && isFinite(v)) ? "$" + (+v).toFixed(2) : "—";

export async function renderPositions(root) {
  root.innerHTML = `
    <div class="view-title">📍 Open Positions</div>
    <div id="pos-body"><div class="empty-state">Loading…</div></div>
  `;
  await refresh();

  async function refresh() {
    showLoader();
    let trades;
    try { trades = await getOpenTrades(); }
    catch (e) { hideLoader(); document.getElementById("pos-body").innerHTML = `<div class="empty-state">Error: ${e.message}</div>`; return; }
    hideLoader();

    const body = document.getElementById("pos-body");
    if (!trades.length) {
      body.innerHTML = `<div class="empty-state">No open positions. Enter a trade first.</div>`;
      return;
    }

    body.innerHTML = trades.map((t) => {
      const isTrend = t.strategy === "trend-pullback";
      const curStop = t.current_stop ?? t.stop_loss;
      const [label, col] = stratLabel(t.strategy);
      const rem = remainingShares(t);
      const exd = exitedShares(t);
      const banked = exd > 0 ? tradeNetPnl(t) : null;   // realized so far from partial exits
      return `
        <div class="card pos-card" data-id="${t.id}">
          <div class="pos-header">
            <div>
              <span class="pos-sym">${esc(t.symbol)}</span>
              <span class="tag" style="background:${col}22;color:${col};border:1px solid ${col}">${esc(label)}</span>
            </div>
            <div class="pos-date">${esc(t.entry_date || "")}</div>
          </div>
          <div class="pos-details">
            <div class="pos-stat"><div class="clabel">ENTRY</div><div class="cvalue">${money(t.entry_price)}</div></div>
            <div class="pos-stat"><div class="clabel">SHARES</div><div class="cvalue">${exd > 0
              ? `${rem.toFixed(0)} <span class="muted" style="font-weight:400">/ ${(+t.shares).toFixed(0)}</span>`
              : (+t.shares).toFixed(0)}</div></div>
            <div class="pos-stat"><div class="clabel">CURRENT STOP</div><div class="cvalue ${curStop != null ? "red" : "muted"}">${money(curStop)}</div></div>
            ${t.target != null ? `<div class="pos-stat"><div class="clabel">TARGET</div><div class="cvalue green">${money(t.target)}</div></div>` : ""}
            ${exd > 0 ? `<div class="pos-stat"><div class="clabel">REALIZED (${exd.toFixed(0)} sold)</div><div class="cvalue ${colorClass(banked)}">${fmt.signMoney(banked)}</div></div>` : ""}
            ${isTrend ? `<div class="pos-stat"><div class="clabel">INITIAL STOP</div><div class="cvalue muted">${money(t.stop_loss)}</div></div>` : ""}
          </div>

          <!-- Full edit form (hidden) -->
          <div class="pos-edit hidden" id="ed-${t.id}">
            <div class="field-row">
              <div class="field"><label>Entry Date</label><input type="date" id="ed-date-${t.id}" value="${esc(t.entry_date || "")}"></div>
              <div class="field"><label>Entry Price $</label><input type="number" step="0.01" id="ed-entry-${t.id}" value="${t.entry_price}"></div>
            </div>
            <div class="field-row">
              <div class="field"><label>Shares</label><input type="number" step="1" id="ed-shares-${t.id}" value="${t.shares}"></div>
              <div class="field"><label>Stop Loss $ (optional)</label><input type="number" step="0.01" id="ed-stop-${t.id}" value="${t.stop_loss ?? ""}"></div>
            </div>
            <div class="field-row">
              <div class="field"><label>Target $ (optional)</label><input type="number" step="0.01" id="ed-target-${t.id}" value="${t.target ?? ""}"></div>
              <div class="field"><label>Commission $ (round trip)</label><input type="number" step="0.5" id="ed-comm-${t.id}" value="${t.commission ?? 0}"></div>
            </div>
            <div class="pos-actions">
              <button class="btn btn-primary btn-sm save-edit" data-id="${t.id}">Save Changes</button>
              <button class="btn btn-ghost btn-sm cancel-edit" data-id="${t.id}">Cancel</button>
            </div>
          </div>

          <!-- Default actions -->
          <div class="pos-actions" id="act-${t.id}">
            <button class="btn btn-secondary btn-sm edit-pos" data-id="${t.id}">✏️ Edit</button>
            ${isTrend ? `<button class="btn btn-secondary btn-sm raise-stop" data-id="${t.id}">⬆ Raise Stop</button>` : ""}
            <button class="btn btn-danger btn-sm close-toggle" data-id="${t.id}">✕ Sell / Close</button>
          </div>

          <!-- Scale-out / close form -->
          <div class="pos-edit hidden" id="cl-${t.id}">
            <div class="field-row">
              <div class="field"><label>Shares to sell (max ${rem.toFixed(0)})</label><input type="number" step="1" min="1" max="${rem}" id="cl-shares-${t.id}" value="${rem}"></div>
              <div class="field"><label>Exit (sell) Price $</label><input type="number" step="0.01" id="cl-price-${t.id}" value="${curStop != null ? (+curStop).toFixed(2) : t.entry_price}"></div>
            </div>
            <div class="field-row">
              <div class="field"><label>Exit Date</label><input type="date" id="cl-date-${t.id}"></div>
              <div class="field"><label>Notes (optional)</label><input id="cl-notes-${t.id}" placeholder="reason / lesson"></div>
            </div>
            <div class="pos-actions" style="gap:6px;margin-bottom:8px">
              <button class="btn btn-ghost btn-sm quick-frac" data-id="${t.id}" data-frac="0.5">½</button>
              <button class="btn btn-ghost btn-sm quick-frac" data-id="${t.id}" data-frac="0.333">⅓</button>
              <button class="btn btn-ghost btn-sm quick-frac" data-id="${t.id}" data-frac="1">All</button>
            </div>
            <div id="cl-prev-${t.id}" style="font-weight:600;margin-bottom:10px"></div>
            <div class="pos-actions">
              <button class="btn btn-primary btn-sm do-close" data-id="${t.id}">Confirm Sell</button>
              <button class="btn btn-ghost btn-sm cancel-close" data-id="${t.id}">Cancel</button>
            </div>
          </div>

          <!-- Inline stop raise (trend-pullback) -->
          ${isTrend ? `<div class="pos-actions stop-edit hidden" id="raise-${t.id}">
            <input type="number" class="stop-input" id="stop-val-${t.id}" value="${(+curStop).toFixed(2)}" step="0.01" style="width:110px" />
            <button class="btn btn-secondary btn-sm save-stop" data-id="${t.id}">Save Stop</button>
            <button class="btn btn-ghost btn-sm cancel-raise" data-id="${t.id}">Cancel</button>
          </div>` : ""}
        </div>`;
    }).join("");

    const show = (id) => document.getElementById(id).classList.remove("hidden");
    const hide = (id) => document.getElementById(id).classList.add("hidden");

    // ── Edit (all trades) ─────────────────────────────────────
    body.querySelectorAll(".edit-pos").forEach((b) => b.addEventListener("click", () => {
      show(`ed-${b.dataset.id}`); hide(`act-${b.dataset.id}`);
    }));
    body.querySelectorAll(".cancel-edit").forEach((b) => b.addEventListener("click", () => {
      hide(`ed-${b.dataset.id}`); show(`act-${b.dataset.id}`);
    }));
    body.querySelectorAll(".save-edit").forEach((b) => b.addEventListener("click", async () => {
      const id = b.dataset.id;
      const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };
      const entry = num(document.getElementById(`ed-entry-${id}`).value);
      const shares = num(document.getElementById(`ed-shares-${id}`).value);
      if (entry == null || entry <= 0 || shares == null || shares <= 0) { toast("Entry and shares must be positive", "error"); return; }
      const stop = num(document.getElementById(`ed-stop-${id}`).value);
      const target = num(document.getElementById(`ed-target-${id}`).value);
      const comm = num(document.getElementById(`ed-comm-${id}`).value);
      const fields = {
        entry_date: document.getElementById(`ed-date-${id}`).value,
        entry_price: entry,
        shares,
        stop_loss: (stop != null && stop > 0) ? stop : null,
        target: (target != null && target > 0) ? target : null,
        commission: (comm != null && comm >= 0) ? comm : 0,
      };
      // keep current_stop sensible if it was tracking the (old) initial stop
      const t = trades.find((x) => x.id === id);
      if (t.current_stop == null || t.current_stop === t.stop_loss) fields.current_stop = fields.stop_loss;
      showLoader();
      try {
        await updateTrade(id, fields);
        toast("Trade updated", "success");
        await refresh();
      } catch (e) { toast("Update failed: " + e.message, "error"); }
      finally { hideLoader(); }
    }));

    // ── Raise stop (trend-pullback) ───────────────────────────
    body.querySelectorAll(".raise-stop").forEach((b) => b.addEventListener("click", () => {
      show(`raise-${b.dataset.id}`); hide(`act-${b.dataset.id}`);
    }));
    body.querySelectorAll(".cancel-raise").forEach((b) => b.addEventListener("click", () => {
      hide(`raise-${b.dataset.id}`); show(`act-${b.dataset.id}`);
    }));
    body.querySelectorAll(".save-stop").forEach((b) => b.addEventListener("click", async () => {
      const id = b.dataset.id;
      const newStop = parseFloat(document.getElementById(`stop-val-${id}`).value);
      if (!newStop || newStop <= 0) { toast("Invalid stop value", "error"); return; }
      showLoader();
      try { await updateTradeStop(id, newStop); toast(`Stop updated to $${newStop.toFixed(2)}`, "success"); await refresh(); }
      catch (e) { toast("Update failed: " + e.message, "error"); }
      finally { hideLoader(); }
    }));

    // ── Scale out / close (partial or full sell) ──────────────
    const sellFee = Math.round((getCommission() / 2) * 100) / 100;   // per-exit sell commission

    function closePreview(id) {
      const t = trades.find((x) => x.id === id);
      const rem = remainingShares(t);
      const exit = parseFloat(document.getElementById(`cl-price-${id}`).value);
      let qty = parseFloat(document.getElementById(`cl-shares-${id}`).value);
      const el = document.getElementById(`cl-prev-${id}`);
      if (!isFinite(exit) || !isFinite(qty) || qty <= 0) { el.textContent = ""; return; }
      qty = Math.min(qty, rem);
      const full = qty >= rem;
      const pnl = realizedPnl(t.direction, t.entry_price, exit, qty) - sellFee;   // this leg, net of its sell fee
      const rps = (t.stop_loss != null && isFinite(t.stop_loss)) ? Math.abs(t.entry_price - t.stop_loss) : 0;
      const r = rps ? (realizedPnl(t.direction, t.entry_price, exit, qty)) / (rps * qty) : 0;
      el.className = colorClass(pnl);
      el.innerHTML = `${full ? "Close all" : "Sell " + qty.toFixed(0) + " of " + rem.toFixed(0)}: `
        + `${fmt.signMoney(pnl)} <span class="muted" style="font-weight:400">(net of $${sellFee.toFixed(2)} sell fee)</span>`
        + `${rps ? " · " + (r >= 0 ? "+" : "") + r.toFixed(2) + "R" : ""}`
        + `${full ? "" : ` · ${(rem - qty).toFixed(0)} left running`}`;
    }

    body.querySelectorAll(".close-toggle").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.id;
      show(`cl-${id}`); hide(`act-${id}`);
      document.getElementById(`cl-date-${id}`).value = new Date().toISOString().slice(0, 10);
      document.getElementById(`cl-price-${id}`).addEventListener("input", () => closePreview(id));
      document.getElementById(`cl-shares-${id}`).addEventListener("input", () => closePreview(id));
      closePreview(id);
    }));
    body.querySelectorAll(".quick-frac").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.id;
      const t = trades.find((x) => x.id === id);
      const rem = remainingShares(t);
      const frac = parseFloat(b.dataset.frac);
      const qty = frac >= 1 ? rem : Math.max(1, Math.round(rem * frac));
      document.getElementById(`cl-shares-${id}`).value = qty;
      closePreview(id);
    }));
    body.querySelectorAll(".cancel-close").forEach((b) => b.addEventListener("click", () => {
      hide(`cl-${b.dataset.id}`); show(`act-${b.dataset.id}`);
    }));
    body.querySelectorAll(".do-close").forEach((b) => b.addEventListener("click", async () => {
      const id = b.dataset.id;
      const t = trades.find((x) => x.id === id);
      const rem = remainingShares(t);
      const exit = parseFloat(document.getElementById(`cl-price-${id}`).value);
      let qty = parseFloat(document.getElementById(`cl-shares-${id}`).value);
      if (!isFinite(exit) || exit <= 0) { toast("Enter a valid exit price", "error"); return; }
      if (!isFinite(qty) || qty <= 0) { toast("Enter shares to sell", "error"); return; }
      if (qty > rem) { toast(`Only ${rem.toFixed(0)} shares left`, "error"); return; }
      const date = document.getElementById(`cl-date-${id}`).value || new Date().toISOString().slice(0, 10);
      const notes = document.getElementById(`cl-notes-${id}`).value;
      const leg = { shares: qty, price: exit, date, notes, commission: sellFee };
      showLoader();
      try {
        const left = await recordExit(id, t, leg);
        toast(left > 0
          ? `Sold ${qty.toFixed(0)} ${t.symbol} @ $${exit.toFixed(2)} — ${left.toFixed(0)} left running`
          : `${t.symbol} fully closed`, "success");
        await refresh();
      } catch (e) { toast("Sell failed: " + e.message, "error"); }
      finally { hideLoader(); }
    }));
  }
}
