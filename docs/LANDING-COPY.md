# Bito Chess — landing page copy

Source of truth for the copy on `docs/index.html` (bitochess.com root).
UK spelling throughout. Approved 2026-08-12.

If you change wording, change it **here first**, then mirror it into
`docs/index.html`. The page is a standalone hand-written HTML file — nothing
generates it from this document, so the two only stay in sync by hand.

One rendering note: the page sets apostrophes as typographic quotes (’) rather
than straight quotes ('). The wording below is identical either way.

---

## [TOP BAR]

bito chess · **Sign in** · the app icon

Signed in, both change: the link becomes **Open app** and every CTA becomes
**Open Bito Chess →**.

---

## [HERO]

**Eyebrow:** Chess opening trainer

**H1:** Improve your next move

**Sub:** Build your repertoire, train smarter, and play with confidence.

**CTA:** Try it for free

**Trust line:** No signup required

**The board** (three scripted moves of the Italian Game, played by the visitor):

1. Your move. Follow the arrow: play **e4**. → The centre is yours. Black answers **e5**.
2. Now develop and hit that pawn: **Nf3**. → Black defends with **Nc6**.
3. One more. Point the bishop at f7: **Bc4**. → Bishop out, eyes on f7 — the Italian Game.

**Finish panel:** That's the Italian Game. Three moves you now own — the app
remembers the other forty for you. · *Try it for free* · Play it again

---

## [HOW IT WORKS]

**H2:** How it works

1. Build a line. Play it out on the board, or pull it from the library, a study, or one of your own games.
2. Confirm it once. Walk through it, then play it back. That's what puts it into training.
3. It comes back before you forget. Spaced repetition tracks every move you play and returns the ones you're losing.

---

## [BUILD]

**H2:** Your repertoire, built your way

**Intro:** Not everyone learns an opening the same way, so there are four ways in:

- Enter moves straight on the board
- Browse a built-in library of ~3,700 named openings, offline
- Import your own games from Chess.com and Lichess
- Start from a curated opening pack, a Lichess study, or a famous trap

---

## [TRAIN]

**H2:** Focused practice, not random drills

Every move you learn carries its own memory score. The app brings back what's slipping and leaves alone what's solid.

Drill a full line, practise single positions, race a timed session, or go straight at your weakest moves. You always know why you're being shown a move.

---

## [YOUR GAMES]

**H2:** Prepare for the games you actually play

Import from Chess.com or Lichess and the app reads your history back to you: which openings you lose in, the mistakes you keep repeating, the winning positions you let slip.

Scout an opponent before a club match and see what they really play — then build the lines you'll actually face, not the ones in the book.

---

## [BEYOND OPENINGS] — a carousel, one card each

**H2:** There's more than openings in here

- **Puzzles that fit you** — Rated tactics matched to your level — and, when you want, to the openings you actually play.
- **Fix your real mistakes** — The app finds the blunders in your own games and hands them back as positions to play properly.
- **Your brilliant moves** — Rediscover the good moves you've already found. Most of them you never noticed at the time.
- **Endgames, judged properly** — Train the endings that decide games against a tablebase, which knows exactly how long it should take.
- **Play it out** — A casual game against Stockfish from any position on the board — including the one you just built.

---

## [PROGRESS]

**H2:** See whether it's working

Memory strength across your whole repertoire, training streaks, puzzle rating, win rate by opening, and how your results move over time.

Less wondering what to study. More time actually studying.

---

## [PRICE]

**H2:** One price. Once.

**Free — €0.** Build as many lines as you want, train ten of them at a time, and use everything else: puzzles, game import, analysis, endgames, statistics. · *Start free*

**Full access — €9 once.** Train your whole repertoire, no cap. No subscription, no renewal, no ads — you pay once and that's the end of it. · *Buy full access*

**Under the buy button:** Secure checkout. You'll sign in first so the unlock
lands on your account. *(Signed in: "…the unlock lands on the account you're
signed in to.")*

> €9 lives in three places that can't import from one another: this page
> (`docs/index.html`), the app's `PRO_PRICE` (`src/entitlement.ts`), and the
> Lemon Squeezy product. Change all three together — and note the store is the
> one that actually charges, so if they disagree it is right and the others are
> the bug.

---

## [WHY] — set as a comic speech bubble

**H2:** Why I made Bito Chess

I'm a passionate chess player and not a particularly strong one 🥹

I tried a lot of opening trainers. They were too rigid, too complicated, or just didn't match how I wanted to learn — so I built the one I wanted.

If it helps other players enjoy studying chess as much as I do, even better.

**Signature:** Marçal — Designer, chess player, and the whole team behind Bito Chess.

**About the app**

- A one-person side project. No investors, no ads, no data to sell.
- Your lines live on your phone. An account is optional and only syncs them.
- It installs like an app, and it's built and tested on a real phone, not a spec sheet.

---

## [FINAL CTA]

*(the pixel pawn hops here, the same one the app plays after a training run)*

**H2:** Ready to build your first line?

**CTA:** Try it for free

**Trust line:** No signup required
