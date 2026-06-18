// Firestore data layer — mirrors the original db.py CRUD functions.
// Each trade is a document under  users/{uid}/trades/{autoId}
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  getDocs, query, where, orderBy, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { currentUser } from "./auth.js";

function tradesCol() {
  const uid = currentUser().uid;
  return collection(db, "users", uid, "trades");
}

// ── Create ───────────────────────────────────────────────────────────────────
export async function addTrade(t) {
  return await addDoc(tradesCol(), {
    symbol: t.symbol.toUpperCase(),
    direction: t.direction,
    entry_date: t.entry_date,
    entry_price: t.entry_price,
    shares: t.shares,
    stop_loss: t.stop_loss,
    current_stop: t.current_stop ?? t.stop_loss,   // trail tracking
    target: t.target ?? null,
    checklist_score: t.checklist_score ?? null,
    setup_notes: t.setup_notes || "",
    strategy: t.strategy || "breakout",
    exit_price: null,
    exit_date: null,
    exit_notes: null,
    status: "open",
    chart_url: null,
    created_at: Date.now(),
  });
}

// ── Update trailing stop ─────────────────────────────────────────────────────
export async function updateTradeStop(id, newStop) {
  const ref = doc(db, "users", currentUser().uid, "trades", id);
  await updateDoc(ref, { current_stop: newStop });
}

// ── Close ────────────────────────────────────────────────────────────────────
export async function closeTrade(id, exitPrice, exitDate, exitNotes) {
  const ref = doc(db, "users", currentUser().uid, "trades", id);
  await updateDoc(ref, {
    exit_price: exitPrice,
    exit_date: exitDate,
    exit_notes: exitNotes || "",
    status: "closed",
  });
}

// ── Chart URL ────────────────────────────────────────────────────────────────
export async function saveChartUrl(id, url) {
  const ref = doc(db, "users", currentUser().uid, "trades", id);
  await updateDoc(ref, { chart_url: url });
}

// ── Delete ───────────────────────────────────────────────────────────────────
export async function deleteTrade(id) {
  await deleteDoc(doc(db, "users", currentUser().uid, "trades", id));
}

// ── Read ─────────────────────────────────────────────────────────────────────
function rowsFromSnap(snap) {
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getAllTrades() {
  const snap = await getDocs(query(tradesCol(), orderBy("created_at", "desc")));
  return rowsFromSnap(snap);
}

export async function getOpenTrades() {
  const snap = await getDocs(query(tradesCol(), where("status", "==", "open")));
  return rowsFromSnap(snap).sort((a, b) => b.created_at - a.created_at);
}

export async function getClosedTrades() {
  const snap = await getDocs(query(tradesCol(), where("status", "==", "closed")));
  return rowsFromSnap(snap).sort((a, b) => (a.exit_date < b.exit_date ? 1 : -1));
}

// ── Reset everything ─────────────────────────────────────────────────────────
export async function resetAllData() {
  const snap = await getDocs(tradesCol());
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}
