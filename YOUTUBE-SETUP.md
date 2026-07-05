# YouTube video previews — optional one-time setup (no code)

The Learn tab already works without any of this: its Videos section shows a
one-tap **Search YouTube** button that opens the YouTube app with the right
search typed in. This guide is only for the optional upgrade — pasting a free
"API key" into Settings so the app can show video previews (thumbnails, titles,
channels) **inside** the Learn tab. It's a ~5-minute clicking exercise in
Google's console, free, no credit card. If you already did the Drive backup
setup (`DRIVE-SETUP.md`), you'll reuse the same `Obertura` project and step 2
is already done.

**What you'll end up with:** a key that looks like `AIzaSyB…`, pasted into
**Settings → Learning content** on the phone. It's stored only in the app's
browser storage on your device — never in the repo, never sent to me. The
restrictions in step 5 make the key useless anywhere except the app's own
address anyway.

## Step by step

1. **Open the console.** Go to <https://console.cloud.google.com> and sign in
   with your normal Google account (marxal87@gmail.com). Everything below stays
   inside the free tier — no billing setup, no credit card.

2. **Select (or create) the project.** Click the project picker at the top. If
   `Obertura` exists from the Drive setup, select it. Otherwise: **New
   project** → name it `Obertura` → **Create**, and make sure it's selected.

3. **Enable the API.** Left menu (or top search bar) → **APIs & Services →
   Library** → search for **YouTube Data API v3** → open it → **Enable**.

4. **Create the key.** **APIs & Services → Credentials** → **+ Create
   credentials** → **API key**. A key appears — copy it.

5. **Restrict it** (the important part — do this before using it). Click the
   new key to edit it:
   - **Application restrictions:** choose **Websites** and add
     `https://marxal.github.io/*`
   - **API restrictions:** choose **Restrict key** and tick only
     **YouTube Data API v3**
   - **Save.**

6. **Paste it into the app.** On the phone: **Settings → Learning content** →
   paste the key → **Save**. Open any line in the builder and swipe to the
   Learn tab — the Videos section now shows preview cards.

## Good to know

- **Quota:** the free tier allows roughly 100 searches per day. The app
  searches once per *opening name* (not per move) and remembers results for a
  week, so normal use is a handful of searches a day. If the quota ever runs
  out, the Videos section silently falls back to the search button until the
  next day — nothing breaks.
- **Removing it:** Settings → Learning content → clear the field → Save. The
  app instantly goes back to the keyless search button.
- **Safety:** the referrer lock means the key only answers requests coming from
  `marxal.github.io`. Still, treat it like a house key — it lives on your
  phone, no need to post it anywhere.
