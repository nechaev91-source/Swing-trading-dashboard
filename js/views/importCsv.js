import { addTrade, closeTrade, getAllTrades, deleteImportedTrades } from "../db.js";
import { showLoader, hideLoader, toast, esc } from "../ui.js";

// Minimal CSV parser (handles quoted fields and commas inside quotes)
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

const num = (v) => parseFloat(String(v ?? "").replace(/[$,]/g, ""));

let parsedRows = null;   // raw arrays
let headers = null;
let preview = null;      // mapped objects ready to import

export async function renderImport(root) {
  root.innerHTML = `
    <div class="view-title">📥 Import from Google Sheets</div>
    <div class="card">
      <div class="section-title">How to export</div>
      <div>1. In Google Sheets: <b>File → Download → Comma Separated Values (.csv)</b><br>
           2. Upload the file below<br>3. Map your columns → Preview → Confirm</div>
    </div>
    <div class="card" id="imported-card">
      <div class="section-title">Imported trades</div>
      <div id="imported-info" class="hint">Checking…</div>
      <button id="clear-imported" class="btn btn-danger btn-sm hidden" style="margin-top:10px">🗑️ Delete imported trades</button>
      <div class="hint" style="margin-top:8px">Imported trades are tagged separately. Deleting them leaves your hand-entered trades untouched — so you can re-upload a corrected file without resetting everything.</div>
    </div>
    <div class="card">
      <div class="field"><label>Upload CSV</label><input type="file" id="csv-file" accept=".csv" /></div>
    </div>
    <div id="map-section"></div>
    <div id="preview-section"></div>
  `;

  await refreshImportedCount();

  async function refreshImportedCount() {
    const info = document.getElementById("imported-info");
    const btn = document.getElementById("clear-imported");
    try {
      const all = await getAllTrades();
      const n = all.filter((t) => t.imported).length;
      info.textContent = n ? `${n} imported trade(s) currently in your data.` : "No imported trades yet.";
      btn.classList.toggle("hidden", n === 0);
    } catch {
      info.textContent = "Could not load trade count.";
    }
  }

  document.getElementById("clear-imported").addEventListener("click", async () => {
    if (!confirm("Delete ALL previously imported trades? Hand-entered trades are kept.")) return;
    showLoader();
    try {
      const n = await deleteImportedTrades();
      toast(`Deleted ${n} imported trade(s)`, "success");
      await refreshImportedCount();
    } catch (e) {
      toast("Delete failed: " + e.message, "error");
    } finally {
      hideLoader();
    }
  });

  document.getElementById("csv-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length < 2) { toast("CSV appears empty", "error"); return; }
    headers = rows[0].map((h) => h.trim());
    parsedRows = rows.slice(1);
    renderMapping();
  });

  function colSelect(id, label) {
    const opts = ['<option value="-1">— skip —</option>']
      .concat(headers.map((h, i) => `<option value="${i}">${esc(h)}</option>`)).join("");
    return `<div class="field"><label>${label}</label><select id="${id}">${opts}</select></div>`;
  }

  function renderMapping() {
    document.getElementById("map-section").innerHTML = `
      <div class="card">
        <div class="section-title">Map Columns</div>
        <div class="two-col">
          <div>
            ${colSelect("m-symbol", "Ticker / Symbol *")}
            ${colSelect("m-entry", "Entry Price *")}
            ${colSelect("m-shares", "Shares / Quantity *")}
            ${colSelect("m-dir", "Direction (Long/Short)")}
          </div>
          <div>
            ${colSelect("m-stop", "Stop Loss")}
            ${colSelect("m-target", "Target")}
            ${colSelect("m-edate", "Entry Date")}
            ${colSelect("m-exit", "Exit Price")}
          </div>
        </div>
        ${colSelect("m-xdate", "Exit Date")}
        ${colSelect("m-commission", "Commission (round trip, buy+sell)")}
        ${colSelect("m-notes", "Notes / Setup")}
        <div class="section-title" style="margin-top:14px">Defaults for missing data</div>
        <div class="two-col">
          <div class="field"><label>Setup (applied to all imported trades)</label>
            <select id="d-setup">
              <option value="other">Manual / historical (recommended)</option>
              <option value="breakout:Cup &amp; Handle">Breakout — Cup &amp; Handle</option>
              <option value="trend-line:Breakout Buy">Trend Line — Breakout Buy</option>
              <option value="trend-line:Support Bounce">Trend Line — Support Bounce</option>
              <option value="trend-pullback">Trend-Pullback</option>
            </select>
          </div>
          <div class="field"><label>Default Side</label><select id="d-side"><option>Long</option><option>Short</option></select></div>
          <div class="field"><label>Default Stop (% from entry — blank = no stop)</label><input type="number" id="d-stop" placeholder="no stop" step="0.5" /></div>
          <div class="field"><label>Default Target (R:R)</label><input type="number" id="d-rr" placeholder="—" step="0.5" /></div>
        </div>
        <div class="hint">Win rate &amp; profit factor work without stops; R-multiple needs one. Map a Stop column if you have it.</div>
        <button id="preview-btn" class="btn btn-secondary" style="margin-top:10px">Preview Import</button>
      </div>`;
    document.getElementById("preview-btn").addEventListener("click", buildPreview);
  }

  function buildPreview() {
    const idx = (id) => parseInt(document.getElementById(id).value);
    const get = (row, id) => { const i = idx(id); return i >= 0 ? row[i] : undefined; };

    const cSymbol = "m-symbol", cEntry = "m-entry", cShares = "m-shares";
    if ([cSymbol, cEntry, cShares].some((c) => idx(c) < 0)) {
      toast("Symbol, Entry Price and Shares are required", "error"); return;
    }

    const dSide = document.getElementById("d-side").value;
    const dStop = num(document.getElementById("d-stop").value);   // NaN = no default stop
    const dRR = num(document.getElementById("d-rr").value);
    const dSetup = document.getElementById("d-setup").value;

    const out = [];
    for (const row of parsedRows) {
      const symbol = String(get(row, cSymbol) ?? "").toUpperCase().trim();
      const entry = num(get(row, cEntry));
      const shares = num(get(row, cShares));
      if (!symbol || !isFinite(entry) || !isFinite(shares)) continue;

      let dir = dSide;
      const dRaw = String(get(row, "m-dir") ?? "").toLowerCase();
      if (dRaw.includes("short")) dir = "Short";
      else if (dRaw.includes("long")) dir = "Long";

      // Stop: from a mapped column, else the default % (if given), else none.
      let stop = null;
      const stopRaw = num(get(row, "m-stop"));
      if (isFinite(stopRaw)) stop = stopRaw;
      else if (isFinite(dStop) && dStop > 0) stop = dir === "Long" ? entry * (1 - dStop / 100) : entry * (1 + dStop / 100);

      // Target: from a column, else derived from stop + R:R (only if both exist).
      let target = null;
      const tgtRaw = num(get(row, "m-target"));
      if (isFinite(tgtRaw)) target = tgtRaw;
      else if (stop != null && isFinite(dRR) && dRR > 0) target = dir === "Long" ? entry + (entry - stop) * dRR : entry - (stop - entry) * dRR;

      const edate = String(get(row, "m-edate") ?? "").trim() || "2024-01-01";
      const exitRaw = num(get(row, "m-exit"));
      const exitPrice = isFinite(exitRaw) && exitRaw > 0 ? exitRaw : null;
      const xdate = String(get(row, "m-xdate") ?? "").trim() || null;
      const notes = String(get(row, "m-notes") ?? "").trim();
      const commRaw = num(get(row, "m-commission"));
      const commission = isFinite(commRaw) ? Math.abs(commRaw) : 0;

      out.push({ symbol, direction: dir, entry_date: edate, entry_price: entry, shares,
        stop_loss: stop != null ? +stop.toFixed(2) : null,
        target: target != null ? +target.toFixed(2) : null,
        checklist_score: null, grade: null, commission, imported: true,
        setup_notes: notes, strategy: dSetup,
        exit_price: exitPrice, exit_date: exitPrice ? xdate : null });
    }

    preview = out;
    const rows = out.slice(0, 50).map((r) => `<tr>
      <td class="bold">${esc(r.symbol)}</td><td>${r.direction}</td><td>${esc(r.entry_date)}</td>
      <td>$${r.entry_price}</td><td>${r.shares}</td>
      <td>${r.stop_loss != null ? "$" + r.stop_loss : "—"}</td>
      <td>${r.target != null ? "$" + r.target : "—"}</td>
      <td>${r.exit_price != null ? "$" + r.exit_price : "—"}</td>
      <td>${r.exit_price ? "closed" : "open"}</td></tr>`).join("");

    document.getElementById("preview-section").innerHTML = `
      <div class="card">
        <div class="section-title">Preview — ${out.length} trades ready</div>
        <div class="table-wrap"><table><thead><tr>
          <th>Symbol</th><th>Side</th><th>Entry Date</th><th>Entry</th><th>Shares</th>
          <th>Stop</th><th>Target</th><th>Exit</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody></table></div>
        ${out.length > 50 ? `<div class="hint">Showing first 50 of ${out.length}.</div>` : ""}
        <div class="spacer"></div>
        <button id="confirm-import" class="btn btn-primary">✅ Confirm Import (${out.length})</button>
      </div>`;
    document.getElementById("confirm-import").addEventListener("click", doImport);
  }

  async function doImport() {
    if (!preview || !preview.length) return;
    showLoader();
    let count = 0;
    try {
      for (const r of preview) {
        const docRef = await addTrade(r);
        if (r.exit_price != null && r.exit_date) {
          await closeTrade(docRef.id, r.exit_price, r.exit_date, "");
        }
        count++;
      }
      toast(`${count} trades imported`, "success");
      document.getElementById("preview-section").innerHTML =
        `<div class="card"><div class="alert alert-ok">🎉 ${count} trades imported successfully.</div></div>`;
      preview = null;
      await refreshImportedCount();
    } catch (e) {
      toast(`Imported ${count}, then failed: ${e.message}`, "error");
    } finally {
      hideLoader();
    }
  }
}
