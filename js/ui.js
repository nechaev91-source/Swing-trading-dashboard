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

// Portfolio base value — stored locally per browser
export function getPortfolio() {
  return parseFloat(localStorage.getItem("portfolio_value") || "10000");
}
export function setPortfolio(v) {
  localStorage.setItem("portfolio_value", String(v));
}

// Escape user text before injecting into innerHTML
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Load checklist.json once and cache it
let _checklist = null;
export async function getChecklist() {
  if (!_checklist) {
    const res = await fetch("checklist.json");
    _checklist = await res.json();
  }
  return _checklist;
}
