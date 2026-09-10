# Bito Chess — roadmap

A personal chess-openings trainer (a focused Lotus-style clone, openings only),
built as an installable PWA. See `CLAUDE.md` for the project guide and the
phase-by-phase build order.

Status key: ✅ done · 🔜 next · 💤 later

Rounds below are in the order they shipped. Add each new round at the bottom,
above the parked sections.

---

## Shipped rounds — the short index

Everything from the first working trainer up to the Stripe migration, one line
each. The full write-ups live in **`archive/ROADMAP-history.md`** — go there only
when you need the reasoning behind a specific round.

The `v0.x` numbers were planning labels and are not a clean sequence (the project
renumbered mid-flight, and `v0.6` was used twice for two unrelated rounds). The
real releases are the git tags: `v0.3`, `v0.4`, `v0.5`, plus legacy `v1.0`–`v1.3`.

| Round | What it was |
|---|---|
| v1.0 | ✅ The working trainer — board on phone → builder → SM-2 training → Stockfish → Chess.com import |
| v1.1 | ✅ Redesign & polish — design-token theming, tab bar, Today dashboard, offline opening DB, backup/restore |
| v1.2 | ✅ Structure, scouting & shine — foundations audit, four-tab restructure, the Explore tab |
| v1.3 | ✅ Refinement — visual language (felt green, four themes), builder truth, Train hub, Statistics |
| **v0.4** | ✅ Beta polish — onboarding, Explore vs Statistics split, unified builder, ~3× opening library, traps, first landing page *(tag `v0.4`)* |
| **v0.5** | ✅ Small improvements — card polish, PWA shell fixes, Train redesign, the daily challenge, Statistics overhaul |
| v0.6 (cloud backup) | ✅ Google Drive cloud backup + `PUBLISHING.md` *(Drive has since been retired)* |
| v0.7 | ✅ Mistake retry — Train 2×2 grid, the mistake scan, the retry drill |
| v0.8 | ✅ General fixes — instant retry answers, engine circuit breakers, full backup (format v2) |
| v0.9 | ✅ Retry analysis & organisation, daily puzzle ladder, stats carousels |
| v0.10 | ✅ End game training — endgame puzzles + classic endgames vs tablebase |
| v0.11 | ✅ Learn-the-opening — YouTube video cards, one shared API key |
| v0.12 | ✅ Statistics & fixes — your site rating + charts, one shared chart engine |
| v0.13 | ✅ Circle-graph statistics — donut engine, move memory ring, sliding carousels |
| v0.14 | ✅ Memory-join fixes (`familyKey`), "Engine always on" pref |
| v0.15 | ✅ Faster & deeper game reviews — cloud miss-streak cutoff, opt-in chess-api.com deep tier |
| v0.16 | ✅ Engine un-sticking (4 hang fixes), Lichess studies in Packs, scannable Packs layout |
| v0.17 | ✅ Free tier: the training cap — `entitlement.ts`, 10 lines in training, DB-enforced `entitled` |
| v0.18 | ✅ The sync stops re-uploading your whole game library — two columns, fingerprints, flush on close |
| v0.19 | ✅ The guest-first first run — picker replaces intro+wizard, guests are first-class |
| v0.20 | ✅ The first-user round — Get-started checklist, inline import, guest import cap |
| v0.21 | ✅ The onboarding flow round — coach-marks walkthrough, training locked to 3 lines |
| v0.22 | ✅ The builder tab round — Explore/Library/My lines/Line info/Engine, one move strip, line priority |
| v0.23 | ✅ The landing page round — rebuilt on the app's tokens, playable hero board, buy button |
| v0.24 | ✅ The buy flow actually sells — Lemon Squeezy checkout, four unlock signals, €9 everywhere |
| v0.25 | ✅ The new copy, the legal pages, and no more Google |
| v0.26 | ✅ The Explore slide opens up |
| v0.27 | ✅ The onboarding tightening round |
| v0.28 | ✅ Training learns the position index |
| v0.29 | ✅ My Lines gets a tree |
| v0.30 | ✅ Coverage gaps |
| v0.6 (redesign) | ✅ **The repertoire redesign** — one tree per book; a line becomes a view of it (`REPERTOIRE-REDESIGN.md`) |
| v0.6b | ✅ Taking moves back out |
| v0.6c | ✅ The line card grows up, and one screen stops being two |
| v0.6d | ✅ The builder tells you what it is doing |

---

## Stripe migration — off Lemon Squeezy, on to being the merchant ✅

The processor swap. **Not a product change:** it is still a one-time unlock, still
"no subscription ever", and every existing customer keeps their access untouched
(`profiles.entitled` is never rewritten by this round).

The original brief asked for `mode: 'subscription'` with recurring prices. That was
raised as a conflict before any code was written — the app, the landing page, the
meta description, the JSON-LD and both legal pages all promise a single payment — and
settled as **one-time**, with no Stripe Tax, and the hosted redirect rather than
embedded Checkout.

- ✅ **Three Worker endpoints**, not Supabase Edge Functions: this repo has no
  `supabase/` directory, no CLI and no migrations, and the server already lived in a
  Worker. `GET /api/stripe/prices`, `POST /api/stripe/checkout`,
  `POST /api/stripe/webhook`, routed by hand in `worker/index.ts` as before.
- ✅ **The account id comes from a verified JWT, never from the request body.** The
  brief's "accepts `user.id`" would have let anyone POST a stranger's id and entitle
  their account. `verifyUser()` asks Supabase to validate the bearer token and takes
  the id *and* the email from it, which is also how `customer_email` gets pre-filled
  without the app sending anything.
- ✅ **The price id is validated too** — retrieved server-side and required to be
  active, one-time and (with `STRIPE_PRODUCT_ID` set) this product's. Otherwise any
  archived discount price in the account was sellable by anyone who could name it.
  Auth is checked *first*, so an unauthenticated caller can't probe price ids.
- ✅ **Dynamic EUR/SEK pricing** (`src/pricing.ts`). Locale → currency (`sv`, `sv-*`
  or any `-SE` region → kronor). The paywall is built synchronously, so it paints from
  a three-layer fallback (fetched → localStorage → built-in) and takes an
  `onPriceChange` subscription to correct itself when the fetch lands. Only the first
  two layers carry a price id, which is exactly what makes a fallback unsellable.
- ✅ **Redirect, not overlay.** lemon.js used to dodge the installed-PWA return
  journey; Stripe's hosted Checkout has no overlay to borrow, so the journey is
  handled by the machinery that already existed — `?purchased=1`, the focus watcher,
  the backoff poll, and Settings' "Already paid?". Two things got better: no
  third-party script in the app at all, and wallets with no domain verification.
- ✅ **Two events the brief didn't ask for, and one it did that can't happen.**
  `checkout.session.async_payment_succeeded` (without it, a delayed payment method
  means a customer pays and is never entitled) and `charge.refunded` → back to the
  free tier, which is what `docs/terms.html` already promised and nothing enforced.
  `customer.subscription.*` are answered with an explicit log line rather than
  silently ignored. Full refunds only.
- ✅ **Merchant of record moved to you.** EU VAT via OSS is now yours; prices are
  VAT-inclusive and Stripe Tax is deliberately off (0.5% a transaction — flagged, not
  assumed). `docs/terms.html` and `docs/privacy.html` rewritten to name you as the
  seller and Stripe as the processor.
- ✅ **The Worker is typechecked by the build now** (`tsconfig.worker.json`). It never
  was — `tsc` covered `src` only, and wrangler found worker errors at deploy time.
- ✅ Verified locally end to end with `wrangler dev`: `constructEventAsync` on workerd
  accepts a correctly-signed event and rejects tampering, the wrong secret, a missing
  header and a replayed timestamp; every event route and every guard returns what it
  should.

_Owner setup: `STRIPE-SETUP.md` (dashboard steps, secrets, decommissioning). Schema:
re-run the SQL in `SUPABASE-SYNC.md`. Restore point: `v0.4`._

---

## The account round — sync that actually syncs ✅

A pass over everything the account touches, prompted by three symptoms that
turned out to be one story: signing in on a second device showed the first
device's old lines, the Account section said "Sync failed — will retry" on every
launch, and nothing anyone did made either better.

**The sync only ever pulled once.** On the very first sign-in with an account,
and never again — after that a device pushed and only pushed. So the second
phone kept its own older copy, showed it, and then pushed it back over the
first's. Both columns now carry a timestamp, each device remembers the last one
it saw of each half, and it asks (two timestamps, a few hundred bytes) on
sign-in, on coming back to the foreground and every five minutes. Only a half
that really moved is downloaded. There is a **Sync now** button for impatience.

- ✅ **A pull always merges, so the merge-or-replace prompt is gone.** It asked
  at the worst possible moment — you have just typed a password and not yet seen
  the app — "merge" was right every time, and cancelling left the device
  silently unsynced for ever. Lines merge by move, games by id, statistics by
  last-write-wins with a guard that can't overwrite unpushed work. What the
  prompt uniquely did is now Settings → Data → **"Replace this device from your
  account"**, asked for on purpose.
- ✅ **The deadlock.** Every `onAuthChange` listener ran inside supabase-js's own
  auth broadcast, which holds an internal lock; the first thing they did was call
  Supabase, which waits on that lock. Auth work now hops to the next task first.
- ✅ **Statistics were only pushed when a line changed.** The core column is the
  lines *plus* the app-state snapshot, but only the lines had a change notifier —
  so a puzzle rating or a streak sat on the phone until some unrelated edit
  carried it up. The core is now offered at every push opportunity and the
  fingerprint decides, which costs no request when nothing changed.
- ✅ **Failures say what went wrong.** "Sync failed — will retry" covered a
  missing table, a missing column, a blocked write and a train tunnel alike.
  Now it names which.

**Email confirmation is back on, and the links now work.** Turning it off was a
mistake — a typo'd address means an account nobody can reach, including the
person who just paid for it. But the return leg had a bug that would have made it
useless: the app only claimed a `?code=` if a localStorage flag it set moments
before the redirect was still standing, and no such flag survives a trip through
a mail app. The flag is gone; `state` (which Lichess always sends and Supabase
never does) is a complete test on its own.

- ✅ **Password reset**, both halves: "Forgot your password?" on the sign-in tab,
  and a "choose a new password" sheet when the link is opened.
- ✅ **Resend the confirmation email**, because the commonest failure of email
  confirmation is an email that never arrives.
- ✅ **Facebook and Apple** join Google, behind `VITE_AUTH_PROVIDERS` so a button
  can never appear for a provider the dashboard hasn't enabled. Lichess and
  Chess.com were investigated and are **not possible** as sign-in providers —
  Supabase takes only its own fixed list, Lichess is OAuth2 without an
  `id_token`, and Chess.com has no public OAuth at all. `SUPABASE-SYNC.md` §3
  has the reasoning and the workaround (offer the existing Lichess connection
  right after sign-in instead).
- ✅ **Registration / Sign in**, not "sign up / sign in" — one letter in the
  middle of a word is a coin-toss to read on a phone. Registration now requires
  ticking a consent for the privacy policy and terms; the social buttons carry
  the passive line, because an OAuth tap is indistinguishable from a
  registration until it comes back.

**Everything else the round touched:**

- ✅ **Export takes a dropdown** — everything, lines, games, statistics or
  settings — and the file records which parts it holds, so "Replace" on a
  lines-only import replaces the lines and leaves the games alone.
