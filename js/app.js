


// ---------- Toast ----------
function toast(message, kind = "success") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  el.setAttribute("data-testid", "toast");
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ---------- Format helpers ----------
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function daysBetween(a, b) {
  return Math.floor((new Date(b) - new Date(a)) / 86400000);
}

// ---------- Auth guard ----------
async function requireAuth(adminOnly = false) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = "index.html"; return null; }
  const { data: profile } = await sb
    .from("profiles")
    .select("*")
    .eq("id", session.user.id)
    .single();
  if (adminOnly && !profile?.is_admin) {
    toast("Admin access required", "error");
    setTimeout(() => window.location.href = "home.html", 1200);
    return null;
  }
  window.currentUser = session.user;
  window.currentProfile = profile;
  return { session, profile };
}

// ---------- Sidebar render ----------
function renderSidebar(activeKey) {
  const isAdmin = window.currentProfile?.is_admin;
  const profile = window.currentProfile || {};
  const initials = (profile.full_name || "U").split(" ").map(s => s[0]).slice(0,2).join("").toUpperCase();
  const avatar = profile.avatar_url
    ? `<img src="${profile.avatar_url}" alt="">`
    : initials;

  const links = [
    { k: "home",       href: "home.html",        label: "Home",          icon: "house" },
    { k: "borrowings", href: "borrowings.html",  label: "My Borrowings", icon: "book-open" },
    { k: "profile",    href: "profile.html",     label: "Profile",       icon: "user" },
  ];
  if (isAdmin) links.push({ k: "admin", href: "admin.html", label: "Admin", icon: "shield" });

  return `
    <aside class="sidebar">
      <div class="brand">Lib<span>raria</span></div>
      <nav>
        ${links.map(l => `
          <a href="${l.href}" data-testid="nav-${l.k}" class="${activeKey===l.k?'active':''}">
            <i data-lucide="${l.icon}" style="width:18px;height:18px;"></i>${l.label}
          </a>
        `).join("")}
        <a href="#" data-testid="nav-logout" id="logout-link" style="margin-top:auto;">
          <i data-lucide="log-out" style="width:18px;height:18px;"></i>Sign out
        </a>
      </nav>
      <div class="user-mini">
        <div class="avatar">${avatar}</div>
        <div>
          <div class="name" data-testid="sidebar-username">${profile.full_name || "User"}</div>
          <div class="role">${isAdmin ? "Admin" : "Student"}</div>
        </div>
      </div>
    </aside>
  `;
}

function mountSidebar(activeKey) {
  const slot = document.getElementById("sidebar-slot");
  if (!slot) return;
  slot.innerHTML = renderSidebar(activeKey);
  if (window.lucide) window.lucide.createIcons();
  document.getElementById("logout-link")?.addEventListener("click", async (e) => {
    e.preventDefault();
    await sb.auth.signOut();
    window.location.href = "index.html";
  });
}

// ---------- Upload helper ----------
async function uploadImage(bucket, file, prefix = "") {
  if (!file) return null;
  const ext = file.name.split(".").pop();
  const path = `${prefix}${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
  const { error } = await sb.storage.from(bucket).upload(path, file, { upsert: true });
  if (error) { toast(error.message, "error"); return null; }
  const { data } = sb.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

// ---------- Live image preview wiring ----------
function wireImagePreview(inputId, previewId) {
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  if (!input || !preview) return;
  input.addEventListener("change", e => {
    const f = e.target.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    preview.src = url; preview.classList.remove("hidden");
  });
}

window.toast = toast;
window.fmtDate = fmtDate;
window.daysBetween = daysBetween;
window.requireAuth = requireAuth;
window.mountSidebar = mountSidebar;
window.uploadImage = uploadImage;
window.wireImagePreview = wireImagePreview;