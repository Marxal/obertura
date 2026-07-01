# Google Drive backup — one-time setup (no code)

The app's cloud backup needs one thing it can't create for itself: a free
Google "OAuth client ID". It's how Google knows the sign-in popup belongs to
Obertura. Creating it is a ~15-minute clicking exercise in Google's console,
done once, and costs nothing. Until it's done, Settings shows the cloud
section as "not set up" and everything else keeps working.

**What you'll end up with:** a long ID that looks like
`123456789-abc123.apps.googleusercontent.com`. Paste it into a Claude Code
session with: *"Here's the Drive client ID, wire it in: …"* — it goes into
`src/drive-backup.ts` and is safe to publish (client IDs are public by design;
there is no secret anywhere in this setup).

## Step by step

1. **Open the console.** Go to <https://console.cloud.google.com> and sign in
   with your normal Google account (marxal87@gmail.com). Accept the terms if
   asked. Everything below stays inside the free tier — no billing setup, no
   credit card.

2. **Create a project.** Click the project picker at the top (it may say
   "Select a project") → **New project**. Name it `Obertura`, leave
   organisation empty, **Create**, then make sure it's selected in the picker.

3. **Enable the Drive API.** In the left menu (or the top search bar) find
   **APIs & Services → Library**. Search for **Google Drive API**, open it,
   click **Enable**.

4. **Set up the consent screen** (the popup users see). Go to
   **APIs & Services → OAuth consent screen** (Google sometimes calls this
   "Google Auth Platform — Branding"). Choose **External**, then fill in:
   - App name: `Obertura`
   - User support email: your email
   - Developer contact email: your email
   - Everything else can stay empty. Save through the steps.

5. **Add yourself as a test user.** Still in the consent-screen area, find
   **Test users** (sometimes under "Audience") → **Add users** → enter
   `marxal87@gmail.com`. While the app is in *Testing* mode, only listed test
   users (up to 100) can connect — perfect for the beta.

6. **Create the client ID.** Go to **APIs & Services → Credentials** →
   **Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Name: `Obertura web`
   - **Authorized JavaScript origins** — add these two, exactly:
     - `https://marxal.github.io`
     - `http://localhost:5173` (lets local development builds connect too)
   - Leave "Authorized redirect URIs" empty (the app uses the popup flow).
   - Click **Create** and copy the **Client ID**.

7. **Hand it over.** Give the ID to Claude Code to paste into
   `src/drive-backup.ts` (`DRIVE_CLIENT_ID`), rebuild, and push. After the
   next deploy, Settings → Data shows "Connect Google Drive".

## Before selling the app publicly

Testing mode is fine for you and your beta testers, but strangers can't
connect (and Google shows an "unverified app" warning during sign-in). Before
a public paid release:

- In the consent-screen area, click **Publish app** (Testing → In production).
- Google will ask you to **verify** the app — a free review where you confirm
  the app name, add a link to the privacy policy, and justify the one scope it
  uses (`drive.appdata`, the hidden app-only folder — the narrowest Drive
  scope, which keeps the review light). Budget a few days to a few weeks.

This can wait until the Google Play work in `PUBLISHING.md` actually starts.
