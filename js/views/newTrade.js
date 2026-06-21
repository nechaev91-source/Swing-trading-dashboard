import { addTrade, saveChartUrl } from "../db.js";
import { getCurrentPrice, getAutoChecklistData, SECTOR_ETFS } from "../data.js";
import { tradeMetrics, gradeSetup, gradeColor } from "../calc.js";
import { fmt, getPortfolio, getStrategies, compressImage, showLoader, hideLoader, toast, esc } from "../ui.js";
import { SETTINGS } from "../config.js";

const TREND_RISK = 120; // hard max loss per trade for the mechanical Trend-Pullback strategy

// Label + detail-field for every auto signal (for the "Auto-detected" panel)
const AUTO_LABELS = {
  spy_above_50ma:           ["S&P 500 above 50-day MA", "spy"],
  spy_above_200ma_rising:   ["S&P 500 above rising 200 SMA", "spy200"],
  stock_above_200ma_rising: ["Stock above rising 200 SMA", "stock200"],
  stock_above_50ma_rising:  ["Stock above rising 50 SMA", "stock50"],
  stock_momentum_stack:     ["Momentum stack (Price>50>200)", "stack"],
  rs_near_high:             ["Relative Strength at new highs", "rs"],
  near_high:                ["Within 5% of 52-week high", "52w_high"],
  sector_above_50ma:        ["Sector ETF above 50-day MA", "sector"],
  no_earnings_3w:           ["No earnings within 3 weeks", "earnings"],
};

