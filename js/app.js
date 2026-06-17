// Main entry: auth gate + hash router.
import { onAuth, login, signup, logout, authErrorMessage } from "./auth.js";
import { showLoader, hideLoader, toast } from "./ui.js";
import { firebaseConfig, TWELVE_DATA_KEY } from "./config.js";

// ── Setup guard: warn clearly if keys aren't configured yet ────────────────────
function configIsPlaceholder() {
  return (
    !firebaseConfig.apiKey ||
    firebaseConfig.apiKey.startsWith("YOUR_") ||
    TWELVE_DATA_KEY.startsWith("YOUR_")
  );
}

if (configIsPlaceholder()) {
  const authScreen = document.getElementById("auth-screen");
  authScreen.classList.remove("hidden");
  authScreen.querySelector(".auth-card").innerHTML = `
    <div class="auth-logo">🔧</div>
    <h1>Finish setup</h1>
    <p class="auth-sub">Add your Firebase and Twelve Data keys in
      <code>js/config.js</code>, then reload. See <b>README.md</b> for step-by-step
      instructions.</p>`;
  throw new Error("config.js not configured — see README.md");
}

import { renderDashboard } from "./views/dashboard.js";
import { renderNewTrade } from "./views/newTrade.js";
import { renderJournal } from "./views/journal.js";
import { renderAnalytics } from "./views/analytics.js";
import { renderImport } from "./views/importCsv.js";
import { renderSettings } from "./views/settings.js";

const VIEWS = {
  dashboard: renderDashboard,
  new: renderNewTrade,
  journal: renderJournal,
  analytics: renderAnalytics,
  import: renderImport,
  settings: renderSettings,
};

const authScreen = document.getElementById("auth-screen");
const appShell = document.getElementById("app-shell");
const container = document.getElementById("view-container");

// ── Router ────────────────────────────────────────────────────────────────────
async function route() {
  const hash = (location.hash.replace("#", "") || "dashboard");
  const view = VIEWS[hash] ? hash : "dashboard";

  document.querySelectorAll(".nav-item[data-view]").forEach((el) => {
    el.classList.toggle("active", el.dataset.view === view);
  });

  container.innerHTML = "";
  try {
    await VIEWS[view](container);
  } catch (e) {
    console.error(e);
    container.innerHTML = `<div class="empty-state">Something went wrong: ${e.message}</div>`;
  }
}

window.addEventListener("hashchange", route);

// ── Auth gate ─────────────────────────────────────────────────────────────────
onAuth((user) => {
  if (user) {
    authScreen.classList.add("hidden");
    appShell.classList.remove("hidden");
    if (!location.hash) location.hash = "#dashboard";
    route();
  } else {
    appShell.classList.add("hidden");
    authScreen.classList.remove("hidden");
  }
});

// ── Auth form wiring ──────────────────────────────────────────────────────────
const emailEl = document.getElementById("auth-email");
const passEl = document.getElementById("auth-password");
const errEl = document.getElementById("auth-error");

async function doAuth(fn) {
  errEl.textContent = "";
  const email = emailEl.value.trim();
  const pass = passEl.value;
  if (!email || !pass) { errEl.textContent = "Enter email and password."; return; }
  showLoader();
  try {
    await fn(email, pass);
  } catch (e) {
    errEl.textContent = authErrorMessage(e);
  } finally {
    hideLoader();
  }
}

document.getElementById("auth-login-btn").addEventListener("click", () => doAuth(login));
document.getElementById("auth-signup-btn").addEventListener("click", () => doAuth(signup));
passEl.addEventListener("keydown", (e) => { if (e.key === "Enter") doAuth(login); });

document.getElementById("logout-btn").addEventListener("click", async () => {
  await logout();
  toast("Signed out");
});
