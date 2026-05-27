/**
 * admin.js — Libraria Admin Page
 * Handles: tabs, books CRUD, borrowings, notices, students, QR scanner.
 * Analytics tab is now powered by analytics-dashboard.js (R + Python).
 */

async function initAdminPage() {
  await requireAuth(true);
  mountSidebar("admin");

  // ---- Tabs ----
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.add("active");

      if (btn.dataset.tab === "tab-analytics")  loadAnalyticsDashboard();
      if (btn.dataset.tab === "tab-borrowings") loadAllBorrowings();
      if (btn.dataset.tab === "tab-books")      loadBooksAdmin();
      if (btn.dataset.tab === "tab-notices")    loadNoticesAdmin();
      if (btn.dataset.tab === "tab-students")   loadStudents();
      if (btn.dataset.tab === "tab-scan")       setupScanner();
    });
  });

  // Initial load
  await loadAnalyticsDashboard();
  await loadAllBorrowings();
  await loadBooksAdmin();
  await loadNoticesAdmin();
  await loadPendingRequests();

  // Wire add-book form
  wireImagePreview("book-cover-input", "book-cover-preview");
  const sel = document.getElementById("book-domain");
  sel.innerHTML = BOOK_DOMAINS.map(d => `<option>${d}</option>`).join("");

  document.getElementById("form-add-book").addEventListener("submit", async e => {
    e.preventDefault();
    const file = document.getElementById("book-cover-input").files[0];
    let cover_url = null;
    if (file) cover_url = await uploadImage(BUCKETS.BOOKS, file, "covers/");

    const bookId = document.getElementById("book-id-input").value;
    const payload = {
      title:            document.getElementById("book-title-input").value,
      author:           document.getElementById("book-author-input").value,
      domain:           document.getElementById("book-domain").value,
      shelf_location:   document.getElementById("book-shelf-input").value,
      total_copies:     +document.getElementById("book-total-input").value || 1,
      available_copies: +document.getElementById("book-available-input").value || 1,
      description:      document.getElementById("book-desc-input").value,
      ebook_url:        document.getElementById("book-ebook-input").value || null,
      cover_url,
    };
    if (!cover_url) delete payload.cover_url;

    let result;
    if (bookId) {
      result = await sb.from("books").update(payload).eq("id", bookId);
    } else {
      result = await sb.from("books").insert(payload);
    }
    if (result.error) { toast(result.error.message, "error"); return; }
    toast(bookId ? "Book updated" : "Book added to library", "success");
    resetBookForm();
    loadBooksAdmin();
    loadAnalyticsDashboard();
  });

  document.getElementById("btn-reset-book").addEventListener("click", resetBookForm);
}

/* ---- Books admin ---- */
async function loadBooksAdmin() {
  const { data, error } = await sb.from("books").select("*").order("created_at", { ascending: false });
  if (error) { toast(error.message, "error"); return; }
  const box = document.getElementById("books-admin-list");
  box.innerHTML = data && data.length ? `
    <table class="data-table" data-testid="books-admin-table">
      <thead><tr><th>Title</th><th>Author</th><th>Available</th><th>Total</th><th>eBook</th><th></th></tr></thead>
      <tbody>
        ${data.map(b => `<tr>
          <td><strong>${b.title || ""}</strong><br><span class="text-soft">${b.domain || ""}</span></td>
          <td>${b.author || ""}</td>
          <td>${b.available_copies ?? 0}</td>
          <td>${b.total_copies ?? 0}</td>
          <td>${b.ebook_url ? `<a href="${b.ebook_url}" target="_blank">Link</a>` : "—"}</td>
          <td>
            <button class="btn btn-sm btn-outline" onclick="editBook('${b.id}')">Edit</button>
            <button class="btn btn-sm btn-secondary" onclick="deleteBook('${b.id}')">Delete</button>
            <button class="btn btn-sm btn-primary" onclick="showBookRequests('${b.id}', '${escapeHtml(b.title || '')}')">Requests</button>
          </td>
        </tr>`).join("")}
      </tbody>
    </table>
  ` : `<div class="empty-state"><h3>No books in library yet.</h3></div>`;
}