- ✅ **Delete your account**, under Data: a Worker endpoint with the service-role
  key (the browser has no key that may touch `auth.users`, and shouldn't),
  type-DELETE to confirm, a backup offered first, and a separate tick-box for
  whether to wipe this phone too — because closing an online account is not the
  same as asking to lose the repertoire in your hand.
- ✅ **Reset progress pushes immediately** rather than waiting out the 30-second
  debounce, and says out loud that it reaches your other devices.
- ✅ **Google Drive backup retired for good** — the code went earlier; this round
  took the documentation, the privacy-policy entries, the dead CSS and the
  leftover device keys, which are now swept at boot.
- ✅ **A size guard in the database.** The 4 MB-per-column ceiling was enforced
  only in JavaScript the user is holding. It is now a Postgres trigger as well.
  Measured on the way: ~2.1–2.7 KB per line, ~1.4 KB per synced game, so the
  ceiling lands at roughly 1,600 lines and the games column can't reach its own
  at all. Full table in `SUPABASE-SYNC.md` §7.
- ✅ **`SUPABASE-SYNC.md` is now the whole account checklist**, not just the SQL:
  auth settings, the redirect allow-list, the email-template edit that makes
  links work in any browser, custom SMTP (the built-in sender is capped at a
  couple of emails an hour, which would have silently blocked registrations),
  every provider's setup, account deletion, quotas, and a checklist at the end.

---

## The daily-challenge, tree and Explore round ✅

Nine items off one brief. Two of them were questions before they were jobs —
what makes the repertoire tree hard to use on a phone, and whether Coverage,
Recommended and "From my games" are really three things — so they were measured
and written up first (the **Tree and Explore** report), then built.

**The daily challenge now exists before you can do it.** Under the three-line
goal it does not run — two of its five parts need a repertoire — and it used to
vanish entirely, which meant the one habit the whole app is built around was
invisible until after you had done the work that turns it on. It introduces
itself instead: the same card, the same rows, greyed and inert, under a bar
counting toward three lines. The Get-started checklist leads and the locked card
follows it, because "how do I get lines" is the question that has to be answered
first.

**The completion popup can be reopened.** It carried the only reading of "how
did that go" the app produces, and a tap anywhere lost it until tomorrow. Three
ways back to it now, all through `daily-review.ts` so they cannot drift apart:
the finished Train card, a day in the 7-day strip, and a day in the month
calendar. Both calendars are banded by how the day WENT rather than whether it
happened — four steps and a legend, coarse on purpose, because a per-percent
gradient on a 20px square is a colour nobody can read back into a number.

- ✅ A reopened day is recomputed **as of that day**: the streak counted back out
  of the training-days set, every all-time tally read off the log truncated
  there. It dates itself rather than borrowing the word "today", and skips the
  confetti — a replay is a look back, not an event.
- ✅ The copy: "Every task cleared" is gone for "9 correct moves of 10 played
  moves", and the word throughout is **challenge**, not task ("Next challenge →").
- ✅ `TRAINING_UNLOCK_LINES` moved to its own leaf module. `first-steps.ts`
  reaches auth, Supabase and the install gate, so importing the constant from
  `daily-challenge.ts` dragged the whole browser world into the headless
  self-test run.

**The trainer opens again after a new line.** Standing inside a book the header
button ADDS moves rather than saving a line, which is right — but it meant the
whole tail of the old save flow never ran. The confirm run stopped appearing,
and "Just save it" stopped being honoured, because a freshly grown branch
inherits `training` from its ancestors whatever the toggle said. Both are picked
back up at the end of `commitBook`, on the one condition that means "I have just
finished a line": the line in front of you contains part of the draft, and the
cursor is standing on its end.

**The filter bar stopped overlapping itself.** Row 1 is a nowrap flex row, and
the colour segment carried `min-width: 0` with nowrap children and no overflow
of its own — so on a narrow phone, or once the count badges reached three
digits, it shrank below its contents and the Black chip ran out across the
search, sort and view icons. Measured at 360px: 34px of overlap. The segment
scrolls itself now, its chips refuse to shrink, and the tools group is
fixed-size. Below 460px the chips also drop their WORDS and keep their pips,
which is what makes room for a fourth icon without anything scrolling at all.

**The tree got its own button and a phone-sized first paint.** It was the fourth
stop on the grouping toggle's cycle — three taps deep behind an icon whose other
states are all lists, with nothing on screen to say it existed. It is a switch
now, and turning it off restores the grouping that was showing before.

- ✅ It draws four moves deep with the existing "Go deeper" control, and the
  first paint shrinks to fit what it drew (floor 0.55, below which the move text
  stops being readable). Same ten-line book, same 378×512 box: **19 of 69 nodes
  on screen → 48 of 58**.
- ✅ The legend's "another move order to the same position" line is gone. It
  explained a line most people never see, in a sentence that reads as jargon on a
  phone, and cost a whole row above a view already short of height. The dashed
  edges still draw and the tap-preview still explains them where it matters.

**Repertoires moved to Settings.** The book picker sat at the top of My Lines,
asking a question most people never have a second answer to — and its answer HID
lines, which on a screen called My Lines reads as data loss. Making, naming,
putting aside and removing books is a setup decision, so it is a setting.
"Which book new lines are filed into" is offered only once there are more than
the two defaults. My Lines shows every saved line, always.

**My Lines ends by offering another line.** "And now what?" gets asked at the
bottom of the list, and the answer used to be to scroll back to the top and find
the + button.

**The Learn tab and every trace of YouTube are gone** — `youtube.ts`,
`video-lib.ts`, `content-ui.ts`, `content-explore.ts`, `content-curated.json`,
the API key that shipped with them, the Explore tab, the icon and ~230 lines of
CSS. Explore is three tabs now: Recommended, Packs, Scouting.

**Two questions were answered first and then built** — the reasoning, the
measurements and the ranking are in the **Tree and Explore** report.

**My Lines is what you own; Explore is what you don't.** One rule, and it
resolved all three of Coverage, Recommended and "From my games" — which were
never three things. `recommendationCard` and `suggestionCard` were the same
component twice, built from the same `analyseGames()` pass and differing only in
a `filter()`, and they overlapped on exactly the interesting case (played a lot,
scoring badly, no line yet), which therefore appeared on two screens with the
same button.

- ✅ **Coverage is an Explore tab**, and leads it once there are lines to have
  gaps in. `coverage-section.ts` already rendered standalone with exactly the
  options a tab body needs, so the full-screen `coverage-screen.ts` and the
  one-row launcher that opened it are both gone.
- ✅ **Recommended and "From my games" are one Openings tab.**
  `analysis.rankOpenings` labels every opening your games show with what it
  NEEDS — *no line yet* / *line is losing* / *prepared* — and orders by
  `games × (100 − score)`. The middle state is the one Recommended got wrong: it
  never checked `hasRepertoire`, so it offered "Build line" for openings already
  prepared. That row now opens the line you have.
- ✅ **My Lines lost its tab bar.** With "From my games" gone there was one tab
  left, and a one-tab tab bar is a title with extra steps.
- ✅ **A coverage row opens the POSITION, not the builder.** Jumping into the
  editor from a one-line list item meant agreeing to prepare something you could
  not yet see. It is `openPositionPeek` — the same popup Statistics' forgotten
  moves and the training results screen use — with the unanswered move drawn as
  an arrow, the figures that ranked it, and two ways on: prepare an answer, or
  see it in the tree. Openings rows do the same.

**The tree stops making a 512px box do a full screen's work.** All six remaining
fixes, on top of the four above:

- ✅ **The preview is a bottom sheet.** It was a full-height panel pinned to the
  TOP of the tree area — 190px of a 512px box, dropped over the part of the tree
  you had just been reading and often over the node you tapped, half of it a
  chessboard nobody had asked for. Collapsed it is a 44px strip at the bottom:
  **37% of the map → 11%**. Pull it up for the board.
- ✅ **Seven controls become three on a phone.** The variation arrows duplicate
  tapping a sibling in plain sight; the ± pair duplicates pinch and floated ON
  the tree. Both stay above the desktop breakpoint. That retires the 5rem of
  padding the bar carried to dodge the FAB.
- ✅ **Full screen.** The embedded map is a `touch-action: none` surface in a
  scrolling page, so at 62vh a vertical swipe panned the tree instead of the
  page with no way past it. The card is a 50vh preview now, and "Full screen"
  reopens the same map as the overlay, standing where you were.
- ✅ **The fit floor is derived from legibility rather than picked.** Shrinking
  to fit is a CSS transform, so it shrank the text: at the old 0.55 floor a 12px
  label rendered at 6.6px. The floor is now the scale at which the label is
  still readable, and anything wider is what panning is for.
- ✅ **Folding.** Every fork carries one, showing the number of LINE ENDS put
  away. The state keys on the uci path rather than the node, so it survives "Go
  deeper", All/Frequent and a colour switch — each of which rebuilds the tree.
- ✅ **Landscape** gets a fixed 300px card instead of 50vh of a 412px viewport,
  and `SIBLING_GAP` goes 12 → 16 so stacked 44px tap targets stop overlapping.

---

## The sign-in round — two taps, or a link in the post ✅

Signing in asked for an email and a password before it offered anything else,
which is the slowest way in and the one most likely to end at "what was my
password again". The sign-in tab is now built the other way round: the accounts
people already have come first, and typing is the fallback.

- ✅ **Facebook joins Google as a lead button**, both at the same weight. The
  choice between them is "whichever you already use", so neither may look
  recommended. This was almost entirely markup: `signInWithProvider()` already
  handled every provider generically (Facebook included, `email` scope and all),
  so `signInWithFacebook()` is one line calling it. It still needs the provider
  enabled in the dashboard and `facebook` added to `VITE_AUTH_PROVIDERS` —
  `SUPABASE-SYNC.md` §3 has the steps.
- ✅ **A magic link is the default email path.** "Send me a sign-in link" needs
  nothing remembered and works from any device, because the link comes back as
  `token_hash` — the same return leg confirmation and password reset already
  use, with no new plumbing (`initAuth` hands whatever `type` is on the URL
  straight to `verifyOtp`; `magiclink` was already in its accepted list).
- ✅ **The link cannot create an account.** `shouldCreateUser: false`, on
  purpose: sign-up means agreeing to the Terms, and there is one door for that.
  An unknown address gets a dialog offering the Registration tab rather than
  Supabase's own "signups not allowed for otp".
- ✅ **Password is one small link away** — "Use a password instead" reveals the
  field, and "Email me a link instead" goes back. One form, so the address you
  typed survives the switch, and one primary button at a time.
- ✅ **Registration is untouched.** Same email + password, same consent
  checkbox, same confirmation email. Only the sign-in surface changed.

---

## The first-line round — one question, and the app doing its own homework ✅

A twelve-item round across Train, Explore and the first run. Two themes hold
most of it together: **the app should do the slow work itself**, and **a screen
should say what it is for where you are standing**.

### The first run

- ✅ **The first screen asks ONE question.** It asked three — colour, depth,
  style — and then handed the builder a curated line somebody else had chosen.
  Every one of those questions can only be answered by someone who already knows
  what the app does. It asks which colour now; "Start building" appears with the
  answer, and "I already have an account, log in" sits quietly at the foot for
  the people that question is actually for. `onboarding-picker.ts` lost two
  thirds of its weight; `onboarding-lines.ts` (the eight curated lines) is left
  in place with its self-test but is no longer reachable from the app.
- ✅ **The walkthrough is six bubbles on an empty board:** the board (play your
  first move), Explore, Library, My lines, the board again (two more moves),
  Save. Line info and Engine are gone — first-minute panels they are not — and
  their tabs are locked while it runs.
- ✅ **Auto-reply is switched on for it**, which is what makes "play a move, get
  an answer" true and a three-move line three taps. The Explore bubble then
  explains something that has already visibly happened. A Black first line gets
  White's move played in at the start (`explorePanel.setAutoReply` exists
  because the panel reads the pref once, into the variable its own switch
  writes).
- ✅ **Two consequences of that**, both handled: the guided line now always ends
  on the opponent's reply, so the "end on your move?" nudge is taken silently
  rather than made a first-timer's modal; and a pack line no longer triggers the
  walkthrough at all, since "play your first move" means nothing on a board that
  already has eight.
- ✅ **The account ask is gone from the success card.** It landed on someone who
  had been in the app four minutes and had nothing yet to sync, and turned the
  one moment that should read as "that worked" into a form. The log-in line on
  screen one is where that question belongs.
- ✅ **Save's "Add more moves" drops to a quiet line** under a primary Save; the
  trainer's introduction carries the Train bolt on "Start training".

### Train

- ✅ **"Refresh your moves"** replaces the lone "Refresh lines" button: Full
  lines and Repertoire run, side by side, equal width, each carrying its own
  count ("6 lines due" / "11 moves due"). They are two answers to one question
  and Repertoire run was buried a third of the way down the Practise menu.
  "Rounds left" holds its column instead of hiding at one.
- ✅ **The Get-started box and the daily card stop butting together** —
  `.daily-host` owns the gap, since either can lead.
- ✅ **A gear in the daily card's corner** opens the same preference rows
  Settings shows. The row chrome moved to `settings-controls.ts` and the rows
  themselves to `daily-prefs.ts`, so neither Settings nor the card has to import
  the other. Its copy is now "Pick your challenges and how many of each."
- ✅ **Practise says once, at the top, why every card is greyed out** — six
  identical "reasons" down a list read as six dead ends rather than one rule.
- ✅ **An (i) beside "Practise" and "From your games"** explains each mode
  (`info-sheet.ts`). The card subtitles have to stay one short line for the menu
  to stay scannable, which leaves nowhere to say how Repertoire run differs from
  Drill new lines.
- ✅ **Round screens list the lines (or moves) that round covered.** A
  four-round sitting showed a bare tally until the very end, which is the wrong
  twenty minutes to wait — the round you just played is the one you can still
  remember. The final screen still lists the whole sitting.

### Middle game

- ✅ **The mistake scan runs on its own** (`mistake-autoscan.ts`). Behind a
  button it was a decision — "do I want to give this ten minutes right now?" —
  and the honest answer is almost always no, so the pane stayed empty for people
  who had imported hundreds of games. One pass at a time, the manual scan always
  wins the engine, aborting is a pause, and the tier cap is the same one the
  button obeys. The hero reports it live; Settings → Data can turn it off.

### Explore

- ✅ **Coverage gets the import form as its empty state**, exactly as Openings
  has: the strongest thing coverage can say is "you have faced this eleven
  times", and that sentence needs your games.
- ✅ **A gap is a position CARD now**, on the shared `.pcard` scaffold — a
  miniature with the unanswered reply already played, the sentence that ranked
  it, and one button. As a dense one-line row it read as a list of complaints.

### Everywhere

- ✅ **Hint arrows and circles go blue** (`board-brushes.HINT_COLOR`). The warm
  orange read beautifully on cream squares and vanished on dark ones; blue is
  off-axis against every board scheme the app ships. The colour lived in nine
  files — it lives in one now.
- ✅ **The endgame's hint arrow clears the moment you move.** It used to survive
  every move after, so a long win ended with an arrow between two squares that
  no longer had the pieces on them.
- ✅ **The just-saved highlight on My Lines works again.** `persistCurrentLine`
  took back the line AS BUILT, whose id is a fresh UUID — but a saved line's id
  is derived from the book and the node it ends on, so nothing downstream could
  find it. It takes back the line as stored now, which also fixes a second save
  of the same line.
- ✅ **The full-screen repertoire map opens with its board up.** The whole reason
  to go full screen is that the embedded card is too small to work in; arriving
  to a 44px strip you then have to pull up spends the extra room on nothing.

---

## The walkthrough-and-background round — the app finishes its own homework ✅

A six-item round across the first run, Middle game, End game and Train. Two
threads run through it: **a walkthrough should not repeat itself**, and **a pane
built on a long engine job should not open with the job as a question**.

### The walkthrough

