

async function initBorrowingsPage() {
  await requireAuth();
  mountSidebar("borrowings");

  await loadActive();
  await loadHistory();
  await loadFines();
}

async function loadActive() {
  const { data } = await sb.from("borrowings")
    .select("*, books(title, author, cover_url)")
    .eq("user_id", currentUser.id)
    .is("returned_at", null)
    .order("borrowed_at", { ascending: false });

  const box = document.getElementById("active-list");
  if (!data || !data.length) {
    box.innerHTML = `<div class="empty-state"><h3>No active borrowings</h3></div>`;
    return;
  }
  box.innerHTML = `
    <table class="data-table" data-testid="active-borrowings-table">
      <thead><tr><th>Book</th><th>Borrowed</th><th>Due</th><th>Status</th></tr></thead>
      <tbody>
        ${data.map(r => {
          const dueDays = daysBetween(new Date(), r.due_date);
          const overdue = dueDays < 0;
          return `<tr>
            <td><strong>${r.books?.title || ""}</strong><br><span class="text-soft">${r.books?.author || ""}</span></td>
            <td>${fmtDate(r.borrowed_at)}</td>
            <td>${fmtDate(r.due_date)}</td>
            <td><span class="badge ${overdue ? 'badge-taupe' : 'badge-sage'}">${overdue ? `Overdue ${Math.abs(dueDays)}d` : 'On time'}</span></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  `;
}

async function loadHistory() {
  const { data } = await sb.from("borrowings")
    .select("*, books(title, author)")
    .eq("user_id", currentUser.id)
    .not("returned_at", "is", null)
    .order("returned_at", { ascending: false });

  const box = document.getElementById("history-list");
  if (!data || !data.length) {
    box.innerHTML = `<div class="empty-state"><h3>No history yet</h3></div>`;
    return;
  }
  box.innerHTML = `
    <table class="data-table" data-testid="history-table">
      <thead><tr><th>Book</th><th>Borrowed</th><th>Returned</th></tr></thead>
      <tbody>
        ${data.map(r => `<tr>
          <td>${r.books?.title || ""}</td>
          <td>${fmtDate(r.borrowed_at)}</td>
          <td>${fmtDate(r.returned_at)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  `;
}

async function loadFines() {
  const { data } = await sb.from("fines")
    .select("*, borrowings(books(title))")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false });

  const box = document.getElementById("fines-list");
  if (!data || !data.length) {
    box.innerHTML = `<div class="empty-state"><h3>No fines — thank you!</h3></div>`;
    return;
  }
  box.innerHTML = `
    <table class="data-table" data-testid="fines-table">
      <thead><tr><th>Book</th><th>Amount</th><th>Status</th><th>Date</th><th></th></tr></thead>
      <tbody>
        ${data.map(f => `<tr>
          <td>${f.borrowings?.books?.title || "—"}</td>
          <td>₹${f.amount}</td>
          <td><span class="badge ${f.paid?'badge-sage':'badge-taupe'}">${f.paid?'Paid':'Pending'}</span></td>
          <td>${fmtDate(f.created_at)}</td>
          <td>${f.paid?'':`<button class="btn btn-sm btn-taupe" data-testid="pay-fine-${f.id}" onclick="payFine('${f.id}')">Pay now</button>`}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  `;
}

async function payFine(fineId) {
  // Demo: mark paid. Replace with real payment gateway.
  const { error } = await sb.from("fines").update({ paid: true, paid_at: new Date().toISOString() }).eq("id", fineId);
  if (error) { toast(error.message, "error"); return; }
  toast("Payment recorded", "success");
  loadFines();
}
window.payFine = payFine;

/* =====================================================
   PROFILE PAGE
   ===================================================== */
async function initProfilePage() {
  await requireAuth();
  mountSidebar("profile");

  const p = currentProfile;
  document.getElementById("p-name").value = p.full_name || "";
  document.getElementById("p-email").value = p.email || currentUser.email;
  document.getElementById("p-dept").value = p.department || "";
  document.getElementById("p-sid").value = p.student_id || "";

  if (p.avatar_url) {
    const img = document.getElementById("avatar-preview");
    img.src = p.avatar_url; img.classList.remove("hidden");
  }

  // Profile QR — contains stable identifier so admin can scan a student
  const qrBox = document.getElementById("profile-qr");
  qrBox.innerHTML = "";
  new QRCode(qrBox, {
    text: JSON.stringify({ type: "student", user_id: currentUser.id, student_id: p.student_id }),
    width: 180, height: 180, colorDark: "#3D3A36", colorLight: "#FFFFFF"
  });

  wireImagePreview("avatar-input", "avatar-preview");

  document.getElementById("form-profile").addEventListener("submit", async e => {
    e.preventDefault();
    let avatar_url = p.avatar_url;
    const file = document.getElementById("avatar-input").files[0];
    if (file) {
      const url = await uploadImage(BUCKETS.STUDENTS, file, `${currentUser.id}/`);
      if (url) avatar_url = url;
    }
    const update = {
      full_name: document.getElementById("p-name").value,
      department: document.getElementById("p-dept").value,
      student_id: document.getElementById("p-sid").value,
      avatar_url
    };
    const { error } = await sb.from("profiles").update(update).eq("id", currentUser.id);
    if (error) { toast(error.message, "error"); return; }
    toast("Profile saved", "success");
  });

  // Load user's borrow requests
  await loadMyRequests();
}

async function loadMyRequests() {
  const box = document.getElementById("my-requests-list");
  if (!box) return;
  box.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  const { data, error } = await sb.from("borrow_requests")
    .select("*, books(title, cover_url)")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false });
  if (error) { box.innerHTML = `<p class="text-soft">Unable to load requests.</p>`; return; }
  if (!data || !data.length) { box.innerHTML = `<div class="empty-state"><h3>No requests</h3><p>You haven't requested any books yet.</p></div>`; return; }

  box.innerHTML = data.map(r => {
    const badge = r.status === 'pending' ? '<span class="badge badge-taupe">Pending</span>' :
                  r.status === 'approved' ? '<span class="badge badge-sage">Approved</span>' :
                  '<span class="badge badge-taupe">Rejected</span>';
    const qrHtml = r.status === 'pending' ? `<div class="mini-qr" id="qr-${r.id}"></div><div class="text-soft" style="font-size:0.85rem;">Code: ${r.unique_code}</div>` : '';
    return `
      <div class="request-item" style="display:flex;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid var(--edge);">
        <div style="width:56px;height:72px;">${r.books?.cover_url?`<img src="${r.books.cover_url}" style="width:56px;height:72px;object-fit:cover">`:'<div class="placeholder small">? </div>'}</div>
        <div style="flex:1">
          <div><strong>${r.books?.title||'Unknown'}</strong> ${badge}</div>
          <div class="text-soft" style="font-size:0.9rem;">Requested on ${fmtDate(r.created_at)}</div>
          ${qrHtml}
        </div>
        <div>
          ${r.status === 'pending' ? `<button class="btn btn-sm btn-outline" onclick="cancelRequest('${r.id}')">Cancel</button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Render QR codes for pending requests
  data.filter(r => r.status === 'pending').forEach(r => {
    const el = document.getElementById(`qr-${r.id}`);
    if (el) {
      el.innerHTML = '';
      try { new QRCode(el, { text: JSON.stringify({ type: 'borrow_request', request_id: r.id, code: r.unique_code }), width: 80, height: 80 }); } catch(e){}
    }
  });
}

async function cancelRequest(reqId) {
  if (!confirm('Cancel this request?')) return;
  // Try deleting — may fail due to RLS; show friendly message if so
  const { error } = await sb.from('borrow_requests').delete().eq('id', reqId);
  if (error) {
    toast('Unable to cancel request. Contact admin to cancel.', 'error');
    return;
  }
  toast('Request cancelled', 'success');
  loadMyRequests();
}
window.cancelRequest = cancelRequest;