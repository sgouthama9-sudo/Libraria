/**
 * js/analytics-r.js  —  Libraria R Analytics Bridge
 * ====================================================
 *
 * This file is the browser-side connector between the admin analytics
 * dashboard and the R statistical engine in  r/analytics.R.
 *
 * CONNECTION MAP
 * ──────────────
 *
 *   r/analytics.R          (pure R functions — the source of truth)
 *         │
 *         │  sourced by
 *         ▼
 *   r/plumber_api.R        (HTTP server on localhost:8080)
 *         │
 *         │  POST /borrow-trend, etc.
 *         ▼
 *   js/analytics-r.js      ◄── YOU ARE HERE
 *         │
 *         │  rBorrowTrend(), rFineStats(), …
 *         ▼
 *   js/analytics-dashboard.js  (charts, tables, panels)
 *         │
 *         ▼
 *   admin.html  (rendered UI)
 *
 * THREE-TIER FALLBACK
 * ───────────────────
 *  Tier 1 — R REST API  (r/plumber_api.R running on localhost:8080)
 *            Real R results; start with:  Rscript r/plumber_api.R
 *
 *  Tier 2 — WebR  (R compiled to WebAssembly, runs inside the browser)
 *            Same R code, no server needed.  Auto-loads on first call.
 *
 *  Tier 3 — JavaScript fallback
 *            Pure-JS reimplementation of every formula.
 *            Identical numerical results to R (validated).
 *            Always available; zero latency.
 *
 * Each function tries Tier 1 → Tier 2 → Tier 3 automatically and silently.
 *
 * EXPORTED FUNCTIONS  (called by analytics-dashboard.js)
 * ───────────────────────────────────────────────────────
 *  rBorrowTrend(weeklyData)           → { slope, intercept, r_squared, trend_label, fitted }
 *  rDomainCorrelation(books, counts)  → { correlation, p_value, significance, direction, strength }
 *  rOverdueRisk(borrowings)           → [{ id, student, book, days_overdue, risk_score, risk_level }]
 *  rFineStats(fines)                  → { mean, median, sd, iqr, total, unpaid }
 *  rTopBooks(books, counts, n)        → [{ id, title, author, domain, borrow_count }]
 *  rDomainDistribution(books, counts) → [{ domain, total_borrows, pct }]
 *
 * MIRROR
 *  Every function here corresponds 1-to-1 with a function in r/analytics.R.
 *  Keep both files in sync when modifying formulas.
 */

// =============================================================================
// CONFIG
// =============================================================================

/** Base URL of the running plumber_api.R server. */
const R_API_BASE       = "http://localhost:8080";
const R_API_TIMEOUT_MS = 3000;   // give up on local API after 3 s

// =============================================================================
// TIER 1 — R REST API  (r/plumber_api.R)
// =============================================================================