function escapeHtml(s) {
  return s.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

async function showBookRequests(bookId, bookTitle) {
  const modal = document.getElementById("book-requests-modal");
  const body  = document.getElementById("book-requests-body");
  if (!modal || !body) return;
  body.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  modal.style.display = "block";
  document.getElementById("book-requests-close").onclick = () => { modal.style.display = "none"; };

  const { data, error } = await sb.from("borrow_requests")
    .select("*, profiles(full_name, student_id)")
    .eq("book_id", bookId).eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) { body.innerHTML = `<p class="text-soft">Unable to load requests: ${error.message}</p>`; return; }
  if (!data || !data.length) { body.innerHTML = `<p class="text-soft">No pending requests for ${bookTitle}</p>`; return; }

  body.innerHTML = data.map(r => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--edge);">
      <div>
        <strong>${r.profiles?.full_name || "Student"}</strong>
        <div class="text-soft" style="font-size:0.9rem;">${r.profiles?.student_id || ""} · ${fmtDate(r.created_at)}</div>
      </div>
      <div>
        <button class="btn btn-sm btn-primary" onclick="approveBorrow('${r.id}','${r.book_id}','${r.user_id}')">Approve</button>
        <button class="btn btn-sm btn-outline" onclick="rejectBorrowRequest('${r.id}')">Reject</button>
      </div>
    </div>
  `).join("");
}
window.showBookRequests = showBookRequests;

function resetBookForm() {
  document.getElementById("book-id-input").value = "";
  document.getElementById("form-add-book").reset();
  document.getElementById("book-cover-preview").classList.add("hidden");
  const saveBtn = document.getElementById("btn-add-book");
  if (saveBtn) saveBtn.textContent = "Save book";
}

async function editBook(bookId) {
  const { data, error } = await sb.from("books").select("*").eq("id", bookId).single();
  if (error || !data) { toast(error?.message || "Book not found", "error"); return; }
  document.getElementById("book-id-input").value       = data.id;
  document.getElementById("book-title-input").value    = data.title || "";
  document.getElementById("book-author-input").value   = data.author || "";
  document.getElementById("book-domain").value         = data.domain || BOOK_DOMAINS[0];
  document.getElementById("book-shelf-input").value    = data.shelf_location || "";
  document.getElementById("book-total-input").value    = data.total_copies ?? 1;
  document.getElementById("book-available-input").value = data.available_copies ?? 1;
  document.getElementById("book-ebook-input").value    = data.ebook_url || "";
  document.getElementById("book-desc-input").value     = data.description || "";
  if (data.cover_url) {
    const preview = document.getElementById("book-cover-preview");
    preview.src = data.cover_url; preview.classList.remove("hidden");
  }
  document.getElementById("btn-add-book").textContent = "Update book";
}
window.editBook = editBook;

async function deleteBook(bookId) {
  if (!confirm("Delete this book?")) return;
  const { error } = await sb.from("books").delete().eq("id", bookId);
  if (error) { toast(error.message, "error"); return; }
  toast("Book deleted", "success");
  loadBooksAdmin();
  loadAnalyticsDashboard();
}
window.deleteBook = deleteBook;

/* ---- Notices ---- */
async function loadNoticesAdmin() {
  const { data, error } = await sb.from("notices").select("*").order("created_at", { ascending: false });
  if (error) { toast(error.message, "error"); return; }
  const box = document.getElementById("notice-admin-list");
  box.innerHTML = data && data.length ? data.map(n => `
    <div class="notice-admin-item">
      <div class="notice-header"><strong>${n.title}</strong>
      <button class="btn btn-sm btn-outline" onclick="deleteNotice('${n.id}')">Delete</button></div>
      <p>${n.message}</p>
      <div class="text-soft" style="font-size:0.8rem;">${fmtDate(n.created_at)}</div>
    </div>
  `).join("") : `<p class="text-soft">No notices published.</p>`;
}

async function deleteNotice(noticeId) {
  if (!confirm("Delete this notice?")) return;
  const { error } = await sb.from("notices").delete().eq("id", noticeId);
  if (error) { toast(error.message, "error"); return; }
  toast("Notice deleted", "success");
  loadNoticesAdmin();
}
window.deleteNotice = deleteNotice;

const noticeForm = document.getElementById("form-notice");
if (noticeForm) {
  noticeForm.addEventListener("submit", async e => {
    e.preventDefault();
    const title   = document.getElementById("notice-title-input").value;
    const message = document.getElementById("notice-message-input").value;
    const { error } = await sb.from("notices").insert({ title, message });
    if (error) { toast(error.message, "error"); return; }
    toast("Notice published", "success");
    e.target.reset();
    loadNoticesAdmin();
  });
}

/* ---- All borrowings ---- */
async function loadAllBorrowings() {
  const filter = document.getElementById("borrow-filter")?.value.toLowerCase() || "";
  const { data } = await sb.from("borrowings")
    .select("*, books(title), profiles(full_name, student_id, department)")
    .order("borrowed_at", { ascending: false });

  const filtered = (data || []).filter(r => {
    if (!filter) return true;
    return (r.profiles?.full_name || "").toLowerCase().includes(filter) ||
           (r.profiles?.student_id || "").toLowerCase().includes(filter) ||
           (r.books?.title || "").toLowerCase().includes(filter);
  });

  const box = document.getElementById("all-borrowings-list");
  const existingPanel = document.getElementById("pending-requests-panel");
  if (existingPanel) existingPanel.remove();

  const pendingBox = document.createElement("div");
  pendingBox.id = "pending-requests-panel";
  const { data: pending } = await sb.from("borrow_requests")
    .select("*, books(title), profiles(full_name, student_id)")
    .eq("status", "pending").order("created_at", { ascending: false });

  if (pending && pending.length) {
    pendingBox.innerHTML = `
      <div class="panel mb-6">
        <h3>Pending borrow requests</h3>
        <div>${pending.map(r => `
          <div class="pending-item" style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--edge);">
            <div>
              <strong>${r.profiles?.full_name || "Student"}</strong> <span class="text-soft">(${r.profiles?.student_id || ""})</span><br>
              <small>Book: <strong>${r.books?.title || ""}</strong></small>
            </div>
            <div>
              <button class="btn btn-sm btn-primary" onclick="approveBorrow('${r.id}','${r.book_id}','${r.user_id}')">Approve</button>
              <button class="btn btn-sm btn-outline" onclick="rejectBorrowRequest('${r.id}')">Reject</button>
            </div>
          </div>`).join("")}</div>
      </div>
    `;
  }
  box.parentNode.insertBefore(pendingBox, box);

  box.innerHTML = `
    <table class="data-table" data-testid="admin-borrowings-table">
      <thead><tr><th>Student</th><th>Book</th><th>Borrowed</th><th>Due</th><th>Returned</th><th></th></tr></thead>
      <tbody>
        ${filtered.map(r => `<tr>
          <td><strong>${r.profiles?.full_name || ""}</strong><br><span class="text-soft">${r.profiles?.student_id || ""}</span></td>
          <td>${r.books?.title || ""}</td>
          <td>${fmtDate(r.borrowed_at)}</td>
          <td>${fmtDate(r.due_date)}</td>
          <td>${r.returned_at ? fmtDate(r.returned_at) : '<span class="badge badge-sage">Active</span>'}</td>
          <td>${r.returned_at ? "" : `<button class="btn btn-sm btn-secondary" data-testid="return-${r.id}" onclick="markReturned('${r.id}')">Mark returned</button>`}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  `;
}

async function loadPendingRequests() {
  const { count } = await sb.from("borrow_requests").select("*", { count: "exact", head: true }).eq("status", "pending");
  const el = document.getElementById("stat-pending");
  if (el) el.textContent = count ?? 0;
}

async function rejectBorrowRequest(reqId) {
  if (!confirm("Reject this borrow request?")) return;
  const { error } = await sb.from("borrow_requests").update({ status: "rejected" }).eq("id", reqId);
  if (error) { toast(error.message, "error"); return; }
  toast("Request rejected", "success");
  loadAllBorrowings(); loadAnalyticsDashboard();
}
window.rejectBorrowRequest = rejectBorrowRequest;

document.addEventListener("input", e => {
  if (e.target.id === "borrow-filter") loadAllBorrowings();
  if (e.target.id === "student-filter") loadStudents();
});

async function markReturned(id) {
  const today = new Date().toISOString();
  const { data: row, error: fetchError } = await sb.from("borrowings").select("*").eq("id", id).single();
  if (fetchError || !row) { toast(fetchError?.message || "Borrowing not found", "error"); return; }

  const { error: incErr } = await sb.rpc("increment_available", { book_id_in: row.book_id });
  if (incErr) { toast("Failed to update book availability", "error"); return; }

  const overdueDays = daysBetween(row.due_date, today);
  if (overdueDays > 0) {
    const { error: fineErr } = await sb.from("fines").insert({
      borrowing_id: id, user_id: row.user_id, amount: overdueDays * 5, paid: false,
    });
    if (fineErr) { toast(fineErr.message, "error"); }
    else { toast(`Returned. Fine ₹${overdueDays * 5} added.`, "success"); }
  } else {
    toast("Book returned", "success");
  }

  const { error } = await sb.from("borrowings").delete().eq("id", id);
  if (error) { toast(error.message, "error"); return; }
  loadAllBorrowings();
}
window.markReturned = markReturned;

/* ---- Students ---- */
async function loadStudents() {
  const filter = document.getElementById("student-filter")?.value.toLowerCase() || "";
  const { data } = await sb.from("profiles").select("*").order("full_name");
  const filtered = (data || []).filter(s =>
    !filter || (s.full_name || "").toLowerCase().includes(filter) || (s.student_id || "").toLowerCase().includes(filter)
  );
  document.getElementById("students-list").innerHTML = `
    <table class="data-table" data-testid="students-table">
      <thead><tr><th>Name</th><th>Student ID</th><th>Department</th><th>Email</th><th>Role</th><th></th></tr></thead>
      <tbody>
        ${filtered.map(s => `<tr>
          <td>${s.full_name || ""}</td>
          <td>${s.student_id || "—"}</td>
          <td>${s.department || "—"}</td>
          <td>${s.email || ""}</td>
          <td><span class="badge ${s.is_admin ? "badge-taupe" : "badge-sand"}">${s.is_admin ? "Admin" : "Student"}</span></td>
          <td><button class="btn btn-sm btn-outline" data-testid="toggle-admin-${s.id}" onclick="toggleAdmin('${s.id}', ${!s.is_admin})">${s.is_admin ? "Revoke admin" : "Grant admin"}</button></td>
        </tr>`).join("")}
      </tbody>
    </table>
  `;
}

async function toggleAdmin(id, makeAdmin) {
  const { error } = await sb.from("profiles").update({ is_admin: makeAdmin }).eq("id", id);
  if (error) { toast(error.message, "error"); return; }
  toast(makeAdmin ? "Admin granted" : "Admin revoked", "success");
  loadStudents();
}
window.toggleAdmin = toggleAdmin;

/* ---- QR scanner ---- */
let scanner = null;
function setupScanner() {
  if (scanner) return;
  scanner = new Html5Qrcode("qr-reader");
  document.getElementById("scan-start").onclick = () => {
    scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 260 }, onScanSuccess, () => {})
      .catch(e => toast(e.message, "error"));
  };
  document.getElementById("scan-stop").onclick = () => scanner.stop().catch(() => {});
}

