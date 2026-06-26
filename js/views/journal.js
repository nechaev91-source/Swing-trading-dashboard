import { getAllTrades, closeTrade, deleteTrade, saveChartUrl, updateTrade } from "../db.js";
import { realizedPnl, tradeNetPnl, tradeR } from "../calc.js";
import { fmt, colorClass, showLoader, hideLoader, toast, esc, compressImage } from "../ui.js";

export async function renderJournal(root) {
  root.innerHTML = `
    <div class="view-title">📓 Trade Journal</div>
    <div class="field-row" style="max-width:420px">
      <div class="field"><label>Status</label><select id="f-status"><option>All</option><option>Open</option><option>Closed</option></select></div>
      <div class="field"><label>Side</label><select id="f-dir"><option>All</option><option>Long</option><option>Short</option></select></div>
    </div>
    <div id="journal-body"><div class="empty-state">Loading…</div></div>
  `;

  showLoader();
  let trades;
  try { trades = await getAllTrades(); }
  finally { hideLoader(); }

  const statusSel = document.getElementById("f-status");
  const dirSel = document.getElementById("f-dir");
  statusSel.addEventListener("change", paint);
  dirSel.addEventListener("change", paint);

  function paint() {
    let list = trades.slice();
    if (statusSel.value === "Open") list = list.filter((t) => t.status === "open");
    else if (statusSel.value === "Closed") list = list.filter((t) => t.status === "closed");
    if (dirSel.value !== "All") list = list.filter((t) => t.direction === dirSel.value);

    const body = document.getElementById("journal-body");
    if (!list.length) { body.innerHTML = `<div class="empty-state">No trades match the filters.</div>`; return; }

    const rows = list.map((t) => {
      let pnlCell = `<td class="muted">—</td>`, rCell = `<td class="muted">—</td>`;
      if (t.status === "closed" && t.exit_price != null) {
        const pnl = tradeNetPnl(t);
        const r = tradeR(t);
        pnlCell = `<td class="${colorClass(pnl)} bold">${fmt.signMoney(pnl)}</td>`;
        rCell = `<td class="${colorClass(r)}">${r.toFixed(2)}R</td>`;
      }
      return `<tr>
        <td class="bold">${esc(t.symbol)}</td><td>${t.direction}</td>
        <td>${esc(t.entry_date)}</td><td>$${fmt.num(t.entry_price)}</td><td>${t.shares}</td>
        <td>$${fmt.num(t.stop_loss)}</td><td>$${fmt.num(t.target)}</td><td>${t.checklist_score}</td>
        <td class="muted">${esc((t.setup_notes || "").slice(0, 40))}</td>
        <td>${t.exit_date ? esc(t.exit_date) : "—"}</td>
        <td>${t.exit_price != null ? "$" + fmt.num(t.exit_price) : "—"}</td>
        ${pnlCell}${rCell}
        <td>${t.chart_url ? "📎" : ""}</td>
        <td>${t.status === "open" ? "🟢 Open" : "⚫ Closed"}</td>
      </tr>`;
    }).join("");

    body.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Symbol</th><th>Side</th><th>Entry Date</th><th>Entry</th><th>Shares</th>
        <th>Stop</th><th>Target</th><th>Score</th><th>Setup</th><th>Exit Date</th><th>Exit</th>
        <th>P&L</th><th>R</th><th>Chart</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="spacer"></div>
      <div id="close-section"></div>
      <div id="edit-section"></div>
      <div id="chart-section"></div>
      <div id="delete-section"></div>
    `;

    renderCloseSection(trades.filter((t) => t.status === "open"));
    renderEditSection(trades);
    renderChartSection(trades);
    renderDeleteSection(trades);
  }

  // ── Edit any trade (fix a wrong value, incl. closed trades) ─────────────────
  function renderEditSection(allTrades) {
    const el = document.getElementById("edit-section");
    if (!allTrades.length) { el.innerHTML = ""; return; }
    const opts = allTrades.map((t) => `<option value="${t.id}">#${t.id.slice(0, 5)} ${esc(t.symbol)} (${t.status})</option>`).join("");
    el.innerHTML = `
      <div class="card">
        <div class="section-title">✏️ Edit a Trade</div>
        <div class="field"><label>Select trade</label><select id="edit-sel">${opts}</select></div>
        <div id="edit-form"></div>
      </div>`;

    const sel = document.getElementById("edit-sel");
    const numv = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };

    function renderForm() {
      const t = allTrades.find((x) => x.id === sel.value);
      const closed = t.status === "closed";
      document.getElementById("edit-form").innerHTML = `
        <div class="field-row">
          <div class="field"><label>Side</label><select id="e-side">
            <option ${t.direction === "Long" ? "selected" : ""}>Long</option>
            <option ${t.direction === "Short" ? "selected" : ""}>Short</option></select></div>
          <div class="field"><label>Entry Date</label><input type="date" id="e-edate" value="${esc(t.entry_date || "")}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Entry Price $</label><input type="number" step="0.01" id="e-entry" value="${t.entry_price}"></div>
          <div class="field"><label>Shares</label><input type="number" step="1" id="e-shares" value="${t.shares}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Stop Loss $ (optional)</label><input type="number" step="0.01" id="e-stop" value="${t.stop_loss ?? ""}"></div>
          <div class="field"><label>Target $ (optional)</label><input type="number" step="0.01" id="e-target" value="${t.target ?? ""}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Commission $ (round trip)</label><input type="number" step="0.5" id="e-comm" value="${t.commission ?? 0}"></div>
          ${closed ? `<div class="field"><label>Exit Price $</label><input type="number" step="0.01" id="e-exit" value="${t.exit_price ?? ""}"></div>` : `<div class="field"></div>`}
        </div>
        ${closed ? `<div class="field-row">
          <div class="field"><label>Exit Date</label><input type="date" id="e-xdate" value="${esc(t.exit_date || "")}"></div>
          <div class="field"><label>Exit Notes</label><input id="e-xnotes" value="${esc(t.exit_notes || "")}"></div>
        </div>` : ""}
        <div class="field"><label>Setup Notes</label><input id="e-notes" value="${esc(t.setup_notes || "")}"></div>
        <button id="e-save" class="btn btn-primary btn-sm">Save Changes</button>`;

      document.getElementById("e-save").addEventListener("click", async () => {
        const entry = numv(document.getElementById("e-entry").value);
        const shares = numv(document.getElementById("e-shares").value);
        if (entry == null || entry <= 0 || shares == null || shares <= 0) { toast("Entry and shares must be positive", "error"); return; }
        const stop = numv(document.getElementById("e-stop").value);
        const target = numv(document.getElementById("e-target").value);
        const comm = numv(document.getElementById("e-comm").value);
        const fields = {
          direction: document.getElementById("e-side").value,
          entry_date: document.getElementById("e-edate").value,
          entry_price: entry,
          shares,
          stop_loss: (stop != null && stop > 0) ? stop : null,
          target: (target != null && target > 0) ? target : null,
          commission: (comm != null && comm >= 0) ? comm : 0,
          setup_notes: document.getElementById("e-notes").value,
        };
        if (closed) {
          const exit = numv(document.getElementById("e-exit").value);
          if (exit == null || exit <= 0) { toast("Exit price must be positive", "error"); return; }
          fields.exit_price = exit;
          fields.exit_date = document.getElementById("e-xdate").value;
          fields.exit_notes = document.getElementById("e-xnotes").value;
        }
        showLoader();
        try {
          await updateTrade(sel.value, fields);
          toast("Trade updated", "success");
          renderJournal(root);
        } catch (e) { toast("Update failed: " + e.message, "error"); }
        finally { hideLoader(); }
      });
    }
    sel.addEventListener("change", renderForm);
    renderForm();
  }

  // ── Close a position ──────────────────────────────────────────────────────
  function renderCloseSection(openTrades) {
    const el = document.getElementById("close-section");
    if (!openTrades.length) { el.innerHTML = ""; return; }
    const opts = openTrades.map((t) => `<option value="${t.id}">#${t.id.slice(0,5)} ${esc(t.symbol)} ${t.direction} @ $${fmt.num(t.entry_price)}</option>`).join("");
    el.innerHTML = `
      <div class="card">
        <div class="section-title">Close a Position</div>
        <div class="field"><label>Select open trade</label><select id="close-sel">${opts}</select></div>
        <div class="field-row">
          <div class="field"><label>Exit Price $</label><input type="number" id="close-price" step="0.01" /></div>
          <div class="field"><label>Exit Date</label><input type="date" id="close-date" /></div>
        </div>
        <div class="field"><label>Exit Notes</label><textarea id="close-notes" placeholder="Why exit? What's the lesson?"></textarea></div>
        <div id="close-preview" style="font-size:18px;font-weight:700;margin-bottom:12px"></div>
        <button id="close-btn" class="btn btn-primary">Close Position</button>
      </div>`;

    document.getElementById("close-date").value = new Date().toISOString().slice(0, 10);
    const sel = document.getElementById("close-sel");
    const priceEl = document.getElementById("close-price");

    function preview() {
      const t = openTrades.find((x) => x.id === sel.value);
      const exit = parseFloat(priceEl.value);
      if (!t || !isFinite(exit)) { document.getElementById("close-preview").textContent = ""; return; }
      const pnl = realizedPnl(t.direction, t.entry_price, exit, t.shares) - (t.commission || 0);
      const risk = (t.stop_loss != null && isFinite(t.stop_loss)) ? Math.abs(t.entry_price - t.stop_loss) * t.shares : 0;
      const r = risk ? pnl / risk : 0;
      document.getElementById("close-preview").innerHTML =
        `<span class="${colorClass(pnl)}">Preview: ${fmt.signMoney(pnl)} (net of $${(t.commission || 0).toFixed(2)} comm) | ${r >= 0 ? "+" : ""}${r.toFixed(2)}R</span>`;
    }
    sel.addEventListener("change", () => {
      const t = openTrades.find((x) => x.id === sel.value);
      if (t) priceEl.value = t.entry_price;
      preview();
    });
    priceEl.addEventListener("input", preview);
    const first = openTrades.find((x) => x.id === sel.value);
    if (first) priceEl.value = first.entry_price;
    preview();

    document.getElementById("close-btn").addEventListener("click", async () => {
      const exit = parseFloat(priceEl.value);
      if (!isFinite(exit)) { toast("Enter exit price", "error"); return; }
      showLoader();
      try {
        await closeTrade(sel.value, exit, document.getElementById("close-date").value, document.getElementById("close-notes").value);
        toast("Position closed", "success");
        renderJournal(root);
      } catch (e) { toast("Failed: " + e.message, "error"); }
      finally { hideLoader(); }
    });
  }

  // ── Attach chart ──────────────────────────────────────────────────────────
  function renderChartSection(allTrades) {
    const el = document.getElementById("chart-section");
    if (!allTrades.length) { el.innerHTML = ""; return; }
    const opts = allTrades.map((t) => `<option value="${t.id}">#${t.id.slice(0,5)} ${esc(t.symbol)} (${t.status})</option>`).join("");
    el.innerHTML = `
      <div class="card">
        <div class="section-title">📎 Attach / View Chart</div>
        <div class="field"><label>Select trade</label><select id="chart-sel">${opts}</select></div>
        <div id="chart-current"></div>
        <div class="field"><label>Upload chart image (PNG/JPG)</label><input type="file" id="chart-file" accept="image/*" /></div>
      </div>`;

    const sel = document.getElementById("chart-sel");
    function showCurrent() {
      const t = allTrades.find((x) => x.id === sel.value);
      document.getElementById("chart-current").innerHTML =
        t && t.chart_url ? `<img src="${t.chart_url}" class="chart-thumb" />` : `<div class="hint">No chart attached.</div>`;
    }
    sel.addEventListener("change", showCurrent);
    showCurrent();

    document.getElementById("chart-file").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      showLoader();
      try {
        const dataUrl = await compressImage(file);
        // ~0.75 bytes per base64 char; warn if close to Firestore's 1 MB limit
        if (dataUrl.length > 900000) {
          toast("Image too large even after compression — try a smaller screenshot", "error");
          return;
        }
        await saveChartUrl(sel.value, dataUrl);
        toast("Chart saved", "success");
        renderJournal(root);
      } catch (err) { toast("Upload failed: " + err.message, "error"); }
      finally { hideLoader(); }
    });
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  function renderDeleteSection(allTrades) {
    const el = document.getElementById("delete-section");
    if (!allTrades.length) { el.innerHTML = ""; return; }
    const opts = allTrades.map((t) => `<option value="${t.id}">#${t.id.slice(0,5)} ${esc(t.symbol)} (${t.status})</option>`).join("");
    el.innerHTML = `
      <div class="card">
        <div class="section-title">🗑️ Delete a Trade (irreversible)</div>
        <div class="field"><select id="del-sel">${opts}</select></div>
        <button id="del-btn" class="btn btn-danger btn-sm">Delete</button>
      </div>`;
    document.getElementById("del-btn").addEventListener("click", async () => {
      showLoader();
      try {
        await deleteTrade(document.getElementById("del-sel").value);
        toast("Trade deleted", "success");
        renderJournal(root);
      } catch (e) { toast("Failed: " + e.message, "error"); }
      finally { hideLoader(); }
    });
  }

  paint();
}
