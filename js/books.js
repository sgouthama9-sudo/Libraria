


async function loadBooks(searchQuery = "", domain = "") {
  let q = sb.from("books").select("*").order("created_at", { ascending: false });
  if (searchQuery) q = q.or(`title.ilike.%${searchQuery}%,author.ilike.%${searchQuery}%`);
  if (domain) q = q.eq("domain", domain);
  const { data, error } = await q;
  if (error) { toast(error.message, "error"); return []; }
  return data || [];
}

function renderBookCard(b) {
  const cover = b.cover_url
    ? `<img src="${b.cover_url}" alt="${b.title}">`
    : `<div class="placeholder">${(b.title || "?")[0]}</div>`;
  return `
    <div class="book-card" data-testid="book-card-${b.id}" onclick="window.location.href='book.html?id=${b.id}'">
      <div class="cover">${cover}</div>
      <div class="info">
        <div class="title">${b.title}</div>
        <div class="author">${b.author || ""}</div>
        ${b.domain ? `<div class="domain">${b.domain}</div>` : ""}
      </div>
    </div>
  `;
}

async function initHomePage() {
  await requireAuth();
  mountSidebar("home");

  // Domain filter options
  const select = document.getElementById("filter-domain");
  if (select) {
    select.innerHTML = `<option value="">All domains</option>` +
      BOOK_DOMAINS.map(d => `<option value="${d}">${d}</option>`).join("");
  }

  const grid = document.getElementById("book-grid");
  const recList = document.getElementById("recommend-list");
  const noticeBoard = document.getElementById("notice-board");

  async function refresh() {
    const query = document.getElementById("search-input").value.trim();
    const domain = select.value;
    grid.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
    const books = await loadBooks(query, domain);
    grid.innerHTML = books.length
      ? books.map(renderBookCard).join("")
      : `<div class="empty-state"><h3>No books found</h3><p>Try a different search.</p></div>`;
  }

  async function loadNotices() {
    if (!noticeBoard) return;
    const { data, error } = await sb.from("notices").select("*").order("created_at", { ascending: false }).limit(5);
    if (error) { noticeBoard.innerHTML = `<p class="text-soft">Unable to load notices.</p>`; return; }
    noticeBoard.innerHTML = (data || []).length
      ? data.map(n => `
          <div class="notice-item">
            <strong>${n.title || "Notice"}</strong>
            <p>${n.message || ""}</p>
            <div class="text-soft" style="font-size:0.8rem;">${fmtDate(n.created_at)}</div>
          </div>
        `).join("")
      : `<p class="text-soft">No notices right now.</p>`;
  }

  document.getElementById("search-input").addEventListener("input", debounce(refresh, 300));
  select.addEventListener("change", refresh);

  // Recommendations: most borrowed
  const { data: recs } = await sb.from("books")
    .select("*, borrowings(count)")
    .limit(5);
  if (recList && recs) {
    recList.innerHTML = recs.map(b => `
      <div class="recommend-item" data-testid="rec-${b.id}" onclick="window.location.href='book.html?id=${b.id}'">
        <div class="mini-cover">${b.cover_url ? `<img src="${b.cover_url}">` : ""}</div>
        <div class="meta"><div class="t">${b.title}</div><div class="a">${b.author || ""}</div></div>
      </div>
    `).join("");
  }

  await loadNotices();
  refresh();
}

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ---------- Book detail page ---------- */
async function initBookPage() {
  await requireAuth();
  mountSidebar("home");

  const params = new URLSearchParams(window.location.search);
  const bookId = params.get("id");
  const container = document.getElementById("book-detail");
  if (!bookId) { container.innerHTML = `<p>Book not found.</p>`; return; }

  const { data: book, error } = await sb.from("books").select("*").eq("id", bookId).single();
  if (error || !book) { container.innerHTML = `<p>Book not found.</p>`; return; }

  // Borrow count
  const { count: borrowCount } = await sb.from("borrowings")
    .select("*", { count: "exact", head: true }).eq("book_id", bookId);

  container.innerHTML = `
    <div class="big-cover">
      ${book.cover_url ? `<img src="${book.cover_url}" alt="${book.title}">` : ""}
    </div>
    <div>
      <h1 data-testid="book-title">${book.title}</h1>
      <p class="text-soft" style="margin-top:4px;">by ${book.author || "Unknown"}</p>
      <div class="meta-list">
        <div class="meta-row"><span class="k">Shelf location</span><span class="v" data-testid="book-shelf">${book.shelf_location || "—"}</span></div>
        <div class="meta-row"><span class="k">Domain</span><span class="v">${book.domain || "—"}</span></div>
        <div class="meta-row"><span class="k">Copies available</span><span class="v" data-testid="book-available">${book.available_copies ?? 0} / ${book.total_copies ?? 0}</span></div>
        <div class="meta-row"><span class="k">Times borrowed</span><span class="v">${borrowCount || 0}</span></div>
        <div class="meta-row"><span class="k">Rating</span><span class="v">${book.avg_rating ? `★ ${book.avg_rating.toFixed(1)}` : "Not rated"}</span></div>
        ${book.ebook_url ? `<div class="meta-row"><span class="k">E-book</span><span class="v"><a href="${book.ebook_url}" target="_blank" rel="noopener noreferrer">Open ebook</a></span></div>` : ""}
      </div>
      <p>${book.description || ""}</p>
      <div class="actions-row">
        <button class="btn btn-primary" data-testid="btn-borrow" id="btn-borrow">
          <i data-lucide="qr-code" style="width:16px;height:16px;"></i>Borrow this book
        </button>
        <button class="btn btn-outline" data-testid="btn-review" id="btn-review">
          <i data-lucide="star" style="width:16px;height:16px;"></i>Write a review
        </button>
      </div>
    </div>
  `;
  if (window.lucide) window.lucide.createIcons();

  document.getElementById("btn-borrow").addEventListener("click", () => generateBorrowQR(book));
  document.getElementById("btn-review").addEventListener("click", () => openReviewModal(book.id));

  loadReviews(bookId);
}