- ✅ **The Explore bubble lights the dock too.** A spotlight is one box-shadow
  cut-out, so it could only ever cover one element — and the element it covered
  stopped at the panel's bottom edge, which is exactly where the auto-reply
  switch the bubble is talking about had scrolled to. A step can name a second
  target now (`spanSelector`), the hole is drawn round both, and the step scrolls
  the switch into it. Panel and bottom bar light up together, which also says
  without a sentence that everything under the board belongs to this step.
- ✅ **"Play two more moves" is answered by playing two more moves.** The bubble
  asked for two and then sat there until Next was pressed, which taught that the
  walkthrough's instructions are decorative. It counts the user's OWN moves — with
  auto-reply on, every move of theirs is followed by one of the opponent's, and a
  raw event count called one move two.
- ✅ **"Import my games" becomes "Games imported."** The same before/after the
  Library step already gave Lichess. An ask that has been answered should stop
  being an ask.
- ✅ **The save bubble stopped appearing twice.** The walkthrough's last bubble IS
  the save step; "Add more moves" ended the walkthrough, which re-armed the
  STANDALONE save step, which is the identical bubble — so declining the offer
  produced the offer. The ending now reports whether that bubble was reached
  (`TourEnd.saveOffered`) and the empty-board first line stops re-arming when it
  was. Two smaller leaks went with it: the same button skipped the walkthrough's
  own tidy-up, so the panel tabs it had locked stayed locked, and so did Save.
- ✅ **The first-line success card offers an account again.** It used to carry the
  sign-up FORM, which turned the one moment that should read as "that worked"
  into data entry; the fix was to delete the ask entirely, which went too far —
  the person has just made something worth keeping and nothing has mentioned that
  the browser can lose it. It celebrates first and offers second: one sentence,
  a button that opens the ordinary sheet, and "Not now" underneath. Built only
  where accounts exist and only for someone not already signed in.

### Middle game

- ✅ **"Your games mix" is the pane's front door.** Every other Train tab opens
  with one wide button that just starts something; this one opened with a menu of
  five cards and asked you to choose a category first — a decision about your own
  games that a first-timer has no basis for. The mix deals round-robin across the
  four mistake categories so a library heavy in one of them doesn't fill the run
  with it, then hands over to your brilliant finds on the results screen, the way
  the daily challenge passes between its halves.
- ✅ **"All games analysed" is one faint line.** It was bold, green, ticked, and
  followed by a sentence explaining a background job nobody had asked about —
  a badge for the app having finished its own homework.
- ✅ **Brilliant moves narrow once there are enough of them.** A brilliant (!!) is
  rare, so the card has always pooled the engine's "great" grade in with them or
  it would be a card with nothing on it. At ten of your own it stops: by then
  there is enough of the real thing to fill a session, and mixing greats in
  dilutes it.

### End game

- ✅ **"From your games" scans itself** (`endgame-autoscan.ts`), the twin of the
  mistake pass. Same rules — one at a time, the manual scan wins, aborting is a
  pause, the tier cap is the button's — plus two this one needs. It goes SECOND,
  because both passes queue on the same review worker and the Middle game pane is
  the one the app leads with. And it can be UNREACHABLE: the tablebase is a
  network call, so a pass that gives up latches off for five minutes rather than
  turning a train journey into a retry loop. One Settings switch still governs
  both.

### Train

- ✅ **Repertoire run's card lines up with the others.** It carried a stat badge
  and a two-clause subtitle, so the subtitle wrapped and dragged the badge out of
  line with the badges above it. One sentence, no badge; the saving it used to
  quote is a fact about the mode rather than a number you decide on, so it moved
  to the info sheet.
- ✅ **The run is one walk, not seven rounds.** Rounds exist because a line walk is
  a long unit worth banking in stages. A repertoire run is one pass through one
  book: "Round 3 of 7" described an arithmetic nobody asked for while hiding the
  only figure they wanted. The drill's own bar reads "Position 12 of 34" the
  whole way through instead — and stopping early now ENDS ON THE RESULTS SCREEN,
  because every answer was already graded and saved, so the recap is owed.
- ✅ **The refresh box counts the pile both ways.** It offers two routes through
  one due pile and measured only the first: lines due, and the rounds of five
  those lines break into. The middle column is the same pile counted in moves
  now — lines due and moves due ARE the two buttons, in the order the buttons sit
  — and each button says what it DOES rather than repeating a count six
  millimetres below the same count. Still three figures.

---

## The walkthrough second pass — the ways out, and the ways back ✅

Six items from testing the round above on the phone. Most of them are the same
shape: a path the walkthrough didn't know existed, taken by a user who had every
reason to take it.

- ✅ **Backing out of the Lichess login keeps the walkthrough.** The connect
  redirects the whole page away, and the stash that says where the walkthrough
  was is read on the way home — but only on the SUCCESS path, so someone who read
  the Lichess login screen and pressed back came home to a half-built line with
  no bubbles and no way to get them back. Both paths read it now. A second bug
  sat behind it and would have hit the successful connect too: this device still
  has no saved lines, so the first-run picker came up over the resumed bubbles —
  the question that STARTED the walkthrough, asked again on top of it. The boot
  sequence checks for a pending resume before offering the picker.
- ✅ **The Explore bubble opens the panel at its top.** The first cut scrolled the
  auto-reply switch into view, which is a jump on arrival to reach something
  three rows down anyway. From the top, the whole of what the bubble describes —
  the question, the three answers, the switch — is already on screen.
- ✅ **The real Save button ends the walkthrough too, and does the same thing.**
  That step is live, so the header's own button is tappable — and it did
  something else entirely. Standing inside a book the header ADDS moves: it
  committed them and ran a bare confirm run, with no trainer introduction, no
  success card, no account offer, and the walkthrough bubble left sitting on top
  of it. Under the walkthrough it now goes down the same path the bubble's Save
  does, says the same word ("Save line", not "Add 6 moves"), and the walkthrough
  hears about it and gets out of the way.
- ✅ **The first line's confirm run has no "End session".** That run is the payoff
  of the whole first visit and lasts about twenty seconds, and its own coach-mark
  already carries a quiet "Skip this time". A louder way out beside it is an
  escape hatch from the thing you most wanted them to see. The header goes with
  it rather than leaving an empty bar. The back gesture still works.
- ✅ **Full lines and Repertoire run get icons that mean something.** A brain and
  a list said "thinking" and "some rows", neither of which is the difference
  between them. Full lines walks a list of lines, so it takes the list;
  Repertoire run walks the book, so it takes the book — on the button, on the
  Practise card and in the info sheet.
- ✅ **"Reset" beside "All games analysed".** The engine improves and the scan's
  rules change, and a spot you fixed months ago is worth being asked again — but
  with the pane reporting "all analysed" there was no route to any of that short
  of deleting your games. A bare word beside the line, not a button: it is a long
  job and a discard, so it asks first and says what goes.
