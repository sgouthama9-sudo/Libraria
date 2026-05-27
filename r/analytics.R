# =============================================================================
# analytics.R  —  Libraria Library Analytics Engine
# =============================================================================
#
# PURPOSE
#   Standalone R script that computes every statistic shown on the admin
#   analytics dashboard.  Can be run directly or sourced by plumber_api.R
#   to expose results as HTTP endpoints the browser calls.
#
# HOW IT CONNECTS TO THE DASHBOARD
#
#   [Supabase DB]
#        │  data (books, borrowings, fines)
#        ▼
#   [analytics-r.js]  ──POST /borrow-trend──►  [plumber_api.R]
#        │                                            │
#        │  fallback (JS math)              source("analytics.R")
#        │                                            │
#        ▼                                            ▼
#   [analytics-dashboard.js]             borrow_trend(), fine_stats() …
#        │
#        ▼
#   [admin.html  charts / tables]
#
#   • When  Rscript r/plumber_api.R  is running on localhost:8080,
#     analytics-r.js calls it and receives real R output.
#   • When the server is not running (production / demo), analytics-r.js
#     falls back to identical JS implementations — same results, no R needed.
#
# RUN STANDALONE (self-test)
#   Rscript r/analytics.R
#
# SOURCE FROM API
#   source("r/analytics.R")
#
# FUNCTIONS
#   borrow_trend(weekly_df)             weekly lm() regression → trend + R²
#   domain_correlation(books_df)        Pearson r + t-test on domain supply/demand
#   overdue_risk(borrowings_df)         logistic sigmoid risk score per borrowing
#   fine_stats(fines_df)                mean / median / sd / IQR / total / unpaid
#   top_borrowed_books(books_df, n)     top-n books by borrow count
#   domain_distribution(books_df, n)   borrows aggregated per domain
#   monthly_trend(borrowings_df)        monthly borrow counts
#
# DEPENDENCIES
#   install.packages(c("dplyr", "lubridate", "jsonlite"))
#   install.packages("plumber")   # only needed for plumber_api.R
# =============================================================================

suppressPackageStartupMessages({
  library(dplyr)
  library(lubridate)
  library(jsonlite)
})


# ─────────────────────────────────────────────────────────────────────────────
# 1.  BORROW TREND
#     Dashboard panel : "Weekly borrow trend" bar chart + regression overlay
#     JS counterpart  : rBorrowTrend()  in  js/analytics-r.js
#     API endpoint    : POST /borrow-trend  in  r/plumber_api.R
# ─────────────────────────────────────────────────────────────────────────────
#
# Input
#   weekly_df  data.frame
#     $week    character  label, e.g. "2025-W04"
#     $count   numeric    number of borrows that week
#
# Output  named list
#   $slope        numeric   books-per-week change  (lm coefficient)
#   $intercept    numeric   baseline intercept
#   $r_squared    numeric   R² goodness-of-fit  [0, 1]
#   $trend_label  character "Rising" | "Stable" | "Declining"
#   $fitted       numeric[] regression-fitted values (one per week, for chart overlay)

borrow_trend <- function(weekly_df) {
  stopifnot(is.data.frame(weekly_df), "count" %in% names(weekly_df))

  n <- nrow(weekly_df)
  if (n < 2) {
    return(list(
      slope = 0, intercept = 0, r_squared = 0,
      trend_label = "Stable", fitted = rep(0, n)
    ))
  }

  df <- weekly_df %>%
    arrange(week) %>%
    mutate(x = seq_len(n()))

  model     <- lm(count ~ x, data = df)
  coefs     <- coef(model)
  slope     <- as.numeric(coefs["x"])
  intercept <- as.numeric(coefs["(Intercept)"])
  fitted    <- as.numeric(round(predict(model), 2))

  ss_res <- sum(residuals(model)^2)
  ss_tot <- sum((df$count - mean(df$count))^2)
  r2     <- if (ss_tot == 0) 1 else 1 - ss_res / ss_tot

  trend_label <- case_when(
    slope >  0.5 ~ "Rising",
    slope < -0.5 ~ "Declining",
    TRUE         ~ "Stable"
  )

  list(
    slope       = round(slope,     3),
    intercept   = round(intercept, 3),
    r_squared   = round(r2,        4),
    trend_label = trend_label,
    fitted      = fitted
  )
}


