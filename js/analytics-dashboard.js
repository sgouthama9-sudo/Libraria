/**
 * js/analytics-dashboard.js  —  Libraria Admin Analytics Dashboard
 * =================================================================
 *
 * Renders every panel on the Analytics tab in admin.html.
 * All statistics come from  js/analytics-r.js  which connects to:
 *   → r/analytics.R  (via r/plumber_api.R REST server, or WebR, or JS fallback)
 *
 * PANELS RENDERED
 * ───────────────
 *  KPI cards        stat-books, stat-students, stat-active, stat-pending
 *  Trend chart      weekly borrow bars + R regression line  (rBorrowTrend)
 *  Status doughnut  Active / Returned / Pending split
 *  Domain polar     borrowings per subject domain            (rDomainDistribution)
 *  Top books bar    top 5 most borrowed                      (rTopBooks)
 *  Correlation card Pearson r demand vs supply               (rDomainCorrelation)
 *  Fine bar         mean / median / sd / IQR                 (rFineStats)
 *  Overdue table    risk score per active borrowing          (rOverdueRisk)
 *  Recommendations  Python hybrid / content / collab panel
 *  Recent activity  last 8 borrow events
 */

"use strict";

let _charts = {};

function _destroyChart(id) {
  if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
}

// =============================================================================
// KPI stat cards
// =============================================================================
function _setKPI(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? 0;
}

// =============================================================================
// Weekly borrow trend  +  R regression line
// Uses: rBorrowTrend() from analytics-r.js  ←→ borrow_trend() in analytics.R
// =============================================================================
async function renderTrendChart(borrowings) {
  _destroyChart("trend-chart");
  const ctx = document.getElementById("trend-chart");
  if (!ctx) return;

  // Bucket by ISO-like week label
  const wm = {};
  borrowings.forEach(b => {
    const d  = new Date(b.borrowed_at);
    const wn = Math.ceil((d.getDate() + new Date(d.getFullYear(), d.getMonth(), 1).getDay()) / 7);
    const lbl = `${d.getFullYear()}-W${String(wn).padStart(2, "0")}`;
    wm[lbl] = (wm[lbl] || 0) + 1;
  });
  const weeks      = Object.keys(wm).sort().slice(-12);
  const counts     = weeks.map(w => wm[w] || 0);
  const weeklyData = weeks.map((w, i) => ({ week: w, count: counts[i] }));

  // Call R (API → WebR → JS fallback)
  const trend     = await rBorrowTrend(weeklyData);
  const trendLine = trend.fitted?.length
    ? trend.fitted.slice(-weeks.length)
    : weeks.map((_, i) => +(trend.intercept + trend.slope * (i + 1)).toFixed(1));

  // Update trend badge
  const badge = document.getElementById("trend-badge");
  if (badge) {
    const col = trend.trend_label === "Rising" ? "#00A878"
              : trend.trend_label === "Declining" ? "#e84545" : "#F0A500";
    const arrow = trend.trend_label === "Rising" ? "▲" : trend.trend_label === "Declining" ? "▼" : "→";
    badge.innerHTML = `
      <span class="trend-pill" style="background:${col}20;color:${col};border:1px solid ${col}40">
        ${arrow} ${trend.trend_label}
      </span>
      <span class="trend-stat">
        R² = ${trend.r_squared} &nbsp;|&nbsp; slope = ${trend.slope > 0 ? "+" : ""}${trend.slope}
      </span>`;
  }

  _charts["trend-chart"] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: weeks,
      datasets: [
        {
          label: "Borrows / week",
          data: counts,
          backgroundColor: "rgba(141,114,254,0.55)",
          borderColor: "#8D72FE",
          borderWidth: 1,
          borderRadius: 4,
        },
        {
          label: "R regression line",
          data: trendLine,
          type: "line",
          borderColor: "#F0A500",
          borderWidth: 2,
          borderDash: [5, 3],
          pointRadius: 0,
          fill: false,
          tension: 0.1,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: "bottom" }, tooltip: { mode: "index" } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } },
        x: { ticks: { maxTicksLimit: 8 } },
      },
    },
  });
}

