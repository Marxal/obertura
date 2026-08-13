# Bito Chess — landing page copy

Source of truth for the copy on `docs/index.html` (bitochess.com root).
UK spelling throughout. Rewritten 2026-08-13.

If you change wording, change it **here first**, then mirror it into
`docs/index.html`. The page is a standalone hand-written HTML file — nothing
generates it from this document, so the two only stay in sync by hand.

One rendering note: the page sets apostrophes as typographic quotes (’) rather
than straight quotes ('). The wording below is identical either way.

**Two things below are also in the app**, and have to move together:

- The **Full Access box** in [THE TWO PLANS] is the wording of the app's upgrade
  popup (`src/pro-sheet.ts`), which runs a shortened version of it. The app
  can't import from a static file in `docs/`, so the strings are typed out in
  both places.
- **9€** lives in three places that can't import from one another: this page,
  the app's `PRO_PRICE` (`src/entitlement.ts`), and the Lemon Squeezy product.
  Change all three together — and note the store is the one that actually
  charges, so if they disagree it is right and the others are the bug.

The legal documents are separate hand-written pages, not part of this file:
`docs/privacy.html`, `docs/terms.html`, `docs/licences.html`.

---

## [TOP BAR]

the app icon · bito chess · **Sign in**

The icon and the wordmark are one lockup on the **left**, in that order, and the
icon shrinks into the bar as the page scrolls. Signed in, the button becomes
**Open app** and every CTA becomes **Open Bito Chess →**.

**Sign in sits on the icon's centre line too**, same as the wordmark: at rest
the icon overhangs the bar and everything beside it is centred on the icon's
middle, not the bar's — Sign in used the bar's own centre until this pass and
sat visibly higher than "bito chess" the moment the page loaded at the top.

---

## [HERO]

**Eyebrow:** Your personal chess training lab

**H1:** Improve your next move

**Sub:** Build your lines, train the moves you forget, and prepare for the games
you’ll actually play.

**CTA:** Try it for free →

**Trust line:** No signup required.

**Above the board:** Play the move *(with a thin drawn arrow curving into the
board)*

**The board.** Six scripted lines, one at a time, played by the visitor. The
card names the loaded line (“Line 3 · Scholar’s Mate”), a discreet **Show
another line** sits under it, and the finish panel offers **Play another line**.
Confetti fires when a line completes. Black’s worse moves carry ?? / ? marks.

1. **Italian Game** — 1.e4 e5 2.Nf3 Nc6 3.Bc4
2. **Ruy López** — 1.e4 e5 2.Nf3 Nc6 3.Bb5
3. **Scholar’s Mate** — 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6?? 4.Qxf7#
4. **Queen’s Gambit** — 1.d4 d5 2.c4 e6 3.Nc3
5. **London System** — 1.d4 Nf6 2.Bf4 d5 3.e3
6. **Punishing the Damiano** — 1.e4 e5 2.Nf3 f6?? 3.Nxe5 fxe5? 4.Qh5+

---

## [HOW IT WORKS]

**H2:** How it works

1. **Build your repertoire** — Create lines on the board. Pull inspiration from the opening library, curated starter packs, engine suggestions, or your own past games.
2. **Confirm it once** — Play the line through once. That confirms what you want to learn and puts it into training mode.
3. **Remember it** — Bito keeps track of the moves you get right and the ones you forget. The moves that need work come back more often. The ones you know stay out of the way.

---

## [BUILD] — a numbered ledger, two up on a wide screen

**H2:** Build your repertoire your way

**Intro:** Build exactly what you want to play.

1. **Play it yourself** — Enter moves directly on the board and shape your own lines.
2. **Explore the opening world** — Browse thousands of named openings, starter packs or famous traps.
3. **Learn from your own games** — Import games from Chess.com or Lichess and turn the positions you actually played into training.
4. **Use the engine** — Explore alternatives, find better moves and build lines around ideas you discover.

---

## [TRAIN] — one bordered panel cut into rows

**H2:** Train what you actually need

**Intro:** Your training is driven by data, not random drills. Bito tracks your weak points and gives you multiple ways to fix them.

- **Drill new lines** — Walk through complete variations until they become muscle memory.
- **Review missed moves** — Target the individual positions you have forgotten.
- **Time attack** — Race against the clock through positions to beat your personal best.
- **Scout real opponents** — Import your tournament or online games to see what your opponents play, and build lines against their specific weaknesses.

**Closing pull-out:** The result is simple: **Less wondering what to study.** More time actually studying.

---

## [YOUR GAMES] — an editorial block: big opening line, detail beside it

Left-aligned and asymmetric, never centred — that's the one section on the page
this rule applies to; the two-plans section below is the opposite case (see
below). No rule/divider across the top either — cut after the first draft.

**H2:** Prepare for the games you actually play

**Opening line (set large):** Chess study is much more useful when it starts with your own games.

**Body:** Import your Chess.com, Lichess or enter your tournament games. Bito can show you where your opening play is working — and where it isn’t. Find the openings you keep struggling with. Discover mistakes that keep coming back. Turn those positions into things you can practise.

---

## [BEYOND OPENINGS] — a carousel, one card each

**H2:** There’s more than openings in here

**Intro:** Once your repertoire is built, keep sharpening the rest of your game.

- **Puzzles that fit you** — Rated tactics matched to your level, with puzzles that can also connect to the openings you actually play.
- **Fix your real mistakes** — Bito finds mistakes in your own games and turns them into positions you can play again, this time finding the better move.
- **Rediscover your brilliant moves** — You’ve probably played better chess than you realised. Bito brings your great and brilliant moves back so you can recognise those ideas again.
- **Learn the endings that matter** — Practise classic endgames and positions from your own games. Play them out against the engine and test yourself against exact tablebase judgement where available.
- **Analyse with the engine** — Play any position against Stockfish 18 lite to test ideas or explore alternatives.

---

## [PROGRESS] — heading plus a quote, with the measures as tags

**H2:** Measure your progress

Your games and training sessions become a picture of your progress.

Track your training streaks, move memory, puzzle rating, and win rates by opening to see exactly what needs work.

**Tags:** Training streaks · Move memory · Puzzle rating · Win rate by opening

**Quote:** “See how your moves improve.”

---

## [THE TWO PLANS] — one section, two boxes of the same size, stacked, CENTRED

> **The paid box is duplicated in the app** — `src/pro-sheet.ts` shows the same
> offer in the upgrade popup, shorter. Change both.
>
> The price is written **9€**, symbol after the number, in both places.
> There is deliberately no “€0” on the free box: a price of zero invites the
> reader to price-compare something that isn’t for sale.
>
> Both boxes are CENTRED (heading, price, body copy) — this is the opposite
> choice from [YOUR GAMES] above, and deliberately so: a price card reads as a
> price card when everything funnels down to one button in the middle. Only the
> Full Access checklist stays left-aligned inside the centred box — a tick list
> read centred loses its scan line down the left edge.

**H2:** Start free

**Intro:** Use Bito Chess without an account — or sign up free to sync your repertoire across devices.

### Box 1 — Free

**FREE** · **Everything you need to get started.**

Build and save as many repertoire lines as you want. Explore the opening library. Import games. Solve puzzles. Analyse positions. Train up to 10 lines at a time.

**Try Bito Chess →** · No signup required.

### Box 2 — Full Access (brass edge, deeper shadow: the premium one)

**FULL ACCESS** · **Your whole repertoire.**

**9€** one payment

“One payment” is written once now, next to the price where it belongs (not
also in the headline — it repeated itself in an earlier draft).

Want to train everything you’ve built? Bito Chess is a solo project — no ads, no investors, no subscriptions. Full Access unlocks unlimited training and helps fund what’s next.

- Unlimited active training rotation
- One-time payment, no subscription ever

**CTA:** Unlock full access →

**Under the buy button:** Secure checkout via Lemon Squeezy. A Bito Chess
account is required so your purchase can follow you across devices. *(Signed in:
“Secure checkout via Lemon Squeezy. The unlock lands on the account you’re
signed in to.”)*

**“A Bito Chess account”, never just “an account”** — the next screen after this
one belongs to Lemon Squeezy, and nobody should have to work out which of the
two accounts they are being asked for. Same wording in `src/checkout.ts`.

**Signed out, Unlock full access opens a card ON THIS PAGE first** — it used to
navigate straight into the app with no warning. `#signup-overlay` in
`docs/index.html`, styled to match this price card (same brass edge, same
`.tier__name` label):

> **FULL ACCESS**
> ### Create your Bito Chess account first
> Full Access is tied to your account, so it follows you to any device you sign
> in on — and comes back if you ever reinstall. You’ll create it on the next
> screen, then land straight back at checkout.
>
> **Create account →** · Not now

Only that card's own button makes the jump to `/app/?auth=signup&buy=1`.
Signed in, the card never appears — straight to Lemon Squeezy, unchanged.

---

## [WHY] — set as a comic speech bubble

**H2:** Why I made Bito Chess

I’m a chess player, but not a particularly strong one. 🥹

I tried a lot of opening trainers. They were too rigid, too complicated, or just didn’t match how I wanted to learn.

I wanted something where I could build and store my own repertoire, practise the things I actually forgot, learn from my own games, and prepare for real opponents.

So I built the tool I wanted to use — and I got +200 rating points in the first month!

If it helps other players enjoy studying chess as much as I do, even better.

**Signature:** Marçal — Designer, chess player, and the whole team behind Bito Chess.

Both the name **and** the portrait link to **marxal.net**. The portrait is
`docs/marcal.png`, shown as a circle with a brass stroke and a hard offset
shadow, echoing the speech bubble — big enough to read as a real portrait, not
an avatar. If that file is missing the page falls back to the pixel pawn rather
than a broken image.

**150×150 on desktop, 190×190 and stacked on a phone.** Below 900px the row
(portrait beside two lines of text) doesn't have the width to spend — a bigger
circle next to a name and role would squeeze the text into a five-line ribbon —
so the layout switches to portrait-above, name-and-role-below, both centred.

---

## [ABOUT] — its own band, one panel with a brass rule: icon + heading left, statement right

The sober counterpart to the section above it — the same subject as fact rather
than as a story. Dressed the way the legal pages' "short version" box is
(`docs/legal.css` `.tldr`): a brass rule down the left edge, plus the app icon
above the heading so the panel carries the same face as the top bar rather than
reading as a slab of plain text.

**H2:** About Bito Chess

Bito Chess is a one-person project. There are no investors, no ads, and no business model based on selling your data. An account is strictly optional and is only used to sync your data across devices. Upgrading to Full Access helps keep the project alive.

---

## [FINAL CTA]

*(the pixel pawn hops here, the same one the app plays after a training run)*

**H2:** Ready to build your first line?

**Sub:** Your next move starts here.

**CTA:** Try Bito Chess →

**Trust line:** No signup required.

---

## [FOOTER]

bito chess

Privacy · Terms · Licences · Contact

© 2026 Bito Chess