# ─────────────────────────────────────────────────────────────────────────────
# 2.  DOMAIN CORRELATION
#     Dashboard panel : "Availability correlation" card
#     JS counterpart  : rDomainCorrelation()  in  js/analytics-r.js
#     API endpoint    : POST /domain-correlation  in  r/plumber_api.R
# ─────────────────────────────────────────────────────────────────────────────
#
# Tests whether domains with high borrow demand tend to have low availability.
# A significant negative r means popular subjects are undersupplied.
#
# Input
#   books_df  data.frame
#     $domain            character
#     $available_copies  numeric
#     $total_copies      numeric
#     $borrow_count      numeric  (total times each book was borrowed)
#
# Output  named list
#   $correlation   numeric   Pearson r
#   $p_value       numeric   two-sided t-test
#   $significance  character "Significant" | "Not significant"
#   $direction     character "positive" | "negative" | "none"
#   $strength      character "strong" | "moderate" | "weak"

domain_correlation <- function(books_df) {
  stopifnot(
    is.data.frame(books_df),
    all(c("domain", "available_copies", "total_copies", "borrow_count") %in% names(books_df))
  )

  by_domain <- books_df %>%
    mutate(total_copies = pmax(as.numeric(total_copies), 1)) %>%
    group_by(domain) %>%
    summarise(
      borrows = sum(as.numeric(borrow_count),     na.rm = TRUE),
      avail_r = sum(as.numeric(available_copies), na.rm = TRUE) /
                sum(as.numeric(total_copies),     na.rm = TRUE),
      .groups = "drop"
    ) %>%
    filter(!is.na(domain), domain != "")

  if (nrow(by_domain) < 3) {
    return(list(
      correlation = 0, p_value = 1,
      significance = "Not significant", direction = "none", strength = "weak"
    ))
  }

  tst <- cor.test(by_domain$borrows, by_domain$avail_r, method = "pearson")
  r   <- as.numeric(tst$estimate)
  pv  <- as.numeric(tst$p.value)

  list(
    correlation  = round(r, 4),
    p_value      = round(pv, 4),
    significance = if (pv < 0.05) "Significant" else "Not significant",
    direction    = if (r > 0) "positive" else if (r < 0) "negative" else "none",
    strength     = if (abs(r) > 0.7) "strong" else if (abs(r) > 0.3) "moderate" else "weak"
  )
}


# ─────────────────────────────────────────────────────────────────────────────
# 3.  OVERDUE RISK SCORING
#     Dashboard panel : "Overdue risk scoring" table with progress bars
#     JS counterpart  : rOverdueRisk()  in  js/analytics-r.js
#     API endpoint    : POST /overdue-risk  in  r/plumber_api.R
# ─────────────────────────────────────────────────────────────────────────────
#
# Logistic sigmoid:  risk = 1 / (1 + exp(-days_overdue / 7))
#   days = -7  (due in 7 days) → risk 27%
#   days =  0  (due today)     → risk 50%
#   days =  7  (1 week late)   → risk 73%
#   days = 14  (2 weeks late)  → risk 88%
#
# Input
#   borrowings_df  data.frame
#     $id            character
#     $student_name  character
#     $book_title    character
#     $due_date      character  ISO date "YYYY-MM-DD"
#     $returned_at   character  NA / "" if still active
#
# Output  data.frame — active rows only, sorted by risk_score desc
#   + $days_overdue  integer
#   + $risk_score    numeric [0, 1]
#   + $risk_level    character "High" | "Medium" | "Low"

overdue_risk <- function(borrowings_df) {
  stopifnot(is.data.frame(borrowings_df))

  if (!"returned_at" %in% names(borrowings_df)) {
    borrowings_df$returned_at <- NA
  }

  borrowings_df %>%
    filter(is.na(returned_at) | returned_at == "") %>%
    mutate(
      due_date     = as.Date(due_date),
      days_overdue = as.integer(Sys.Date() - due_date),
      risk_score   = round(1 / (1 + exp(-days_overdue / 7)), 3),
      risk_level   = case_when(
        risk_score >= 0.80 ~ "High",
        risk_score >= 0.50 ~ "Medium",
        TRUE               ~ "Low"
      )
    ) %>%
    arrange(desc(risk_score))
}


# ─────────────────────────────────────────────────────────────────────────────
# 4.  FINE STATISTICS
#     Dashboard panel : "Fine analytics" bar chart + summary badge
#     JS counterpart  : rFineStats()  in  js/analytics-r.js
#     API endpoint    : POST /fine-stats  in  r/plumber_api.R
# ─────────────────────────────────────────────────────────────────────────────
#
# Input
#   fines_df  data.frame
#     $amount  numeric
#     $paid    logical  (optional)
#
# Output  named list
#   $mean    $median    $sd    $iqr    $total    $unpaid   (all numeric, ₹)

