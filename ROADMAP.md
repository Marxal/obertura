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

## v1.4 — seeds (parked) 💤

Deliberately parked during the v1.3 round; revisit once v1.3 has had real use on
the phone.

- 💤 A fourth board/app theme.
- 💤 Map transpositions (merge positions reached by different move orders).
- 💤 True background sync via a service worker.
- 💤 Deeper engine adaptation.

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
