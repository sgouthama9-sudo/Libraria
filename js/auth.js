

document.addEventListener("DOMContentLoaded", async () => {
  // If already signed in, jump to home
  const { data: { session } } = await sb.auth.getSession();
  if (session) { window.location.href = "home.html"; return; }

  // Tabs (login / signup)
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.add("active");
    });
  });

  // Google sign-in
  document.getElementById("btn-google")?.addEventListener("click", async () => {
    const redirectTo = `${window.location.origin}/home.html`;
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo }
    });
    if (error) toast(error.message, "error");
  });

  // Email login
  document.getElementById("form-login")?.addEventListener("submit", async e => {
    e.preventDefault();
    const email = document.getElementById("login-email").value;
    const password = document.getElementById("login-password").value;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { toast(error.message, "error"); return; }
    window.location.href = "home.html";
  });

  // Email sign up
  document.getElementById("form-signup")?.addEventListener("submit", async e => {
    e.preventDefault();
    const fullName   = document.getElementById("signup-name").value;
    const email      = document.getElementById("signup-email").value;
    const password   = document.getElementById("signup-password").value;
    const department = document.getElementById("signup-department").value;
    const studentId  = document.getElementById("signup-student-id").value;

    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: { full_name: fullName, department, student_id: studentId } }
    });
    if (error) { toast(error.message, "error"); return; }

    // If signup returns an authenticated session, update the profile row.
    // If email verification is required, insert/update is skipped until the user signs in.
    if (data.user && data.session) {
      const { error: profileError } = await sb.from("profiles").upsert({
        id: data.user.id,
        full_name: fullName,
        email,
        department,
        student_id,
        is_admin: false
      });
      if (profileError) {
        console.error("Profile upsert failed:", profileError);
        toast(`Database error saving new user: ${profileError.message}`, "error");
        return;
      }
    }

    toast("Account created. Check your inbox to verify.", "success");
  });
});