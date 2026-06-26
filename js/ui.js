// Shared UI helpers: loader, toast, formatting, portfolio value.

export function showLoader() { document.getElementById("loader").classList.remove("hidden"); }
export function hideLoader() { document.getElementById("loader").classList.add("hidden"); }

let toastTimer;
export function toast(msg, type = "") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast " + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 3200);
}

export const fmt = {
  money: (n) => (n >= 0 ? "$" : "-$") + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  signMoney: (n) => (n >= 0 ? "+$" : "-$") + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  pct: (n) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%",
  num: (n, d = 2) => Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }),
};

export function colorClass(n) { return n >= 0 ? "green" : "red"; }

// App settings (starting capital, commission). Cached in localStorage for
// synchronous reads; source of truth is Firestore so they sync across devices.
import { getUserSettings, setUserSetting } from "./db.js";

export function getPortfolio() {
  return parseFloat(localStorage.getItem("portfolio_value") || "10000");
}
export function setPortfolio(v) {
  localStorage.setItem("portfolio_value", String(v));
  setUserSetting("portfolio_value", v).catch(() => {});
}

// Default round-trip commission applied to new trades ($1.5 buy + $1.5 sell).
export function getCommission() {
  return parseFloat(localStorage.getItem("commission_rt") || "3");
}
export function setCommission(v) {
  localStorage.setItem("commission_rt", String(v));
  setUserSetting("commission_rt", v).catch(() => {});
}

// Pull saved settings from Firestore into the local cache (call once after login).
export async function syncSettingsFromRemote() {
  try {
    const s = await getUserSettings();
    if (s.portfolio_value != null && isFinite(s.portfolio_value)) localStorage.setItem("portfolio_value", String(s.portfolio_value));
    if (s.commission_rt != null && isFinite(s.commission_rt)) localStorage.setItem("commission_rt", String(s.commission_rt));
  } catch { /* offline / first run — keep local */ }
}

// Normalize a date string to ISO YYYY-MM-DD so date comparisons/sorting work.
// Handles ISO, US slash (M/D/Y), month names (via Date), and European D/M/Y.
export function normDate(s) {
  if (!s) return "";
  s = String(s).trim();
  if (!s) return "";
  const fromLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);          // already ISO
  const d = new Date(s);                                            // ISO+time, US slash, "Jun 18 2026"
  if (!isNaN(d.getTime()) && /[A-Za-z]|^\d{4}/.test(s)) return fromLocal(d);
  const m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/); // D/M/Y or M/D/Y
  if (m) {
    let day = +m[1], mon = +m[2], y = m[3];
    if (mon > 12 && day <= 12) { const t = day; day = mon; mon = t; } // it was M/D
    if (y.length === 2) y = (+y > 70 ? "19" : "20") + y;
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31)
      return `${y}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  if (!isNaN(d.getTime())) return fromLocal(d);
  return "";
}

// Escape user text before injecting into innerHTML
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Load strategies.json once per session. `no-store` avoids the browser/CDN
// serving a stale cached copy, so checklist edits appear on the next reload.
let _strategies = null;
export async function getStrategies() {
  if (!_strategies) {
    const res = await fetch("strategies.json", { cache: "no-store" });
    _strategies = await res.json();
  }
  return _strategies;
}

// Resize + compress an image File to a JPEG data URL small enough to live inside
// a Firestore document (1 MB limit). Shared by New Trade and Journal.
export function compressImage(file, maxWidth = 1200, quality = 0.7) {
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

// HTML for a "paste or upload" chart picker. `p` is an id prefix.
export function chartPickerHTML(p, label = "Chart Screenshot (optional)") {
  return `<div class="field"><label>${label}</label>
    <div class="chart-paste" id="${p}-paste" tabindex="0">
      <span class="chart-paste-hint">📋 Click here & press <b>Ctrl+V</b> to paste a chart,
        <button type="button" class="btn btn-secondary btn-sm chart-paste-btn" id="${p}-pastebtn">Paste</button>
        or <label class="chart-file-label">choose a file<input type="file" id="${p}-file" accept="image/*" hidden></label></span>
    </div>
    <div id="${p}-preview"></div>
  </div>`;
}

// Wire a chart picker (paste event + Paste button + file input) to a callback.
// Calls onImage(dataUrl) when a valid image is supplied.
export function wireChartPicker(p, onImage) {
  const el = (s) => document.getElementById(`${p}-${s}`);
  const preview = el("preview");
  const handle = async (blob) => {
    if (!blob) return;
    try {
      const url = await compressImage(blob);
      if (url.length > 900000) { toast("Image too large even after compression", "error"); return; }
      preview.innerHTML = `<img src="${url}" class="chart-thumb" />`;
      onImage(url);
    } catch { toast("Could not read image", "error"); }
  };
  el("file").addEventListener("change", (e) => handle(e.target.files[0]));
  el("paste").addEventListener("paste", (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (item) { e.preventDefault(); handle(item.getAsFile()); }
  });
  el("pastebtn").addEventListener("click", async () => {
    if (!navigator.clipboard?.read) { el("paste").focus(); toast("Press Ctrl+V inside the box, or choose a file", "error"); return; }
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) { handle(await item.getType(type)); return; }
      }
      toast("No image found in clipboard", "error");
    } catch { toast("Clipboard access blocked — press Ctrl+V inside the box", "error"); }
  });
}
