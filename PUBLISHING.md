# Publishing Bito Chess — options, costs and the recommended path

The goal, in Marçal's words: sell the app with a **one-time payment**, without
being tied to a server. This document is the full decision guide: what's
possible, what each route costs, where the traps are, and the order I'd do
things in. Nothing here is started until you say go.

## Where we stand

Bito Chess is a PWA (an installable web app) served free at
`https://bitochess.com/app/`, and mirrored for internal testing at
`https://marxal.github.io/obertura/`. All data lives on the device; signing in
keeps a synced copy in the user's account (see `SUPABASE-SYNC.md`). The Google
Drive backup that used to fill that role has been retired — the account does it
better and asks for nothing from anybody's Drive.

## The one honest tension first: the web app is public

Anyone can open the GitHub Pages URL in a browser for free, today. If the
paid product is "the same app in a store", a determined person can always use
the free URL instead. The realistic ways to handle it:

1. **Web free, store app paid** *(recommended)* — the web version is the demo
   and the marketing; the store app sells convenience: a real icon, store
   updates, later offline support. This is a very common indie model, needs
   zero extra code, and at personal-project scale "someone used the free URL"
   costs you nothing.
2. **Lock the web version** — possible without a server (a license key checked
   against a payment provider's API), but it adds real code, real support
   burden, and annoys legitimate users. Not recommended for v1 of selling.
3. **Take the web version down** — kills your demo, your beta testers' access,
   and the URL the Android app itself is served from (the store app IS the
   web app — see below). Not viable.

## Option 1 — Google Play (recommended first)

Android can ship a PWA as a **Trusted Web Activity (TWA)**: a tiny native
wrapper that opens the real web app full-screen, chrome-less. The app in the
store *is* `marxal.github.io/obertura` — no rewrite, and every web deploy
updates the "app" instantly without a store re-review. Tools like
**PWABuilder** (pwabuilder.com, free, point-it-at-your-URL) or Bubblewrap
generate the Android package.

**Money:** $25 developer registration, once, forever. On a **paid app**
(pay-before-download) Google runs the whole transaction and keeps 15% (at
indie volumes). No billing code, no server, nothing to maintain — this is the
cleanest possible one-time payment.

**The checklist, in order:**

1. Create a Google Play developer account ($25, needs ID verification).
2. Prove you own the web app: a small file must exist at
   `https://marxal.github.io/.well-known/assetlinks.json` — note that's the
   **root** of `marxal.github.io`, not the `/obertura/` path. On GitHub that
   means creating one extra (free) repository named exactly
   `marxal.github.io` containing just that file. PWABuilder generates the
   file's contents; without it the app shows a browser bar instead of looking
   native.
3. Generate the Android package with PWABuilder from the live URL.
4. Store listing: name, description, screenshots (phone + 7-inch), the icon,
   a **privacy policy URL** (`https://bitochess.com/privacy.html`, already
   written), a content-rating questionnaire, and the data-safety form. The
   data-safety answers are unusually easy here: no analytics, no ads, no
   tracking; an email address for the account, and the chess data the user
   asked to sync.
5. **The big gotcha for new personal accounts:** before you may publish to
   production, Google requires a **closed test with at least 12 testers
   enrolled continuously for 14 days**. Plan for this — it's the beta list's
   moment (see `BETA-ACCESS.md`). Testers install from a Play link you send.
6. Decide paid-vs-free **before** the first production release: a free Play
   listing can never later become paid-up-front (you'd have to switch to
   in-app purchases, which means integrating Play Billing into the wrapper —
   real extra work). Set the price at launch.

**Also worth knowing:** the paid app still loads the public web URL, so
"piracy" is just… using the website (see the tension above — priced in).
Reviews take a few days the first time. The Google sign-in consent screen
should be verified before launch.

## Option 2 — Microsoft Store (desktop, optional, cheap)

Desktop needs no store at all — Chrome and Edge install the PWA from the
address-bar icon on Windows/Mac/Linux today, and signing in on both makes the
desktop and the phone share one repertoire. But if you want a real desktop
storefront: the **Microsoft Store accepts PWAs almost as-is** (PWABuilder
again), registration is a one-time ~$19 for individuals, and paid listings
work the same way. Low effort, low reach, entirely optional.

## Option 3 — Apple App Store (defer)

The honest list of hurdles:

- **$99/year**, forever, plus Apple keeps 15% (Small Business Program).
- **Requires a Mac** with Xcode to build and submit. No Mac, no App Store.
- No TWA equivalent: the app must be wrapped with **Capacitor** into a real
  iOS project, and Apple's guideline 4.2 ("minimum functionality") rejects
  apps it judges to be thin website wrappers. Chess trainers with offline
  data have passed review, but rejection risk is real and appeals cost weeks.
- iPhone users can still install the PWA from Safari ("Add to Home Screen"),
  so iOS isn't dark — it's just store-less.

**Verdict:** revisit only if the Play version sells and iPhone users ask.
The yearly fee alone means it should earn its keep.

## Option 4 — Sell from the web, no stores

**This is what shipped, and it is no longer hypothetical** — see STRIPE-SETUP.md.
Bito Chess sells the unlock directly through Stripe Checkout: no store review, no
15% cut, no $25/$99. There is no license key to gate — access is a flag on the
account (`profiles.entitled`), written by a signed webhook, which is both simpler
and impossible to copy between devices.

What it costs instead is the merchant-of-record job that a reseller like Gumroad
or Lemon Squeezy absorbs: you are the seller, so EU VAT and receipts are yours.
Stripe's own cut (~1.5% + fixed for European cards) is well under a reseller's
~5–10%, and the difference is roughly the price of an accountant's opinion.
Installs stay manual ("open this URL, tap Add to Home Screen") and discoverability
is whatever marketing you do — the two real costs of not being in a store.

## Recommended sequence

1. **Now:** finish the Supabase account setup end to end — `SUPABASE-SYNC.md`
   §9 is the checklist, and custom SMTP is the step that actually blocks
   registrations if it's skipped.
2. **Prep:** privacy policy page on the landing site; the `marxal.github.io`
   repo with `assetlinks.json`; screenshots.
3. **Play:** developer account → PWABuilder package → closed test with the
   beta group (the mandatory 12-testers/14-days window doubles as the final
   beta) → set the one-time price → production.
4. **Optional:** Microsoft Store for a desktop storefront.
5. **Later, only on demand:** Apple via Capacitor.

## Deferred design note — the last piece of true sync

Automatic two-device sync now exists: both halves of the account row carry a
timestamp, each device remembers the last one it saw, and it pulls and merges on
sign-in, on foreground and every few minutes (`src/repertoire-sync.ts`). Lines
merge by move, games by id, statistics by last-write-wins.

What is still deferred is the one thing merge can't do — **propagate a
deletion**. Delete a line on phone A and phone B hands it back, because there is
no way to tell "deleted" from "hasn't arrived yet". Doing it properly needs:

- a per-move or per-line `updatedAt`, bumped on every save, so a merge can be
  "newest wins" rather than "union";
- **deletion tombstones** (a remembered list of deleted ids and when), kept long
  enough that a device offline for a month still learns about them;
- a rule for what happens when the same line is edited on one device and deleted
  on the other.

Until then the escape hatch is explicit and adequate: Settings → Data → "Replace
this device from your account" takes the account's copy exactly, which is how you
make a deletion stick everywhere.

The existing `mergeLines()` in `src/storage.ts` is the right foundation; this
note exists so a future round starts from the design, not from scratch.
Dropbox (or others) would follow the same pattern as `src/drive-backup.ts`
with a different OAuth + API layer — add only if users ask.
