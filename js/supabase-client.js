
/* =====================================================
   SUPABASE CLIENT INITIALIZATION
   -----------------------------------------------------
   Replace the two values below with your project keys.
   Get them from: Supabase Dashboard -> Project Settings
                  -> API -> Project URL & anon public key
   See docs/SUPABASE_SETUP.md for full instructions.
   ===================================================== */

const SUPABASE_URL  = "https://ilmrgsazohenxpjcxwkw.supabase.co";   // e.g. https://abcd1234.supabase.co
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlsbXJnc2F6b2hlbnhwamN4d2t3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3Mzc0MzMsImV4cCI6MjA5NDMxMzQzM30.9NTOsUCLt6Kr7du9kkNbNh4aZOIS0i6cCRu2q4N4Sr0";      // long JWT-like string

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