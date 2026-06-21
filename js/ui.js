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

// Load strategies.json once and cache it
let _strategies = null;
export async function getStrategies() {
  if (!_strategies) {
    const res = await fetch("strategies.json");
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
