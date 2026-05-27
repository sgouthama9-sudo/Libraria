# Libraria Project Update Summary

## Updated files
- `js/auth.js`
  - Fixed Google OAuth redirect to use the current app origin.
- `js/books.js`
  - Added home notice board loading.
  - Added e-book link display on book detail pages.
  - Shortened borrow QR payload to a compact request object.
- `js/admin.js`
  - Added admin book management with edit/delete.
  - Added admin notice management.
  - Added analytics chart rendering using Chart.js.
  - Improved QR scan payload handling and approval flow.
- `admin.html`
  - Added Manage Books and Notices tabs.
  - Added analytics chart placeholders.
  - Added e-book link and available copies fields.
- `home.html`
  - Added notice board section on the homepage.
- `css/styles.css`
  - Added styles for notice board and admin chart layout.
- `docs/schema.sql`
  - Added `ebook_url` to `books`.
  - Added `notices` table and RLS policies.
- `docs/FULL_SETUP.md`
  - Added a full setup guide with Supabase and Google auth steps.
- `docs/ANDROID_APP.md`
  - Added Android Studio skeleton documentation.
- `android/MainActivity.kt`
  - Added a starter Android WebView app skeleton.
- `python/recommendations.py`
  - Added a Python recommendation script for book suggestions based on borrow history and content similarity.

## What changed
- The borrow request flow now stores a `borrow_requests` row and generates a compact QR code that the admin scanner can read reliably.
- Admins can now create, update, and delete books including e-copy links and inventory counts.
- The homepage shows current library notices.
- Admin analytics now include chart visualizations of borrow activity.
- Google sign-in redirects to the current site home page instead of a hard-coded GitHub Pages URL.
