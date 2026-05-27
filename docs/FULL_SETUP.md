# Libraria Full Setup Guide

## 1. Clone or copy the project
Place the `library-app` folder on your computer and open it in VS Code.

## 2. Create a Supabase project
1. Go to https://supabase.com and sign in.
2. Create a new project. Set a strong database password and choose a region near your users.
3. Wait for the project to finish provisioning.

## 3. Configure Supabase API keys
1. In Supabase → **Project Settings** → **API**.
2. Copy the **Project URL** and **anon public key**.
3. Open `js/supabase-client.js` and update:
```js
const SUPABASE_URL  = "https://<your-project-ref>.supabase.co";
const SUPABASE_ANON = "<your-anon-key>";
```

## 4. Run the SQL schema
1. In Supabase → **SQL Editor** → **New query**.
2. Open `docs/schema.sql` in this repo.
3. Paste the full file and click **Run**.
4. Confirm the tables and policies were created successfully.

## 5. Configure authentication
### Email authentication
- In Supabase → **Authentication → Settings** → **Sign in / Providers**.
- You can disable email confirmation for easier testing.

### Google OAuth
1. Follow `docs/GOOGLE_AUTH_SETUP.md` to create a Google OAuth client.
2. In Supabase → **Authentication → Providers → Google**.
3. Paste the Google client ID and secret.
4. Make sure your OAuth redirect URI matches the Supabase callback URL.
5. Set Supabase **Site URL** to your deployed app URL if using hosting.

### Local testing
If you run the app locally, use a static web server such as:
```bash
cd "library-app"
python -m http.server 5500
```
Then open: `http://localhost:5500/index.html`.

## 6. Make your first admin
1. Open the app and sign up with a regular student account.
2. In Supabase SQL editor, run:
```sql
update profiles set is_admin = true where email = 'your@email.com';
```
3. Refresh the app. The **Admin** sidebar page should appear.

## 7. New project features
This version adds:
- Request/approve borrow flow using `borrow_requests` and admin QR scan approval.
- Short borrow QR payloads for reliable scanning.
- Admin book management: add, edit, delete books, inventory counts, e-book links.
- Notice board on the homepage and admin notice management.
- Improved admin analytics with chart visualizations.
- Fixed Google auth redirect to the current site home page.

## 8. Android app replication
See `android/README_ANDROID.md` for a minimal Android Studio skeleton using WebView and Supabase login guidance.

## 9. Run the app
Open `index.html` using a static server:
- VS Code Live Server extension
- `python -m http.server 5500`

Then sign in and test the flows:
- Student request borrow via book page.
- Admin scan request QR in `admin.html` and approve.
- Publish notices from admin and view them on home page.
- Add/edit/delete books from the admin panel.