async function onScanSuccess(decodedText) {
  await scanner.stop().catch(() => {});
  let payload;
  try { payload = JSON.parse(decodedText); } catch { toast("Invalid QR", "error"); return; }
  const resultBox = document.getElementById("scan-result");

  if (payload.type === "borrow_request" || payload.code) {
    const query = sb.from("borrow_requests").select("*, books(title, available_copies), profiles(full_name, student_id)");
    if (payload.request_id) query.eq("id", payload.request_id);
    else query.eq("unique_code", payload.code);
    const { data: req } = await query.single();
    if (!req) { resultBox.innerHTML = `<p class="text-soft">Request not found.</p>`; return; }
    resultBox.innerHTML = `
      <div class="panel">
        <h2>Confirm borrow request</h2>
        <p><strong>${req.profiles?.full_name}</strong> (${req.profiles?.student_id})</p>
        <p>Book: <strong>${req.books?.title}</strong></p>
        <p>Code: <code>${req.unique_code}</code></p>
        <div class="actions-row">
          <button class="btn btn-primary" data-testid="approve-borrow" onclick="approveBorrow('${req.id}','${req.book_id}','${req.user_id}')">Approve</button>
          <button class="btn btn-outline" onclick="document.getElementById('scan-result').innerHTML=''">Cancel</button>
        </div>
      </div>
    `;
  } else if (payload.type === "student") {
    const { data: p } = await sb.from("profiles").select("*").eq("id", payload.user_id).single();
    if (!p) { resultBox.innerHTML = `<p>Student not found.</p>`; return; }
    resultBox.innerHTML = `
      <div class="panel">
        <h2>${p.full_name}</h2>
        <p>${p.student_id || ""} · ${p.department || ""}</p>
        <p>${p.email || ""}</p>
      </div>
    `;
  }
}

async function approveBorrow(reqId, bookId, userId) {
  const { data: book } = await sb.from("books").select("available_copies").eq("id", bookId).single();
  if (!book || book.available_copies <= 0) { toast("Unable to approve: no copies available", "error"); return; }

  const due = new Date(); due.setDate(due.getDate() + 14);
  const { error: borrowError } = await sb.from("borrowings").insert({
    book_id: bookId, user_id: userId,
    borrowed_at: new Date().toISOString(),
    due_date: due.toISOString().slice(0, 10),
  });
  if (borrowError) { toast(borrowError.message, "error"); return; }

  const { error: reqError } = await sb.from("borrow_requests").update({ status: "approved" }).eq("id", reqId);
  if (reqError) { toast(reqError.message, "error"); return; }

  const { error: decError } = await sb.rpc("decrement_available", { book_id_in: bookId });
  if (decError) { toast(decError.message, "error"); return; }

  toast("Borrow approved", "success");
  document.getElementById("scan-result").innerHTML = "";
  loadAllBorrowings(); loadAnalyticsDashboard();
}
window.approveBorrow = approveBorrow;
