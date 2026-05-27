
Action: file_editor create /app/library-app/README.md --file-text "# LIBRARIA — Library Management System

A pure HTML/CSS/JS frontend backed by **Supabase** (Postgres + Auth + Storage).
No build step, no Node server required for the frontend.

---

## Folder layout

```
library-app/
├── index.html          Sign in / sign up
├── home.html           Book search + recommendations
├── book.html           Book details + borrow QR + reviews
├── profile.html        Student profile + own QR
├── borrowings.html     My active borrowings, history, fines
├── admin.html          Admin dashboard (analytics, books, students, scan QR)
├── css/
│   └── styles.css      Single stylesheet (soft-cream palette)
├── js/
│   ├── supabase-client.js   Supabase init — paste your keys here
│   ├── app.js               Shared helpers (auth guard, sidebar, toast, uploads)
│   ├── auth.js              Login / signup / Google OAuth
│   ├── books.js             Home + book detail logic
│   ├── borrow.js            Borrowings + profile logic
│   └── admin.js             Admin dashboard logic
└── docs/
    ├── SUPABASE_SETUP.md        How to create the Supabase project + DB
    ├── GOOGLE_AUTH_SETUP.md     How to enable Google sign-in
    ├── NAVIGATION_BLUEPRINT.txt Map of features → files → tables (read first)
    └── schema.sql               Full SQL: tables, RLS, RPCs, buckets
```

## How to run

This is a static site — open the files via any static server.

**Option A — VS Code Live Server** extension: right-click `index.html` → "Open with Live Server".

**Option B — Python:**

```bash
cd library-app
python3 -m http.server 5500
# open http://localhost:5500
```

**Option C — Deploy** straight to Vercel / Netlify / GitHub Pages / Cloudflare Pages.
Drop the `library-app` folder, no build step needed.

## Setup checklist

1. Create a Supabase project — see `docs/SUPABASE_SETUP.md`.
2. Run `docs/schema.sql` in Supabase SQL Editor — creates all tables, RLS, and helper functions.
3. Enable Google OAuth — see `docs/GOOGLE_AUTH_SETUP.md`.
4. Open `js/supabase-client.js` and paste your **Project URL** and **anon public key**.
5. Open `index.html` in a browser, sign up — that's it.

## First admin user

After signing up the first time, run this once in Supabase SQL editor:

```sql
update profiles set is_admin = true where email = 'YOUR_EMAIL';
```

Now refresh the app — the **Admin** link appears in the sidebar.
"
Observation: Create successful: /app/library-app/README.md