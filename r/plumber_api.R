# =============================================================================
# plumber_api.R  —  Libraria R Analytics REST API
# =============================================================================
#
# PURPOSE
#   Turns every function in analytics.R into an HTTP endpoint.
#   analytics-r.js (the browser bridge) calls these endpoints first;
#   if the server is not running it falls back to its own JS math.
#
# START SERVER
#   cd Libriaria-enhanced
#   Rscript r/plumber_api.R
#   → http://localhost:8080
#
# ENDPOINTS
#   GET  /health                 → { status, r_version, timestamp }
#   POST /borrow-trend           → { slope, intercept, r_squared, trend_label, fitted }
#   POST /domain-correlation     → { correlation, p_value, significance, direction, strength }
#   POST /overdue-risk           → [{ id, student_name, book_title, days_overdue, risk_score, risk_level }]
#   POST /fine-stats             → { mean, median, sd, iqr, total, unpaid }
#   POST /top-books              → [{ id, title, author, domain, borrow_count }]
#   POST /domain-distribution    → [{ domain, total_borrows, pct }]
#   POST /monthly-trend          → [{ month, count }]
#
# HOW IT CONNECTS TO THE DASHBOARD
#   analytics.R (pure R functions)
#       └─── sourced by ──► plumber_api.R (HTTP server)
#                                └─── called by ──► js/analytics-r.js (browser bridge)
#                                                        └─── feeds ──► analytics-dashboard.js
#
# DEPENDENCIES
#   install.packages(c("plumber", "dplyr", "lubridate", "jsonlite"))
# =============================================================================

# ── Resolve analytics.R path regardless of how this script is invoked ────────
`%||%` <- function(a, b) if (!is.null(a) && length(a) > 0 && !is.na(a)) a else b

.this_file <- tryCatch({
  args <- commandArgs(trailingOnly = FALSE)
  flag <- args[grepl("^--file=", args)]
  if (length(flag)) normalizePath(sub("^--file=", "", flag[1]))
  else normalizePath(sys.frame(1)$ofile)
}, error = function(e) NULL)

.analytics_path <- if (!is.null(.this_file)) {
  file.path(dirname(.this_file), "analytics.R")
} else {
  "r/analytics.R"   # fallback when sourced interactively from project root
}

source(.analytics_path, local = FALSE)
cat(sprintf("✅ Sourced: %s\n", .analytics_path))

library(plumber)
library(jsonlite)

# =============================================================================
# Helper: parse JSON body safely
# =============================================================================
.body <- function(req) fromJSON(req$postBody, simplifyDataFrame = TRUE)

# =============================================================================
# Plumber API definition
# (plumb_api() reads this file's roxygen-style #* annotations at runtime)
# =============================================================================

#* @apiTitle    Libraria Analytics API
#* @apiDescription  R-powered statistics for the admin analytics dashboard.

#* Allow cross-origin requests from the browser dev server
#* @filter cors
function(req, res) {
  res$setHeader("Access-Control-Allow-Origin",  "*")
  res$setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res$setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (identical(req$REQUEST_METHOD, "OPTIONS")) {
    res$status <- 200
    return(list())
  }
  plumber::forward()
}

# ── GET /health ───────────────────────────────────────────────────────────────
#* Health check — confirms the R server is reachable
#* @get /health
#* @serializer json list(auto_unbox=TRUE)
function() {
  list(
    status    = "ok",
    r_version = paste(R.version$major, R.version$minor, sep = "."),
    timestamp = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")
  )
}

# ── POST /borrow-trend ────────────────────────────────────────────────────────
#* Linear regression on weekly borrow counts
#* Body: { "weekly": [{"week":"2025-W01","count":5}, …] }
#* @post /borrow-trend
#* @serializer json list(auto_unbox=TRUE)
function(req) {
  b            <- .body(req)
  weekly       <- as.data.frame(b$weekly)
  weekly$count <- as.numeric(weekly$count)
  borrow_trend(weekly)
}

