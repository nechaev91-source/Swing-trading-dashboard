import { getAllTrades, closeTrade, deleteTrade, saveChartUrl } from "../db.js";
import { realizedPnl, rMultiple } from "../calc.js";
import { fmt, colorClass, showLoader, hideLoader, toast, esc } from "../ui.js";

// Resize + compress an image File to a JPEG data URL that stays small enough
// to live inside a Firestore document (1 MB limit). No cloud Storage needed.
function compressImage(file, maxWidth = 1200, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

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
        const pnl = realizedPnl(t.direction, t.entry_price, t.exit_price, t.shares);
        const r = rMultiple(t.direction, t.entry_price, t.exit_price, t.stop_loss, t.shares);
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
      <div id="chart-section"></div>
      <div id="delete-section"></div>
    `;

    renderCloseSection(trades.filter((t) => t.status === "open"));
    renderChartSection(trades);
    renderDeleteSection(trades);
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
      const pnl = realizedPnl(t.direction, t.entry_price, exit, t.shares);
      const r = rMultiple(t.direction, t.entry_price, exit, t.stop_loss, t.shares);
      document.getElementById("close-preview").innerHTML =
        `<span class="${colorClass(pnl)}">Preview: ${fmt.signMoney(pnl)} | ${r >= 0 ? "+" : ""}${r.toFixed(2)}R</span>`;
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