async function loadReviews(bookId) {
  const list = document.getElementById("review-list");
  if (!list) return;
  const { data } = await sb.from("reviews")
    .select("*, profiles(full_name)")
    .eq("book_id", bookId)
    .order("created_at", { ascending: false });
  if (!data || !data.length) {
    list.innerHTML = `<p class="text-soft">No reviews yet. Be the first!</p>`;
    return;
  }
  list.innerHTML = data.map(r => `
    <div class="review-item">
      <div class="header">
        <span class="author">${r.profiles?.full_name || "Student"}</span>
        <span class="date">${fmtDate(r.created_at)}</span>
      </div>
      <div class="stars">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</div>
      <p>${r.comment || ""}</p>
    </div>
  `).join("");
}

function openReviewModal(bookId) {
  const m = document.getElementById("review-modal");
  m.classList.add("active");
  document.getElementById("review-cancel").onclick = () => m.classList.remove("active");
  document.getElementById("review-submit").onclick = async () => {
    const rating = +document.getElementById("review-rating").value;
    const comment = document.getElementById("review-comment").value;
    const { error } = await sb.from("reviews").insert({
      book_id: bookId, user_id: currentUser.id, rating, comment
    });
    if (error) { toast(error.message, "error"); return; }
    toast("Review posted", "success");
    m.classList.remove("active");
    loadReviews(bookId);
  };
}

/* ---------- Generate borrow QR ---------- */
async function generateBorrowQR(book) {
  // Prevent duplicate pending request for same book by same user
  const { data: existing } = await sb.from("borrow_requests")
    .select("*")
    .eq("book_id", book.id)
    .eq("user_id", currentUser.id)
    .eq("status", "pending")
    .limit(1)
    .single();
  if (existing) { toast("You already have a pending request for this book.", "info"); return; }

  // Create a pending borrow request row -> admin scans QR to approve
  const uniqueCode = "BRW-" + Math.random().toString(36).slice(2,10).toUpperCase();
  const payload = {
    book_id: book.id,
    user_id: currentUser.id,
    unique_code: uniqueCode,
    status: "pending"
  };
  const { data, error } = await sb.from("borrow_requests").insert(payload).select().single();
  if (error) { toast(error.message, "error"); return; }

  toast("Borrow request submitted — admin will approve shortly.", "success");

  const qrData = JSON.stringify({ type: "borrow_request", request_id: data.id, code: uniqueCode });

  const m = document.getElementById("qr-modal");
  if (m) {
    m.classList.add("active");
    const qrBox = document.getElementById("qr-canvas");
    if (qrBox) {
      qrBox.innerHTML = "";
      new QRCode(qrBox, { text: qrData, width: 220, height: 220, colorDark: "#3D3A36", colorLight: "#FFFFFF" });
    }
    const codeText = document.getElementById("qr-code-text"); if (codeText) codeText.textContent = uniqueCode;
    const closeBtn = document.getElementById("qr-close"); if (closeBtn) closeBtn.onclick = () => m.classList.remove("active");
  }
}