# ── POST /domain-correlation ──────────────────────────────────────────────────
#* Pearson correlation: borrow demand vs availability ratio
#* Body: { "books": [{"domain":"CS","available_copies":2,"total_copies":5,"borrow_count":12}, …] }
#* @post /domain-correlation
#* @serializer json list(auto_unbox=TRUE)
function(req) {
  b                      <- .body(req)
  books                  <- as.data.frame(b$books)
  books$available_copies <- as.numeric(books$available_copies)
  books$total_copies     <- as.numeric(books$total_copies)
  books$borrow_count     <- as.numeric(books$borrow_count)
  domain_correlation(books)
}

# ── POST /overdue-risk ────────────────────────────────────────────────────────
#* Logistic sigmoid risk score for every active borrowing
#* Body: { "borrowings": [{"id":"br1","student_name":"Alice","book_title":"Clean Code","due_date":"2025-05-01","returned_at":null}, …] }
#* @post /overdue-risk
#* @serializer json list(auto_unbox=TRUE, na="null", dataframe="rows")
function(req) {
  b  <- .body(req)
  df <- as.data.frame(b$borrowings)
  if (!"returned_at" %in% names(df)) df$returned_at <- NA_character_
  overdue_risk(df)
}

# ── POST /fine-stats ──────────────────────────────────────────────────────────
#* Descriptive statistics on fine amounts
#* Body: { "fines": [{"amount":25,"paid":false}, …] }
#* @post /fine-stats
#* @serializer json list(auto_unbox=TRUE)
function(req) {
  b            <- .body(req)
  fines        <- as.data.frame(b$fines)
  fines$amount <- as.numeric(fines$amount)
  if ("paid" %in% names(fines)) fines$paid <- as.logical(fines$paid)
  fine_stats(fines)
}

# ── POST /top-books ───────────────────────────────────────────────────────────
#* Top N most-borrowed books
#* Body: { "books": [{…}], "n": 5 }
#* @post /top-books
#* @serializer json list(auto_unbox=TRUE, na="null", dataframe="rows")
function(req) {
  b                  <- .body(req)
  books              <- as.data.frame(b$books)
  books$borrow_count <- as.numeric(books$borrow_count)
  n                  <- as.integer(b$n %||% 5L)
  top_borrowed_books(books, n = n)
}

# ── POST /domain-distribution ─────────────────────────────────────────────────
#* Borrow counts aggregated per domain
#* Body: { "books": [{…}], "top_n": 8 }
#* @post /domain-distribution
#* @serializer json list(auto_unbox=TRUE, na="null", dataframe="rows")
function(req) {
  b                  <- .body(req)
  books              <- as.data.frame(b$books)
  books$borrow_count <- as.numeric(books$borrow_count)
  top_n              <- as.integer(b$top_n %||% 8L)
  domain_distribution(books, top_n = top_n)
}

# ── POST /monthly-trend ───────────────────────────────────────────────────────
#* Monthly borrow counts for the full history view
#* Body: { "borrowings": [{"borrowed_at":"2025-03-15T10:00:00Z"}, …] }
#* @post /monthly-trend
#* @serializer json list(auto_unbox=TRUE, na="null", dataframe="rows")
function(req) {
  b          <- .body(req)
  borrowings <- as.data.frame(b$borrowings)
  monthly_trend(borrowings)
}

# =============================================================================
# Entry point — only executes when run directly via Rscript
# =============================================================================
if (!interactive()) {
  port <- as.integer(Sys.getenv("LIBRARIA_R_PORT", unset = "8080"))

  cat("\n╔══════════════════════════════════════════════════════╗\n")
  cat("║  Libraria R Analytics API                           ║\n")
  cat(sprintf("║  http://localhost:%-33d║\n", port))
  cat("╠══════════════════════════════════════════════════════╣\n")
  cat("║  GET  /health                                        ║\n")
  cat("║  POST /borrow-trend        lm() regression          ║\n")
  cat("║  POST /domain-correlation  Pearson r + t-test       ║\n")
  cat("║  POST /overdue-risk        logistic sigmoid         ║\n")
  cat("║  POST /fine-stats          mean/median/sd/IQR       ║\n")
  cat("║  POST /top-books           ranked by borrows        ║\n")
  cat("║  POST /domain-distribution borrows per domain       ║\n")
  cat("║  POST /monthly-trend       monthly counts           ║\n")
  cat("╚══════════════════════════════════════════════════════╝\n\n")

  pr <- plumb(file = .this_file)
  pr$run(host = "127.0.0.1", port = port)
}
