// Pure trading math — ported from the Streamlit New Trade page.
// No side effects, easy to reason about and test.

// Risk per share given side
export function riskPerShare(side, entry, stop) {
  return side === "Long" ? entry - stop : stop - entry;
}

export function rewardPerShare(side, entry, target) {
  return side === "Long" ? target - entry : entry - target;
}

// Position sizing: how many shares so that a full stop-out loses exactly maxRisk $
export function sharesFromRisk(maxRisk, rps) {
  if (rps <= 0) return 0;
  return maxRisk / rps;
}

// Full trade metrics used by the New Trade screen
export function tradeMetrics({ side, entry, stop, target, maxRisk, portfolio }) {
  const rps = riskPerShare(side, entry, stop);
  const rwps = rewardPerShare(side, entry, target);
  const shares = Math.round(sharesFromRisk(maxRisk, rps) * 10) / 10;
  const riskDollar = rps > 0 ? rps * shares : 0;
  const rewardDollar = Math.max(rwps, 0) * shares;
  const rr = rps > 0 ? rwps / rps : 0;
  const positionSize = entry * shares;
  const riskPct = portfolio > 0 ? (riskDollar / portfolio) * 100 : 0;
  return { rps, rwps, shares, riskDollar, rewardDollar, rr, positionSize, riskPct };
}

// Realized P&L for a closed trade
export function realizedPnl(side, entry, exit, shares) {
  return side === "Long" ? (exit - entry) * shares : (entry - exit) * shares;
}

// R-multiple achieved (result / initial risk). Returns 0 if there's no stop.
export function rMultiple(side, entry, exit, stop, shares) {
  const pnl = realizedPnl(side, entry, exit, shares);
  const risk = (stop != null && isFinite(stop)) ? Math.abs(entry - stop) * shares : 0;
  return risk !== 0 ? pnl / risk : 0;
}

// Live (open) position P&L and R, plus stop/target flags
export function openPositionStats(side, entry, current, stop, target, shares) {
  const hasStop = stop != null && isFinite(stop);
  let pnl, r, atStop, atTarget;
  if (side === "Long") {
    pnl = (current - entry) * shares;
    r = hasStop && entry - stop !== 0 ? (current - entry) / (entry - stop) : 0;
    atStop = hasStop && current <= stop;
    atTarget = target != null && isFinite(target) && current >= target;
  } else {
    pnl = (entry - current) * shares;
    r = hasStop && stop - entry !== 0 ? (entry - current) / (stop - entry) : 0;
    atStop = hasStop && current >= stop;
    atTarget = target != null && isFinite(target) && current <= target;
  }
  const risk = hasStop ? Math.abs(entry - stop) * shares : 0;
  return { pnl, r, atStop, atTarget, risk };
}

// Grade a setup A+ … D from its checklist + risk/reward.
// Philosophy: CRITICAL items are gatekeepers — a missing critical caps the grade,
// because in swing trading a missing must-have (e.g. no volume confirmation, broken
// regime) is a real flaw no amount of nice-to-haves makes up for. R:R nudges the
// score: a clean structure with a 3:1 reward is worth more than the same at 1.5:1.
export function gradeSetup(items, checked, rr) {
  let critTotal = 0, critMet = 0, nonTotal = 0, nonMet = 0;
  items.forEach((it, i) => {
    if (it.critical) { critTotal++; if (checked[i]) critMet++; }
    else { nonTotal++; if (checked[i]) nonMet++; }
  });
  const critMissing = critTotal - critMet;

  // Criticals carry double weight in the base percentage
  const pts = critMet * 2 + nonMet;
  const maxPts = critTotal * 2 + nonTotal;
  let pct = maxPts > 0 ? (pts / maxPts) * 100 : 0;

  // R:R modifier
  if (rr >= 2.5) pct += 5;
  else if (rr > 0 && rr < 1.5) pct -= 8;
  pct = Math.max(0, Math.min(100, pct));

  // Critical ceiling: each missing critical lowers the best attainable grade
  let grade;
  if (critMissing === 0) {
    grade = pct >= 92 ? "A+" : pct >= 82 ? "A" : pct >= 70 ? "B" : pct >= 55 ? "C" : "D";
  } else if (critMissing === 1) {
    grade = pct >= 80 ? "B" : pct >= 60 ? "C" : "D";   // capped at B
  } else {
    grade = pct >= 60 ? "C" : "D";                      // capped at C
  }

  return { grade, pct: Math.round(pct), critMet, critTotal, nonMet, nonTotal, critMissing };
}

// Color bucket for a letter grade
export function gradeColor(grade) {
  if (grade === "A+" || grade === "A") return "green";
  if (grade === "B") return "accent";
  if (grade === "C") return "yellow";
  return "red";
}