export async function renderNewTrade(root) {
  const strategies = await getStrategies();

  // Optional prefill from the Ideas tab
  const pfSymbol = sessionStorage.getItem("prefill_symbol");
  const pfStrategy = sessionStorage.getItem("prefill_strategy");
  let mode = (pfStrategy && (strategies[pfStrategy] || pfStrategy === "trend-pullback")) ? pfStrategy : "breakout";

  const tabs = [
    ...Object.entries(strategies).map(([id, s]) => `<button class="strat-tab" data-mode="${id}">${s.label}</button>`),
    `<button class="strat-tab" data-mode="trend-pullback">🤖 Trend-Pullback</button>`,
    `<button class="strat-tab" data-mode="manual">📝 Manual</button>`,
  ].join("");

  root.innerHTML = `
    <div class="view-title">🎯 New Trade Entry</div>
    <div class="strategy-toggle">${tabs}</div>
    <div id="form-body"></div>
  `;

  root.querySelector(".strategy-toggle").addEventListener("click", (e) => {
    const btn = e.target.closest(".strat-tab");
    if (!btn || btn.dataset.mode === mode) return;
    mode = btn.dataset.mode;
    root.querySelectorAll(".strat-tab").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    mount();
  });

  function mount() {
    if (mode === "trend-pullback") mountTrendPullback();
    else if (mode === "manual") mountManual();
    else mountChecklistForm(strategies[mode], mode);
  }

  // ── CHECKLIST-BASED STRATEGIES (Breakout, Trend Line) ───────────────────────
  function mountChecklistForm(strategy, strategyId) {
    const portfolio = getPortfolio();
    let activeIdx = 0;
    let chartDataUrl = null;

    const sectorOptions = Object.entries(SECTOR_ETFS)
      .map(([label, etf]) => `<option value="${etf}">${label}</option>`).join("");

    const subToggle = strategy.checklists.length > 1
      ? `<div class="sub-toggle">${strategy.checklists.map((c, i) =>
          `<button class="sub-tab${i === 0 ? " active" : ""}" data-idx="${i}">${esc(c.name)}</button>`).join("")}</div>`
      : "";

    document.getElementById("form-body").innerHTML = `
      <div class="two-col">
        <div>
          <div class="card">
            <div class="section-title">Trade Details</div>
            <div class="field-row">
              <div class="field"><label>Ticker Symbol</label><input id="f-symbol" placeholder="e.g. NVDA" /></div>
              <div class="field"><label>Side</label><select id="f-side"><option>Long</option><option>Short</option></select></div>
            </div>
            ${strategy.sector ? `<div class="field"><label>Sector ETF (for trend check)</label>
              <select id="f-sector"><option value="">🔍 Auto-detect</option>${sectorOptions}</select>
              <div class="hint">Auto-detect needs a Finnhub key; otherwise pick manually.</div></div>` : ""}
            <div class="field"><label>Entry Date</label><input type="date" id="f-date" /></div>
            <div class="field-row">
              <div class="field"><label>Entry Price $</label><input type="number" id="f-entry" value="100" step="0.01" /></div>
              <div class="field"><label>Stop Loss $</label><input type="number" id="f-stop" value="95" step="0.01" /></div>
            </div>
            <div class="field-row">
              <div class="field"><label>Target $</label><input type="number" id="f-target" value="110" step="0.01" /></div>
              <div class="field"><label>Max Risk $ (loss I accept)</label><input type="number" id="f-risk" value="200" step="10" /></div>
            </div>
            <div class="field"><label>Setup Description</label><textarea id="f-notes" placeholder="Pattern, timeframe, confluence…"></textarea></div>
            <div class="field"><label>Chart Screenshot (optional)</label><input type="file" id="f-chart" accept="image/*" /><div id="chart-preview"></div></div>
            <button id="check-price" class="btn btn-secondary btn-sm">Check Live Price</button>
            <div id="price-result" class="hint"></div>
          </div>
          <div class="card">
            <div class="section-title">Position Sizing & Risk</div>
            <div class="calc-row" id="calc-row"></div>
            <div id="calc-warn"></div>
          </div>
        </div>
        <div>
          <div class="card">
            <div class="section-title">Checklist</div>
            ${subToggle}
            <button id="autofill" class="btn btn-secondary btn-sm" style="margin-bottom:12px">⚡ Auto-fill from Market Data</button>
            <div id="checklist-items"></div>
          </div>
          <div class="card">
            <div class="section-title">Setup Grade</div>
            <div id="grade-box"></div>
          </div>
          <button id="enter-btn" class="btn btn-primary" disabled>✅ Enter Trade</button>
        </div>
      </div>
    `;

    document.getElementById("f-date").value = new Date().toISOString().slice(0, 10);
    const $ = (id) => document.getElementById(id);

    const activeItems = () => strategy.checklists[activeIdx].items;

    function renderChecklist() {
      const items = activeItems();
      $("checklist-items").innerHTML = items.map((item, i) => {
        const tags = [];
        if (item.critical) tags.push(`<span class="tag tag-critical">CRITICAL</span>`);
        if (item.auto_key) tags.push(`<span class="tag tag-auto">AUTO</span>`);
        else tags.push(`<span class="tag tag-cat">${esc(item.category)}</span>`);
        return `<div class="chk-item">
          <input type="checkbox" id="chk_${i}" />
          <div class="chk-text"><div class="chk-q">${esc(item.question)}${tags.join("")}
            <span class="auto-result" id="ar_${i}"></span></div>
            <div class="chk-detail sdetail" id="cd_${i}"></div></div>
        </div>`;
      }).join("");
      items.forEach((_, i) => $(`chk_${i}`).addEventListener("change", recompute));
      recompute();
    }

    function readMetrics() {
      return tradeMetrics({
        side: $("f-side").value,
        entry: parseFloat($("f-entry").value) || 0,
        stop: parseFloat($("f-stop").value) || 0,
        target: parseFloat($("f-target").value) || 0,
        maxRisk: parseFloat($("f-risk").value) || 0,
        portfolio,
      });
    }

    function recompute() {
      const m = readMetrics();
      const rrColor = m.rr >= 2 ? "green" : m.rr >= 1.5 ? "yellow" : "red";
      const pctColor = m.riskPct > SETTINGS.maxRiskPctWarn ? "red" : "green";
      $("calc-row").innerHTML = `
        <div class="calc-item"><div class="clabel">SHARES TO BUY</div><div class="cvalue">${m.shares.toFixed(0)}</div></div>
        <div class="calc-item"><div class="clabel">POSITION SIZE</div><div class="cvalue">$${m.positionSize.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div></div>
        <div class="calc-item"><div class="clabel">ACTUAL RISK</div><div class="cvalue red">-$${m.riskDollar.toFixed(2)}</div></div>
        <div class="calc-item"><div class="clabel">RISK % OF PF</div><div class="cvalue ${pctColor}">${m.riskPct.toFixed(1)}%</div></div>
        <div class="calc-item"><div class="clabel">POTENTIAL GAIN</div><div class="cvalue green">+$${m.rewardDollar.toFixed(2)}</div></div>
        <div class="calc-item"><div class="clabel">R:R RATIO</div><div class="cvalue ${rrColor}">1:${m.rr.toFixed(2)}</div></div>`;
      let warn = "";
      if (m.rr < 2 && m.rps > 0) warn += `<div class="alert alert-warn">⚠️ R:R below 1:2 — reconsider entry.</div>`;
      if (m.riskPct > SETTINGS.maxRiskPctWarn) warn += `<div class="alert alert-warn">⚠️ Risking ${m.riskPct.toFixed(1)}% of portfolio — above ${SETTINGS.maxRiskPctWarn}% limit.</div>`;
      $("calc-warn").innerHTML = warn;

      const items = activeItems();
      const checked = items.map((_, i) => $(`chk_${i}`).checked);
      const g = gradeSetup(items, checked, m.rr);
      renderGrade(g, m);

      const symbol = $("f-symbol").value.trim();
      const canEnter = symbol && m.rps > 0 && m.shares > 0;
      $("enter-btn").disabled = !canEnter;
    }

    function renderGrade(g, m) {
      const gc = gradeColor(g.grade);
      const interp = {
        "A+": "Textbook setup — full conviction.",
        "A": "Strong setup.",
        "B": g.critMissing ? "Missing a critical item — proceed with caution." : "Solid, not premium.",
        "C": "Marginal — wait for more confirmation.",
        "D": "Weak — likely skip.",
      }[g.grade];
      const lowRisk = (m.riskPct > 0 && m.riskPct <= 1 && m.rr >= 2)
        ? `<div class="alert alert-ok" style="margin-top:10px">💡 Low risk (${m.riskPct.toFixed(1)}% of PF) with R:R ${m.rr.toFixed(1)} — acceptable even below A+.</div>` : "";
      const critLine = g.critMissing
        ? `<span class="red">${g.critMet}/${g.critTotal} critical</span>`
        : `<span class="green">${g.critMet}/${g.critTotal} critical ✓</span>`;
      $("grade-box").innerHTML = `
        <div class="grade-row">
          <div class="grade-letter ${gc}">${g.grade}</div>
          <div>
            <div class="grade-pct">${g.pct}<span style="font-size:13px;color:var(--muted)">/100</span></div>
            <div style="font-size:12px;color:var(--muted)">${critLine} · ${g.nonMet}/${g.nonTotal} other</div>
          </div>
        </div>
        <div style="font-size:13px;margin-top:8px">${interp}</div>
        ${lowRisk}`;
    }

    // ── Chart upload ──────────────────────────────────────────────────────────
    $("f-chart").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) { chartDataUrl = null; $("chart-preview").innerHTML = ""; return; }
      try {
        chartDataUrl = await compressImage(file);
        if (chartDataUrl.length > 900000) {
          toast("Image too large even after compression — use a smaller screenshot", "error");
          chartDataUrl = null; $("chart-preview").innerHTML = ""; return;
        }
        $("chart-preview").innerHTML = `<img src="${chartDataUrl}" class="chart-thumb" />`;
      } catch {
        toast("Could not read image", "error");
      }
    });

    // ── Live price ────────────────────────────────────────────────────────────
    $("check-price").addEventListener("click", async () => {
      const sym = $("f-symbol").value.trim().toUpperCase();
      if (!sym) return;
      $("price-result").textContent = "Fetching…";
      const price = await getCurrentPrice(sym);
      if (price) {
        const entry = parseFloat($("f-entry").value) || price;
        const diff = ((price - entry) / entry) * 100;
        $("price-result").innerHTML = `${sym} live: <b>$${price.toFixed(2)}</b> <span class="${diff >= 0 ? "green" : "red"}">(${fmt.pct(diff)} vs entry)</span>`;
      } else {
        $("price-result").innerHTML = `<span class="red">Could not fetch ${sym}</span>`;
      }
    });

    // ── Auto-fill ─────────────────────────────────────────────────────────────
    $("autofill").addEventListener("click", async () => {
      const sym = $("f-symbol").value.trim().toUpperCase();
      if (!sym) { toast("Enter a ticker symbol first", "error"); return; }
      const items = activeItems();
      const wantSector = strategy.sector && items.some((it) => it.auto_key === "sector_above_50ma");
      const wantEarnings = items.some((it) => it.auto_key === "no_earnings_3w");
      const sectorEtf = strategy.sector ? ($("f-sector")?.value || null) : null;

      showLoader();
      let result;
      try { result = await getAutoChecklistData(sym, sectorEtf, { sector: wantSector, earnings: wantEarnings }); }
      catch (e) { hideLoader(); toast("Auto-fill failed: " + e.message, "error"); return; }
      hideLoader();

      const { signals, detail } = result;

      // Tick each auto item, mark green ✓ / red ✗, and show its detail inline
      items.forEach((item, i) => {
        const ar = $(`ar_${i}`);
        const cd = $(`cd_${i}`);
        if (item.auto_key && item.auto_key in signals) {
          const ok = signals[item.auto_key];
          $(`chk_${i}`).checked = ok;
          ar.textContent = ok ? "✓" : "✗";
          ar.className = "auto-result " + (ok ? "pass" : "fail");
          const [, field] = AUTO_LABELS[item.auto_key] || [null, null];
          let det = field ? detail[field] : "";
          if (item.auto_key === "sector_above_50ma" && detail.sector_name) {
            det = detail.sector_name + (det ? " · " + det : "");
          }
          cd.textContent = det || "";
        } else if (item.auto_key) {
          ar.textContent = "—";
          ar.className = "auto-result muted";
          cd.textContent = "data unavailable";
        }
      });
      recompute();
      toast("Auto-fill complete", "success");
    });

    // ── Enter ─────────────────────────────────────────────────────────────────
    $("enter-btn").addEventListener("click", async () => {
      const m = readMetrics();
      const items = activeItems();
      const checked = items.map((_, i) => $(`chk_${i}`).checked);
      const score = checked.filter(Boolean).length;
      const g = gradeSetup(items, checked, m.rr);
      const checklistName = strategy.checklists[activeIdx].name;

      showLoader();
      try {
        const ref = await addTrade({
          symbol: $("f-symbol").value.trim(),
          direction: $("f-side").value,
          entry_date: $("f-date").value,
          entry_price: parseFloat($("f-entry").value),
          shares: m.shares,
          stop_loss: parseFloat($("f-stop").value),
          target: parseFloat($("f-target").value),
          checklist_score: score,
          grade: g.grade,
          setup_notes: $("f-notes").value,
          strategy: `${strategyId}:${checklistName}`,
        });
        if (chartDataUrl && ref?.id) await saveChartUrl(ref.id, chartDataUrl);
        toast(`Trade saved — grade ${g.grade}, ${m.shares.toFixed(0)} shares, risk $${m.riskDollar.toFixed(2)}`, "success");
        mount();
      } catch (e) {
        toast("Save failed: " + e.message, "error");
      } finally {
        hideLoader();
      }
    });

    // Sub-toggle between the strategy's checklists
    const st = document.querySelector(".sub-toggle");
    if (st) {
      st.addEventListener("click", (e) => {
        const b = e.target.closest(".sub-tab");
        if (!b) return;
        activeIdx = parseInt(b.dataset.idx);
        st.querySelectorAll(".sub-tab").forEach((x) => x.classList.toggle("active", x === b));
        renderChecklist();
      });
    }

    ["f-side", "f-entry", "f-stop", "f-target", "f-risk", "f-symbol"].forEach((id) =>
      $(id).addEventListener("input", recompute));

    renderChecklist();
  }

  // ── TREND-PULLBACK MODE (mechanical, no checklist) ──────────────────────────
  function mountTrendPullback() {
    document.getElementById("form-body").innerHTML = `
      <div class="card" style="max-width:520px">
        <div class="section-title">Trade Details</div>
        <div class="alert alert-ok" style="margin-bottom:16px">
          Mechanical strategy — shares are pre-sized so max loss ≤ $${TREND_RISK}. No checklist required.
        </div>
        <div class="field-row">
          <div class="field"><label>Ticker Symbol</label><input id="tp-symbol" placeholder="e.g. AAPL" /></div>
          <div class="field"><label>Entry Date</label><input type="date" id="tp-date" /></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Limit Price $ <span class="hint" style="display:inline">(signal-day close)</span></label>
            <input type="number" id="tp-entry" value="100" step="0.01" /></div>
          <div class="field"><label>Initial Stop $</label><input type="number" id="tp-stop" value="95" step="0.01" /></div>
        </div>
        <div class="field"><label>Notes (optional)</label>
          <textarea id="tp-notes" placeholder="e.g. Scanned 2026-06-18, regime risk-on"></textarea></div>
        <div class="field"><label>Chart Screenshot (optional)</label><input type="file" id="tp-chart" accept="image/*" /><div id="tp-chart-preview"></div></div>
      </div>
      <div class="card" style="max-width:520px;margin-top:16px">
        <div class="section-title">Position Summary</div>
        <div class="calc-row" id="tp-calc"></div>
        <div id="tp-status" style="margin-top:12px"></div>
        <button id="tp-enter-btn" class="btn btn-primary" style="margin-top:12px" disabled>✅ Enter Trade</button>
      </div>
    `;

    document.getElementById("tp-date").value = new Date().toISOString().slice(0, 10);
    const $ = (id) => document.getElementById(id);
    let chartDataUrl = null;

    $("tp-chart").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) { chartDataUrl = null; $("tp-chart-preview").innerHTML = ""; return; }
      try {
        chartDataUrl = await compressImage(file);
        if (chartDataUrl.length > 900000) { toast("Image too large", "error"); chartDataUrl = null; $("tp-chart-preview").innerHTML = ""; return; }
        $("tp-chart-preview").innerHTML = `<img src="${chartDataUrl}" class="chart-thumb" />`;
      } catch { toast("Could not read image", "error"); }
    });

    function recomputeTP() {
      const entry = parseFloat($("tp-entry").value) || 0;
      const stop = parseFloat($("tp-stop").value) || 0;
      const sym = $("tp-symbol").value.trim();
      const psr = entry - stop;
      const shares = psr > 0 ? Math.floor(TREND_RISK / psr) : 0;
      const cost = shares * entry;
      const maxLoss = shares * psr;
      $("tp-calc").innerHTML = `
        <div class="calc-item"><div class="clabel">SHARES</div><div class="cvalue">${shares || "—"}</div></div>
        <div class="calc-item"><div class="clabel">POSITION COST</div><div class="cvalue">$${cost ? cost.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}</div></div>
        <div class="calc-item"><div class="clabel">MAX LOSS AT STOP</div><div class="cvalue red">${maxLoss ? "-$" + maxLoss.toFixed(2) : "—"}</div></div>
        <div class="calc-item"><div class="clabel">STOP DISTANCE</div><div class="cvalue">${(psr > 0 && entry > 0) ? (psr / entry * 100).toFixed(1) + "%" : "—"}</div></div>`;
      const canEnter = sym && psr > 0 && shares >= 1;
      $("tp-enter-btn").disabled = !canEnter;
      if (canEnter) $("tp-status").innerHTML = `<div class="alert alert-ok">✅ Ready — ${shares} shares, limit $${entry.toFixed(2)}, stop $${stop.toFixed(2)}</div>`;
      else if (!sym) $("tp-status").innerHTML = `<div class="alert alert-warn">Enter a ticker symbol.</div>`;
      else if (psr <= 0) $("tp-status").innerHTML = `<div class="alert alert-warn">Limit price must be above stop price.</div>`;
      else $("tp-status").innerHTML = `<div class="alert alert-warn">Position too small (shares = 0). Stop too wide for $${TREND_RISK} risk.</div>`;
    }

    ["tp-symbol", "tp-entry", "tp-stop"].forEach((id) => $(id).addEventListener("input", recomputeTP));

    $("tp-enter-btn").addEventListener("click", async () => {
      const entry = parseFloat($("tp-entry").value);
      const stop = parseFloat($("tp-stop").value);
      const shares = Math.floor(TREND_RISK / (entry - stop));
      showLoader();
      try {
        const ref = await addTrade({
          symbol: $("tp-symbol").value.trim(),
          direction: "Long",
          entry_date: $("tp-date").value,
          entry_price: entry,
          shares,
          stop_loss: stop,
          current_stop: stop,
          target: null,
          checklist_score: null,
          setup_notes: $("tp-notes").value || `Trend-Pullback. Limit: ${entry}, Stop: ${stop}`,
          strategy: "trend-pullback",
        });
        if (chartDataUrl && ref?.id) await saveChartUrl(ref.id, chartDataUrl);
        toast(`Trade saved — ${shares} shares, limit $${entry.toFixed(2)}, stop $${stop.toFixed(2)}`, "success");
        mount();
      } catch (e) {
        toast("Save failed: " + e.message, "error");
      } finally {
        hideLoader();
      }
    });

    recomputeTP();
  }

  // ── MANUAL MODE (discretionary trade, no checklist / strategy) ──────────────
  function mountManual() {
    const portfolio = getPortfolio();
    document.getElementById("form-body").innerHTML = `
      <div class="card" style="max-width:560px">
        <div class="section-title">Manual Trade — no strategy / checklist</div>
        <div class="alert alert-ok" style="margin-bottom:16px">
          For discretionary trades that don't fit a developed strategy. Enter the
          actual shares you hold. Saved under the "Manual" setup.
        </div>
        <div class="field-row">
          <div class="field"><label>Ticker Symbol</label><input id="mn-symbol" placeholder="e.g. KO" /></div>
          <div class="field"><label>Side</label><select id="mn-side"><option>Long</option><option>Short</option></select></div>
        </div>
        <div class="field"><label>Entry Date</label><input type="date" id="mn-date" /></div>
        <div class="field-row">
          <div class="field"><label>Entry Price $</label><input type="number" id="mn-entry" value="100" step="0.01" /></div>
          <div class="field"><label>Shares</label><input type="number" id="mn-shares" value="10" step="1" /></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Stop Loss $ (optional)</label><input type="number" id="mn-stop" placeholder="—" step="0.01" /></div>
          <div class="field"><label>Target $ (optional)</label><input type="number" id="mn-target" placeholder="—" step="0.01" /></div>
        </div>
        <div class="field"><label>Notes (optional)</label><textarea id="mn-notes" placeholder="Why this trade?"></textarea></div>
        <div class="field"><label>Chart Screenshot (optional)</label><input type="file" id="mn-chart" accept="image/*" /><div id="mn-chart-preview"></div></div>
      </div>
      <div class="card" style="max-width:560px;margin-top:16px">
        <div class="section-title">Summary</div>
        <div class="calc-row" id="mn-calc"></div>
        <div id="mn-status" style="margin-top:12px"></div>
        <button id="mn-enter" class="btn btn-primary" style="margin-top:12px" disabled>✅ Add Trade</button>
      </div>
    `;
    document.getElementById("mn-date").value = new Date().toISOString().slice(0, 10);
    const $ = (id) => document.getElementById(id);
    let chartDataUrl = null;

    $("mn-chart").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) { chartDataUrl = null; $("mn-chart-preview").innerHTML = ""; return; }
      try {
        chartDataUrl = await compressImage(file);
        if (chartDataUrl.length > 900000) { toast("Image too large", "error"); chartDataUrl = null; $("mn-chart-preview").innerHTML = ""; return; }
        $("mn-chart-preview").innerHTML = `<img src="${chartDataUrl}" class="chart-thumb" />`;
      } catch { toast("Could not read image", "error"); }
    });

    function recompute() {
      const side = $("mn-side").value;
      const entry = parseFloat($("mn-entry").value) || 0;
      const stop = parseFloat($("mn-stop").value) || 0;
      const target = parseFloat($("mn-target").value) || 0;
      const shares = parseFloat($("mn-shares").value) || 0;
      const rps = side === "Long" ? entry - stop : stop - entry;
      const riskDollar = rps > 0 ? rps * shares : 0;
      const riskPct = portfolio > 0 ? (riskDollar / portfolio) * 100 : 0;
      const rr = (target > 0 && rps > 0) ? (side === "Long" ? target - entry : entry - target) / rps : 0;
      $("mn-calc").innerHTML = `
        <div class="calc-item"><div class="clabel">POSITION SIZE</div><div class="cvalue">$${(entry * shares).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div></div>
        <div class="calc-item"><div class="clabel">RISK $</div><div class="cvalue red">${riskDollar ? "-$" + riskDollar.toFixed(2) : "—"}</div></div>
        <div class="calc-item"><div class="clabel">RISK % OF PF</div><div class="cvalue">${riskPct ? riskPct.toFixed(1) + "%" : "—"}</div></div>
        <div class="calc-item"><div class="clabel">R:R</div><div class="cvalue">${rr > 0 ? "1:" + rr.toFixed(2) : "—"}</div></div>`;
      const ok = $("mn-symbol").value.trim() && entry > 0 && shares > 0;
      $("mn-enter").disabled = !ok;
      $("mn-status").innerHTML = ok ? "" : `<div class="alert alert-warn">Fill ticker, entry and shares.</div>`;
    }
    ["mn-symbol", "mn-side", "mn-entry", "mn-shares", "mn-stop", "mn-target"].forEach((id) => $(id).addEventListener("input", recompute));

    $("mn-enter").addEventListener("click", async () => {
      const target = parseFloat($("mn-target").value);
      const stop = parseFloat($("mn-stop").value);
      showLoader();
      try {
        const ref = await addTrade({
          symbol: $("mn-symbol").value.trim(),
          direction: $("mn-side").value,
          entry_date: $("mn-date").value,
          entry_price: parseFloat($("mn-entry").value),
          shares: parseFloat($("mn-shares").value),
          stop_loss: isFinite(stop) && stop > 0 ? stop : null,
          target: isFinite(target) && target > 0 ? target : null,
          checklist_score: null,
          grade: null,
          setup_notes: $("mn-notes").value,
          strategy: "other",
        });
        if (chartDataUrl && ref?.id) await saveChartUrl(ref.id, chartDataUrl);
        toast(`Manual trade ${$("mn-symbol").value.trim().toUpperCase()} added`, "success");
        mount();
      } catch (e) {
        toast("Save failed: " + e.message, "error");
      } finally {
        hideLoader();
      }
    });

    recompute();
  }

  // Activate the first tab and mount
  root.querySelector(`.strat-tab[data-mode="${mode}"]`).classList.add("active");
  mount();

  // Apply prefilled ticker (from the Ideas tab), then clear it
  if (pfSymbol) {
    const el = document.getElementById("f-symbol") || document.getElementById("tp-symbol");
    if (el) { el.value = pfSymbol; el.dispatchEvent(new Event("input")); }
  }
  sessionStorage.removeItem("prefill_symbol");
  sessionStorage.removeItem("prefill_strategy");
}
