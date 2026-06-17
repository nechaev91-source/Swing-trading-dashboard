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

// R-multiple achieved (result / initial risk)
export function rMultiple(side, entry, exit, stop, shares) {
  const pnl = realizedPnl(side, entry, exit, shares);
  const risk = Math.abs(entry - stop) * shares;
  return risk !== 0 ? pnl / risk : 0;
}

// Live (open) position P&L and R, plus stop/target flags
export function openPositionStats(side, entry, current, stop, target, shares) {
  let pnl, r, atStop, atTarget;
  if (side === "Long") {
    pnl = (current - entry) * shares;
    r = entry - stop !== 0 ? (current - entry) / (entry - stop) : 0;
    atStop = current <= stop;
    atTarget = current >= target;
  } else {
    pnl = (entry - current) * shares;
    r = stop - entry !== 0 ? (entry - current) / (stop - entry) : 0;
    atStop = current >= stop;
    atTarget = current <= target;
  }
  const risk = Math.abs(entry - stop) * shares;
  return { pnl, r, atStop, atTarget, risk };
}
