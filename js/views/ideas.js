import { showLoader, hideLoader, esc } from "../ui.js";

// Daily trend-line setups posted by traders on TradingView, ranked by
// engagement. Generated server-side by scripts/idea_scan.py → signals/trendline_ideas.json
export async function renderIdeas(root) {
  root.innerHTML = `<div class="view-title">💡 Trend-Line Ideas</div><div id="ideas-body"><div class="empty-state">Loading…</div></div>`;
  const body = document.getElementById("ideas-body");

  showLoader();
  let data;
  try {
    const res = await fetch("signals/trendline_ideas.json?ts=" + Date.now());
    if (!res.ok) throw new Error("no feed yet");
    data = await res.json();
  } catch {
    hideLoader();
    body.innerHTML = `<div class="empty-state">No ideas feed yet.<br>
      Run the <b>idea_scan</b> workflow (GitHub → Actions → Run workflow), or wait for the daily run.</div>`;
    return;
  }
  hideLoader();

  const ideas = data.ideas || [];
  if (!ideas.length) {
    body.innerHTML = `<div class="empty-state">No US-stock trend-line ideas in the latest scan.</div>`;
    return;
  }

  const when = data.generated_at ? new Date(data.generated_at).toLocaleString() : "";
  const cards = ideas.map((i) => {
    const badges = [];
    if (i.is_sp500) badges.push(`<span class="idea-badge sp">S&P 500</span>`);
    if (i.editors_pick) badges.push(`<span class="idea-badge pick">⭐ Editor's pick</span>`);
    else if (i.is_hot) badges.push(`<span class="idea-badge hot">🔥 Hot</span>`);
    if (i.premium) badges.push(`<span class="idea-badge pro">PRO author</span>`);
    const img = i.image
      ? `<a href="${esc(i.chart_url)}" target="_blank" rel="noopener"><img class="idea-img" loading="lazy" src="${esc(i.image)}" alt=""></a>`
      : "";
    return `<div class="idea-card">
      ${img}
      <div class="idea-body">
        <div class="idea-top">
          <span class="idea-ticker">${esc(i.ticker)}</span>
          ${badges.join("")}
        </div>
        <a class="idea-title" href="${esc(i.chart_url)}" target="_blank" rel="noopener">${esc(i.title)}</a>
        <div class="idea-summary">${esc(i.summary || "")}</div>
        <div class="idea-meta">
          <span>@${esc(i.author)}</span>
          <span>👍 ${i.likes}</span>
          <span>💬 ${i.comments}</span>
        </div>
        <div class="idea-actions">
          <a class="btn btn-secondary btn-sm" href="${esc(i.chart_url)}" target="_blank" rel="noopener">View chart ↗</a>
          <button class="btn btn-primary btn-sm" data-ticker="${esc(i.ticker)}">Load into New Trade</button>
        </div>
      </div>
    </div>`;
  }).join("");

  body.innerHTML = `
    <div class="hint" style="margin-bottom:14px">
      ${ideas.length} setups · ${esc(data.source || "")} · updated ${esc(when)}.
      You still draw the trend line and judge the entry — this is a shortlist of what popular traders are watching.
    </div>
    <div class="ideas-grid">${cards}</div>
  `;

  // "Load into New Trade" → prefill the Trend-Line form with this ticker
  body.querySelectorAll("button[data-ticker]").forEach((btn) => {
    btn.addEventListener("click", () => {
      sessionStorage.setItem("prefill_symbol", btn.dataset.ticker);
      sessionStorage.setItem("prefill_strategy", "trend-line");
      location.hash = "#new";
    });
  });
}
