# Bito Chess — landing page copy

Source of truth for the copy on `docs/index.html` (bitochess.com root).
UK spelling throughout. Repositioned 2026-10-24 around game analysis and personal training.

If you change wording, change it **here first**, then mirror it into
`docs/index.html`. The page is a standalone hand-written HTML file — nothing
generates it from this document, so the two only stay in sync by hand.

One rendering note: the page sets apostrophes as typographic quotes (’) rather
than straight quotes ('). The wording below is identical either way.

**Shared offer details:**

- The **Full Access box** shares feature entitlements with the app's upgrade
  popup (`src/pro-sheet.ts`). Its landing-page heading is “More room to grow.”. The app
  can't import from a static file in `docs/`, so the strings are typed out in
  both places.
- **The price** lives in three places that can't import from one another: this
  page, the app's built-in fallback (`FALLBACK_AMOUNTS` in `src/pricing.ts`), and
  the Stripe Price objects. Stripe is the one that actually charges, so if they
  disagree it is right and the others are the bug.

  Since the Stripe migration, both the landing page's price card and the app's
  paywall FETCH the real number (`GET /api/stripe/prices`) and overwrite what was
  typed in. The hard-coded 12€ in each is now a no-JS / offline fallback rather
  than a second source of truth — so the copy below is the shape, and Stripe is
  the number. A Swedish device is quoted in kronor instead (139 kr, a figure you
  should confirm or change when you set the SEK price in Stripe — see
  STRIPE-SETUP.md).

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

**Eyebrow:** Personal chess training, built around your games

**H1:** Improve your next move

**Sub:** Analyse your games, practise the mistakes that cost you points, and build an opening repertoire you remember. Bito Chess turns the games you play into training made for you.

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

## Your games show you what to practise

Every game leaves something to learn. Bito helps you find it and work on it.

- **Bring in your games** — Import games from Chess.com or Lichess to build your personal game library.
- **Discover the turning points** — Find costly mistakes, missed opportunities and positions worth another look. Explore the alternatives with engine analysis.
- **Turn analysis into practice** — Return to those positions as interactive exercises. Find a better move yourself, then take what you’ve learnt into your next game.

---

## Exercises from games you actually played

Recognising a mistake in analysis is a start. Finding the better move yourself is the next step.

- **Try your mistakes again** — Revisit a position where you went wrong and play a stronger move. Practise keeping a winning advantage and punishing your opponent’s mistakes.
- **Become a blunder detective** — Watch a short sequence from one of your games. Spot the move that changed everything, then find what should have been played.
- **Choose the better move** — Compare your original move with an engine alternative. Decide which is stronger before revealing the answer.
- **Think under time pressure** — Work through positions from your games against the clock. Practise making decisions when there’s little time to spare.
- **Rediscover your best moves** — Find your own strong and brilliant moves again, and practise recognising the ideas behind them.

---

## Build openings you can rely on

Choose what you want to play, explore your options and remember your moves when you need them.

- **Create your own repertoire** — Enter moves on the board, browse thousands of named openings or begin with a starter pack. Explore famous traps and investigate alternatives with the engine.
- **Learn from your opening results** — See which openings bring good results and which keep causing problems. Turn positions from your games into lines you can practise.
- **Remember with spaced repetition** — Play through your lines, then review them over time. Moves you struggle with return more often, so practice follows what you need to remember.
- **See how your lines connect** — Explore your repertoire as a visual tree, with your variations and branches together.
- **Prepare for an opponent** — Explore an opponent’s games, discover what they tend to play and build your preparation around the positions you might meet. Available with Full Access.

---

## Sharpen your tactics

Practise spotting threats, finding combinations and making the most of your chances.

- **A daily rated mix** — Solve a mix of puzzles informed by your repertoire and games, and track your Bito puzzle rating as you practise.
- **Focus your practice** — Choose puzzles by opening or tactical theme to work on specific ideas.
- **Race the clock** — Challenge yourself in Time Attack and try to beat your personal best.
- **Revisit missed puzzles** — Puzzles you get wrong return over time, giving you another chance to recognise the pattern.

---

## Make improvement a daily habit

Build a daily challenge around opening lines, tactics, endgames and exercises from your own games.

- **Choose your daily practice** — Pick the activities, their order and how much you want to practise.
- **Keep your learning moving** — Track your streak, revisit previous sessions and keep working on positions that need attention.

---

## [THE TWO PLANS] — one section, two boxes of the same size, stacked, CENTRED

> **The paid box shares feature entitlements with the app** — keep the feature lists consistent with `src/pro-sheet.ts`. The marketing heading can differ.
>
> **Both boxes are plain feature lists now — no explanatory prose.** An earlier
> draft had a body paragraph per box, a launch-price comparison against
> Chessbook, and a line explaining why game-sync is the paid half. All of that
> got cut: the ticks say what's included, full stop. Don't re-add reasoning
> sentences here — if a feature needs explaining, that explanation belongs on
> the feature's own page in the app, not in the pricing box.
>
> **The price shown is always the Stripe price** — never hand-typed as a
> sentence. `docs/index.html`'s script and `src/pro-sheet.ts`'s `opts.price`
> are the only two places a number appears, and both fetch it. Don't add a
> price mention anywhere else in this section.
>
> **Both boxes are CENTRED** (heading, price, tick list) — this is the opposite
> choice from [YOUR GAMES] above, and deliberately so: a price card reads as a
> price card when everything funnels down to one button in the middle. Only the
> tick lists themselves stay left-aligned inside the centred box — a tick list
> read centred loses its scan line down the left edge.
>
> **The Free box's import tick used to say "100 games" — that was the GUEST
> number, not the free-account one.** `FREE_GUEST_IMPORT` (100) caps a
> signed-out visitor's single scan; a free account has always had the full
> ladder up to `HARD_CAP` (1,000). Fixed 2026-09, alongside dropping the
> free-account games-store cap entirely (`FREE_STORED_GAMES` in
> `src/entitlement.ts` — removed, since games never sync on free anyway and the
> cap was guarding the user's own phone, not the database). Don't quote the
> guest number here again; it belongs only in the app's own guest-facing copy
> (`import-tier.ts`, `import-panel.ts`).

**H2:** Start free

**Intro:** Use Bito Chess without an account — or sign up free to sync your repertoire across devices.

### Box 1 — Free

**FREE** · **Everything you need to get started.**

- Build up to 500 lines
- Train 10 at a time
- Sync across your devices
- Import up to 1,000 games, kept on your device
- Library and starter packs
- Puzzles and endgames
- Engine and analyser
- Backup and PGN export

**Try Bito Chess →** · No signup required.

### Box 2 — Full Access (brass edge, deeper shadow: the premium one)

**FULL ACCESS** · **More room to grow.**

**{price}** one payment — always the live Stripe number, never typed in.

- Your whole games library, synced and kept
- Unlimited active training rotation
- Unlimited repertoires
- Opponent scouting
- One-time payment, no subscription ever

**CTA:** Unlock full access →

**Under the buy button:** Secure checkout. A Bito Chess account is required so
your purchase can follow you across devices. *(Signed in: “Secure checkout. The
unlock lands on the account you’re signed in to.”)*

Stripe IS named in the app's version of this note ("Secure checkout via
Stripe", `src/pro-sheet.ts`) and deliberately not named here. The difference is
where the reader is standing: on this page the word is one more unexplained
brand between them and the thing they want, while in the app they have already
decided to buy and the name is reassurance about the screen they're about to see.

**“A Bito Chess account”, never just “an account”** — the next screen after this
one belongs to Stripe, and nobody should have to work out which of the two
accounts they are being asked for. Same wording in `src/checkout.ts`.

### Signed out: the account card (`#signup-overlay`)

A ONE-STEP interstitial on this page, styled to match the price card above
(brass edge, `.tier__name` label) — not a form, not a sign-in flow. It exists to
answer "why am I being asked to sign up" before it's asked, and nothing more.
Its own button is the only thing that navigates.

> **FULL ACCESS**
> ### Create your Bito Chess account first
> Full Access is tied to your account, so it follows you to any device you sign
> in on — and comes back if you ever reinstall. You’ll create it on the next
> screen, then land straight back at checkout.
>
> **Create account →** · Not now

Tapping **Create account →** navigates to `/app/?auth=signup&buy=1` — the
app's own sign-up sheet, which continues straight to checkout once the account
exists. **Not now**, Escape, and a backdrop tap all just close the card.

**A fuller version of this — a real email/password form running against
Supabase's REST API directly from this page, so the visitor never touches the
app at all — was tried and reverted.** It worked, but it read as more form than
the moment called for. This one-step card is the deliberate choice: say why,
then hand off.

**Where the card does NOT appear:** signed in already — straight to checkout.

---

## [WHY] — set as a comic speech bubble

**H2:** Why I made Bito Chess

I’m a passionate chess player, but not a particularly strong one. 🥹

I tried a lot of opening trainers. They were too rigid, too complicated, or just didn’t match how I wanted to learn.

I wanted something where I could build and store my own repertoire, practise the things I actually forgot, learn from my own games, and prepare for real opponents.

So I built the tool I wanted to use — and I got +200 rating points in the first month!

If it helps other players enjoy studying chess as much as I do, even better.

> Restored 2026-10-30: this is Marçal's own copy. A rewrite on 2026-10-24
> ("Built by a player who wanted a better way to learn…") replaced it and was
> reverted at his request — keep this wording.

**Signature:** Marçal — Designer, chess player, and the whole team behind Bito Chess.

Both the name **and** the portrait link to **marxal.net**. The portrait is
`docs/marcal.png`, shown as a circle with a brass stroke and a hard offset
shadow, echoing the speech bubble — big enough to read as a real portrait, not
an avatar. If that file is missing the page falls back to the pixel pawn rather
than a broken image.

**The speech bubble's tail points at the middle of the portrait.** Its size
comes from the same `--avatar` token the portrait is sized from, so the two
can't drift apart: half the avatar's width in on desktop (where `.who` is a row
starting at the bubble's own left edge), dead centre on a phone (where `.who` is
stacked and centred).

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

Bito Chess is a one-person project. There are no investors, no ads, and no business model based on selling your data. You can try the app without an account. A free account syncs your repertoire across devices, and Full Access adds game-library sync and is tied to your account. Upgrading to Full Access helps keep the project alive.

---

## [FINAL CTA]

*(the pixel pawn hops here, the same one the app plays after a training run)*

**H2:** Give your next game something to build on

**Sub:** Bring your games. Find something to work on. Practise your next move.

**CTA:** Try Bito Chess → (opens `/app/` directly; signup remains optional)

**Trust line:** No signup required.

---

## [FOOTER]

bito chess

Privacy · Terms · Licences · Contact

© 2026 Bito Chess


## Section layout — 2026-10-24

The feature copy above is unchanged. Each section has its own presentation:

- Your games: three-step horizontal journey, stacked on phones.
- Personal exercises: asymmetric five-card grid with a featured mistake-retry card.
- Openings: illustrative repertoire tree beside introductory text; three supporting notes below. Tree explicitly labelled as an example, not an app screenshot.
- Tactics: editorial heading beside a four-tile grid.
- Endgames: decorative chess-piece vignette beside three text explanations.
- Daily practice: green panel with a sample activity checklist. No invented completed tasks or streak counts.
- Rating progress: visual measurement panel beside explanations. No fabricated rating series or promised improvement.

All layouts use the existing theme tokens and collapse for mobile. No external images, fonts or JavaScript dependencies added. Existing demo and checkout behaviour retained.


## Wooden image treatment 2026 10 25

Generated transparent wooden chess illustrations replace the faint hero knight and the endgame Unicode vignette, with a floating knight bishop and pawn composition beside the personal-exercises introduction. These are decorative illustrations with empty alternative text and hidden decorative containers; feature text is unchanged.

Assets live in docs/art as 1000px and 500px transparent WebP images. The same files work in both colour schemes, with theme-specific saturation, brightness, soft shadows and an amber radial halo instead of a baked background. Images have fixed dimensions, responsive source selection and lazy loading. Desktop scrolling produces small clamped translations and rotations from stationary anchors. Mobile and reduced-motion visitors see static art. Motion preferences are observed live and no continuous animation loop runs.


## Landing refinement 2026-10-25

This update supersedes the endgame and rating/statistics landing sections above: both standalone sections are removed. App features are unchanged. Journey icons now depict import, analysis and practice. Exercise icons use chess mistake (?), blunder (??), comparison, two-sided chess clock and brilliant (!!) symbols, drawn as consistent inline SVGs in the theme palette. Tactics icons follow the same SVG style.

The repertoire illustration is now a labelled Italian Game example: 1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5. White's chosen moves are highlighted, followed by a spaced-repetition explanation. It replaces the schematic branching tree. Scroll reveals ease in over 520ms, journey rules draw on entry and example moves appear in sequence. All new animation is disabled under reduced motion; existing bounded decorative parallax is preserved.


## Exercise badges — 2026-10-25

The personal-exercise cards reuse the app's filled circular move-classification badges, matching classIcon geometry, glyphs and CLASS_COLOR from src/icons.ts: orange mistake (?), red blunder (??), green best-move star and teal brilliant (!!). Timed practice keeps its two-sided chess clock. Explicit SVG fills preserve the badge colours and white symbols in both themes. This supersedes the outline annotation icons from the preceding refinement.


## Circular chess-clock badges — 2026-10-25

Timed game exercises and Time Attack use a white two-sided chess clock inside a filled blue disc (#5c8bb0, the app's great-move blue). Both match the other exercise badges' 44px size and circular geometry, with explicit SVG fills/strokes preserved in light and dark themes.


## Scroll-driven wooden pieces — 2026-10-25

Wooden images now follow a shallow horizontal arc with vertical drift, rotation, a slight perspective tilt and gentle scaling as their stationary container crosses the viewport. The light pool moves in the opposite direction for layered depth. Desktop movement is bounded to 26px horizontal, 72px vertical and 12 degrees rotation; phones use 38% of the movement. Transforms ease over 180ms, without an idle animation loop. Reduced motion disables all piece and halo transforms/transitions. Live preference changes reset the new variables. Validation: inline script syntax and executable checks of the actual transform block at multiple viewport positions for desktop/mobile bounds and scale.


## Landing presentation pass — 2026-10-30

Supersedes the layout notes in every dated section above (2026-10-24 and
2026-10-25). Feature copy is unchanged; what is new is the short labels and the
microcopy inside the interactive demos, listed here so they have a home.

**Section labels (kickers, above each H2):** Game analysis · Personal
exercises · Opening repertoire · Puzzles · Daily challenge.

**Your games:** three cards labelled Step 1 / Step 2 / Step 3, each with a
small drawn scene (import list with result chips, an evaluation graph with a ??
turning point, a board corner with the better move). Illustrations only — no
names, ratings or numbers.

**Exercises:** five stacking cards (each sticks a little lower than the last
and the one underneath sinks back). Each carries a playable example position —
example positions, not anyone's game:

1. *Try your mistakes again* — back-rank mate. “In the game you played h3?
   here. White to move — find the stronger move.” → “Rd8#★ Checkmate — the
   move you missed, found.” Misses: “Not that one. Look at Black’s back rank.”,
   then “The rook can reach the eighth rank — follow the arrow.”
2. *Become a blunder detective* — Légal’s mate plays itself (5.Nxe5 Bxd1
   6.Bxf7+ Ke7 7.Nd5#). “Checkmate. Which move changed everything? Tap it.” →
   “5…Bxd1?? took the queen and walked into mate. Better was 5…dxe5.” Button:
   Watch again.
3. *Choose the better move* — Your move Nc3 vs Engine Ne7+. “Right. Ne7+ forks
   the king and the queen.” / “Your Nc3 just retreats. Ne7+ forks the king and
   the queen.”
4. *Think under time pressure* — “Start the clock”, ten seconds. “White to
   move. Win material before the flag falls.” → “d5! forks both knights, with N
   seconds to spare.” / “Time! d5 forks both knights.” Button: Go again.
5. *Rediscover your best moves* — Qg8+!! Rxg8 Nf7#. “You found something
   special here once. White to move — find it again.” → “Qg8+!! then Nf7#: a
   smothered mate. Your best move, found again.”

**Openings:** a sticky walk-through. The five feature notes scroll past one
pinned example tree (“My White lines”, 1.e4 against e5 / c5 / e6, four line
ends), which changes per note. Legend lines:

1. Build — “Your moves in green, the replies you expect in outline. Add a move
   and the line grows.”
2. Results — “Each reply carries how it has gone in your games. 1…c5 keeps
   causing problems.” (win/draw/loss bars, shapes only, no numbers)
3. Review — “Dashed rings mark the moves due today. The ones you miss come back
   sooner.”
4. Connect — “Every line end is a line you train. Tap one to trace it.”
   (tapping a line end shows its name and moves)
5. Prepare — “Your opponent’s favourite reply, lit up — so you know which
   branch to prepare.” Tag on the tree: THEIR FAVOURITE.

The Italian Game box is gone.

**Puzzles:** the old “Sharpen your tactics” section, now a short puzzles-only
section: centred heading, four mode tiles with the app's own icons (puzzle
piece, target, stopwatch, reset arrow), each with its own hover motion.

**Daily challenge:** the felt panel, with a working copy of the app's daily
card beside the copy: “Daily challenge” · “N parts today” · a Monday-first week
row with today ringed (no invented streak) · five rows using the app's own
labels (TASK_META in `src/daily-challenge.ts`): 3 lines to remember, 3 puzzles
to solve, 3 endgame puzzles, 2 mistakes to fix, 2 minutes under pressure. − / +
change the count (0 is off, shown as “Lines to remember — off”), ↑ / ↓ move the
row. Nothing is saved. Button: Try Bito Chess →.

**Buttons:** the → on every button nudges forward on hover.


## Exercises, openings, analysis and founding price — 2026-10-30 (second pass)

Supersedes the exercise and openings notes in the pass above where they differ.

**[ANALYSE NOW] — new felt band straight after "Your games"**, the app's own
first question (`src/onboarding-where.ts`), answered on this page:

> **Kicker:** Try it with your games
> **H2:** Where do you play?
> **Sub:** We’ll read your games and show you the openings you actually play.
> Tabs: Chess.com · Lichess · placeholder “Your Chess.com username” / “Your
> Lichess username” · **Import my games →**
> *Free, no signup. Your games stay on your device.*

It opens `/app/?import=chesscom|lichess&user=NAME`; the app reads that once
(`src/import-link.ts`) and goes straight into the import.

**Exercises.** Every card now has a **How it works** box in its left half
(desktop only), two exercises with progress pills and **Next exercise →** /
**Start again** (the blunder detective has one, time pressure has three
positions on one clock), a confetti burst and a ring when solved, hover cues
(your pieces lift, the board rings in the card's colour), drag-to-move with a
mouse, and the side to move glows twice on load.

- *Try your mistakes again* — How it works: The red arrow is the move played in
  the game. / Find a stronger move for White. / Tap a piece, then a square — or
  drag it. Ex 1: red arrow h2–h3 with the ?? disc; “In the game, White played
  h3?? — the red arrow. White to move: find what was missed.” → “Rd8#★
  Checkmate — the move that was missed, found.” Ex 2: red arrow Nf4 with the ?
  disc; “In the game, White played Nf4?. White to move: find the move that wins
  material.” → “Check! And now the rook in the corner has nobody left to guard
  it.” → “Nc7+ then Nxa8★ The fork wins a whole rook.”
- *Become a blunder detective* — How it works: Step through the game with the
  arrows, starting from ▶. / Stop on the move that changed everything and mark
  it. / Then play what should have been played. The app's move navigation (first
  · previous · next · last) plus **Mark ??**; ▶ pulses until first pressed.
  “Press ▶ to step through the game.” · “Keep going — or mark this move if it’s
  the one.” · “That’s the end of the game. Go back to the move that changed
  everything and mark it.” → “5…Bxd1?? — that’s the one.” → “Now you’re Black,
  just after 5.Nxe5. Play what should have been played.” → “5…dxe5★ A pawn down
  instead of mated.” Wrong marks: “Strong, not a blunder — the knight is safe
  there for now.” / “Strong — but only because of what came before.” / “That one
  was forced.” / “The finish, not the turning point.”
- *Choose the better move* — How it works: Two candidate moves, one blue and one
  purple. / Pick the stronger one: tap its button or play it on the board. / See
  why it wins. Buttons “Move A” (blue) and “Move B” (purple), relabelled “Your
  move” / “Engine” on reveal. “White to move. Which is stronger — X or Y?” →
  “Right. / Not this time. Ne7+ forks the king and the queen. In the game, Nc3
  was played.” Ex 2: Rd1 vs Rxe8# — “… is mate on the back rank — the rook was
  never really in danger.”
- *Think under time pressure* — How it works: Start the clock: 30 seconds for
  three positions. / Find the winning move in each one. / Beat the flag.
  Positions: “Win a piece.” (d5 fork) · “Something is hanging.” (Nxd5) · “Mate in
  one.” (Qxh7#) → “All three, with N seconds to spare.” / “Time! …”
- *Rediscover your best moves* — How it works: A position where a brilliant move
  was found. / Find it again — it may mean giving something up. / Finish the
  combination. Ex 1 Qg8+!! Rxg8 Nf7#; ex 2 “White to move. Something bold wins
  on the spot.” → “Qxd8+!! then Rxd8#: the queen goes so the rook can mate.”

**Openings.** The tree panel has a **White · Black** switch (“My White lines” /
“My Black lines”, the app's two default books). The Black example: 1…e5 against
1.e4 (2.Nf3 Nc6 3.Bb5, 2.Bc4 Nf6) and 1…d5 against 1.d4 (2.c4 e6 3.Nc3, 2.Bf4
Nf6). Step 2's legend is now “Each of their moves carries how it has gone in
your games. 1…c5 / 2.Bc4 keeps causing problems.” and step 5's “Your opponent’s
favourite line, lit up — so you know which branch to prepare.” The notes are
joined by a rail that fills to the current one, and the current note is set as
a card with a notch pointing at the tree.

**[THE TWO PLANS] — now side by side**, a “Pricing” kicker, the paid card on
the right with a **Founding price** ribbon and, under the price:

> **For the first 100 members.**

Once 20 founding places are gone a meter and “N of 100 founding places left”
appear under it (`GET /api/founding`, `worker/founding.ts`, counting entitled
profiles). Below 20 the count stays hidden on purpose — “99 of 100 left” after
one sale reads as “nobody is buying”. The rest of both boxes is unchanged.

Founding buyers keep Full Access for life; after the first 100, new buyers
may move to a yearly subscription. `docs/terms.html` §5 says so.


## [WHY] and [ABOUT] — 2026-10-30 (third pass)

The bubble copy above is unchanged. Beside it (below it on a phone), the
rating card:

> **Kicker:** The story · **H2:** Why I made Bito Chess
>
> **+200** — in my first month with Bito Chess · chip: “Blitz today 1921”
> (live, links to the profile; hidden if the Worker can't fetch it)
>
> Graph: blitz rating Oct 2025 → Oct 2026, marker “Bito Chess”, bracket “+200”.
>
> **Before** Stuck between 1600 and 1700 · **One month in** Up to the
> 1900–2000 club · **Since** The daily challenge keeps me there
>
> I play every day on Chess.com and train every day on Bito Chess.
> **My Chess.com profile ↗** (chess.com/member/marxal_bitochess)
> *Blitz rating, traced from my Chess.com stats.*

**[ABOUT]:** kicker “About”, the paragraph unchanged, then three chips: One
person, no investors · No ads, no trackers · Your data is never sold.