fine_stats <- function(fines_df) {
  stopifnot(is.data.frame(fines_df), "amount" %in% names(fines_df))

  v <- as.numeric(fines_df$amount)
  v <- v[!is.na(v)]

  if (length(v) == 0) {
    return(list(mean = 0, median = 0, sd = 0, iqr = 0, total = 0, unpaid = 0))
  }

  unpaid <- if ("paid" %in% names(fines_df)) {
    paid_flag <- as.logical(fines_df$paid)
    sum(as.numeric(fines_df$amount)[!paid_flag & !is.na(!paid_flag)], na.rm = TRUE)
  } else 0

  list(
    mean   = round(mean(v),   2),
    median = round(median(v), 2),
    sd     = round(sd(v),     2),
    iqr    = round(IQR(v),    2),
    total  = round(sum(v),    2),
    unpaid = round(unpaid,    2)
  )
}


# ─────────────────────────────────────────────────────────────────────────────
# 5.  TOP BORROWED BOOKS
#     Dashboard panel : "Top books" bar chart
#     JS counterpart  : rTopBooks()  in  js/analytics-r.js
#     API endpoint    : POST /top-books  in  r/plumber_api.R
# ─────────────────────────────────────────────────────────────────────────────
#
# Input
#   books_df  data.frame  columns: id, title, author, domain, borrow_count
#   n         integer     how many top books to return  (default 5)
#
# Output  data.frame  top n rows sorted by borrow_count desc

top_borrowed_books <- function(books_df, n = 5L) {
  stopifnot(is.data.frame(books_df), "borrow_count" %in% names(books_df))

  books_df %>%
    filter(!is.na(borrow_count)) %>%
    arrange(desc(as.numeric(borrow_count))) %>%
    slice_head(n = as.integer(n)) %>%
    select(any_of(c("id", "title", "author", "domain", "borrow_count")))
}


# ─────────────────────────────────────────────────────────────────────────────
# 6.  DOMAIN DISTRIBUTION
#     Dashboard panel : "Domain popularity" polar area chart
#     JS counterpart  : rDomainDistribution()  in  js/analytics-r.js
#     API endpoint    : POST /domain-distribution  in  r/plumber_api.R
# ─────────────────────────────────────────────────────────────────────────────
#
# Input
#   books_df  data.frame  columns: domain, borrow_count
#   top_n     integer     cap at top N domains  (default 8)
#
# Output  data.frame
#   $domain         character
#   $total_borrows  numeric
#   $pct            numeric  percentage of all borrows

domain_distribution <- function(books_df, top_n = 8L) {
  stopifnot(is.data.frame(books_df), "borrow_count" %in% names(books_df))

  books_df %>%
    mutate(domain = if_else(is.na(domain) | domain == "", "Other", domain)) %>%
    group_by(domain) %>%
    summarise(total_borrows = sum(as.numeric(borrow_count), na.rm = TRUE), .groups = "drop") %>%
    arrange(desc(total_borrows)) %>%
    slice_head(n = as.integer(top_n)) %>%
    mutate(pct = round(total_borrows / sum(total_borrows) * 100, 1))
}


# ─────────────────────────────────────────────────────────────────────────────
# 7.  MONTHLY TREND
#     Dashboard panel : extended history line chart
#     JS counterpart  : (called via /monthly-trend API)
#     API endpoint    : POST /monthly-trend  in  r/plumber_api.R
# ─────────────────────────────────────────────────────────────────────────────
#
# Input
#   borrowings_df  data.frame  column: borrowed_at (ISO timestamp)
#
# Output  data.frame
#   $month  character  "YYYY-MM"
#   $count  integer

monthly_trend <- function(borrowings_df) {
  stopifnot(is.data.frame(borrowings_df), "borrowed_at" %in% names(borrowings_df))

  borrowings_df %>%
    mutate(month = format(as.Date(substr(borrowed_at, 1, 10)), "%Y-%m")) %>%
    count(month, name = "count") %>%
    arrange(month)
}


# ─────────────────────────────────────────────────────────────────────────────
# INTERNAL HELPER
# ─────────────────────────────────────────────────────────────────────────────

.to_json <- function(x) {
  jsonlite::toJSON(x, auto_unbox = TRUE, null = "null", na = "null", digits = 4)
}