// =============================================================================
// Domain polar area chart
// Uses: rDomainDistribution() from analytics-r.js  ←→ domain_distribution() in analytics.R
// =============================================================================
async function renderDomainChart(books, borrowCounts) {
  _destroyChart("domain-chart");
  const ctx = document.getElementById("domain-chart");
  if (!ctx) return;

  const dist    = await rDomainDistribution(books, borrowCounts, 8);
  const palette = ["#8D72FE","#00A878","#F0A500","#4F7CAC","#B8907A","#A8B5A0","#e84545","#5c6ac4"];

  _charts["domain-chart"] = new Chart(ctx, {
    type: "polarArea",
    data: {
      labels: dist.map(d => d.domain),
      datasets: [{
        data: dist.map(d => d.total_borrows),
        backgroundColor: palette.map(c => c + "aa"),
        borderColor: palette,
        borderWidth: 1.5,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: "right", labels: { font: { size: 11 } } } },
    },
  });
}

// =============================================================================
// Borrow status doughnut  (Active / Returned / Pending)
// =============================================================================
function renderStatusChart(active, returned, pending) {
  _destroyChart("status-chart");
  const ctx = document.getElementById("status-chart");
  if (!ctx) return;
  const total = active + returned + pending || 1;

  _charts["status-chart"] = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Active", "Returned", "Pending"],
      datasets: [{
        data: [active, returned, pending],
        backgroundColor: ["#00A878","#4F7CAC","#F0A500"],
        borderWidth: 2,
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      cutout: "65%",
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: c => ` ${c.label}: ${c.parsed} (${((c.parsed / total) * 100).toFixed(1)}%)`,
          },
        },
      },
    },
  });
}

// =============================================================================
// Top 5 books horizontal bar chart
// Uses: rTopBooks() from analytics-r.js  ←→ top_borrowed_books() in analytics.R
// =============================================================================
async function renderTopBooksChart(books, borrowCounts) {
  _destroyChart("top-books-chart");
  const ctx = document.getElementById("top-books-chart");
  if (!ctx) return;

  const top = await rTopBooks(books, borrowCounts, 5);

  _charts["top-books-chart"] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: top.map(b => b.title?.length > 20 ? b.title.slice(0, 18) + "…" : b.title),
      datasets: [{
        label: "Total borrows",
        data:  top.map(b => b.borrow_count),
        backgroundColor: ["#8D72FEcc","#00A878cc","#F0A500cc","#4F7CACcc","#B8907Acc"],
        borderRadius: 6,
        borderWidth: 0,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

// =============================================================================
// Fine statistics bar chart
// Uses: rFineStats() from analytics-r.js  ←→ fine_stats() in analytics.R
// =============================================================================
function renderFineChart(fs) {
  _destroyChart("fine-chart");
  const ctx = document.getElementById("fine-chart");
  if (!ctx) return;

  _charts["fine-chart"] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Mean ₹", "Median ₹", "Std Dev ₹", "IQR ₹"],
      datasets: [{
        label: "Fine distribution (R stats)",
        data: [fs.mean, fs.median, fs.sd, fs.iqr],
        backgroundColor: ["#8D72FE88","#00A87888","#F0A50088","#B8907A88"],
        borderColor:     ["#8D72FE",  "#00A878",  "#F0A500",  "#B8907A"],
        borderWidth: 2,
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } },
    },
  });
}

