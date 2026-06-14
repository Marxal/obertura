# Beta access — owner notes

Obertura is behind a small code gate so only people I invite can open it. This
is everything I need to run the private beta. (The gate lives in
`src/gate.ts`.)

## 1. Rotating the code

The current code is hashed (SHA-256), not stored in plain text. To change it,
replace one constant in `src/gate.ts`:

```ts
const ACCESS_CODE_SHA256 = '8310d97dad3fca12f8d8110bcb8f1c87e9cd9251222573ad0051a94726305e10';
```

Generate the hash of a new code with this one-liner (codes are trimmed and
lower-cased before hashing, so do the same here):

```sh
node -e "crypto=require('crypto');console.log(crypto.createHash('sha256').update('your-new-code'.trim().toLowerCase()).digest('hex'))"
```

Paste the printed hash in as the new value, then rebuild and push so GitHub
Pages serves it.

**Key fact:** rotating the code does **not** lock out testers who already
unlocked. Once a device passes the gate, it sets a flag in `localStorage`
(`obertura.betaUnlocked`) and never asks again — even if I later change the
code. So rotation only gates **new** people; it's not a way to evict existing
testers.

## 2. What to share

Send each tester two things, by hand:

- **URL:** https://marxal.github.io/obertura
- **The current code**

I collect tester emails myself, out of band (a note, a chat) — **the app
stores nothing about who's testing**: no emails, no accounts, no analytics.

## 3. What the tester does

1. Open the URL → **enter the code** → tap Unlock.
2. They land on a **welcome / install** screen.
   - **Android (Chrome):** taps **Install app**.
   - **iPhone (Safari):** taps the **Share** button → **Add to Home Screen**.
3. An **Obertura icon** appears on their home screen. Opening it launches the
   app full-screen, and it **updates automatically** from the URL — no
   reinstalling when I push new builds.

(There's always a "Continue in browser" link if they'd rather not install.)

## 4. Limitations

This is a **client-side** gate — a friendly speed-bump, not real security. Fine
for a small, trusted beta; not something to rely on for anything sensitive.