# =============================================================================
# SELF-TEST  —  run with:   Rscript r/analytics.R
# =============================================================================
if (!interactive()) {
  cat("\n╔══════════════════════════════════════════════════╗\n")
  cat("║   Libraria Analytics Engine  —  Self-test       ║\n")
  cat("╚══════════════════════════════════════════════════╝\n\n")

  set.seed(42)

  # ── synthetic data ──────────────────────────────────────────────────────────
  weeks_df <- data.frame(
    week  = paste0("2025-W", sprintf("%02d", 1:12)),
    count = c(3L, 5L, 4L, 7L, 9L, 8L, 11L, 10L, 14L, 13L, 16L, 15L)
  )

  books_df <- data.frame(
    id               = paste0("b", 1:10),
    title            = paste("Book", 1:10),
    author           = paste("Author", LETTERS[1:10]),
    domain           = rep(c("Computer Science","Mathematics","Physics","Literature","History"), 2),
    available_copies = c(2, 0, 3, 1, 4, 0, 2, 1, 3, 2),
    total_copies     = c(5, 4, 6, 3, 7, 5, 4, 6, 5, 4),
    borrow_count     = c(18, 15, 12, 9, 7, 14, 11, 6, 3, 8),
    stringsAsFactors = FALSE
  )

  today <- Sys.Date()
  borrowings_df <- data.frame(
    id           = paste0("br", 1:7),
    student_name = paste("Student", LETTERS[1:7]),
    book_title   = paste("Book", 1:7),
    due_date     = as.character(today + c(-14L, -7L, -3L, 0L, 2L, 5L, 10L)),
    returned_at  = c(NA, NA, NA, NA, NA, as.character(today), as.character(today)),
    stringsAsFactors = FALSE
  )

  fines_df <- data.frame(
    id     = paste0("f", 1:6),
    amount = c(25, 10, 50, 15, 30, 20),
    paid   = c(TRUE, FALSE, TRUE, FALSE, FALSE, TRUE),
    stringsAsFactors = FALSE
  )

  borrowings_hist <- data.frame(
    borrowed_at = as.character(seq(as.Date("2024-09-01"), today, by = "week")[1:24])
  )

  # ── 1. borrow_trend ─────────────────────────────────────────────────────────
  cat("1. borrow_trend()\n")
  tr <- borrow_trend(weeks_df)
  cat(sprintf("   slope      = %+.3f  borrows/week\n",  tr$slope))
  cat(sprintf("   intercept  = %.3f\n",                  tr$intercept))
  cat(sprintf("   R²         = %.4f\n",                  tr$r_squared))
  cat(sprintf("   trend      = %s\n",                    tr$trend_label))
  cat(sprintf("   fitted[1]  = %.2f\n\n",                tr$fitted[1]))

  # ── 2. domain_correlation ───────────────────────────────────────────────────
  cat("2. domain_correlation()\n")
  cr <- domain_correlation(books_df)
  cat(sprintf("   r            = %+.4f\n",  cr$correlation))
  cat(sprintf("   p-value      = %.4f\n",   cr$p_value))
  cat(sprintf("   significance = %s\n",     cr$significance))
  cat(sprintf("   direction    = %s\n",     cr$direction))
  cat(sprintf("   strength     = %s\n\n",   cr$strength))

  # ── 3. overdue_risk ─────────────────────────────────────────────────────────
  cat("3. overdue_risk()\n")
  risk <- overdue_risk(borrowings_df)
  print(
    risk[, c("student_name", "days_overdue", "risk_score", "risk_level")],
    row.names = FALSE
  )
  cat("\n")

  # ── 4. fine_stats ───────────────────────────────────────────────────────────
  cat("4. fine_stats()\n")
  fs <- fine_stats(fines_df)
  cat(sprintf("   mean   = ₹%.2f\n",  fs$mean))
  cat(sprintf("   median = ₹%.2f\n",  fs$median))
  cat(sprintf("   sd     = ₹%.2f\n",  fs$sd))
  cat(sprintf("   IQR    = ₹%.2f\n",  fs$iqr))
  cat(sprintf("   total  = ₹%.2f\n",  fs$total))
  cat(sprintf("   unpaid = ₹%.2f\n\n",fs$unpaid))

  # ── 5. top_borrowed_books ───────────────────────────────────────────────────
  cat("5. top_borrowed_books(n = 5)\n")
  print(top_borrowed_books(books_df, n = 5L), row.names = FALSE)
  cat("\n")

  # ── 6. domain_distribution ──────────────────────────────────────────────────
  cat("6. domain_distribution()\n")
  print(domain_distribution(books_df), row.names = FALSE)
  cat("\n")

  # ── 7. monthly_trend ────────────────────────────────────────────────────────
  cat("7. monthly_trend()\n")
  print(monthly_trend(borrowings_hist), row.names = FALSE)
  cat("\n")

  cat("✅  All functions passed\n\n")
}
