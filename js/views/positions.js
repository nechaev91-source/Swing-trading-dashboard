import { getOpenTrades, updateTradeStop, closeTrade } from "../db.js";
import { showLoader, hideLoader, toast, esc } from "../ui.js";

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

    const rows = trades.map((t) => {
      const isTrend = t.strategy === "trend-pullback";
      const curStop = t.current_stop ?? t.stop_loss;
      const badge = isTrend
        ? `<span class="tag" style="background:#1c3a2e;color:#3fb950;border:1px solid #3fb950">Trend-Pullback</span>`
        : `<span class="tag" style="background:#1a2a40;color:#58a6ff;border:1px solid #58a6ff">Breakout</span>`;

      return `
        <div class="card pos-card" data-id="${t.id}">
          <div class="pos-header">
            <div>
              <span class="pos-sym">${esc(t.symbol)}</span>
              ${badge}
            </div>
            <div class="pos-date">${esc(t.entry_date)}</div>
          </div>
          <div class="pos-details">
            <div class="pos-stat"><div class="clabel">ENTRY</div><div class="cvalue">$${(+t.entry_price).toFixed(2)}</div></div>
            <div class="pos-stat"><div class="clabel">SHARES</div><div class="cvalue">${(+t.shares).toFixed(0)}</div></div>
            <div class="pos-stat"><div class="clabel">CURRENT STOP</div>
              <div class="cvalue red stop-display" data-id="${t.id}">$${(+curStop).toFixed(2)}</div>
            </div>
            ${isTrend ? `
            <div class="pos-stat">
              <div class="clabel">INITIAL STOP</div>
              <div class="cvalue" style="color:var(--muted)">$${(+t.stop_loss).toFixed(2)}</div>
            </div>` : ""}
          </div>
          ${isTrend ? `
          <div class="pos-actions">
            <div class="stop-edit hidden" id="edit-${t.id}">
              <input type="number" class="stop-input" id="stop-val-${t.id}"
                value="${(+curStop).toFixed(2)}" step="0.01" style="width:110px" />
              <button class="btn btn-secondary btn-sm save-stop" data-id="${t.id}">Save Stop</button>
              <button class="btn btn-ghost btn-sm cancel-edit" data-id="${t.id}">Cancel</button>
            </div>
            <div class="stop-btns" id="btns-${t.id}">
              <button class="btn btn-secondary btn-sm raise-stop" data-id="${t.id}">⬆ Raise Stop</button>
              <button class="btn btn-danger btn-sm close-pos" data-id="${t.id}" style="margin-left:8px">✕ Close (stop hit)</button>
            </div>
          </div>` : `
          <div class="pos-actions">
            <button class="btn btn-danger btn-sm close-pos" data-id="${t.id}">✕ Close Trade</button>
          </div>`}
        </div>`;
    }).join("");

    body.innerHTML = rows;

    // ── Raise stop ────────────────────────────────────────────
    body.querySelectorAll(".raise-stop").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        document.getElementById(`edit-${id}`).classList.remove("hidden");
        document.getElementById(`btns-${id}`).classList.add("hidden");
      });
    });

    body.querySelectorAll(".cancel-edit").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        document.getElementById(`edit-${id}`).classList.add("hidden");
        document.getElementById(`btns-${id}`).classList.remove("hidden");
      });
    });

    body.querySelectorAll(".save-stop").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const newStop = parseFloat(document.getElementById(`stop-val-${id}`).value);
        if (!newStop || newStop <= 0) { toast("Invalid stop value", "error"); return; }
        showLoader();
        try {
          await updateTradeStop(id, newStop);
          toast(`Stop updated to $${newStop.toFixed(2)}`, "success");
          await refresh();
        } catch (e) {
          toast("Update failed: " + e.message, "error");
        } finally { hideLoader(); }
      });
    });

    // ── Close position ────────────────────────────────────────
    body.querySelectorAll(".close-pos").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const trade = trades.find(t => t.id === id);
        const curStop = trade.current_stop ?? trade.stop_loss;
        const confirmed = confirm(
          `Close ${trade.symbol} at stop $${(+curStop).toFixed(2)}?\n` +
          `(You can change the exit price in the Journal view.)`
        );
        if (!confirmed) return;
        showLoader();
        try {
          await closeTrade(id, curStop, new Date().toISOString().slice(0, 10), "Stop hit");
          toast(`${trade.symbol} closed at $${(+curStop).toFixed(2)}`, "success");
          await refresh();
        } catch (e) {
          toast("Close failed: " + e.message, "error");
        } finally { hideLoader(); }
      });
    });
  }
}
