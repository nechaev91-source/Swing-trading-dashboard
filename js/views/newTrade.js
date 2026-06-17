import { addTrade } from "../db.js";
import { getCurrentPrice, getAutoChecklistData, SECTOR_ETFS } from "../data.js";
import { tradeMetrics } from "../calc.js";
import { fmt, getPortfolio, getChecklist, showLoader, hideLoader, toast, esc } from "../ui.js";
import { SETTINGS } from "../config.js";

const MIN = SETTINGS.minChecklistScore;

export async function renderNewTrade(root) {
  const checklist = await getChecklist();
  const total = checklist.length;
  const portfolio = getPortfolio();

  const sectorOptions = Object.entries(SECTOR_ETFS)
    .map(([label, etf]) => `<option value="${etf}">${label}</option>`).join("");

  const checklistHTML = checklist.map((item, i) => {
    const tags = [];
    if (item.critical) tags.push(`<span class="tag tag-critical">CRITICAL</span>`);
    if (item.auto_key) tags.push(`<span class="tag tag-auto">AUTO</span>`);
    else tags.push(`<span class="tag tag-cat">${esc(item.category)}</span>`);
    return `<div class="chk-item">
      <input type="checkbox" id="chk_${i}" data-auto="${item.auto_key || ""}" data-critical="${item.critical}" />
      <div class="chk-text"><div class="chk-q">${esc(item.question)}${tags.join("")}</div></div>
    </div>`;
  }).join("");

  root.innerHTML = `
    <div class="view-title">🎯 New Trade Entry</div>
    <div class="two-col">
      <!-- LEFT -->
      <div>
        <div class="card">
          <div class="section-title">Trade Details</div>
          <div class="field-row">
            <div class="field"><label>Ticker Symbol</label><input id="f-symbol" placeholder="e.g. NVDA" /></div>
            <div class="field"><label>Side</label><select id="f-side"><option>Long</option><option>Short</option></select></div>
          </div>
          <div class="field"><label>Sector ETF (for trend check)</label>
            <select id="f-sector"><option value="">🔍 Auto-detect</option>${sectorOptions}</select>
            <div class="hint">Auto-detect needs a Finnhub key; otherwise pick manually.</div></div>
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
          <button id="check-price" class="btn btn-secondary btn-sm">Check Live Price</button>
          <div id="price-result" class="hint"></div>
        </div>

        <div class="card">
          <div class="section-title">Position Sizing & Risk</div>
          <div class="calc-row" id="calc-row"></div>
          <div id="calc-warn"></div>
        </div>
      </div>

      <!-- RIGHT -->
      <div>
        <div class="card">
          <div class="section-title">Breakout Checklist — minimum ${MIN}/${total}</div>
          <button id="autofill" class="btn btn-secondary btn-sm" style="margin-bottom:12px">⚡ Auto-fill from Market Data</button>
          <div id="auto-signals"></div>
          ${checklistHTML}
        </div>
        <div class="card">
          <div class="section-title">Score</div>
          <div class="score-box">
            <div class="score-num" id="score-num">0 / ${total}</div>
            <div class="score-bar-bg"><div class="score-bar-fill" id="score-fill" style="width:0%"></div></div>
          </div>
          <div id="critical-warn"></div>
        </div>
        <div id="enter-status"></div>
        <button id="enter-btn" class="btn btn-primary" disabled>✅ Enter Trade</button>
      </div>
    </div>
  `;

  // default date = today
  document.getElementById("f-date").value = new Date().toISOString().slice(0, 10);

  const $ = (id) => document.getElementById(id);
  const inputs = ["f-side", "f-entry", "f-stop", "f-target", "f-risk", "f-symbol"];
  inputs.forEach((id) => $(id).addEventListener("input", recompute));
  checklist.forEach((_, i) => $(`chk_${i}`).addEventListener("change", recompute));

  function getMetrics() {
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
    const m = getMetrics();
    const rrColor = m.rr >= 2 ? "green" : m.rr >= 1.5 ? "yellow" : "red";
    const pctColor = m.riskPct > SETTINGS.maxRiskPctWarn ? "red" : "green";

    $("calc-row").innerHTML = `
      <div class="calc-item"><div class="clabel">SHARES TO BUY</div><div class="cvalue">${m.shares.toFixed(0)}</div></div>
      <div class="calc-item"><div class="clabel">POSITION SIZE</div><div class="cvalue">$${m.positionSize.toLocaleString(undefined,{maximumFractionDigits:0})}</div></div>
      <div class="calc-item"><div class="clabel">ACTUAL RISK</div><div class="cvalue red">-$${m.riskDollar.toFixed(2)}</div></div>
      <div class="calc-item"><div class="clabel">RISK % OF PF</div><div class="cvalue ${pctColor}">${m.riskPct.toFixed(1)}%</div></div>
      <div class="calc-item"><div class="clabel">POTENTIAL GAIN</div><div class="cvalue green">+$${m.rewardDollar.toFixed(2)}</div></div>
      <div class="calc-item"><div class="clabel">R:R RATIO</div><div class="cvalue ${rrColor}">1:${m.rr.toFixed(2)}</div></div>`;

    let warn = "";
    if (m.rr < 2 && m.rps > 0) warn += `<div class="alert alert-warn">⚠️ R:R below 1:2 — reconsider entry.</div>`;
    if (m.riskPct > SETTINGS.maxRiskPctWarn) warn += `<div class="alert alert-warn">⚠️ Risking ${m.riskPct.toFixed(1)}% of portfolio — above ${SETTINGS.maxRiskPctWarn}% limit.</div>`;
    $("calc-warn").innerHTML = warn;

    // score
    let score = 0; const criticalFailed = [];
    checklist.forEach((item, i) => {
      const checked = $(`chk_${i}`).checked;
      if (checked) score++;
      if (item.critical && !checked) criticalFailed.push(item.question);
    });
    const color = score >= MIN ? "var(--green)" : "var(--red)";
    $("score-num").style.color = color;
    $("score-num").textContent = `${score} / ${total}`;
    $("score-fill").style.width = `${(score / total) * 100}%`;
    $("score-fill").style.background = color;
    $("critical-warn").innerHTML = criticalFailed
      .map((q) => `<div class="red" style="font-size:12px;margin-bottom:4px">✗ CRITICAL: ${esc(q)}</div>`).join("");

    const symbol = $("f-symbol").value.trim();
    const canEnter = score >= MIN && criticalFailed.length === 0 && symbol &&
      m.rps > 0 && m.rwps > 0 && m.shares > 0;

    $("enter-btn").disabled = !canEnter;
    if (canEnter) {
      $("enter-status").innerHTML = `<div class="alert alert-ok">✅ Passed (${score}/${total}) — ${m.shares.toFixed(0)} shares, risk $${m.riskDollar.toFixed(2)}</div>`;
    } else if (criticalFailed.length) {
      $("enter-status").innerHTML = `<div class="alert alert-stop">🚫 One or more CRITICAL items unchecked.</div>`;
    } else {
      const reason = score < MIN ? `Score ${score}/${total} (need ${MIN})` : "Fix symbol / entry levels";
      $("enter-status").innerHTML = `<div class="alert alert-warn">Not ready: ${reason}</div>`;
    }
  }

  // Check live price
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

  // Auto-fill
  $("autofill").addEventListener("click", async () => {
    const sym = $("f-symbol").value.trim().toUpperCase();
    if (!sym) { toast("Enter a ticker symbol first", "error"); return; }
    const sectorEtf = $("f-sector").value || null;
    showLoader();
    let result;
    try {
      result = await getAutoChecklistData(sym, sectorEtf);
    } catch (e) {
      hideLoader(); toast("Auto-fill failed: " + e.message, "error"); return;
    }
    hideLoader();

    const { signals, detail } = result;
    // tick matching checkboxes
    checklist.forEach((item, i) => {
      if (item.auto_key && item.auto_key in signals) {
        $(`chk_${i}`).checked = signals[item.auto_key];
      }
    });

    const sectorLabel = detail.sector_name ? `Sector — ${detail.sector_name}` : "Sector ETF trend";
    const labelMap = {
      spy_above_50ma: ["S&P 500 trend", detail.spy],
      near_high: ["52-week high proximity", detail["52w_high"]],
      rs_near_high: ["Relative Strength at new highs", detail.rs],
      sector_above_50ma: [sectorLabel, detail.sector],
      no_earnings_3w: ["No earnings within 3 weeks", detail.earnings],
    };
    let html = `<div class="section-title" style="margin-top:6px">Auto-detected</div>`;
    for (const [key, [label, det]] of Object.entries(labelMap)) {
      if (key in signals) {
        const ok = signals[key];
        html += `<div class="auto-signal"><span>${ok ? "✅" : "❌"}</span>
          <div><div>${label}</div><div class="sdetail">${esc(det || "")}</div></div></div>`;
      }
    }
    if (detail.sector && !("sector_above_50ma" in signals)) {
      html += `<div class="auto-signal"><span>ℹ️</span><div><div>Sector</div><div class="sdetail">${esc(detail.sector)}</div></div></div>`;
    }
    $("auto-signals").innerHTML = html;
    recompute();
    toast("Auto-fill complete", "success");
  });

  // Enter trade
  $("enter-btn").addEventListener("click", async () => {
    const m = getMetrics();
    let score = 0;
    checklist.forEach((_, i) => { if ($(`chk_${i}`).checked) score++; });
    showLoader();
    try {
      await addTrade({
        symbol: $("f-symbol").value.trim(),
        direction: $("f-side").value,
        entry_date: $("f-date").value,
        entry_price: parseFloat($("f-entry").value),
        shares: m.shares,
        stop_loss: parseFloat($("f-stop").value),
        target: parseFloat($("f-target").value),
        checklist_score: score,
        setup_notes: $("f-notes").value,
      });
      toast(`Trade saved — ${m.shares.toFixed(0)} shares, risking $${m.riskDollar.toFixed(2)}`, "success");
      renderNewTrade(root);
    } catch (e) {
      toast("Save failed: " + e.message, "error");
    } finally {
      hideLoader();
    }
  });

  recompute();
}
