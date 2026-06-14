# Beta access — owner notes

Obertura is behind a small code gate so only people I invite can open it. This
is everything I need to run the private beta. (The gate lives in
`src/gate.ts`.)

## 1. Rotating the codes

Codes are hashed (SHA-256), not stored in plain text. The app accepts **any**
code whose hash is in the list, so you can run several at once. The current
codes are **`joan`** and **`thunderchess`**. To change them, edit one array in
`src/gate.ts`:

```ts
const ACCESS_CODE_SHA256S = [
  'd2dae6d1b4625413eade8cafcb06d6d000fdb57d963fc3c5c497084d42288319', // joan
  '7832da28625d9bf6dd2c2bcb092731debdec80664a0f77da564ae074a4787681', // thunderchess
];
```

Generate the hash of a new code with this one-liner (codes are trimmed and
lower-cased before hashing, so do the same here):

```sh
node -e "crypto=require('crypto');console.log(crypto.createHash('sha256').update('your-new-code'.trim().toLowerCase()).digest('hex'))"
```

Add or replace entries in the array (a trailing `// comment` to remember which
code is which helps), then rebuild and push so GitHub Pages serves it.

**Key fact:** rotating the code does **not** lock out testers who already
unlocked. Once a device passes the gate, it sets a flag in `localStorage`
(`obertura.betaUnlocked`) and never asks again — even if I later change the
code. So rotation only gates **new** people; it's not a way to evict existing
testers.

## 2. What to share

Send each tester two things, by hand:

- **URL:** https://marxal.github.io/obertura
- **A current code** (`joan` or `thunderchess`)

I collect tester emails myself, out of band (a note, a chat) — **the app
stores nothing about who's testing**: no emails, no accounts, no analytics.

## 3. What the tester does

1. Open the URL → **enter the code** → tap Unlock.
2. They land on a **welcome / install** screen.
   - **Android (Chrome, Edge, Samsung, Brave, Opera):** taps **Install app** —
     a real button that adds the icon to the home screen.
   - **Android (Firefox or other non-Chromium):** no button is possible, so the
     screen shows manual steps — browser menu (⋮) → **Install** / **Add to Home
     screen** (and a nudge to use Chrome for the smoothest install).
   - **iPhone (Safari):** taps the **Share** button → **Add to Home Screen**.
3. An **Obertura icon** appears on their home screen. Opening it launches the
   app full-screen, and it **updates automatically** from the URL — no
   reinstalling when I push new builds.

(There's always a "Continue in browser" link if they'd rather not install.)

## 4. Limitations

This is a **client-side** gate — a friendly speed-bump, not real security. Fine
for a small, trusted beta; not something to rely on for anything sensitive.
