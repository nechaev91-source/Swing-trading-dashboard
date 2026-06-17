// ============================================================
//  CONFIGURATION — fill these in before deploying
// ============================================================
//
//  1. FIREBASE: Create a project at https://console.firebase.google.com
//     - Enable Authentication → Email/Password
//     - Create Firestore Database (production mode)
//     - Create Storage
//     - Project Settings → Your apps → Web app → copy the config below
//
//  2. TWELVE DATA: Sign up free at https://twelvedata.com → copy your API key
//     (Free tier: 800 calls/day, includes historical candles — needed
//      for the auto-checklist. Finnhub's free tier no longer serves candles.)
//
// ============================================================

export const firebaseConfig = {
  apiKey: "AIzaSyCnEnJT5MMoiTtT9O4nebDkzDJ-92N-WsA",
  authDomain: "swing-trading-db.firebaseapp.com",
  projectId: "swing-trading-db",
  storageBucket: "swing-trading-db.firebasestorage.app",
  messagingSenderId: "905565295937",
  appId: "1:905565295937:web:28f2af24b6bad452da3dc0",
};

// Twelve Data free API key (read-only, rate-limited — safe to expose client-side)
export const TWELVE_DATA_KEY = "69daab877b4e4b6f91e8fd44bb27e27f";

// Finnhub free API key — OPTIONAL. Used only to auto-detect a stock's sector
// (the /stock/profile2 endpoint is free). Leave as-is to skip auto-detection
// and pick the sector ETF manually instead. Sign up free at https://finnhub.io
export const FINNHUB_KEY = "d8p1od9r01qp954u4u0gd8p1od9r01qp954u4u10";

// App settings
export const SETTINGS = {
  minChecklistScore: 7,     // minimum score to enable "Enter Trade"
  maxRiskPctWarn: 3,        // warn if risking more than this % of portfolio
};
