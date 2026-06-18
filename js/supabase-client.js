
/* =====================================================
   SUPABASE CLIENT INITIALIZATION
   -----------------------------------------------------
   Replace the two values below with your project keys.
   Get them from: Supabase Dashboard -> Project Settings
                  -> API -> Project URL & anon public key
   See docs/SUPABASE_SETUP.md for full instructions.
   ===================================================== */

const SUPABASE_URL  = "https://wzwfstvmnporxtvnvwos.supabase.co";   // Replace with your Supabase project URL
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6d2ZzdHZtbnBvcnh0dm52d29zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NjIxNjUsImV4cCI6MjA5NzMzODE2NX0.AX1cAWm1T6PsIMER8NPAy2e4FGV74LAEGnM-WW3ZHAY";
if (SUPABASE_URL.includes("<your-project-ref>") || SUPABASE_ANON.includes("<your-anon-key>")) {
  console.error(
    "Supabase is not configured. Open js/supabase-client.js and paste your Project URL and anon public key from Supabase Dashboard."
  );
}
// Loaded from CDN in every HTML page:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// Storage bucket names — keep in sync with SQL setup
const BUCKETS = {
  BOOKS: "book-covers",
  STUDENTS: "student-photos"
};

// Domain filter options used in search and add-book
const BOOK_DOMAINS = [
  "Computer Science", "Mathematics", "Physics", "Literature",
  "History", "Biology", "Engineering", "Philosophy",
  "Economics", "Art & Design", "Other"
];

window.sb = sb;
window.BUCKETS = BUCKETS;
window.BOOK_DOMAINS = BOOK_DOMAINS;