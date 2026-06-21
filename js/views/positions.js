import { getOpenTrades, updateTradeStop, updateTrade, closeTrade } from "../db.js";
import { showLoader, hideLoader, toast, esc } from "../ui.js";

function stratLabel(strategy) {
  if (!strategy) return ["Other", "#8b949e"];
  const [id, sub] = strategy.split(":");
  if (id === "trend-pullback") return ["Trend-Pullback", "#3fb950"];
  if (id === "trend-line") return [sub || "Trend Line", "#58a6ff"];
  if (id === "breakout") return [sub || "Breakout", "#58a6ff"];
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
            <div class="pos-stat"><div class="clabel">SHARES</div><div class="cvalue">${(+t.shares).toFixed(0)}</div></div>
            <div class="pos-stat"><div class="clabel">CURRENT STOP</div><div class="cvalue ${curStop != null ? "red" : "muted"}">${money(curStop)}</div></div>
            ${t.target != null ? `<div class="pos-stat"><div class="clabel">TARGET</div><div class="cvalue green">${money(t.target)}</div></div>` : ""}
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
            <div class="field"><label>Target $ (optional)</label><input type="number" step="0.01" id="ed-target-${t.id}" value="${t.target ?? ""}"></div>
            <div class="pos-actions">
              <button class="btn btn-primary btn-sm save-edit" data-id="${t.id}">Save Changes</button>
              <button class="btn btn-ghost btn-sm cancel-edit" data-id="${t.id}">Cancel</button>
            </div>
          </div>

          <!-- Default actions -->
          <div class="pos-actions" id="act-${t.id}">
            <button class="btn btn-secondary btn-sm edit-pos" data-id="${t.id}">✏️ Edit</button>
            ${isTrend ? `<button class="btn btn-secondary btn-sm raise-stop" data-id="${t.id}">⬆ Raise Stop</button>` : ""}
            <button class="btn btn-danger btn-sm close-pos" data-id="${t.id}">✕ Close${isTrend ? " (stop hit)" : ""}</button>
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
      const fields = {
        entry_date: document.getElementById(`ed-date-${id}`).value,
        entry_price: entry,
        shares,
        stop_loss: (stop != null && stop > 0) ? stop : null,
        target: (target != null && target > 0) ? target : null,
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

    // ── Close ─────────────────────────────────────────────────
    body.querySelectorAll(".close-pos").forEach((b) => b.addEventListener("click", async () => {
      const id = b.dataset.id;
      const t = trades.find((x) => x.id === id);
      const curStop = t.current_stop ?? t.stop_loss;
      const exit = (curStop != null && isFinite(curStop)) ? curStop : t.entry_price;
      const confirmed = confirm(
        `Close ${t.symbol} at $${(+exit).toFixed(2)}?\n(You can adjust the exit price in the Journal view.)`
      );
      if (!confirmed) return;
      showLoader();
      try {
        await closeTrade(id, exit, new Date().toISOString().slice(0, 10), curStop != null ? "Stop hit" : "Closed");
        toast(`${t.symbol} closed at $${(+exit).toFixed(2)}`, "success");
        await refresh();
      } catch (e) { toast("Close failed: " + e.message, "error"); }
      finally { hideLoader(); }
    }));
  }
}