- ✅ **…and it resets the brilliant half too.** The first cut only reset the scan,
  because that is the only thing on this pane that HAS a scan — the brilliant
  finds are read off each game's saved analysis, written by the game review, so
  nothing here can regenerate them and dropping them would mean deleting that
  analysis (with the user's variations and notes in it) for good. But the half
  that IS progress — the log that rests a re-found gem for a few days — survived
  a reset that claimed to clear progress. It goes now.
- ✅ **The brilliant card counts what is actually waiting.** It badged the whole
  pool, so the number never moved however many you re-found — and, once Reset
  existed, nothing on that card could show it had done anything. It badges the
  available ones now, like the mistake cards badge their unfixed, and when they
  have all been re-found the badge gives way to a line saying they come back over
  the next few days rather than a "0" that reads as a failure.

---

## The middle-game detective round — two exercises that read the whole game ✅

Everything on the Middle game pane trained ONE position: here is where you went
wrong, find the better move. Two new exercises change the question. The first
gives you a run of moves and doesn't say which of them is the mistake — which is
the thing a game actually asks. The second shrinks the exercise to its smallest
useful form: two moves, pick the better one. Both are in the daily challenge.

- ✅ **Blunder detective.** Four to six moves from one of your own games, browsed
  with back and forward, and one wide button that always names the move on the
  board: "13…♞xe4 is the blunder". The blunder can be YOURS OR YOUR OPPONENT'S
  and nothing says which — that is the whole exercise. A wrong accusation says so
  and crosses that move off, and the run carries on; a discrete "Show solution"
  is there for anyone stuck. Catching it is only half: the board goes back to the
  position before the blunder and asks for the move that should have been played,
  judged instantly against the stored top three, like the mistake drill. An (i)
  beside the brief explains the rest.
- ✅ **Exactly one blunder per run, guaranteed.** The rule the whole exercise
  rests on, so `detective.ts` is strict about it: one move over the blunder line
  (a 22% win-probability drop, a shade past the grader's own boundary), and every
  OTHER move in the run comfortably under the *mistake* line — not merely under
  the blunder line. A run that can't clear that bar isn't offered. Runs never span
  a position the scan couldn't evaluate, never open ON the blunder, and never
  start from a position the blunderer had already lost. Where the blunder sits
  inside the run is chosen by a hash of the game id, so it isn't always the middle
  one and isn't always the last.
- ✅ **It costs the scan almost nothing.** The mistake scan already walks every
  game building an eval per position — covering BOTH sides — and then threw that
  trail away. It keeps it now (`retry.trail`), so finding the run is free
  arithmetic; the engine is asked exactly once per game, for the move that should
  have been played, and not even that when the blunder is one of your own that
  the same pass has already verified.
- ✅ **Better or blunder.** The quick one. One position, two moves drawn as
  arrows — the one you played and the one the engine wanted — and two buttons
  under the board naming them. Pick one, or just play it on the board. The
  arrows are two neutral colours (violet and teal, never the palette's blunder
  red or the hint blue) and the sides shuffle every time, so nothing but the
  chess tells you which is which. It ends by naming the game: "Against Kevin you
  played 11.♝xe6 ?? here. The engine wanted ♝a4" — with the evaluation either
  side of it, and Analyse to open the game at that position.
- ✅ **Only fair questions get asked.** A two-answer question with a defensible
  wrong answer is worse than no question, so `better.ts` refuses any spot where
  the move you played is also one of the engine's picks, where the two moves land
  on the same square, or where the gap between them is under the grader's mistake
  boundary.
- ✅ **Both in the daily challenge** — one detective case (a case is four to six
  moves to read plus an answer, so one IS an exercise), three better-or-blunder
  picks, and **Mistakes to fix drops from three to two**, because the blank-board
  search is now one of three from-your-games parts rather than the only one. Each
  part has its own default count instead of one number for all seven, and the
  perfect-day bar holds a part to two OR its own default, whichever is lower —
  otherwise shipping a part at one would have made a perfect day impossible.
- ✅ **A re-read of the library, said honestly.** The trail the detective needs
  can't be reconstructed from an old scan, so games scanned under the previous
  rules look unscanned again and the background pass rebuilds them. Nothing
  earned is lost: each spot's fixed mark, attempts and last-trained date are
  carried across by id. And because a settled library suddenly having 300 games
  "to read" looks like an import bug, the pane says which it is — "read under
  older rules" — and the button says "Read my games again".
- ✅ **The free tier stops promising a pass that won't run.** A free account's
  scan stops once its rolling ten unfixed spots are full; the pane went on saying
  "this happens on its own while the app is open", which was never going to
  happen. It now says it has stopped and why.
- ✅ **Both exercises rest and come back.** A case you crack, or a question you
  answer right, rests a few days and then returns, further out each time
  (`middle-log.ts`) — so the pool rotates instead of dealing you the same run
  forever. The cards badge what is available now rather than the whole pool, and
  Reset clears these logs along with the brilliant one.
- ✅ **A chessground trap, documented in the code.** Both boards are built
  interactive from the start and gated by `movable.color`, never by `viewOnly`:
  chessground binds its drag listeners once, at creation, and binds none at all
  when `viewOnly` is set — so a board born view-only never becomes playable, and
  the detective's "now play the better move" step silently did nothing.

---

## The middle-game second pass — one colour, one queue, and the missing brilliancies ✅

Testing the round above on the phone turned up two things that were quietly
broken and three that were merely wrong. The two: every session dealt the same
mistakes, and the Brilliant-moves card was empty on a library the same screen
called fully analysed.

- ✅ **Better or blunder is now "Which move".** Shorter, and it asks the question
  instead of listing the answers.
- ✅ **One colour for both moves.** The two arrows were violet and teal with
  buttons to match, which was pretty and wrong: colour in this app MEANS
  something — red is a blunder, green is the engine's move — so two colours had
  already started answering the question. Both arrows and both buttons now wear
  the app's hint blue. The only thing telling them apart is the chess.
- ✅ **The reveal says less, and shows more.** It was a sentence with the answer
  buried in it ("…here. The engine wanted ♝a4") followed by an evaluation nobody
  could attach to a move. Now: one line naming the game and what you played, then
  the two moves side by side with what each was worth — the one you played in
  red, the engine's in green. The numbers argue better than the sentence did.
- ✅ **The mistakes stopped repeating.** THE BUG: `pickSpots` ordered unfixed
  spots by game recency and nothing else, which is a FIXED order — so every
  session dealt the same handful, and the only way a spot ever left the front of
  the queue was solving it cleanly. Miss one, or take a hint, and it was waiting
  there again tomorrow; with a big library the newest games' spots monopolised
  every deal and the other three hundred games were never reached. The queue
  moves now: spots you have never been shown lead, then the ones you saw longest
  ago, then the fixed ones — and within each tier they are dealt round-robin BY
  GAME, so a session is never three positions from the same game. Self-tested,
  including "answer today's session without fixing anything, and tomorrow's
  session is different spots".
- ✅ **The Fixed figure opens what it counts.** It was a number that only went up
  with no way to see what it meant — and the only record of which games have
  actually been worked through. It now opens a list: every fixed position,
  grouped under its game, with when you put it right, a row that drills it again,
  and a "Train these again" that deals the ones you fixed longest ago.
- ✅ **The engine now finds your brilliancies.** THE BUG: the Brilliant-moves card
  read a game's SAVED ANALYSIS, which only exists after you open that game in the
  analyser and press Analyse game — one game at a time. The pane's "games
  analysed" figure counts the BACKGROUND MISTAKE SCAN, which is a different thing
  entirely, so the screen could say "400 games analysed" and "no brilliant moves"
  in the same breath and both were true. The scan looks for them itself now: a
  pure candidate pass (a real material sacrifice, by the same SEE test the
  analyser uses, that leaves you FINE afterwards — which is what rules out every
  accidentally hung piece for free), then the analyser's own grader at the
  analyser's own depth on what survives, capped at two positions per game. Finds
  from both sources are merged by move, and a scan-found brilliancy earns the
  game its automatic "brilliant" tag, so the My games filter fills in on its own.
- ✅ **…and the card stops asking for something that was already done.** Its
  greyed-out line said "analyse your games to find your brilliant moves" on a
  screen reporting every game analysed. It now gives the same two reasons the
  mistake cards do: analyse your games first, or none found in the ones analysed.

---

## The daily-challenge round — your order, your exercises, and three queues that move ✅

Testing the middle-game round on the phone: the daily challenge felt like the
same challenge every day, one part of it never ticked itself off, and the three
newest exercises still looked like three unrelated screens once you were inside
them.

- ✅ **The order is yours now.** Which parts the daily challenge includes was
  already a preference; the order they run in was whatever `daily-challenge.ts`
  happened to list, which quietly decided what you do first every single day —
  and the first thing is the thing that actually gets done. Each row in
  Preferences carries a pair of move buttons and its place in the day, and the
  card and the "Next challenge →" chain both follow it. Up/down rather than
  drag-and-drop: a drag handle inside a scrolling bottom sheet on a phone fights
  the scroll for the same gesture.
- ✅ **…or nobody's.** "Shuffle each day" hands the order to chance. It settles
  ONCE PER DAY (seeded on the date, not on `Math.random`), so the card can be
  rebuilt mid-sitting without rearranging itself under your thumb, and the part
  you were about to do is still the part you were about to do.
- ✅ **New defaults.** Three lines, three positions, three puzzles, three endgame
  puzzles, then two each of the three that read your own games. The from-your-
  games parts are whole exercises rather than items, and there are three of them
  now — three each would have made your own games two-thirds of the day.
  Blunder detective goes UP from one to two; Which move down from three to two
  and renamed on the card to "moves to pick".
- ✅ **A finished part ticks itself off, even after a detour.** THE BUG: finish
  the last puzzle of the daily challenge, tap Analyse, come back with "Back to
  train", tap "See results" — the task was recorded but the card still showed it
  waiting. `showView('train')` REBUILDS the whole Train screen, so the suspended
  session was holding closures over a daily card that was no longer in the
  document; it dutifully repainted a detached node. "Next challenge →" was worse:
  it rendered the next session into a detached pane, so nothing happened at all.
  Both now go through one live hook that the newest render owns.
- ✅ **The lines stopped repeating.** With nothing actually due — which is most
  days once a repertoire settles — the top-up was "the newest three, then the
  weakest", both fixed orders over a set that barely changes. It now leads with
  the lines you have gone longest without training, which is both the more useful
  pick and a genuinely moving target: training a line stamps it, so tomorrow
  deals different ones. Self-tested as exactly that.
- ✅ **…and so did the blunders, the questions and the gems.** Same shape as the
  mistake-queue fix in the round above, and the same root cause: all three rest
  logs recorded only a CLEAN solve. Miss a detective case and it was still the
  newest game's case, so it led the pile again immediately — from the daily
  challenge and from the pane both. A miss now rests a day without stepping the
  ladder: out of today's way, back tomorrow, while a cracked one is still four
  days out.
- ✅ **Every exercise says what it is.** Each mode owns an icon, a colour and a
  name — on the card that launches it. The moment the overlay opened, all three
  vanished: the header was one "‹ End session" and nothing else. It now carries
  the icon in an accent-tinted chip, the exercise's name, and the exit on the
  right; the session's framing ("Daily challenge", "Your games mix") rides above
  the name as a kicker, so a chained run always says what it just handed you.
  Shared by all eight overlays (`run-header.ts`); the duplicate mode title that
  used to sit above the board is gone, and that block is about the position again.
- ✅ **The count stopped eating the card.** A "From your games" card's badge had a
  column of its own — a big number and an uppercase label, a third of the width —
  which wrapped every title and subtitle onto two lines. It is a small chip in
  the top-right corner now, and the words have the width back.
- ✅ **Blunder detective: a hint before the answer.** The answer phase offered
  "Show the move" and nothing else, so the only way to get unstuck was to be told.
  Hint comes first and highlights the piece; only once it is spent does Show
  solution appear; Analyse arrives with the closed case.
- ✅ **…and it says the instruction once.** The brief above the board stays; the
  stepper's "Before the run" — which said where the board was, which the disabled
  arrow already said — is now the instruction itself, in a quiet two-line box
  between the arrows it is telling you to press. The sentence that repeated it
  under the button is gone.
- ✅ **Results rows open the position.** The mistake drill's rows have always
  popped the position up; detective and Which move copied the results screen but
  not that, so their rows were the only ones in the app that looked like buttons
  and did nothing. One shared popup (`spot-peek.ts`) for all three.
- ✅ **Which move says why.** The red and green boxes were two numbers, and a
  number is only an argument if you already read evals. Each now carries one
  derived clause — a static exchange on the destination square answers "did this
  hang something", the mate sentinels answer "is this mate", the win
  probabilities answer "what changed". Anything the engine did not tell us, it
  does not say.
- ✅ **Your games mix means all of your games.** It dealt mistake positions and
  closed on brilliancies; the two newest exercises were not in it. It now chains
  every exercise in the section — two-move questions, mistakes, a detective case
  or two, then your best moves — skipping whatever has nothing to deal.
- ✅ **The daily card stopped vanishing.** Turning "lines to remember" off deleted
  the whole card: it bailed whenever today's lines came back empty, even though
  every other part still had work to offer.

---

## The new-lines round — nothing added waits at the back for ever ✅

Testing on the phone: add a line to a repertoire that is already in training,
and it never comes up. It was in training, it was due — it was just always
eleventh in a queue that only ever gets five deep.

- ✅ **New material takes one slot in three, everywhere.** A line saved today is
  due the moment it exists (no review record = never trained = due), but the due
  pile was handed out in BOOK order: `mergePath` appends a new branch after its
  siblings, a session runs in rounds of five, and the daily challenge takes the
  first three. A just-graded line comes back due tomorrow, so the same handful at
  the front of the book was re-served every day and a line added later never
  surfaced. `dueLines` now weaves two queues — never-trained material and
  reviews — giving every third slot to what is new. A round of five carries two
  new lines; the daily challenge's three carry one. Neither side can starve the
  other, so adding twenty lines in one afternoon cannot flush the day's reviews
  either.
- ✅ **Reviews lead on how late they are, not where they sit in the book.**
  Lateness measured against each move's OWN interval: two days late on a one-day
  move is forgotten, two days late on a ninety-day move is nothing. Nothing can
  hide at the back of a long book any more.
- ✅ **The same fix, one layer down.** Individual positions (the daily "positions
  to refresh") ranked the due pool weakest-first, and a never-trained move has no
  lapses — so it sorted below every move you have ever missed, and lapses only
  ever grow. Repertoire run cut the book at 24 moves in walk order, so a long
  book's tail was never run. Both now use the same interleave.
- ✅ **First in, first drilled.** New lines are served oldest-added first, so
  adding three on Monday and two on Wednesday doesn't push Monday's remaining
  ones further back every time you add something.

---

## The one-blunder round — three doors onto the same move ✅

Testing on the phone: catch a blunder in Blunder detective, and the same move
turns up again two rows down the daily challenge as a Which move question. It
wasn't chance — each exercise kept its own memory and none of them could see
the others.

- ✅ **A blunder answered anywhere rests everywhere.** The same move from one of
  your games is dealt by three exercises: Blunder detective shows it inside a
  run of six, Which move puts it against the engine's pick, and the mistake
  drill (Opening blunders, Punish, Missed win, Blunder) asks you to play the fix
  at a blank board. Their ids already name the game and the ply — `g#14`,
  `g#d14` — so `spot-rest.ts` collapses them onto one key and holds a single
  shared rest under all three. It rests for however long the mode that dealt it
  earned (a cracked detective case is four days, so the question is four days
  away too), with a floor of one day — which is what stops a single day's
  challenge asking the same thing twice.
- ✅ **A rest is never a removal.** Every picker still deals resting items once
  the fresh ones run out, so a small library gets a full session rather than an
  empty one. The blunder goes to the back of the queue; nothing leaves it.
- ✅ **The mistake drill learned to rest.** `pickSpots` had three tiers (never
  met → seen longest ago → already fixed) and no way to know what another
  exercise had just shown you. It now takes the shared rest above all three.
- ✅ **The mix deals each blunder once.** "Your games mix" chooses all of its
  legs before the first one is answered, so no rest log could have covered it —
  the legs now claim what they deal and the later ones skip it.
- ✅ **"Play again" plays something else.** The pane read the rest logs once,
  when it painted, and handed the same stale map to every replay — so playing a
  detective sitting again dealt the identical cases. Every deal now reads the
  logs at the moment it deals. Same fix for the brilliancies carousel.

## The grow-your-lines round — the first daily part that asks you to write ✅

Every part of the daily challenge asked you to REMEMBER something. This one asks
you to write something: it takes a line you have genuinely learned, stands at the
end of it, and names three moves you'd meet next that you have no answer to.

- ✅ **"Grow your lines" is the eighth part of the daily challenge.** One line a
  day by default, and one is the honest number — it is the only part that opens
  the builder and wants a decision about a position you have never had to think
  about. It sits with the two other repertoire parts in the default order, and
  it takes a count, a position and an off switch in Preferences like every other.
- ✅ **It waits for mastery, and mastery is the app's existing verdict.**
  `lineMastered` (line-status.ts) already decided when the trainer says "you know
  this one — keep adding moves": three clean runs, 80% recall, every move
  drilled, confidence 3+, and a last move with nothing saved after it. The row
  simply doesn't appear until a line clears it, so the exercise is the reward for
  finishing something rather than a chore to start one with.
- ✅ **The end of a mastered line is an opponent-to-move position.** A repertoire
  line ends on YOUR move — you prepared an answer and stopped — so what happens
  next is a question nobody has answered yet. (A line ending on THEIR move is a
  different hole, and coverage-gaps.ts is what reports those; grow-line.ts is
  deliberately the complement, working on exactly the line ends coverage ignores.)
- ✅ **Three moves, each with one reason, from the app's established sources.**
  Your own games first ("you have faced this 4 times"), then the bundled opening
  book ("12 openings continue this way"), then a scouted opponent ("Kevin plays
  this"). No network, no login, no engine — a daily part must never wait on any
  of the three. The floors are coverage's own — two games, because once is an
  accident and twice is a thing that happens to you — plus one of the book's
  own: past its main continuation, a reply has to be played by at least two
  named openings. At the end of 4.Ba4 the book knows 468 openings that play
  4…Nf6, four that play 4…Bc5, and then four more moves with one apiece; the
  tail is padding, not a choice.
- ✅ **The exercise IS the builder, plus one tab.** Adding a move is building,
  and the builder is where the tools are — the board, the opening library, your
  own games, the engine, the position explorer. So the daily row opens the book
  at the end of the line and puts a "Grow line" tab in front of the others,
  carrying the brief, the line's record and the three moves. One move is the
  whole job; every other tab is right there if you want to look further first.
- ✅ **The three moves are on the board, not just in a list.** They are drawn as
  arrows in the hint blue every other "the app is pointing at this" arrow uses,
  weighted in the order the panel lists them, and they go the moment one is
  played — three arrows over the position you are now thinking about would be
  three arrows in the way. The tiles themselves are Explore's, verbatim: same
  gesture, same shape, three across. Only the reasons live underneath, where
  they have the width to be read.
- ✅ **The panel says what to do next, by name.** "Now play your answer" leaves
  someone looking for what they are answering, so the copy names the move:
  *They've played Nf6. Now play YOUR answer on the board.* Then, once it is
  down, *Nf6 is your answer — add it to your line* over a full-width button
  that does exactly that. The line's own moves are not repeated on the panel;
  the builder's move strip is directly above it, on every tab.
- ✅ **Save and move on.** A grown branch skips the confirm run every other new
  line gets. The exercise is already an interruption to the daily challenge, and
  ending it by drilling the line you have just written — then landing on My
  Lines — puts two screens between the user and the rest of their day. It saves,
  leaves the builder, and launches the next part of the challenge.
- ✅ **"Skip for today" is quiet, and it counts.** A position you don't want to
  think about today is not a failure, so the control that says so is a plain
  underlined word rather than a button — beside the title, where it can be found
  without reading the panel to the end. It clears the row with no right and no
  wrong filed (a perfect day survives it) and rests that line for a day, so
  tomorrow offers a different one. It does NOT pull the next part up: skipping
  says "not now", and answering that with another exercise would be the app
  arguing. It goes while a draft is waiting, too — skipping then would throw
  away moves just played. Walking out of the builder clears nothing: the row
  stays open, because leaving isn't doing it.
- ✅ **A grown line looks after itself.** Adding moves gives the line moves that
  have never been drilled, so it stops being mastered until it has been learned
  again — it leaves the pool without being told to. `grow-log.ts` exists for the
  case that doesn't: a skip, and a branch grown into material already in training.

---

## The speed-bonus round — paying for how fast, where Elo pays nothing for whether ✅

Testing on the phone: at the bottom of the ladder every puzzle is a low-rated
one, and plain Elo pays nothing for solving those. Beat a puzzle 700 points
below you and the gain rounds to zero; miss it and it costs a full step. An easy
puzzle was all downside.

- ✅ **The bonus fills exactly the gap the base leaves.**
  `bonus = 6 × speed × expectedScore(you, puzzle)` — `expectedScore` being the
  share of the result plain Elo already treated as a foregone conclusion. So the
  clock pays most precisely where the solve paid least, and fades to nothing on a
  puzzle harder than you, where a full step is already on the table. A 900 puzzle
  at 1600 went from **+0 to +6**; a 1400 puzzle at 1000 stays at +21 whether you
  were quick or not.
- ✅ **It only ever adds, and a miss ignores the clock entirely.** Losing rating
  for being slow would turn every puzzle into a test of nerve, and "I saw it, I
  just checked it twice" is not a mistake. Wrong is wrong, at the same price as
  before. A wrong move or a hint takes the bar away then and there — a bar
  counting down to a bonus that is already spent is worse than no bar.
- ✅ **Par is per-puzzle, and generous.** Five seconds to read the position, five
  per move you have to find, and up to thirty more for the puzzle's own
  difficulty: a one-move 800 is 13 seconds, a three-move 2000 is 43. Anything
  under a third of par is the full bonus — par is not a target, it is the line
  past which speed stops being evidence.
- ✅ **It is YOUR thinking time, not wall time.** The clock runs only while the
  board is actually yours, so the opening animation, the opponent's scripted
  replies and the alternative-move engine check are all free. Charging someone
  for the app's own pauses is the quickest way to make a bonus feel rigged.
- ✅ **One block for the whole puzzle: YOUR rating, and the clock under it.**
  Before this round the rating only appeared at the END, as the PUZZLE's rating,
  and the clock was a stray row above an empty space — two strangers sharing a
  gap. Now the number you care about is on screen while you solve and MOVES when
  you finish, which is the only presentation of a rating change anybody reads.
  The clock is a time and a bar and nothing else: a bar that empties as the bonus
  does needs no caption, and "Speed bonus" written beside it was one.
- ✅ **A discreet eye hides the clock, and nothing else.** Some people solve worse
  with a clock in front of them and should still be paid for being quick, so this
  is a DISPLAY switch — the bonus is earned exactly the same way with the readout
  off. A bonus you can turn off is not a bonus, it is a difficulty setting. The
  choice is remembered across runs, and the eye stays as the way back.
- ✅ **The addition is staged, because addition is a thing that HAPPENS.**
  "+6 points ⚡+6 fast" sat there as two facts side by side and nobody could tell
  whether the bolt was part of the six or on top of it. Now the solve lands
  (`+0 solved`), the bolt arrives beside it (`+ ⚡+6 fast`), and only then do the
  two resolve into a total that counts on from the first number — with your
  rating ticking up alongside it. Reduced motion gets the final state at once.
- ✅ **The clock never flickers in and out of a run.** A repeat from the review
  queue can't move the rating, so it used to hide the clock entirely — which is
  most of what made the rated mix look like it had no clock at all, since about a
  third of that mix is repeats. The time now always runs; only the BAR is absent
  when there is nothing to earn (a repeat, or a puzzle already spoiled by a wrong
  move or a hint).
- ✅ The results list still puts a bolt on every row the clock paid for.
- ✅ **Both ladders, one change.** The Puzzles tab and the End game trainer both
  run through `startPuzzleSession` in rated count mode, so tactics and endgames
  got this together. Time Attack is untouched — it is casual, it never moved the
  rating, and it already has a clock of its own.
- ⚠️ **The ladder will settle a little higher.** A bonus that only ever adds has
  to. It is now measuring how hard a puzzle you can solve QUICKLY rather than
  whether you can solve it at all — a different, and for practical strength a
  better, question. It is self-limiting: the harder the puzzles get, the smaller
  `expectedScore` gets, and the bonus goes with it.

---

---

## The counting round — sixteen clickers and nothing to put a name to ✅

I have shipped this app for months with no idea whether anyone opens it. The
landing page has Umami; the app itself had nothing, and the privacy policy said
so in as many words. This round buys back the smallest useful amount of that
without buying an identifier along with it.

- ✅ **The whole payload is one word.** `POST /api/event` with a body of exactly
  `{"name":"app_open"}` — validated against a hardcoded allowlist of sixteen,
  400 otherwise, and an object with any SECOND key is also a 400. That last
  check is the load-bearing one: it means a future call site cannot quietly
  start attaching something, because attaching something means editing
  `worker/metrics.ts` where it shows up in a diff.
- ✅ **The server reads nothing it could identify anyone with.** No IP, no user
  agent, no Referer, no cookie, no auth header, no body in the reply. The client
  sets `credentials: 'omit'` and `referrerPolicy: 'no-referrer'` so the browser
  never offers the last two either. Verified on a live load: the events arrive
  with `referer=none cookie=none`.
- ✅ **The stored row is `(name, day, hits)` and there is nowhere for a third
  column.** Two visits cannot be told apart at either end, so these are counts of
  EVENTS and never of people. "How many users" is unanswerable here by
  construction, and that is the design rather than a limitation of it.
- ✅ **Retention without cohorts.** `return_after_d2/d7/d30`, fired once ever on
  the first launch that far after `obertura.installedAt`. The obvious design —
  `retained_d7:2026-w36` — was rejected twice over: a rotating name cannot sit on
  a literal allowlist, and at this traffic a cohort week with one member is a
  pseudo-identifier that follows a device across sessions. Nothing derived from
  the install date leaves the device beyond "a threshold was crossed". The sets
  NEST, so they mean "ever came back after N days", not day-N retention.
- ⚠️ **`app_open` is cold launches, not sessions.** A `sessionStorage` flag
  survives backgrounding and bfcache, but Android evicts a backgrounded PWA's
  document under memory pressure and resuming re-navigates into a fresh one. So
  the number is "launches, plus however often the OS reclaimed the app". Never
  read it as a headcount.
- ⚠️ **OAuth sign-ups cannot be told from OAuth sign-ins.** Google and the rest
  come back with a session that looks identical whether the account is ten
  seconds or ten months old; separating them means asking the server whether
  `created_at` is within seconds of now, on every sign-in, to learn something no
  decision depends on. Not doing it. `signed_up_email` is a floor on
  registrations, not the total.
- ✅ **Three keys stay on the device, each one registered by name.**
  `obertura.installedAt`, `obertura.metricsSeen` and `obertura.metricsOptOut` are
  in `local-keys.ts`'s deny list with their reasons and in
  `local-keys.selftest.ts` by name. A synced `installedAt` alone would make every
  retention number a measure of how often people restore backups.
- ✅ **"Leave me out of the counts", in Settings under the privacy link.** With no
  identifier there is nothing to filter on afterwards, so the only way for me to
  stay out of my own numbers is to say so on the device. Off by default.
- ✅ **The GitHub Pages build compiles it to nothing.** Gated on
  `__DEPLOY_TARGET__`, and confirmed at the bundle: the string `api/event` does
  not appear in that build's JavaScript at all.
- ✅ **Everything fails soft, against the house style.** `stripe-webhook.ts` has a
  banner insisting on the opposite; that reasoning is Stripe's and does not
  travel. A missing secret, a Supabase outage and an accepted event all return
  the same 204. Once-ever events are marked spent BEFORE sending, so a failed
  send is simply lost — which is correct for a counter and would be a bug for a
  payment.
- ✅ **The privacy policy stopped lying in four places.** It used to say "No
  analytics in the app. I don't know how many people use the app". Replaced with
  a section naming every event, what is deliberately not collected, the two local
  values and where the switch is — not softened wording.

---

---

## The account-summary round — who trains, who only builds ✅

The anonymous counter (previous round) answers "how many times did X happen"
and can never answer "does the same person who builds also train" — that is the
design, not a gap in it. This round answers the second question the only way it
can honestly be answered: per account, for people who chose to have one, in
numbers small enough to ride a push that was happening anyway.

- ✅ **A `stats` jsonb column on `profiles`.** Twelve integers and two strings,
  ~300 bytes: lines, lines in training, repertoires, games, drills, puzzles,
  daily challenges, endgames, mistake drills, streak, training days, onboarding
  done, last active day, app version. Flat on purpose —
  `select id, stats->>'linesInTraining' from profiles` is the whole admin query,
  and it never touches a user's repertoire blob.
- ✅ **It costs no request.** Attached inside the one branch of `pushDirtyParts`
  that has already decided to write the `repertoire` column — not to the row
  unconditionally, which would make every 30-second tick a request and defeat the
  fingerprint skip. Not part of the fingerprint, so it can never make an
  unchanged payload look new. Wrapped in a `try`: a failed counter must never
  cost somebody their sync.
- ✅ **No third timestamp.** Because it only ever rides the core write,
  `repertoire_updated_at` already dates it exactly.
- ✅ **⚠️ Reported, not measured.** The browser computes it and the browser
  uploads it, so it is forgeable. `authenticated` has an UPDATE grant on `stats`
  and deliberately none on `entitled`; nothing may ever gate on this column, and
  the app never reads it back. Written down in three places so it survives.
- ✅ **One new counter, not fourteen.** Thirteen of the numbers were already on
  the device. `mistakeDrillsCompleted` was not — the per-spot marks live on each
  game's `retry` blob, so totalling them meant loading every game with its
  analysis tree. One integer bumped in `recordSpotResult` replaces that, cleared
  by "Reset progress" with the other logs.
- ✅ **Honest names.** `daysActive` became `trainingDays`, because that is what
  it measures — nothing records days the app was merely opened, and the keys that
  could are device-local by design. `puzzlesSolved` and
  `dailyChallengesCompleted` are 120- and 180-day windows, said so per field.
- ✅ **The opt-out does not cover it, and the app says so.** "Leave me out of the
  counts" is about the anonymous counter, where not counting is the only possible
  exclusion. This is account data, so the Settings copy now ends by saying it
  covers anonymous counting only and points at the privacy policy, which
  discloses the summary in the account table and draws the distinction in full.
- ✅ **An entitlement hole found in the grant audit, closed.** Verifying that
  `entitled` stayed unwritable turned up `authenticated` holding INSERT on every
  column of `profiles`: the block revoked UPDATE only, so Supabase's default
  table-wide INSERT grant survived and the column list merely added to it. RLS
  kept everyone inside their own row, so no data was ever exposed — but a row
  does not exist until the first push, so a new account could insert its own row
  with `entitled = true`, once, and get the paid tier free. `revoke insert` +
  re-grant, applied together because Postgres drops the column grants with the
  table privilege and the revoke alone would stop new accounts creating a row at
  all. Verified as the `authenticated` role: the `entitled` insert and update
  both come back *permission denied*, the six-column sync insert passes.
- ✅ **A fingerprint bug found on the way in, fixed first and on its own.**
  `coreFingerprintOf` hashed `backup.lines`, the retired v1/v2 shape;
  `exportCore()` has emitted `repertoires` since version 3. The fingerprint was
  therefore taken over the localStorage snapshot alone, and a repertoire edit
  touching no localStorage key did not count as a change. The self-test agreed
  with the bug — its `coreBlob()` built the v1/v2 shape — so that helper now
  builds what the app really produces.

---

## The grow-notice round — from a daily quota to a standing offer ✅

Growing a line (previous round) shipped as the daily challenge's eighth part,
capped at one because the exercise ends by handing you the extended line and
chaining a second one would yank you back into the builder from a screen you
were just taken to. That cap made it feel like a chore competing with puzzles
and lines for one of the day's ticks, when the honest shape of the offer is
"this one's ready whenever you are" — which a quota row can't say.

- ✅ **Out of Daily Challenge entirely.** `growLines` is gone from
  `DailyTaskId`, the order, the config, the done-state, the preview — the
  challenge is seven parts again. `dailyCountCeiling` (the special one-a-day
  cap it existed for) went with it, since every remaining part shares the same
  ceiling.
- ✅ **A dismissable notification card instead** (`grow-notice.ts`), styled
  like a phone notification — it isn't one — sitting in a host shared by
  Train, My Lines and Explore (`#grow-notice-host`, a sibling of `<header>` in
  `index.html`, repainted from `showView()` on every navigation). One card,
  one line, ever: icon, "Grow a line", the line's name. Nothing else — the
  reasons for each suggested move still live inside the builder's Grow tab,
  where there's room to read them.
- ✅ **Never nagging.** No mastered, growable line with something to prepare
  for → no card, not an empty one. Three ways to go quiet, sharing the one
  rest map (`grow-log.ts`) so any of them clears the offer everywhere, not
  just where it was acted on: swiping the notice away rests the line 3 days
  (`GROW_NOTICE_DISMISS_DAYS`, the vaguest signal); "Skip for today" inside
  the builder's Grow tab rests it 1 day (you looked and passed — a more
  specific answer); finishing the exercise rests it 14 days, as before.
- ✅ **The same exercise, a new front door.** Tapping the card runs the exact
  builder-entry recipe the old daily row used — Grow tab preselected, arrows
  on the board, the three sourced moves — just reached from wherever the
  notice was tapped. Finishing or skipping now returns to *that* screen
  (`growReturnView`: Train, My Lines or Explore), not always to Train.

---

## The GitHub Pages retirement — a goodbye page for the old test mirror ✅

Bito Chess now lives at bitochess.com; the GitHub Pages URL was only ever the
internal tester mirror (`DEPLOY_TARGET=github`, gate.ts's beta gate). With real
users on the real domain, that mirror closes rather than keeps drifting.

- ✅ **`farewell/index.html`** — a single self-contained static page (its own
  copies of the two Chakra Petch `.woff2` files and `icon-192.png`, no build
  step, no dependency on `src/`) that explains the move, links to
  bitochess.com, and carries one working button: "Download my data".
- ✅ **The export logic is a hand-copied duplicate of `exportBackup()` and
  `local-keys.ts`'s `backupLocalKey()`**, not an import of them — deliberately,
  so the page keeps exporting correctly even after the app it once served is
  deleted from the repo. Reads IndexedDB's `repertoires`/`lines`/`games`
  stores and the same allow-listed localStorage keys straight from the
  browser, and writes the exact `obertura-backup` v4 JSON shape the real
  `parseBackup()` accepts — verified by running the produced file through the
  actual `parseBackup()`/`repertoiresFrom()`/`partsInBackup()` from
  `storage.ts` (not just eyeballed).
- ✅ **`deploy.yml` no longer builds the app.** It used to run the full
  `npm run build` (the `github` target) and upload `dist/`; now it just
  uploads `farewell/` as-is. The `github` Vite build target itself is
  untouched — `npm run dev`/`npm run build` still build the real app locally
  — only the GitHub Pages *deploy* changed. The `cloudflare` target
  (bitochess.com) was never touched.

---

## The daily challenge card, dressed up ✅

The card worked but read flatly: a filler sentence nobody needed to read
twice, a done-state that was one line of plain text with no sense of how the
day went even though the full numbers already exist a tap away in the
completion popup, and task icons with no visual weight of their own.

- ✅ **Circular icon badges.** Task icons now sit in a soft accent disc — the
  same recipe as the onboarding intro/wizard icons, scaled down — instead of
  a bare coloured glyph. Done tasks get the same disc in green.
- ✅ **A progress bar on the active card.** A thin "N of M done today" bar
  under the header, built with the same track/fill CSS the locked card's
  three-line goal bar already used (factored into one shared `buildBar`
  helper rather than duplicated).
- ✅ **The footer's flavor text is gone.** "Lines, puzzles and your own
  mistakes, picked for you." (and its fallback) added nothing worth reading
  twice a day; the footer is now just the preferences gear, right-aligned.
- ✅ **The done card shows a real number.** Instead of "Daily challenge done —
  keep training ✓", a green check badge, "Done for today", and a
  "N% correct today" line — read straight from the same log
  (`getDailyLog`/`accuracyOf` in `daily-recap.ts`) the completion popup itself
  reads, so the two numbers can never disagree. Still the same tappable row
  that reopens the popup for the full recap.

---

## The which-move reveal, folded into one row ✅

Which move (and Mistake retry / Blunder detective, which share the same
red/green reveal) used to show the verdict twice: the two pick buttons turned
red/green, then a second row of two boxes underneath repeated the same two
moves with their evaluation and a why-clause. That cost a full extra block of
vertical space to say the same thing twice.

- ✅ **One box per move, not two.** The eval number and the why-clause
  (`explainPair` in `which-move.ts` — "leaves you losing", "holds the
  balance", etc.) now render straight inside the same pick button that
  already turned red or green, via a shared `fillEvalContent` helper
  (`eval-chip.ts`). Which move no longer renders a second `wm-facts` block at
  all.
- ✅ **Tap red or green to see that position.** Both boxes stay tappable after
  answering — tapping either flips the board to that move's own resulting
  position (a new `fenAfter` pure helper in `which-move.ts`), with a subtle
  brightness highlight showing which one is currently on screen. The same
  tap-to-preview lands on Mistake retry and Blunder detective's reveal chips
  (`evalPairRow`'s new optional tap callbacks), even though those two don't
  have pick buttons to fold into.
- ✅ **"No — X was the move" is gone.** Which move's status line now reads
  "Against `<opponent>` you played `<move>` ??" instead — the fact worth
  keeping, since the two boxes already carry the right/wrong verdict.

---

## The four .mr-* drills, made to match ✅

Mistake retry (four categories: Opening blunders, Punish the opening, Missed
wins, Blunders), Blunder detective and Brilliant moves share the same `.pt-*`
/ `.mr-*` overlay chrome, but were built in separate rounds and had drifted:
only Which move and Blunder detective had `--compact` (Mistake retry's top
block ate the spare height meant for the board), all four still showed the
game's opening under the opponent's name, and none of them protected the
post-answer Analyse/Next buttons from being scrolled out of reach when the
reveal ran long.

- ✅ **The opening is gone.** It named a fact nobody needed mid-drill and cost
  a line of vertical space in all four exercises for nothing the story line
  above it didn't already imply.
- ✅ **Analyse and Next never scroll away.** The overlay itself stopped
  scrolling; a new `.pt-scroll` wrapper holds everything except the
  post-answer actions, which now sit outside it as an ordinary flex item — so
  they're always the last thing on screen (`.pt-overlay--footer` in
  `style.css`), never something a long reveal pushes below the fold. Mistake
  retry also picked up `--compact`, matching the other three.
- ✅ **Which move's reveal, in three lines.** Above "Against X you played Y"
  now reads Correct/Incorrect in words (not just the red/green the two boxes
  already carry), and below it the engine's own evaluation of the position —
  the number the two boxes' own evals are relative to.

---

## The free/Pro copy round — 500 lines, four Pro things, no explaining ✅

The offer had outgrown its own description. Free already capped storage at 500
lines and 100 games (two earlier rounds), and Pro already carried unlimited
repertoires and opponent scouting *in code* (`isEntitled()` waives both caps) —
but every piece of copy still said the old, narrower thing: Pro as "unlimited
training rotation" and nothing else, at 9€. A first pass rewrote it with a
price-comparison line against Chessbook and a paragraph explaining why
game-sync is the paid half; a second pass cut both, on the instruction that a
pricing box lists features and stops — no launch-price note, no reasoning,
just ticks.

- ✅ **Both boxes are now plain tick lists, nothing else.** Free: build up to
  500 lines, train 10 at a time, sync across your devices, import and scan 100
  games for coverage gaps, library and starter packs, puzzles and endgames,
  engine and analyser, backup and PGN export. Pro: your whole games library
  synced and kept, unlimited training rotation, unlimited repertoires,
  opponent scouting, one-time payment. No tagline sentence explaining either
  one beyond the box's own heading. Rewritten in `docs/LANDING-COPY.md`'s [THE
  TWO PLANS] (the source of truth), mirrored into `docs/index.html`, and into
  `src/pro-sheet.ts`'s popup — same words, same order, as the house rule
  requires. `src/settings-screen.ts`'s Go-Pro CTA and `src/about.ts` carried no
  offer copy to begin with; confirmed, not touched.
- ✅ **The price is always the live Stripe number, never a sentence.** No
  hand-typed price comparison anywhere in the offer copy — just the one price
  tag both surfaces already fetch from `GET /api/stripe/prices`, with the
  `12€` fallback for when that fetch hasn't landed yet. Mirrored the 9€→12€
  move into `src/pricing.ts`'s `FALLBACK_AMOUNTS`, `docs/terms.html`'s refund
  and liability-cap clauses, and `STRIPE-SETUP.md`'s dashboard instructions —
  none of which touches the actual Stripe Price objects, which are a
  dashboard edit only Marçal can make.
- ✅ **`APP-CONTEXT.md` §16.3 was already stale before this round** — it
  documented only the training cap and never picked up `FREE_SAVED_LINES` or
  `FREE_STORED_GAMES` from the two rounds that added them. Fixed in the same
  pass, per the "wrong docs cost more than missing ones" rule.

---

## The `stats_daily` retention round — the one table with a growth curve ✅

A full audit of what the free/Pro tiers cost on Supabase's free plan found the
app's own per-account payload well controlled — the two-column split, the games
diet, the 4 MB ceilings, the free tier's caps — and exactly one table with no
bound on it at all. `stats_daily`'s cron took **every** profile with a `stats`
value, **every day, for ever**: an account that pushed once and never came back
still cost a row a day of unchanging numbers. At ~420 bytes a row that is
~0.15 MB per account per year, roughly twice the entire profile row of a typical
free account, and it was on course to be the thing that filled the 500 MB —
before repertoires, egress or MAU came anywhere near their limits.

- ✅ **The snapshot only takes accounts used in the last 35 days.**
  `snapshot_profile_stats()` now filters on `stats->>'lastActiveDay'`, which
  `src/account-stats.ts` writes as a local `YYYY-MM-DD` and which dates real
  activity (a push only happens when something changed). Compared **as text**,
  not cast to a date: ISO dates sort chronologically as strings, so the
  comparison is exact, and a malformed value fails to match instead of raising
  and killing the nightly run for everyone.
- ✅ **And the tape has an end.** A second function, `prune_profile_stats()`,
  deletes rows past 400 days — a year plus enough margin to have both ends of a
  year-on-year comparison — on its own weekly cron (`prune-profile-stats`,
  Sundays 03:47 UTC, clear of the nightly snapshot). Safe to delete by nature:
  the table is a derived copy of a summary the app rebuilds from scratch on
  every push, nothing reads it back into the app, and the only loss is a trend
  line.
- ✅ **Growth changed shape, not slope.** The table now costs ~0.17 MB per
  **monthly-active** account and stops climbing, instead of climbing with
  everyone who ever signed up. 500 active accounts hold it at ~84 MB in a
  steady state. An account that registers and never returns costs nothing at
  all: no `stats` until its first push, no row after 35 quiet days.
- ✅ **`SUPABASE-SYNC.md` §1 and §7 rewritten to match**, including the
  free-account figures (0.07 MB typical, 0.31 MB at the 500-line cap — games
  never sync for a free account) and a `pg_total_relation_size` query, so the
  next person to ask "how much room is left?" measures instead of guessing.
- ⚠️ **Both cron jobs must be (re-)run from the dashboard** — the SQL is in
  §1 and is safe to paste whole; pg_cron keys jobs by name, so re-running
  updates rather than duplicates them.

---

## A free account worth having — lifting a cap that protected nothing ✅

Same audit that found `stats_daily`'s growth curve turned up the opposite
problem next door: a wall in front of something worthless doesn't convert. A
free account bought sync and the fuller import ladder, and *cost* one thing a
guest never met — `FREE_STORED_GAMES`, a 100-game ceiling on My games that only
applied once you actually signed in. It was the one place in the app where
signing in took something away, which `entitlement.ts`'s own long-standing
comment says must never happen.

- ✅ **`FREE_STORED_GAMES` is gone, not just raised.** It was guarding the
  user's own phone, not the database: games never sync for a free account
  (`gateGamesToEntitlement` in `sync-core.ts` keeps that column Pro-only), so
  the cap cost Supabase nothing to lift. Removed the constant, `freeGameRoom()`,
  `isSignedInFree()` and `noteGamesCapHit()` from `entitlement.ts` outright,
  and simplified every call site rather than leaving a dead branch: the two
  `auto-refresh.ts` refresh paths (`takeWithinCap` deleted, its trim was
  already a no-op for anyone but a signed-in free account), `import-last.ts`
  (`GamesCapReached` and its callers in `builder-import.ts` and `main.ts`),
  `import-panel.ts`'s headroom notice and `runPersist`'s baseline/room/capped
  bookkeeping, and `my-games-screen.ts`'s counter. The now-unreachable
  `games_cap_hit` metric came out of both `src/metrics.ts` and
  `worker/metrics.ts`'s allowlists.
- ✅ **The landing page was advertising the GUEST number as the free-account
  benefit.** The Free box's "Import and scan 100 games" was
  `FREE_GUEST_IMPORT` — the signed-OUT cap — when a free account has always had
  the full ladder to `HARD_CAP` (1,000). Fixed in `docs/LANDING-COPY.md` (the
  source of truth, with a note explaining why so the guest number doesn't
  drift back in) and mirrored into `docs/index.html`: "Import up to 1,000
  games, kept on your device."
- ✅ **The import panel's guest padlock now names the actual reward.** It
  already only ever quoted the true guest number, so nothing there was wrong —
  but it undersold the upgrade. "Without an account you can import 100 games"
  now continues "— a free account lifts that to your whole history."
  (`import-panel.ts`)
- ✅ **`APP-CONTEXT.md` §16.3 rewritten** to drop the retired constant from its
  table, note why it's gone, and correct the free/Pro split summary.
- ✅ **`npm run selftest` (1495/1495) and `npm run build` both pass** on the
  result — a pure subtraction, no new surface added.


---

## The games-first onboarding round — the app's front door, rebuilt ✅

The old first run taught the HARDEST thing first: an empty board and a guided
build, with training, the daily challenge, mistakes from your own games, the map
and the coverage gaps all behind a three-line wall the user had to grind through
before seeing any of it. This round replaced the whole entrance.

**The shape.** "Where do you play?" (`onboarding-where.ts`) → import → a recap of
YOUR openings (`onboarding-recap-screen.ts`) → one tap saves five lines →
training and the daily challenge unlock with real data in them. Colour is never
asked on that path; the import already knows which they play more. The colour
picker survives behind "I'm new" only.

- ✅ **The beta gate is gone.** A SHA-256 code screen in front of the whole app,
  always a speed bump rather than security, guarding a beta that is now public.
  `gate.ts` keeps only the install-prompt plumbing. `BETA-ACCESS.md` and 143
  lines of `.gate-*` CSS went with it.
- ✅ **The recap is deliberately ENGINE-FREE**, and that is the whole reason it
  works. The first draft put a mistake and a brilliancy on it; both come from
  `mistake-scan.ts`'s pass at 15–40 s a game (81 positions, 120 ms cloud pacing,
  local Stockfish after three misses) — `mistake-autoscan.ts` exists precisely
  because that is "a progress bar for ten minutes". Cutting them removed the
  engine from first run entirely. The background autoscan still prepares them for
  whenever the user reaches Mistake Retry.
- ✅ **The lines offered are the user's own moves** — a majority-vote trunk
  through each opening's games (`trunkOf`), always ending on one of their own
  moves, balanced across both colours so neither book starts empty. 28 self-tests.
- ✅ **The import's review step folded into the recap.** "Found N games" asked
  for decisions about raw games before the user had seen anything; its one real
  question (time format) moved onto the recap, where changing a chip visibly
  changes the openings. `skipReview`, `alwaysReplace` and `maxGames` are the
  three options that make the shared panel behave for first run.
- ✅ **Scan only what we keep.** The panel scanned to `HARD_CAP` (1,000) and
  sliced afterwards — ten times the archives for games thrown away.
  `FREE_GUEST_IMPORT` now bounds the scan itself, and rose 100 → 500 so the
  recap's time filter still has something to say after slicing.
- ✅ **One loader across the whole wait.** Three attempts: a blank cover never
  painted (naming openings is a long synchronous block), a fresh loader painted
  but started empty (avatar, status and openings slider all vanished mid-flow),
  and finally the import panel HANDS ITS LIVE LOADER OVER (`onImported`'s
  `handOff`). Naming is precomputed with yields, which also makes every later
  filter change a map lookup instead of 500 replays.
- ✅ **"N openings found"** on the loader, sliding through their names — free,
  because every parsed game already carries the platform's opening name. It
  replaced 38 lines of chat in the author's voice ("Grab a coffee ☕").
- ✅ **Back steps through the flow** instead of dropping the user in an empty
  app, and `setOnboardingComplete()` moved to where the flow genuinely ends — it
  used to fire on picking a platform, so backing out left first run never to
  return. A reload mid-flow now RESUMES at the openings.
- ✅ **The walkthrough fires on the first builder open, whichever door.** It was
  wired to the first-run colour picker, which no longer exists for most people.
- ✅ **Get started rebuilt around the new flow**: the account leads (the only row
  that protects what was just made), "Import your games" became "Add openings you
  play", "Take the walkthrough" became "Build a line by hand".

---

## Round 4 — saying when you are a guest ✅

Guest-first is the design, which makes "am I signed in?" a question the app never
answered: the header icon looked identical either way, and signing out changes
nothing visible because the lines are on the phone regardless.

- ✅ **A dot in the header.** Hollow for guest, filled for signed in, state in the
  button's accessible name. Deliberately independent of the avatar beside it —
  that picture is the CHESS PLATFORM's, set by an import, so a guest who imported
  games looked exactly like a member. `overflow: hidden` came off the button to
  stop it clipping the badge; it was there to round the avatar, which rounds
  itself.
- ✅ **The free account offered before the price.** A signed-out user who hit a
  cap got a €12 sheet whose only other affordance was "Already have Full Access?
  Sign in". **It is NOT a way past the cap** — `canEnrolAnother` is
  `isEntitled() || under the cap`, and a free account is not entitled — so it
  offers what the account genuinely does at that moment: keep the work. The
  warning against implying otherwise sits beside the option in `pro-sheet.ts`.
- ✅ **The first push is deferred** until there is a line to protect
  (`shouldDeferFirstPush`, `sync-core.ts`) — a `profiles` row is created by the
  first push, so an account that never pushes costs only its `auth.users` entry.
- 💤 **iOS storage eviction is still unverified** — Safari may drop IndexedDB
  after ~7 days for a site not added to the home screen. If it does, "install the
  app" and "create an account" stop being interchangeable in Get started. Needs a
  real iPhone over a real fortnight.

---

## The clock round — saying when you were low on time ✅

Both platforms hand the per-move clock over with the games we already download,
and the import was throwing it away. Now it doesn't, and the "from your games"
exercises can say what the engine numbers never could: not just that the move
was bad, but what kind of moment you played it in.

- ✅ **Clocks captured at import, from data we already fetch.** Chess.com writes
  `{[%clk 0:02:59.9]}` after every move of every live game inside the PGN we
  already parse (verified against a live archive: 60/60 games carried it);
  Lichess adds a per-ply centisecond array for one extra URL parameter,
  `clocks=true`, on the response we already stream. **No extra requests on
  either platform.** Only YOUR OWN readings are kept, rounded to whole seconds —
  about 190 bytes a game against ~370 for both sides, and the opponent's clock
  answers no question this app asks. `clock.ts`, `clock.selftest.ts`.
- ✅ **Correspondence is excluded on purpose.** Chess.com writes a `[%clk]` for
  daily games too, but it is not a countdown — a 3-day game shows readings that
  jump around — and nothing honest can be said about time pressure there.
- ✅ **Two arithmetic traps, both now covered by tests.** The increment lands on
  the reading the platform writes (an instant first move on a 180+1 shows
  180.9), so it has to be added back or every move looks slower than it was; and
  a berserked Lichess game starts on half the clock with no increment, so its
  first move reports an unknown spend rather than a two-minute think.
- ✅ **A context strip under the reveal** (`spot-context.ts`): the clock ("Low on
  time · 14s left · 20s spent") and what your own repertoire plays here. Two
  rows is the whole budget, and each renders only when it has something true to
  say — a 'steady' clock says nothing at all.
- ✅ **The brief above the board is REPLACED, not added to.** "You played ♛xe8 ??
  here and blundered" is what the red box says once you answer, with a number
  attached, so its line carries the game instead: "3 days ago · you lost this
  one", the result in red or green. The same pixels, a different fact at a
  different moment — which is where the room for all of this came from.
- ✅ **"The full story" takes Analyse's place** beside Next position, and Analyse
  moves inside the sheet it opens (`full-story.ts`). Analyse was the rarest
  thing wanted from that row and the row's other half is the button that
  continues the run.
- ✅ **The sheet is mostly charts, and both were free.** Your clock through the
  whole game and the evaluation through the whole game, each marked at this
  move — a line falling off a cliff says "you were low on time" better than a
  sentence does. The eval trail has been stored on every scanned game since the
  scan hit v2 and nothing had ever drawn it.
- ✅ **Which move lost two whole lines.** Its reveal restated the played move and
  the engine's eval, both of which its two pick boxes already carry;
  `.wm-facts-line` and `.wm-reveal-eval` went with them.
- ✅ **Line names are cut to fit.** Saved lines are named after their moves —
  "Sicilian: Najdorf, 6.Be2 e5 7.Nb3 Be7 8.O-O O-O 9.Be3 Be6 10.Qd2" is a real
  generated name — and the whole move list was landing inside a one-line row in
  the running app. `shortLineName` drops everything from the first comma; a
  two-line clamp is the backstop for a custom name long enough to beat it.
- ✅ **Nothing new is stored beyond the clocks.** Every other fact is derived at
  render time, so no game needs re-scanning when a rule changes and
  `RETRY_VERSION` did not have to move.
- 💤 **Old games have no clocks.** They arrive only with newly imported games,
  and "Add to existing" skips games it already has by id — so a library imported
  before this round stays clock-less until a "Replace" import. Worth teaching
  the merge to refresh a game that is missing them.
- ✅ **Time pressure, the speed round** (`time-pressure.ts`,
  `time-pressure-run.ts`). Two minutes, twenty seconds a position, opening on
  the moves you had least time for. Any of the engine's top three counts —
  under that clock the skill is seeing a move that doesn't lose, not finding
  the single best one — and the scan already stores all three, so judging costs
  no engine and no network. A find inside three seconds is worth double.
  - It **ranks rather than filters**. "Only positions where you were low on
    time" would leave most people an empty card, so the pool is every mistake
    ordered by how little clock was left; the framing stays honest because all
    of them are positions you actually got wrong. A short pool cycles rather
    than ending the round early.
  - **Nothing is drawn on the board** — not the move you played, not the move
    that was there. The position is read cold, which is what it was in the
    game; an arrow would answer half the question before the clock started.
    The only feedback during the round is a tick or a cross, and what was
    actually there waits for the results screen.
  - **Three outcomes, kept apart to the results screen**: found, missed, and
    ran out. "I knew it and was too slow" is the failure this exercise exists
    to show you, and folding it in with "I had no idea" would hide it.
  - It **writes no training state** — no spot is marked fixed, no rest is
    filed. Finding a move in four seconds under a clock is not the same act as
    working one out in the drill, and letting a speed round empty the queue
    that exists to catch repeat blunders would be a bug wearing a feature's
    clothes. The only thing kept is the personal best.
  - **No abandon dialog**: a confirmation box with a clock running behind it is
    worse than ending early, so End round goes straight to the results with
    everything you found intact.
  - **It is the daily challenge's eighth part**, last in the shipped order. Its
    configured number is the round's LENGTH IN MINUTES rather than a count of
    items — Off/2/3/5, or a typed 1–20 — because the round ends on the clock
    and how many positions it deals was never the user's to pick. That is the
    one asymmetry in the daily config, so `dailyCountUnit` names it and the
    picker, the card label and the custom field all read it from there.
    Existing configs gain the part at the end for free (`normaliseOrder`
    appends what it doesn't find), and the day's row only ticks once the round
    has actually dealt a position — End round on the way in is not a two-tap
    way to clear the day.

---

## The middle-game polish round — one style, one popup, no phantom scrollbar ✅

Six small things, all of them found by using the thing rather than reading it.

- ✅ **The results-row popup carries the story.** Tapping a row used to give you
  the position and a one-line caption while everything known about that move
  sat behind a different button in a different place. `buildStoryContent()`
  splits the story out of its sheet so both can show it; the popup puts it
  under the board and shrinks the board to keep the two together.
- ✅ **"It cost you: the game / nothing" is gone.** Both readings left the
  actual result to be inferred, which is a strange thing to make someone do
  about their own game. The tile now says **This game: Lost / Won / Drawn**, in
  the colour it deserves.
- ✅ **Both ratings, not the gap.** The gap was arithmetic anyone can do from
  two numbers that were already stored; "1520 vs 1370" is what you would
  actually recognise about a game.
- ✅ **"The full story" → "About this move."** The first name promised a
  newspaper feature; the new one says what is inside.
- ✅ **One reveal style.** Which move kept its two chunky pick buttons after the
  answer — filled boxes that still read as things to press, under a board that
  had already moved on. Its picks now become the same `.wm-eval` chips the
  other three exercises show, keeping a ring on the one you picked and a wash
  on the one whose position is on the board.
- ✅ **The phantom scrollbar.** Every overlay is `position: fixed` over a Train
  screen two or three viewports tall, and the DOCUMENT kept its scrollbar: a
  bar down the side of an exercise that moved nothing you could see, and a
  stray swipe scrolled the screen underneath mid-position. Fixed in CSS with
  `html:has(> body > .pt-overlay)` rather than in each of the ~40 overlays'
  open/close, because a missed unlock would leave the app frozen — the rule
  releases itself the moment the overlay leaves the DOM, and a browser without
  `:has()` simply behaves as before.

---

## v1.4 — seeds (parked) 💤

Deliberately parked during the v1.3 round; revisit once v1.3 has had real use on
the phone.

- 💤 A fourth board/app theme.
- 💤 Map transpositions (merge positions reached by different move orders).
- 💤 True background sync via a service worker.
- 💤 Deeper engine adaptation.


## Train becomes four doors and four boxes ✅

**The problem.** Train was four tabs over four hidden panes. Whichever tab you
landed on you were still two decisions from playing anything: pick a tab, read a
menu of five to eight cards, pick one. And the four panes were nothing like four
equal things — the Openings pane is 2,500 lines of screen code and the End game
one 700 — but a tab strip presents them as four identical doors.

**Two shapes were tried on the phone and rejected before this one.** First: all
four doors at the top with every remaining exercise in ONE three-across tile
grid banded by domain colour, readouts in collapsible drawers. Twenty-odd
two-word tiles in five colours read as a wall. Second: each door moved down to
head its own box — which fixed the grouping and lost the row of four that says
what training is. The answer was both layers.

**What shipped.**

- **Four doors, together, at the top.** Each is a big card filled in its
  domain's colour with that domain's live figure on it, and one tap starts its
  flagship: Openings → a repertoire run (*moves due*), Middlegame → the games
  mix (*to fix*), Tactics → the Daily Rated Mix (*rating*), Endgames → the rated
  ladder (*rating*). Every one was already its pane's wide hero button.
- **A box per domain below**, washed in the same colour: *Practise your
  openings*, *From your games*, *More puzzles*, *More endgames*. Mode cards to
  start something, accordions to open a catalogue.
- **Tactics and Endgames are one list each now.** Tactics was three sections
  with their own titles and blurbs, one of which hid half the offer behind a
  segmented toggle buried inside an accordion; it is now Time attack, Satisfying
  traps, Based on my games, Based on my repertoire, then the five theme groups —
  nine rows, scannable in one pass. Endgames leads with "From your games",
  collapsed, then the four piece runs, then the classics.

**Nothing in the plumbing changed, through any of the three shapes.** Each screen
still gets one host and re-renders itself alone. It never needed anything else:
every drill is a `position: fixed` overlay on `<body>`, so a screen's host was
only ever the thing to redraw on the way back. A host holds its door and its
box; `display: contents` plus one `order` apiece sorts the bands.

**Six blocks left Train.** The due hero, Forgotten moves, the mistake stats hero
with its autoscan status, the latest-mistakes carousel, "Analyse my games" with
its progress overlay, and the "start these exercises again" reset. The first
four are readouts and go to Home; the scan is an action nobody asks for by name
(it runs from boot, and Home is where it should say so while it works); the
reset belongs in Settings. Their code is at `97c8733` / `eecb0d7`.

**Timed modes, one length each.** Time attack (openings) was 1/3/5 minutes and
Time attack (tactics) 3/5/10 across two sources — six records nobody could
compare. Both are three minutes now, which was already the tactics default. The
retired lengths' bests stay on disk, unread; `TIMED_DURATIONS` and `TA_TIMES`
survive only so "Reset progress" still clears them all.

**Three real bugs found on the way.** `--eg-accent` was declared on `.eg-screen`,
a wrapper this round removes, while nine rules read it — it now hangs off
`:root`. The door's figure, drawn in the flat accent on a tint built from the
same hue, measured 2.8:1 for the orange one, under the 3:1 floor large text
gets; mixed toward `--text` all four land between 4.4 and 5.6:1. And the
Settings toggle "Analyse games in the background" restarted only the *endgame*
pass when switched back on — survivable while Train had an "Analyse my games"
button, a dead end without one, so it now starts both.

New module: `train-doors.ts` (`buildDoor`, `buildBox`, `boxBody`,
`buildAccordion`, `DOMAIN_ACCENT`). `renderTrainTabbed` → `renderTrainRoom`.
Retired: the `.train-tabs` / `.train-col` / `data-train-mode` CSS, the
`.pz-screen` / `.mistakes-screen` / `.eg-screen` wrappers, `buildTimedCard`,
`buildMixButton`, the endgame piece-selector row, the puzzle practice-source
toggle and all four heroes.

Tagged `v0.10` before starting. **Not deployed** — `main` is still on the tab
strip. The daily-challenge card stays at the top of Train, and Forgotten moves
has no caller at all, until Home lands.



## Home — the app gets a front door ✅

**Why.** Every screen in the app answered one question and none of them answered
"what is going on". The daily challenge sat at the top of Train, where it
competed with the four doors for the first thing you see; Forgotten moves had no
home at all after the Train round removed it; and nothing anywhere told you the
background scan was working rather than broken.

**What shipped.** A sixth tab, first in the bar and the app's new start view:

- **The daily-challenge card**, moved wholesale from Train, with the Get-started
  checklist that rides with it.
- **Train** — the four domains as a 2×2 of tiles carrying their live figures
  (moves due, spots to fix, both ratings), landing on Train. They navigate
  rather than start: each flagship is launched from inside its own screen with
  that screen's data in hand, and reaching those from Home would mean loading
  four more modules on every paint to save one tap.
- **Waiting for you** — "Reading your games — 24 to go" while the background
  pass is actually running (it subscribes and takes itself off screen when the
  pass ends), then Forgotten moves, back from the dead.
- **Your app** — one row per section with its live figure: My Lines, Explore, My
  games (count, last opponent, date), Statistics (the streak).

**The rule that keeps Home and Train apart**, because they are now the two
screens that both talk about training: *Home has one card per section of the
app, Train has one door per kind of training.* If Home ever starts listing
exercises, it has become Train.

**The risky wiring, and what it needed.** `liveDaily` moves with the card, so
`renderHome` is what rebuilds it now. Two things had to follow:

- **The suspended-session resume** keyed on landing back on `train`. Finish a
  daily puzzle, tap Analyse, then "Back to train" — the screen you return to is
  the one with the daily card on it, which is Home. It resumes on either now;
  before the fix that case took the *discard* branch and threw the run away
  silently.
- **The back-navigation root** moved from `train` to `home`, along with the
  start view, the "Back to train" chip, the first-run skip and the
  install-prompt refresh.

**Six tabs is temporary.** They fit at 375px (63px each, widest label 51px, none
clipped) and `.tab-item span` clips rather than shoving its neighbours, but the
answer is structural: My Lines and Explore merge into one "Openings" tab next
round, which takes it back to five.

New module: `home-screen.ts`. `main.ts` gains `renderHome`, and two module-level
handles (`trainOpeningsHost`, `repaintMistakes`) so Home's daily launchers can
still re-render the Train domains they touch — stale-but-harmless when Train is
not the screen you are on, because re-rendering a detached host costs a little
work and changes nothing.

**Not deployed** — `main` is still on the tab strip.



## My Lines and Explore become one tab ✅

**Why.** My Lines answered "what is in my book" and Explore answered "what
isn't" — one question asked twice, in two of the five nav slots, while the half
of the app that reads your own games had a quarter of one tab. My Lines had no
tab bar at all (a comment in `lines-screen.ts` called a one-tab strip "a title
with extra steps"); Explore had four. The fix was to stop one step further on.

**What shipped.** One tab, **Openings**, with four:

1. **My lines** — the saved list, unchanged. `lines-screen.ts` never learned it
   used to be a nav destination: it still takes a host, owns its filter bar,
   sort, groups and re-render, and the host is now a tab body. Its deps arrive
   through `ExploreDeps.linesDeps`.
2. **Coverage** — the replies your lines can't answer.
3. **Discover** — the openings your games say you play. Deliberately *not*
   called "Openings": a tab with its parent's name says nothing about itself.
4. **Packs** — starter packs, traps, the study browser.

**Scouting came off the strip** and sits at the foot of Discover. It was the
only tab here not about *your* repertoire, it is one opponent at a time (one on
the free tier), and Discover is already "read some games, find the openings in
them" — Discover reads yours, scouting reads theirs. It needed a section title
in the move: the tab strip had been its heading, and the old code says so in a
comment ("no section title here, the tab nav already reads Scouting").

**The nav is back to five** — Home · Train · Openings · My games · Statistics —
at 75px a tab on a 375px phone, no label clipped. It was briefly six between the
Home round and this one.

**The one thing that breaks loudly if it is wrong** is the builder's post-save
focus: save a line and the app shows you where it landed. That was
`showView('lines')` plus a re-render; it is `showMyLines()` now, which sets the
TAB and the view together. Every other old `showView('lines')` — the analyser's
back-at-the-start exit, "See in My Lines", the removal flow, the first-line
success — goes through the same helper for the same reason.

**Not deployed** — `main` is still on the tab strip.



## The My games result bar ✅

The last of the four rounds the navigation redesign planned. One stacked
won/drawn/lost bar above the list, counts inside their own segments, score on
the right — draws count a half, and it is called *score* rather than win rate
because that is the chess convention and this is a chess screen.

Two things earn it the space rather than making it decoration. It reads the
**filtered** set, so filtering to Black or to one opening re-reads it — a figure
that changes when you touch the controls above it is a figure people trust. And
it is **tappable**, opening Statistics, where win rate over time already exists;
one bar is also the way into the real numbers.

One bar and no second chart: the space above a list is worth one row, and a
screen whose job is the list should not open with a dashboard. A segment under a
tenth of the bar drops its count rather than clipping it to half a character,
and an empty bucket is not built at all — a zero-width segment still draws its
gap and reads as a hairline in the wrong colour.

**This completes the redesign**: Home, Train's doors and boxes, the Openings
merge, and this. `main` is still on the tab strip until it is deployed.



## The tidy-up round — a home for the reset, a carousel, and two stacked insets ✅

Three things off the back of the first phone test of the new navigation.

**The reset found its home.** "Start these exercises again" came off the
Middlegame box when that box was cut to seven exercises and nothing else, and
had been unreachable since. It is Settings → **"Read my games again"**, beside
Reset progress, because it is the same shape of thing: clears what you have
done, keeps what you have written. It stops the background pass before the wipe,
clears the scan's findings and all three rest logs, and says something different
if background analysis is switched off two rows above it.

**Forgotten moves is a horizontal carousel.** Five of those cards is a board and
four lines of text apiece — two phone screens, at the top of a page whose job is
to show you the whole app. Laid across it costs one card's height and still
shows the worst offender in full, which is the one you were going to tap. The
cards are untouched: same markup, same tap target, same peek. "See all" is the
last slide rather than a row underneath, which is where someone who has looked
through the five already is.

**Two insets that stacked, and a class that was already taken.**

- The shared `.section` card carries a side margin for screens whose parent
  isn't padded. Home's body IS padded, so Forgotten moves sat a full inset
  further in than the label above it — visible in the first screenshot, on both
  sides.
- `lines-screen.ts` wrapped itself in `.lines-tab-content`, which is the class
  carrying the tab body's padding. Fine as a standalone view; doubled the moment
  it became a tab inside Openings, pushing the filter chips and every card in
  past the tab strip.
- The new card carousel picked `.forgotten-slide` — a class the *window* swipe
  track in the very same component already used, which wins by source order. Every
  card came out full width with no peek. It is `.fmove-strip` / `.fmove-card` now.
  Grep before naming a class in an 18,000-line stylesheet.

Section labels also lost the 4px inline padding that had them sitting just
inside the cards they label, on both Home and the Train boxes.



## Forgotten moves, unboxed ✅

Second pass on the block, off the phone.

**The box went.** It was a bordered `.section` card inside a page whose sections
are already spaced and labelled — a second frame around the same thing — and its
padding pushed the card strip in so the cards lined up with nothing else on
Home. Heading and cards now sit at the page inset, same as every other block.

**Moves and Lines are two blocks, not two tabs.** They are two halves of one
question and the toggle kept one of them hidden. Stacked, each gets its own
heading and its own count.

**The captions went.** "Green is recalled, red missed…" under a block whose bars
are green and red; "Recall is the share of a line's drilled moves…" under a
figure labelled recall. The peek behind each card carries the real numbers.

**The Lines card was too wide — and the reason is worth writing down.**
`.fmove-card` had `flex: 0 0 82%` and still came out 493px, because a flex
item's automatic minimum size floors it at min-content: a fixed-width board plus
an unbroken opening name. `flex-shrink: 0` does not help — the floor applies to
the base size rather than by shrinking. `min-width: 0` on the item itself (not
just on its child) is the fix. With it, the card is 281px with a 62px peek, the
recall figure stays inside the card, long names ellipsis, and the meta clamps to
two lines so every card in the strip is the same height.

Names needed one markup change to ellipsis at all: the name row is a flex
container (it carries the colour pip) and the label was a bare text node, which
becomes an anonymous box that cannot take `text-overflow`. It is a span now.



## Home becomes four strips of boards ✅

Home was a daily card, a grid repeating the four Train doors, and a list of every
nav destination with its count. Two of those three were menus of the things Home
is supposed to be showing you the STATE of — the tab bar is one tap away and
already does that job. Both are gone.

What is there instead: **four strips of boards**, each a horizontal swipe of the
same card, in the order the answers are useful.

- **Ready to grow** — lines you have mastered, with the replies you would be
  preparing for **drawn as arrows on the board**. This was a notification:
  `grow-notice.ts`, one card, one line, pinned above three screens with a
  swipe-to-dismiss. That shape said "here is a thing to dismiss"; a strip of
  boards says "here are three positions you know well enough to extend". The
  module is deleted; `grow-line.ts` gained `growTargets()`, the plural of
  `firstGrowTarget`.
- **From your last games** — the mistake spots the scan found, newest first, the
  move you played drawn on the board and what it cost in pawns. This came the
  other way, off the Middle game box, because it is a thing you look at rather
  than start. Rebuilt as a strip to match its three neighbours rather than
  ported as the old tabbed slide track.
- **Forgotten moves** and **Forgotten lines**, as before, with bigger boards.

`forgotten-section.ts` exports `buildStrip` / `buildStripBlock` so all four share
one chrome, and `buildMiniBoard()` gained an `arrows` option — plain SVG geometry
rather than a `<marker>`, because markers need a `<defs>` id and ids have to be
unique across a document holding fifty miniatures.

**The scan banner moved to the top**, above the daily card, and reads like a
notification: an icon, "Reading your games — 24 to go", and three pulsing dots.
The dots earn their place — the count only moves every few seconds, and a figure
that has not changed for four of them is indistinguishable from one that has
stopped. It takes itself off screen when the pass ends, and honours
`prefers-reduced-motion`.



## Home's boards, and three things that made the app feel slow ✅

**The lag was real, and mostly one bug.** Home's scan banner subscribed to the
autoscan on every render and only unsubscribed when the pass *finished*. With
four hundred games left to read, every visit to Home left another live listener
writing into a detached banner — and the scan publishes once per game. Fixed the
way the endgame scan already did it: self-cancel the moment the host is
detached, plus one module-level handle so a new render cancels the old one.

Two more, both mine, both from the redesign:

- Home **awaited** `computeGrowTargets` — which imports the 1.7 MB opening book
  and indexes every game and scouted opponent — before painting anything at all,
  on the landing screen. It paints first now and fills a host when the answer
  arrives. Filling a host rather than re-rendering: a second full pass would
  rebuild every inline SVG board on the page to populate one strip.
- Train renders four domains where it used to render one tab, and Home is a
  fifth surface, so a paint could ask for every game five times over.
  `storage.ts` coalesces **concurrent** calls to `getAllGames` and
  `getAllRepertoires` — the slot clears as soon as the promise settles, so
  nothing is cached and nothing can go stale.

**Two shape changes on Home.** The grow card is a column with a full board on
top: everywhere else the text identifies the thing and the board is a thumbnail
beside it, but here the board IS the thing — three arrows on a position you have
mastered — and at row size you could not read them off it. And the **latest-
mistakes carousel is back as it was**: one position at a time, the newest
unfixed blunder in each category plus your best find, with the five icons across
the top as both picker and position indicator. Its boards are real Chessgrounds,
so they are built **lazily** — an IntersectionObserver on the track builds each
the first time its slide is in view, one instance per paint instead of five.


---

## Later 💤

Deliberately deferred. Revisited once the app has had more real use on the phone.

- 💤 **Deletion tombstones.** Two-device sync now works (the account round), but
  a *deletion* still doesn't travel: lines and games merge, so removing a line on
  one phone leaves it on the other. Needs per-line `updatedAt` plus a remembered
  list of deleted ids — design note in `PUBLISHING.md`. Until then the escape
  hatch is Settings → Data → "Replace this device from your account".
- 💤 Monetization build-out (options and recommended path now in `PUBLISHING.md`)
- 💤 Offline support (service worker / installable cache)
- 💤 Deeper engine features and richer explanations
- 💤 More opening-database coverage and naming