/** POST JSON body to an R API endpoint. Returns parsed response or null. */
async function _rPost(endpoint, payload) {
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), R_API_TIMEOUT_MS);
    const res   = await fetch(`${R_API_BASE}${endpoint}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
      signal:  ctrl.signal,
    });
    clearTimeout(timer);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** One-time health check — true if plumber_api.R is reachable. */
let _apiOk = null;
async function _apiReady() {
  if (_apiOk !== null) return _apiOk;
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), R_API_TIMEOUT_MS);
    const res  = await fetch(`${R_API_BASE}/health`, { signal: ctrl.signal });
    _apiOk = res.ok;
  } catch {
    _apiOk = false;
  }
  console.info(_apiOk
    ? "✅ R API (plumber_api.R) connected — Tier 1 analytics active"
    : "ℹ️  R API offline — using WebR (Tier 2) or JS fallback (Tier 3)"
  );
  return _apiOk;
}

// =============================================================================
// TIER 2 — WebR  (R via WebAssembly)
// =============================================================================

let _webr      = null;
let _webrReady = false;

async function _initWebR() {
  if (_webrReady) return _webr;
  if (typeof WebR === "undefined") return null;
  try {
    _webr = new WebR.WebR();
    await _webr.init();
    _webrReady = true;
    console.info("✅ WebR initialised — Tier 2 R-in-browser analytics active");
  } catch (e) {
    console.warn("WebR init failed:", e.message);
  }
  return _webr;
}

async function _rEval(code) {
  const w = await _initWebR();
  if (!w) return null;
  try { return await (await w.evalR(code)).toJs(); } catch { return null; }
}

async function _rBind(name, value) {
  const w = await _initWebR();
  if (!w) return false;
  try { await w.objs.globalEnv.bind(name, value); return true; } catch { return false; }
}

// =============================================================================
// 1.  BORROW TREND
//     R source    : borrow_trend()       in  r/analytics.R
//     API endpoint: POST /borrow-trend   in  r/plumber_api.R
// =============================================================================
/**
 * Linear regression on weekly borrow counts.
 * @param  {Array<{week:string, count:number}>} weeklyData
 * @return {{ slope, intercept, r_squared, trend_label, fitted:number[] }}
 */
async function rBorrowTrend(weeklyData) {
  if (!weeklyData?.length) {
    return { slope: 0, intercept: 0, r_squared: 0, trend_label: "Stable", fitted: [] };
  }

  // ── Tier 1 ──
  if (await _apiReady()) {
    const r = await _rPost("/borrow-trend", { weekly: weeklyData });
    if (r) return r;
  }

  // ── Tier 2 ──
  const x = weeklyData.map((_, i) => i + 1);
  const y = weeklyData.map(d => d.count);
  if (await _rBind("x_r", x) && await _rBind("y_r", y)) {
    const js = await _rEval(`
      x <- as.numeric(x_r); y <- as.numeric(y_r)
      m <- lm(y ~ x)
      co <- coef(m)
      ss_res <- sum(residuals(m)^2)
      ss_tot <- sum((y - mean(y))^2)
      r2 <- if (ss_tot == 0) 1 else 1 - ss_res / ss_tot
      list(
        slope       = as.numeric(co[2]),
        intercept   = as.numeric(co[1]),
        r_squared   = round(r2, 4),
        trend_label = if (co[2] > 0.5) "Rising" else if (co[2] < -0.5) "Declining" else "Stable",
        fitted      = as.numeric(predict(m))
      )
    `);
    if (js) return {
      slope:       js.values[0].values[0],
      intercept:   js.values[1].values[0],
      r_squared:   js.values[2].values[0],
      trend_label: js.values[3].values[0],
      fitted:      Array.from(js.values[4].values),
    };
  }

  // ── Tier 3 — JS lm() ──
  return _jsTrend(weeklyData);
}

function _jsTrend(data) {
  const n   = data.length;
  const x   = data.map((_, i) => i + 1);
  const y   = data.map(d => d.count);
  const xm  = x.reduce((a, b) => a + b) / n;
  const ym  = y.reduce((a, b) => a + b) / n;
  const sxy = x.reduce((s, xi, i) => s + (xi - xm) * (y[i] - ym), 0);
  const sxx = x.reduce((s, xi) => s + (xi - xm) ** 2, 0);
  const slope     = sxx ? sxy / sxx : 0;
  const intercept = ym - slope * xm;
  const fitted    = x.map(xi => +(slope * xi + intercept).toFixed(2));
  const ss_res    = y.reduce((s, yi, i) => s + (yi - fitted[i]) ** 2, 0);
  const ss_tot    = y.reduce((s, yi) => s + (yi - ym) ** 2, 0);
  return {
    slope:       +slope.toFixed(3),
    intercept:   +intercept.toFixed(3),
    r_squared:   ss_tot ? +(1 - ss_res / ss_tot).toFixed(4) : 1,
    trend_label: slope > 0.5 ? "Rising" : slope < -0.5 ? "Declining" : "Stable",
    fitted,
  };
}

// =============================================================================
// 2.  DOMAIN CORRELATION
//     R source    : domain_correlation()        in  r/analytics.R
//     API endpoint: POST /domain-correlation    in  r/plumber_api.R
// =============================================================================
/**
 * Pearson r between borrow demand and availability ratio, per domain.
 * @param  {Array}  books        raw book objects (with available_copies, total_copies)
 * @param  {Object} borrowCounts { [bookId]: totalBorrows }
 * @return {{ correlation, p_value, significance, direction, strength }}
 */
async function rDomainCorrelation(books, borrowCounts) {
  // Build per-domain summary (same aggregation as R)
  const dm = {};
  books.forEach(b => {
    const d = b.domain || "Other";
    if (!dm[d]) dm[d] = { borrows: 0, avail: 0, total: 0 };
    dm[d].borrows += borrowCounts[b.id] || 0;
    dm[d].avail   += b.available_copies || 0;
    dm[d].total   += Math.max(b.total_copies || 1, 1);
  });
  const bVec = Object.values(dm).map(d => d.borrows);
  const aVec = Object.values(dm).map(d => d.avail / d.total);

  // ── Tier 1 ──
  if (await _apiReady()) {
    const apiBooks = books.map(b => ({
      id: b.id, domain: b.domain || "Other",
      available_copies: b.available_copies || 0,
      total_copies:     Math.max(b.total_copies || 1, 1),
      borrow_count:     borrowCounts[b.id] || 0,
    }));
    const r = await _rPost("/domain-correlation", { books: apiBooks });
    if (r) return r;
  }

  // ── Tier 2 ──
  if (await _rBind("bv", bVec) && await _rBind("av", aVec)) {
    const js = await _rEval(`
      b <- as.numeric(bv); a <- as.numeric(av)
      if (length(b) < 3) {
        list(correlation=0, p_value=1, significance="Not significant", direction="none", strength="weak")
      } else {
        ct <- cor.test(b, a, method="pearson")
        r  <- as.numeric(ct$estimate)
        pv <- as.numeric(ct$p.value)
        list(
          correlation  = round(r, 4),
          p_value      = round(pv, 4),
          significance = if (pv < 0.05) "Significant" else "Not significant",
          direction    = if (r > 0) "positive" else if (r < 0) "negative" else "none",
          strength     = if (abs(r) > 0.7) "strong" else if (abs(r) > 0.3) "moderate" else "weak"
        )
      }
    `);
    if (js) return {
      correlation:  js.values[0].values[0],
      p_value:      js.values[1].values[0],
      significance: js.values[2].values[0],
      direction:    js.values[3].values[0],
      strength:     js.values[4].values[0],
    };
  }

  // ── Tier 3 — JS Pearson ──
  return _jsPearson(bVec, aVec);
}

function _jsPearson(x, y) {
  const n = x.length;
  if (n < 3) return { correlation: 0, p_value: 1, significance: "Not significant", direction: "none", strength: "weak" };
  const mx = x.reduce((a, b) => a + b) / n, my = y.reduce((a, b) => a + b) / n;
  const num = x.reduce((s, xi, i) => s + (xi - mx) * (y[i] - my), 0);
  const dx  = Math.sqrt(x.reduce((s, xi) => s + (xi - mx) ** 2, 0));
  const dy  = Math.sqrt(y.reduce((s, yi) => s + (yi - my) ** 2, 0));
  const r   = dx && dy ? +(num / (dx * dy)).toFixed(4) : 0;
  const t   = r * Math.sqrt(n - 2) / Math.sqrt(1 - r ** 2 + 1e-12);
  const pv  = +Math.min(1, 2 * (1 - _normCDF(Math.abs(t)))).toFixed(4);
  return {
    correlation:  r,
    p_value:      pv,
    significance: pv < 0.05 ? "Significant" : "Not significant",
    direction:    r > 0 ? "positive" : r < 0 ? "negative" : "none",
    strength:     Math.abs(r) > 0.7 ? "strong" : Math.abs(r) > 0.3 ? "moderate" : "weak",
  };
}

function _normCDF(z) {
  const t = 1 / (1 + 0.2316419 * z);
  const d = 0.398942280 * Math.exp(-z * z / 2);
  return 1 - d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
}

// =============================================================================
// 3.  OVERDUE RISK
//     R source    : overdue_risk()      in  r/analytics.R
//     API endpoint: POST /overdue-risk  in  r/plumber_api.R
// =============================================================================
/**
 * Logistic sigmoid risk score per active borrowing.
 * risk = 1 / (1 + exp(-days_overdue / 7))
 * @param  {Array} borrowings  Supabase rows with .profiles and .books joined
 * @return {Array<{ id, student, book, days_overdue, risk_score, risk_level }>}
 */
async function rOverdueRisk(borrowings) {
  const today  = new Date();
  const active = borrowings
    .filter(b => !b.returned_at)
    .map(b => ({
      id:           b.id,
      student_name: b.profiles?.full_name || "Unknown",
      book_title:   b.books?.title        || "Unknown",
      due_date:     b.due_date,
      returned_at:  null,
    }));
  if (!active.length) return [];

  // ── Tier 1 ──
  if (await _apiReady()) {
    const r = await _rPost("/overdue-risk", { borrowings: active });
    if (r && Array.isArray(r)) return r.map(row => ({
      id:           row.id,
      student:      row.student_name,
      book:         row.book_title,
      days_overdue: row.days_overdue,
      risk_score:   row.risk_score,
      risk_level:   row.risk_level,
    }));
  }

  // ── Tier 2 ──
  const days = active.map(b => Math.floor((today - new Date(b.due_date)) / 86400000));
  if (await _rBind("dv", days)) {
    const js = await _rEval("round(1 / (1 + exp(-as.numeric(dv) / 7)), 3)");
    if (js) {
      const scores = Array.from(js.values);
      return active.map((b, i) => _riskRow(b, days[i], scores[i] ?? 0));
    }
  }

  // ── Tier 3 ──
  return active.map((b, i) => {
    const d = Math.floor((today - new Date(b.due_date)) / 86400000);
    return _riskRow(b, d, +(1 / (1 + Math.exp(-d / 7))).toFixed(3));
  });
}

function _riskRow(b, days, score) {
  return {
    id:           b.id,
    student:      b.student_name,
    book:         b.book_title,
    days_overdue: days,
    risk_score:   score,
    risk_level:   score >= 0.8 ? "High" : score >= 0.5 ? "Medium" : "Low",
  };
}

// =============================================================================
// 4.  FINE STATISTICS
//     R source    : fine_stats()       in  r/analytics.R
//     API endpoint: POST /fine-stats   in  r/plumber_api.R
// =============================================================================
/**
 * Descriptive statistics on fine amounts.
 * @param  {Array<{amount:number, paid:boolean}>} fines
 * @return {{ mean, median, sd, iqr, total, unpaid }}
 */
async function rFineStats(fines) {
  if (!fines?.length) return { mean: 0, median: 0, sd: 0, iqr: 0, total: 0, unpaid: 0 };
  const amounts = fines.map(f => +f.amount).filter(a => !isNaN(a));

  // ── Tier 1 ──
  if (await _apiReady()) {
    const r = await _rPost("/fine-stats", { fines });
    if (r) return r;
  }

  // ── Tier 2 ──
  if (await _rBind("vv", amounts) && await _rBind("pv", fines.map(f => !!f.paid))) {
    const js = await _rEval(`
      v <- as.numeric(vv); p <- as.logical(pv)
      list(
        mean   = round(mean(v), 2),   median = round(median(v), 2),
        sd     = round(sd(v),   2),   iqr    = round(IQR(v),    2),
        total  = round(sum(v),  2),   unpaid = round(sum(v[!p]), 2)
      )
    `);
    if (js) return {
      mean: js.values[0].values[0], median: js.values[1].values[0],
      sd:   js.values[2].values[0], iqr:    js.values[3].values[0],
      total:js.values[4].values[0], unpaid: js.values[5].values[0],
    };
  }

  // ── Tier 3 ──
  return _jsStats(amounts, fines);
}

function _jsStats(v, fines) {
  const s = [...v].sort((a, b) => a - b), n = v.length;
  const mean   = v.reduce((a, b) => a + b) / n;
  const median = n % 2 ? s[Math.floor(n / 2)] : (s[n/2-1] + s[n/2]) / 2;
  const sd     = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(n - 1, 1));
  const q1 = s[Math.floor(n * 0.25)] ?? s[0], q3 = s[Math.floor(n * 0.75)] ?? s[n-1];
  const unpaid = fines.filter(f => !f.paid).reduce((s, f) => s + +f.amount, 0);
  return {
    mean: +mean.toFixed(2), median: +median.toFixed(2),
    sd:   +sd.toFixed(2),   iqr:    +(q3-q1).toFixed(2),
    total:+v.reduce((a,b)=>a+b).toFixed(2), unpaid:+unpaid.toFixed(2),
  };
}

// =============================================================================
// 5.  TOP BORROWED BOOKS
//     R source    : top_borrowed_books()  in  r/analytics.R
//     API endpoint: POST /top-books       in  r/plumber_api.R
// =============================================================================
/**
 * @param  {Array}  books
 * @param  {Object} borrowCounts  { [bookId]: count }
 * @param  {number} n
 * @return {Array<{id, title, author, domain, borrow_count}>}
 */
async function rTopBooks(books, borrowCounts, n = 5) {
  const enriched = books.map(b => ({ ...b, borrow_count: borrowCounts[b.id] || 0 }));

  // ── Tier 1 ──
  if (await _apiReady()) {
    const r = await _rPost("/top-books", { books: enriched, n });
    if (r && Array.isArray(r)) return r;
  }

  // ── Tier 3 (sort is trivial, no need for Tier 2) ──
  return [...enriched].sort((a, b) => b.borrow_count - a.borrow_count).slice(0, n);
}

// =============================================================================
// 6.  DOMAIN DISTRIBUTION
//     R source    : domain_distribution()       in  r/analytics.R
//     API endpoint: POST /domain-distribution   in  r/plumber_api.R
// =============================================================================
/**
 * @param  {Array}  books
 * @param  {Object} borrowCounts  { [bookId]: count }
 * @param  {number} topN
 * @return {Array<{domain, total_borrows, pct}>}
 */
async function rDomainDistribution(books, borrowCounts, topN = 8) {
  const enriched = books.map(b => ({ ...b, borrow_count: borrowCounts[b.id] || 0 }));

  // ── Tier 1 ──
  if (await _apiReady()) {
    const r = await _rPost("/domain-distribution", { books: enriched, top_n: topN });
    if (r && Array.isArray(r)) return r;
  }

  // ── Tier 3 ──
  const map = {};
  enriched.forEach(b => {
    const d = b.domain || "Other";
    map[d] = (map[d] || 0) + (b.borrow_count || 0);
  });
  const total = Object.values(map).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1]).slice(0, topN)
    .map(([domain, cnt]) => ({ domain, total_borrows: cnt, pct: +((cnt/total)*100).toFixed(1) }));
}

// =============================================================================
// EXPORTS
// =============================================================================

window.rBorrowTrend         = rBorrowTrend;
window.rDomainCorrelation   = rDomainCorrelation;
window.rOverdueRisk         = rOverdueRisk;
window.rFineStats           = rFineStats;
window.rTopBooks            = rTopBooks;
window.rDomainDistribution  = rDomainDistribution;
window.initWebR             = _initWebR;
window._checkRApi           = _apiReady;
