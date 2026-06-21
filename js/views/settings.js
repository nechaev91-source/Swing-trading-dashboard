import { getAllTrades, resetAllData } from "../db.js";
import { currentUser } from "../auth.js";
import { showLoader, hideLoader, toast } from "../ui.js";

export async function renderSettings(root) {
  const user = currentUser();
  root.innerHTML = `
    <div class="view-title">⚙️ Settings</div>

    <div class="card">
      <div class="section-title">Account</div>
      <div>Signed in as <b>${user.email}</b></div>
      <div class="hint">Your data syncs automatically across every device you sign in on.</div>
    </div>

    <div class="card">
      <div class="section-title">Data</div>
      <div id="data-stats" class="hint">Loading…</div>
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