// =============================================================================
// Overdue risk table
// Uses: rOverdueRisk() from analytics-r.js  ←→ overdue_risk() in analytics.R
// =============================================================================
function renderOverdueTable(rows) {
  const box = document.getElementById("overdue-risk-table");
  if (!box) return;
  if (!rows?.length) {
    box.innerHTML = `<p class="text-soft">No active overdue borrowings.</p>`;
    return;
  }
  const sorted = [...rows].sort((a, b) => b.risk_score - a.risk_score);
  box.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Student</th><th>Book</th><th>Days overdue</th>
          <th>Risk score (R)</th><th>Level</th>
        </tr>
      </thead>
      <tbody>
        ${sorted.map(r => {
          const pct   = Math.round(r.risk_score * 100);
          const col   = pct >= 80 ? "#e84545" : pct >= 50 ? "#F0A500" : "#00A878";
          const level = pct >= 80 ? "High"    : pct >= 50 ? "Medium"  : "Low";
          return `<tr>
            <td>${r.student}</td>
            <td>${r.book}</td>
            <td>${r.days_overdue > 0 ? r.days_overdue : "Due today"}</td>
            <td>
              <div class="risk-bar-wrap">
                <div class="risk-bar" style="width:${pct}%;background:${col}"></div>
                <span>${pct}%</span>
              </div>
            </td>
            <td>
              <span class="badge"
                style="background:${col}22;color:${col};border:1px solid ${col}44">
                ${level}
              </span>
            </td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;
}

// =============================================================================
// Correlation card
// Uses: rDomainCorrelation() from analytics-r.js  ←→ domain_correlation() in analytics.R
// =============================================================================
function renderCorrCard(corr) {
  const el = document.getElementById("corr-badge");
  if (!el) return;
  const c   = corr.correlation;
  const col = c > 0 ? "#00A878" : "#e84545";
  el.innerHTML = `
    <div class="corr-card">
      <div class="corr-val" style="color:${col}">${c > 0 ? "+" : ""}${c.toFixed(3)}</div>
      <div class="corr-label">Pearson r — borrow demand vs availability ratio</div>
      <div class="corr-sub">
        ${corr.strength} ${corr.direction} correlation &nbsp;·&nbsp;
        <em>${corr.significance}</em> (p&nbsp;=&nbsp;${corr.p_value})
      </div>
    </div>`;
}

// =============================================================================
// Python recommendations panel
// Uses: pyHybridRecommend / pyContentRecommend / pyCollabRecommend
//       from  js/recommendations-py.js
// =============================================================================
async function renderRecommendationsPanel(books, borrowHistory, students) {
  const box = document.getElementById("recommendations-panel");
  if (!box) return;

  box.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p class="text-soft mt-2">Python engine loading…</p>
    </div>`;

  await initPyodide();

  const activity = {};
  borrowHistory.forEach(b => { activity[b.user_id] = (activity[b.user_id] || 0) + 1; });
  const topStudents = students
    .filter(s => activity[s.id])
    .sort((a, b) => (activity[b.id] || 0) - (activity[a.id] || 0))
    .slice(0, 5);

  if (!topStudents.length) {
    box.innerHTML = `<p class="text-soft">Not enough borrowing data for recommendations.</p>`;
    return;
  }

  box.innerHTML = `
    <div class="rec-tabs">
      <button class="rec-tab-btn active" data-mode="hybrid">🤖 Hybrid</button>
      <button class="rec-tab-btn"        data-mode="content">📖 Content-based</button>
      <button class="rec-tab-btn"        data-mode="collab">👥 Collaborative</button>
    </div>
    <div class="rec-student-row">
      ${topStudents.map((s, i) =>
        `<button class="rec-student-btn ${i === 0 ? "active" : ""}"
          data-uid="${s.id}">${s.full_name || "Student"}</button>`
      ).join("")}
    </div>
    <div id="rec-results" class="rec-results-grid"></div>
    <div class="rec-engine-badge">
      ⚙️ Python (Pyodide) · TF-IDF cosine similarity + domain collaborative filtering
    </div>`;

  async function loadRecs() {
    const mode    = box.querySelector(".rec-tab-btn.active")?.dataset.mode || "hybrid";
    const userId  = box.querySelector(".rec-student-btn.active")?.dataset.uid;
    const grid    = document.getElementById("rec-results");
    if (!grid) return;

    grid.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

    const hist     = borrowHistory.filter(b => b.user_id === userId);
    const lastBook = hist[hist.length - 1]?.book_id || null;

    let recs = [];
    if (mode === "hybrid")  recs = await pyHybridRecommend(books, borrowHistory, userId, lastBook, 6);
    if (mode === "content") recs = lastBook ? await pyContentRecommend(books, lastBook, 6) : [];
    if (mode === "collab")  recs = await pyCollabRecommend(books, borrowHistory, userId, 6);

    if (!recs?.length) {
      grid.innerHTML = `<p class="text-soft">No recommendations available.</p>`;
      return;
    }
    grid.innerHTML = recs.map(b => `
      <div class="rec-book-card">
        ${b.cover_url
          ? `<img src="${b.cover_url}" alt="" class="rec-cover">`
          : `<div class="rec-cover-placeholder">${(b.title || "?")[0]}</div>`}
        <div class="rec-book-info">
          <div class="rec-book-title">${b.title || "Untitled"}</div>
          <div class="rec-book-meta">${b.author || "Unknown"}</div>
          <span class="badge badge-sand" style="font-size:.72rem">${b.domain || ""}</span>
        </div>
      </div>`).join("");
  }

  box.querySelectorAll(".rec-tab-btn").forEach(btn =>
    btn.addEventListener("click", () => {
      box.querySelectorAll(".rec-tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      loadRecs();
    })
  );
  box.querySelectorAll(".rec-student-btn").forEach(btn =>
    btn.addEventListener("click", () => {
      box.querySelectorAll(".rec-student-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      loadRecs();
    })
  );

  loadRecs();
}

// =============================================================================
// MAIN LOADER  —  called by admin.js when the Analytics tab is activated
// =============================================================================
async function loadAnalyticsDashboard() {
  const tab = document.getElementById("tab-analytics");
  if (!tab) return;

  const loader = document.getElementById("r-loading-badge");
  if (loader) loader.style.display = "flex";

  // ── KPI counts ─────────────────────────────────────────────────────────────
  const [
    { count: totalBooks },
    { count: totalStudents },
    { count: activeBorrows },
    { count: pendingCount },
    { count: totalBorrowings },
  ] = await Promise.all([
    sb.from("books")         .select("*", { count: "exact", head: true }),
    sb.from("profiles")      .select("*", { count: "exact", head: true }),
    sb.from("borrowings")    .select("*", { count: "exact", head: true }).is("returned_at", null),
    sb.from("borrow_requests").select("*", { count: "exact", head: true }).eq("status", "pending"),
    sb.from("borrowings")    .select("*", { count: "exact", head: true }),
  ]);

  _setKPI("stat-books",    totalBooks);
  _setKPI("stat-students", totalStudents);
  _setKPI("stat-active",   activeBorrows);
  _setKPI("stat-pending",  pendingCount);

  const returned = (totalBorrowings || 0) - (activeBorrows || 0);

  // ── Detailed data ───────────────────────────────────────────────────────────
  const [
    { data: allBorrowings },
    { data: allBooks },
    { data: allFines },
    { data: allStudents },
  ] = await Promise.all([
    sb.from("borrowings").select("*, books(id,title,domain), profiles(full_name,student_id)")
      .order("borrowed_at", { ascending: false }),
    sb.from("books").select("*, borrowings(count)"),
    sb.from("fines").select("*"),
    sb.from("profiles").select("*"),
  ]);

  const borrowCounts = {};
  (allBooks || []).forEach(b => { borrowCounts[b.id] = b.borrowings?.length || 0; });

  // ── Charts ──────────────────────────────────────────────────────────────────
  renderStatusChart(activeBorrows || 0, returned, pendingCount || 0);
  await renderDomainChart(allBooks || [], borrowCounts);
  await renderTopBooksChart(allBooks || [], borrowCounts);
  await renderTrendChart(allBorrowings || []);

  // ── R analytics ─────────────────────────────────────────────────────────────
  const riskRows = await rOverdueRisk(allBorrowings || []);
  renderOverdueTable(riskRows);

  const corrData = await rDomainCorrelation(allBooks || [], borrowCounts);
  renderCorrCard(corrData);

  const fineStats = await rFineStats(allFines || []);
  renderFineChart(fineStats);

  const fineBox = document.getElementById("fine-total-badge");
  if (fineBox) {
    fineBox.innerHTML = `
      <strong>Total fines collected: ₹${fineStats.total}</strong>
      &nbsp;·&nbsp; Unpaid: ₹${fineStats.unpaid}<br>
      <span class="text-soft">
        Mean ₹${fineStats.mean} &nbsp;|&nbsp;
        Median ₹${fineStats.median} &nbsp;|&nbsp;
        σ ₹${fineStats.sd}
      </span>`;
  }

  // ── Python recommendations ──────────────────────────────────────────────────
  const borrowHistory = (allBorrowings || []).map(b => ({
    book_id: b.book_id, user_id: b.user_id,
  }));
  await renderRecommendationsPanel(allBooks || [], borrowHistory, allStudents || []);

  // ── Recent activity ──────────────────────────────────────────────────────────
  const actBox = document.getElementById("recent-activity");
  if (actBox) {
    actBox.innerHTML = (allBorrowings || []).slice(0, 8).map(r => `
      <div class="review-item">
        <div class="header">
          <span class="author">${r.profiles?.full_name || "Student"}</span>
          <span class="date">${fmtDate(r.borrowed_at)}</span>
        </div>
        <p>Borrowed <strong>${r.books?.title || ""}</strong></p>
      </div>`).join("") || `<p class="text-soft">No recent activity</p>`;
  }

  if (loader) loader.style.display = "none";
}

window.loadAnalyticsDashboard = loadAnalyticsDashboard;
