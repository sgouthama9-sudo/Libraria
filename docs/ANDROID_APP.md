# Libraria Android App Skeleton

This is a minimal Android Studio starter for replicating the library website as a mobile app.
It uses a simple WebView for the frontend and can be extended to call Supabase directly.

## App structure
- `MainActivity.kt` — app entry point and WebView host.
- Use the existing web frontend inside a hosted URL or local web assets.

## Notes
- If you want native Supabase auth, use the Supabase Android SDK.
- This skeleton is intended as a starting point; it does not implement full app flows yet.

## How to use
1. Open Android Studio.
2. Create a new project using **Empty Compose Activity** or **Empty Activity**.
3. Replace the generated `MainActivity.kt` contents with the code in `android/MainActivity.kt`.
4. Add internet permission to `AndroidManifest.xml`:
   ```xml
   <uses-permission android:name="android.permission.INTERNET" />
   ```
5. Load your hosted `home.html` or a local web URL into the WebView.

## Recommended web approach
- Deploy `library-app` as a static site on Netlify/Vercel/GitHub Pages.
- Point the Android WebView at the hosted `index.html`.

## Future work
- Replace WebView with native screens.
- Use Supabase REST and Android SDK for auth, book browsing, and QR scanning.
