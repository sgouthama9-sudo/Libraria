

## 1. Create the project
1. Go to https://supabase.com and sign in.
2. Click **New project**. Pick an organisation, name it (e.g. `libraria`), set a strong DB password, choose a region close to your users, and create.
3. Wait ~2 minutes for the project to be ready.

## 2. Get the API keys
1. In the left sidebar → **Project Settings** → **API**.
2. Copy:
   - **Project URL**  (looks like `https://xxxxxxxx.supabase.co`)
   - **anon public key** (long JWT-like string starting with `eyJ…`)
3. Open `js/supabase-client.js` in this project and paste them:
   ```js
   const SUPABASE_URL  = "https://xxxxxxxx.supabase.co";
   const SUPABASE_ANON = "eyJhbGciOi...";
   ```

> Never paste the **service_role** key into the frontend — it bypasses Row-Level Security.

## 3. Create all database tables, policies and helper functions
1. In the left sidebar → **SQL Editor** → **New query**.
2. Open the file `docs/schema.sql` from this project, copy the full contents, paste them in the SQL editor, and click **Run**.
3. You should see "Success. No rows returned." — every table, policy, RPC, and bucket is now in place.

The schema creates:
- `profiles` — one row per signed-up user (name, dept, student id, is_admin, avatar_url)
- `books` — every book in the library, with `ebook_url`, inventory counts, and book metadata
- `borrow_requests` — pending borrow requests (created when a student presses Borrow)
- `borrowings` — actual borrowings (created when admin scans + approves)
- `fines` — overdue fines
- `reviews` — book reviews
- `notices` — library announcements shown on the home page
- RPC `increment_available(book_id_in uuid)` and `decrement_available(...)`
- Storage buckets: `book-covers` and `student-photos` (public read)
- Row-Level Security on every table so users only see/edit their own data, admins see all.

## 4. Create storage buckets (already in schema.sql, but verify)
1. **Storage** → **Buckets**.
2. You should see `book-covers` and `student-photos`, both marked **Public**.
3. If they don't exist, click **New bucket**, name `book-covers`, toggle **Public bucket** on. Repeat for `student-photos`.

## 5. Auth settings
1. **Authentication** → **Providers** → **Email** is enabled by default.
2. For email-confirmation off (easier testing) → **Authentication** → **Sign in / Providers** → toggle off **Confirm email**.
3. For Google sign-in, follow `GOOGLE_AUTH_SETUP.md`.

## 6. First admin user
1. Sign up a regular account inside the app (`index.html`).
2. In Supabase **SQL editor**:
   ```sql
   update profiles set is_admin = true where email = 'your@email.com';
   ```
3. Refresh — the **Admin** sidebar entry now appears.

## 7. (Optional) Seed sample books
```sql
insert into books (title, author, domain, shelf_location, total_copies, available_copies, description)
values
('Clean Code', 'Robert C. Martin', 'Computer Science', 'A1-12', 3, 3, 'A handbook of agile software craftsmanship.'),
('Sapiens',    'Yuval Noah Harari','History',          'B2-04', 2, 2, 'A brief history of humankind.'),
('Calculus',   'Michael Spivak',   'Mathematics',      'C1-22', 4, 4, 'Rigorous introduction to calculus.');
```

## How data flows
- Frontend imports `@supabase/supabase-js` via CDN.
- Every call is a JS method like `sb.from("books").select("*")` — Supabase translates it into a SQL query and runs it under RLS.
- File uploads go through `sb.storage.from(bucket).upload(...)` → returned URL is stored in the row.
- See `NAVIGATION_BLUEPRINT.txt` for a full map of which page calls which table.

## How to extract data as raw SQL
- **Supabase → SQL Editor** lets you run any SQL.
- To export, use **Database → Backups** or **Table Editor → … → Export as CSV**.
- To inspect a query, click the request log in **Logs → Postgres**.
- For full DB dump:
   ```bash
   pg_dump "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" 
     --schema=public --data-only > dump.sql
   ```
