


## 1. Create a Google OAuth client
1. Go to https://console.cloud.google.com/ — create a new project (or reuse one).
2. **APIs & Services → OAuth consent screen**:
   - User type: **External** (unless you only allow your workspace).
   - App name: `Libraria` (or anything).
   - Support email: your email.
   - Save. Add test users (your email) while the app is in **Testing** mode.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Name: `Libraria web`.
   - **Authorized JavaScript origins**:
     - `http://localhost:5500` (or whatever port you serve from)
     - your production URL e.g. `https://libraria.vercel.app`
   - **Authorized redirect URIs** — paste the value Supabase gives you in the next step. It looks like:
     `https://<your-ref>.supabase.co/auth/v1/callback`
4. Click **Create** → copy **Client ID** and **Client secret**.

## 2. Enable Google in Supabase
1. Supabase dashboard → **Authentication → Providers → Google**.
2. Toggle **Enable Sign in with Google**.
3. Paste the **Client ID** and **Client secret** from Google.
4. Copy the **Callback URL (for OAuth)** shown by Supabase — paste it back into the Google OAuth client's "Authorized redirect URIs" if you haven't already.
5. Click **Save**.

## 3. Test
- Open `index.html` → click **Continue with Google**.
- A Google consent screen opens, you pick an account, you're redirected back to `home.html` signed-in.
- A row is created automatically in `auth.users`. The `profiles` table also gets a row via the trigger in `schema.sql` (`handle_new_user`).

## 4. How the code does it
File: `js/auth.js`
```js
await sb.auth.signInWithOAuth({
  provider: "google",
  options: { redirectTo: <home.html URL> }
});
```
The `sb.auth` listener inside the page checks if a session exists and the user is redirected.

## 5. Production checklist
- Move the OAuth consent screen from **Testing** to **In production**.
- Add your production domain to **Authorized origins / redirects**.
- In Supabase **Authentication → URL Configuration**, set **Site URL** to your production URL.
