# Bito Chess — UX/UI audit

*October 2026 · based on reading the source (`src/`, 189 modules) and on driving
the built app headlessly at phone size (412 × 915). The screenshots are in
`ux-audit/`.*

---

## How to read this

**What was reviewed:** every user-facing flow. That covers first run (both
paths), the builder and its walkthrough, starter packs, Home, the four Train
domains, the drill, the exercises built from your games, game import, My games,
the analyser, Openings, Statistics, Settings, accounts, sync, and the Go Pro /
checkout journey.

**Evidence:** findings marked 📸 were seen in the running app, with the
screenshot named. Findings marked 🔎 come from reading the code. The headless
build has no Supabase keys, so the account, paywall and checkout screens never
render there. Those findings come from the code and should be checked on a phone
before acting on them.

**Severity**

| Level | Meaning |
|---|---|
| **P0, critical** | Breaks a core promise, loses data or trust, or makes a new user likely to quit in the first session |
| **P1, high** | Real friction on a main flow; many users will feel it |
| **P2, medium** | Confusing, inconsistent or inefficient, but you can get past it |
| **P3, polish** | Small craft issues |

Each finding has the **problem**, **why it matters** and one or more
**proposals**. Proposals are ordered from cheapest to most ambitious.

---

## Contents

1. [The six critical flows (P0)](#1-the-six-critical-flows-p0)
2. [First run and onboarding](#2-first-run-and-onboarding)
3. [Home](#3-home)
4. [Train](#4-train)
5. [The drill (opening training)](#5-the-drill-opening-training)
6. [Exercises from your games (Middlegame)](#6-exercises-from-your-games-middlegame)
7. [Tactics and Endgames](#7-tactics-and-endgames)
8. [Creating a line (the builder)](#8-creating-a-line-the-builder)
9. [Openings tab (My lines, Coverage, Discover, Packs)](#9-openings-tab)
10. [Game import and My games](#10-game-import-and-my-games)
11. [The game analyser](#11-the-game-analyser)
12. [Statistics](#12-statistics)
13. [Settings](#13-settings)
14. [Account, sign-up and sync](#14-account-sign-up-and-sync)
15. [Go Pro and checkout](#15-go-pro-and-checkout)
16. [Cross-cutting: navigation, language, feedback, accessibility](#16-cross-cutting-issues)
17. [Prioritised plan](#17-prioritised-plan)

---

## 1. The six critical flows (P0)

These are the issues most likely to make someone leave in their first week.
Fix them before anything else.

### C1. New lines are tested before they are taught

📸 `09-pack-detail.png` → `12-train.png` → `15-drill-after-wrong.png`

**The problem.** A new user adds a starter pack with "Add all 12 without opening
them". Train then says **"Run your book — 87 moves due · 0 of 12 mastered"**. On
Start, the Repertoire run asks *"Your move"* about positions the user has never
seen.

- Nothing shows which line or opening the position belongs to. Only
  "POSITION 1 OF 24" appears, even though `RunPosition` carries `lineName`.
- The Repertoire run has **no Hint button**. `drill.ts` builds the Hint, Note,
  Turn off and Edit row only when `isLineDrill && !timed`, and a Repertoire run
  is a positions drill, so it gets none of them.
- The pack's move notes ("✎ 7 move notes") are never shown the first time.
- A wrong move says "Not quite — one more try" and the pawn snaps back. Nothing
  says what was expected or why.

So the first session is a quiz on material nobody taught, with no way to ask
for help. That is the moment the user decides whether the app is "for them".

**Why it matters.** Spaced repetition only works once something has been
learned. Being tested cold produces failure, and "87 due" on day one reads as
debt.

**Proposals**
1. *Quick:* call new material "new", not "due". For example: "12 new lines to
   learn · 0 due". Keep "due" for reviews.
2. *Quick:* show the line name and the move list so far above the board in every
   positions drill (`run-header.ts` already has a `contextLabel` slot).
3. *Quick:* add **Hint** and **Show move** to the Repertoire run. Count them as
   a miss for scheduling, but let the user get unstuck.
4. *Medium:* add a **Learn** step for never-trained moves. The first time a move
   comes up, play it for the user with an arrow and its note, then ask for it.
   This "show, then ask" pattern is how Lotus, Chessable and Anki-style apps
   introduce cards. The confirm run (`settleNewBookLines`) already does this for
   lines saved in the builder; "Add all" from a pack skips it. Apply it to every
   way a line can be added.
5. *Medium:* put new moves into the queue gradually, for example "8 new moves
   per day" as a setting, the way Anki limits new cards. Then "87 moves" is never
   one session.

### C2. The "I'm new" path drops beginners into the hardest screen

📸 `01-where.png` → `03-after-new.png` → `04b-builder.png` → `05-tour-1.png` → `05-tour-4.png` → `06-home-empty.png`

**The problem**
- The tab says **"I'm new"**, but the panel underneath says "I don't play
  online". Someone new to chess and someone who plays only over the board are
  different users, and the label suits neither well.
- After choosing a colour (two taps: White, then "Start building") the user lands
  in the builder: five tabs, a move strip, three suggestion cards, an Auto-reply
  toggle, statistics like "4581.7M games" and "ENGINE PICK #1", and a dock of
  unlabelled icons.
- The six-step walkthrough **moves on whether or not the user does anything**.
  Step 1 says "Play your first move!" and Next works anyway. Step 5 says "Play two
  more moves for now" even when none have been played. The last step offers a big
  **"Save line"** button while the header button says **"Play your first move"**
  and is disabled, so the two instructions contradict each other.
- Step 2 asks the user to **"Connect Lichess"**, an OAuth trip out of the app, in
  their second minute.
- Leaving the builder lands on Home, where "Get started" offers **"Build a line"**
  and **"Build a line by hand"** as two separate items, plus Starter packs. That
  is three ways to do roughly the same thing.

**Why it matters.** This path is for people with no games to import, so they are
the least experienced users, and it gives them the densest screen in the app.

**Proposals**
1. *Quick:* rename the tab to **"No account"** or **"I play offline"**, and add a
   fourth option, or a link, for **"I'm new to openings"**.
2. *Quick:* make the walkthrough wait for actions. The "Play your first move"
   step should advance when a move is played. Hide "Save line" until there are at
   least two of the user's own moves. Drop Lichess from the walkthrough and offer
   it later, at the first moment the explorer would help.
3. *Quick:* merge "Build a line" and "Build a line by hand" into one item.
4. *Medium:* send beginners to **Starter packs first**: "Pick an opening to start
   with" with three big cards (White: Italian · London; Black: Caro-Kann…), then
   Learn mode (C1, proposal 4). Offer the builder as "or build your own".
5. *Medium:* give first-time builder users a simplified mode. Show only the board,
   Explore and Save. Unlock the other tabs after the first saved line, or behind
   "More tools".

### C3. A paywall can appear during first run

🔎 `onboarding-recap-screen.ts:toggleChosen` → `main.ts:3818` `onOverLimit: () => showTrainingCapDialog()`

**The problem.** On "Pick your lines", ticking more than 10 openings (the free
training limit) opens the full Pro sheet with a price, inside first run.
`entitlement.ts` says the opposite should happen: *"never during first-run
onboarding … A paywall in the first minute … is the wrong first impression."*

Also on this screen:
- Five cards are pre-ticked and the toggle on them says **"✓ Added"**, though
  nothing is saved until the user taps "Save 5 lines →". It should say
  "Selected".
- There is no counter for the limit, so the limit only shows up when the user
  hits it.

**Proposals**
1. *Quick:* during first run, replace the sheet with an inline note: "Free
   accounts train 10 lines at a time. The rest will be saved and you can switch
   them on later." Let the extra lines be saved but not put into training (the
   same behaviour as `showBulkCapToast`).
2. *Quick:* add a counter beside the Save button: "5 of 10 training slots".
3. *Quick:* change "✓ Added" to "✓ Selected".

### C4. The email links may open outside the installed app

🔎 `account-ui.ts:441–458`, `account-ui.ts:714`, `auth.ts`. **Needs checking on an Android phone.**

**The problem.** Email sign-up, magic link and password reset all send a link
("Open it on this phone and you can come straight back"). On Android, a link
tapped in Gmail opens in **Chrome**, not the installed PWA, unless the PWA
captures links, and most don't. The user then has a signed-in browser tab and a
signed-out app. They may think sign-up failed, or end up with two copies of their
data (the browser tab has its own empty IndexedDB).

The sign-up form also:
- reports errors as toasts at the bottom of the screen, far from the field;
- has no way to show the password;
- mentions the 6-character minimum only in the placeholder, which disappears once
  you type.

**Proposals**
1. *Quick:* change the dialog copy to "Open the link, then come back to the Bito
   app — you'll be signed in here" only if that is actually true. Otherwise
   explain the extra step.
2. *Medium:* switch email sign-in, confirmation and reset to a **6-digit code**
   typed into the app. Supabase supports email OTP (`verifyOtp` with type
   `email`). The user never leaves the PWA, and the browser/app split goes away.
3. *Quick:* show errors under the field they belong to, add a show/hide toggle on
   the password, and keep the "6+ characters" hint visible.
4. *Later:* add `launch_handler` (and the still-experimental `handle_links`) to the manifest so supporting
   browsers open the PWA when a bitochess.com/app link is tapped.

### C5. Deleted lines come back

🔎 `APP-CONTEXT.md §16.2`: *"deletions do not travel. Remove a line on phone A and phone B hands it back on its next push."*

**The problem.** A signed-in user with two devices (phone and desktop is the
obvious pair, and the app has a full desktop layout) deletes a line and later
finds it back. The only workaround is Settings → Data → "Replace this device from
the account", which the user has no reason to know about. To the user, it looks
like the app ignored them.

**Proposals**
1. *Quick:* when a signed-in user deletes, and the account has been seen on more
   than one device, warn them in the undo toast: "Deleted here. Other devices may
   restore it — [How to fix]".
2. *Right fix:* store **tombstones** (deleted node id plus time) in the
   repertoire blob and respect them in `mergeIncoming…`. This is already on the
   Later list. Given how much it affects trust, it should move up.

### C6. The Go Pro offer is unclear about what the user gets

🔎 `pro-sheet.ts`, `entitlement.ts:openUpgradeDialog`, `checkout.ts`

**The problem**
- **The sheet can show up to five actions** for a guest: *Unlock full access →*,
  *Create a free account to keep them*, *Sign in*, *Continue as a guest*, plus
  tapping the backdrop. With that many options, none of them stands out.
- **The benefits are jargon or vague:** "Unlimited active training rotation",
  "Your whole games library, synced and kept". There's no comparison with what the
  user has now (10 lines in training, 3 repertoires, 1 opponent).
- **The product has four names:** "Full access", "Full Access", "Unlock full
  access", and "Go pro" / "Pro" in code comments and docs. The account card shows
  "Free — 10 lines in training".
- **Buying requires an account,** so a guest goes from the price to a sign-up
  sheet, then (for email users) to "Check your inbox", then out of the app (C4),
  then back, then to Stripe. Every step loses people.
- **Upgrade prompts look different depending on the trigger.** The cap dialog,
  `buildCapNotice` rows ("Unlock full access" with a sparkles icon) and the
  Settings CTA each look different.

**Proposals**
1. *Quick:* give the sheet one primary action (Unlock) and one text link
   ("Not now"). Move "Already bought? Sign in" into a small footer line, and move
   the free-account offer to *after* "Not now", or into the Get-started list.
2. *Quick:* rewrite the benefits as before → after:
   "Train **10 → unlimited** lines at once", "**3 → unlimited** repertoires",
   "Scout **1 → unlimited** opponents", "Games library synced across devices".
3. *Quick:* pick one name, e.g. **"Bito Pro"**, and use it everywhere: the pill,
   the button ("Get Bito Pro — 12€ once"), the account card and the landing page.
   Update `docs/LANDING-COPY.md` first.
4. *Medium:* let the user enter an email at checkout and create the account from
   the Stripe webhook, or use Stripe's customer email plus a 6-digit OTP (C4).
   Make the order *pay → account is created → you're signed in*, not *sign-up →
   confirm email → come back → pay*.

---

## 2. First run and onboarding

### 2.1 "Where do you play?" (games-first path)
📸 `01-where.png`

| # | Sev | Problem | Proposal |
|---|---|---|---|
| 2.1.1 | P1 | The first screen doesn't say **what Bito is**. A user who came from the Play Store or a shared link sees only "Where do you play?". The only explanation is the logo, which links to an external site. | Add a one-line value statement above the question: *"Build your opening repertoire from your own games — and remember it."* |
| 2.1.2 | P1 | **The username isn't checked before the import starts.** A typo goes straight to a slow import that finds nothing. | Look the user up as they type (both APIs are public and free) and show their **avatar, rating and game count** before the import: "Is this you?". The recap already has the avatar, so this is mostly moving it earlier. |
| 2.1.3 | P2 | The content is centred vertically, leaving about 300 px of empty space above the title on a phone, with the key controls in the middle. | Pin the content near the top (about 20% down) or fill the space with a small illustration or the value statement. Keep the button reachable with the keyboard open. |
| 2.1.4 | P2 | "I'm new" is ambiguous (see C2). | "I play offline / not online" plus a separate "New to openings?" link. |
| 2.1.5 | P3 | The "Import my games →" button is greyed out until the user types, but the grey is low-contrast, so it reads as broken rather than "waiting for you". | Keep it fully coloured and focus the field on tap, or add helper text: "Enter your username to continue". |
| 2.1.6 | P3 | Lowercase "bito chess" wordmark vs "Bito Chess" everywhere else. | Fine if it's the logo, but use the same spelling in `aria-label` and the page title. |

### 2.2 The import loader and the recap
🔎 `onboarding-recap-screen.ts`

| # | Sev | Problem | Proposal |
|---|---|---|---|
| 2.2.1 | P0 | Paywall in first run (C3). | See C3. |
| 2.2.2 | P1 | **"✓ Added"** on cards that aren't saved yet. | "✓ Selected". |
| 2.2.3 | P2 | Each card has *two* tap targets: the card opens a preview and the pill toggles selection. People usually expect tapping a card to select it. | Make the whole card toggle selection, and add a clear "Preview ›" link. Or keep the current behaviour and make the toggle look like a checkbox. |
| 2.2.4 | P2 | "Not now" skips the recap with nothing saved. The user then lands on Home with games but no lines, and the Middlegame exercises are still being built in the background. | Ask "Skip? You can turn openings into lines later from Openings → Discover", and tell them where. |
| 2.2.5 | P2 | The line length (how many of your moves) can be changed per line only inside the preview ("add more moves"). Most users will never find it. | Show it on the card: "6 moves · ＋". |
| 2.2.6 | P3 | Time-format chips appear only when there is more than one format. Nothing says the default leaves bullet out. | Label the chips: "Showing: Blitz + Rapid". |

### 2.3 The first-run success card and the account ask
🔎 `onboarding-signup.ts:showFirstLineSuccess`

| # | Sev | Problem | Proposal |
|---|---|---|---|
| 2.3.1 | P1 | Right after saving, the celebration card shows **the full sign-up form** (Google, Facebook, Email). The comment in the file says an earlier version put a form here and it hurt the moment. The current code builds the form on the card again (`buildAuthForm`). | Keep the celebration clean: title, one line ("Right now this lives only on this phone"), one primary button **"Keep it safe — free account"** that opens the sheet, and "Continue as a guest". |
| 2.3.2 | P2 | The first thing after the celebration is Home with a checklist, not a first win. | Offer **"Start your first 2-minute session"** as the primary next step (with Learn mode, C1). |

### 2.4 Get started checklist
📸 `06-home-empty.png`, `11-home.png`

| # | Sev | Problem | Proposal |
|---|---|---|---|
| 2.4.1 | P2 | Three entries do nearly the same thing: Build a line, Build a line by hand, and the FAB's "New line". | Keep one. |
| 2.4.2 | P2 | "Connect Lichess" is listed as a beginner step, but it's useful only to advanced users (explorer, stronger engine). Its description sounds technical. | Move it to a contextual prompt in the builder's Library tab and to Settings. |
| 2.4.3 | P2 | "Training unlocks at 3 lines" is a rule the user didn't ask for, and the copy elsewhere says the habit *"dies"* below 3 (`train-screen.ts:423`). | Say it positively: "Add 2 more lines to start daily training". Remove the "habit dies" wording. |
| 2.4.4 | P3 | The locked daily card says *"Save 3 lines and your first challenge is waiting **tomorrow**"*, but once 3 lines were saved the challenge was available **the same day** (📸 `11-home.png`). | "…and your first challenge starts right away." |

---

## 3. Home
📸 `11-home.png`

| # | Sev | Problem | Proposal |
|---|---|---|---|
| 3.1 | P1 | For a user with lines but no games, Home is the daily card plus a checklist and nothing else. The "state of things" (Ready to grow, mistakes, forgotten moves) only appears once there is history, so the first week's Home is mostly empty. | Add one **"Today"** block that's always there: "Next review in 3 h · 12 lines · streak 0", with a small next-due board. |
| 3.2 | P2 | The FAB (＋) overlaps content on every tab, for example the daily rows and the Statistics "Week" button (📸 `12-progress.png`). It also duplicates "Build a line". | Add bottom padding equal to the FAB's height on every scroll view. Consider showing the FAB only on Openings, where creating lines belongs. |
| 3.3 | P2 | The daily card lists four rows that look like buttons but can't be tapped individually. Only "Start daily challenge" works. | Either make each row start that part, or style the rows as a plain checklist (no card background or press state). |
| 3.4 | P3 | The 🔥 0 streak pill on day one comes before any success. | Hide the streak until it's at least 1. |
| 3.5 | P3 | The scan banner ("Reading your games — 24 to go") gives no time estimate, and each game takes 15–40 s. | "About 10 min — you can keep training." |

---

## 4. Train
📸 `12-train.png`, `13-drill-start.png`

| # | Sev | Problem | Proposal |
|---|---|---|---|
| 4.1 | P0 | "87 moves due" on day one (see C1). | "87 new moves". |
| 4.2 | P1 | **The padlock means three things.** On the domain switch, a padlock means "needs data" (Middlegame needs games; Openings and Tactics need 3 lines). Most users read a padlock as "pay to unlock". Tactics is locked with no lines even though **theme puzzles need no repertoire** and work in its box. | Use the padlock only for Pro. For "needs data", use a hint like "Import games" or "Add 3 lines". Never lock Tactics: start it on theme puzzles. |
| 4.3 | P1 | **Counts that don't mean anything yet.** On untrained lines: Weak spots **12**, New lines 12, Whole lines 12, and **Missed moves 20** before a single move has been played. That last one is either a bug or a count of something other than misses. | Hide a row's count until its meaning is true (no "weak" before training). Check what "Missed moves" counts on a fresh install. |
| 4.4 | P2 | "Tactics 1000" and "Endgames 1000" are puzzle ratings with no label, so they look like counts. | "1000 rating", or an Elo icon. Hide it until the first rated puzzle. |
| 4.5 | P2 | The **"long-press a tab to reorder"** tip appears as a toast on the first visit. It teaches a minor feature before the main one, and it stays on screen over other tabs (📸 `12-explore.png`). | Show it only after the 5th Train visit, attach it to the switch, and dismiss it when the user leaves the screen. |
| 4.6 | P2 | Five ways to train the same lines (Run your book, Whole lines, Weak spots, New lines, Missed moves, plus Time attack and Prep). The difference between "Run your book" and "Whole lines" is explained only behind an (i). | Keep **Start** (smart mix) as the obvious default. Put the rest under "Choose what to practise" with one-line explanations. Rename "Run your book" to "Review" or "Today's review". "Book" is internal language. |
| 4.7 | P3 | The "Run your book" card has an icon, a ring, a title, a subtitle and a Start pill, and the whole card is also tappable. | Fine. Make the Start pill the obvious target and give the card the same pressed state. |

---

## 5. The drill (opening training)
📸 `15-drill-after-wrong.png`, `16-end-session.png`

| # | Sev | Problem | Proposal |
|---|---|---|---|
| 5.1 | P0 | No hint or "show move" in the Repertoire run (C1). | See C1. |
| 5.2 | P0 | No context: the position isn't named and there's no move list. In the main mode the user doesn't know which line they're playing. | Show the line name and the moves so far ("1.e4 e5 2.♘f3 …") in the header area. |
| 5.3 | P1 | After a wrong move: "Not quite — one more try". The board doesn't mark the right piece, and after two misses the user can't easily tell what the answer was or why. | After the 2nd miss, show an arrow, the note if there is one, and the explanation from the pack. Add a "Why?" link that opens the line in the builder. |
| 5.4 | P2 | About 170 px of empty space above the board on a phone. The board is centred vertically and the status text sits at the bottom. | Put the board right under the header and use the space below for status, hint and controls, in thumb reach. |
| 5.5 | P2 | 24 progress dots wrap onto a second row. | Use a thin progress bar, or dots only up to 12 and a bar beyond that. |
| 5.6 | P2 | The "End this session?" sheet: *"Progress on finished lines is kept"*. In a move-by-move run, "finished lines" means nothing to the user. The **filled red "End session"** is visually stronger than "Keep going". | "Your answers so far are saved." Make *Keep going* the primary button and *End* a secondary one. |
| 5.7 | P3 | Sound is off by default, and correct and wrong moves have only colour feedback. | Add a small haptic (`navigator.vibrate`) on a miss, and offer sound on the first run. |

---

## 6. Exercises from your games (Middlegame)
🔎 `mistakes-screen.ts`, `mistake-run.ts`, `detective-run.ts`, `which-move-run.ts`, `brilliant-run.ts`, `time-pressure-run.ts`

| # | Sev | Problem | Proposal |
|---|---|---|---|
| 6.1 | P1 | **Five exercises on the same raw material** (Mistake retry in 4 categories plus Fixed, Which move, Blunder detective, Brilliant moves, Time pressure). The same blunder can come up in three of them; `spot-rest.ts` exists to work around that. Users will find it hard to tell them apart or know which to pick. | Keep **"Today's mix"** as the main door, and present the others as *formats* of one deck ("Fix mistakes" with a format toggle) rather than as separate destinations. |
| 6.2 | P1 | **The wait isn't explained.** The scan reads 15–40 s per game in the background. A user who imports 500 games sees a locked or empty Middlegame for a long time, with progress shown only on Home. | Show progress *inside* the Middlegame panel ("12 of 50 games read — 4 exercises ready, start now"), and let the user start as soon as the first exercises exist. |
| 6.3 | P2 | Category names like "Punish opening" and "Missed win" mix verbs and nouns. | Use one pattern, for example "Your opening blunders · Their opening mistakes · Wins you missed · Game-losing blunders". |
| 6.4 | P2 | Free limits (10 spots from the last 50 games) are explained only in a `buildCapNotice` row. "Unlock full access" on a coaching screen reads as small print. | Explain the limit where it applies: "You're seeing your 10 latest mistakes. Pro shows all 143." A specific number sells better than a general one. |
| 6.5 | P3 | "About this move" (the full story sheet) contains the most useful explanation, but it's a secondary button. | After a miss, open the story automatically, or show its first line inline. |

---

## 7. Tactics and Endgames

| # | Sev | Problem | Proposal |
|---|---|---|---|
| 7.1 | P1 | Tactics locked without lines (see 4.2). | Never lock it. |
| 7.2 | P2 | Two separate 1000-rated ladders (tactics, endgames) start at the same number with no explanation. | A first-time explanation: "Your puzzle rating starts at 1000 and moves with every rated puzzle". |
| 7.3 | P2 | Puzzles need a network connection, and a failed fetch only shows an error. There's no queue for when the user is offline (common for a phone app). | Cache the next 10–20 puzzles when online. |
| 7.4 | P3 | Puzzle Time Attack is documented in some places as 3/5/10 min and in others as fixed at 3 min (`APP-CONTEXT §6.5` vs `§13.1`). | Make sure the UI and docs agree. |

---

## 8. Creating a line (the builder)
📸 `04b-builder.png`, `21-builder-c4.png`, `22-builder-back.png`

| # | Sev | Problem | Proposal |
|---|---|---|---|
| 8.1 | P0 | Walkthrough problems (see C2). | See C2. |
| 8.2 | P1 | **Auto-reply is ON by default.** After the user's move, the app plays the opponent's reply "from whichever source knows this position best". The line being saved then contains opponent choices the user never made. In 📸 `21`, 2…g6 (West Indian) was picked for them. Many users won't notice the reply wasn't theirs. | Default it to off for the first lines. Or, when it plays, briefly highlight it: "Auto-reply played 2…g6 · [Change]". Show the three reply options as the main choice. |
| 8.3 | P1 | **"Add 4 moves"** counts both sides, while the user thinks they played 2. | "Save line (2 of your moves)", or count only the user's moves. |
| 8.4 | P1 | **Density.** Five tabs, a move strip, suggestion cards, an Auto-reply card, "WHY THESE MOVES" statistics, a dock with six icon buttons, and an (i) per panel. "Line info" and "Engine" are greyed out with no reason given. | Default to **one** panel (Explore) plus a "More" drawer. Explain disabled tabs on tap ("Save the line first"). |
| 8.5 | P2 | The header title becomes the full opening name ("Indian Defense: West Indian Defense") and wraps onto two lines, pushing the board down while the user plays. | Fix the title to one line with an ellipsis. Show the full name in the move strip or on tap. |
| 8.6 | P2 | Large numbers and jargon: "4581.7M games", "ENGINE PICK #1", "+0.19", the "Masters / Lichess" toggle. | Round to "4.6B games", and explain "ENGINE PICK" with an icon and tooltip. Hide eval numbers by default for beginners. |
| 8.7 | P2 | The dock has six icon-only controls, including flip board and engine (chip icon). | Labels under the icons, at least the first few times. |
| 8.8 | P2 | The save guard (📸 `22`) stacks **Add them** (green), **Discard** (filled red) and Keep editing. A filled red Discard right under the primary button invites a mis-tap that loses the work. | Make Discard a text button. *Add them* stays primary. Undo already exists, so the dialog could just save and show "Saved · Undo". |
| 8.9 | P3 | Moves in the strip are drawn as dashed boxes. They look like empty slots or drag targets. | Plain text with the current move highlighted, as in Lichess. |

---

## 9. Openings tab
📸 `12-explore.png`

| # | Sev | Problem | Proposal |
|---|---|---|---|
| 9.1 | P1 | **Very long list.** Each saved line is a large card (mini board, name, ECO text, "Added today", status, toggle, four icon actions), about 270 px tall. 12 lines take about 3,200 px of scrolling, and 100 lines would be unmanageable. | Default to a **compact list**, one row per line (name · status dot · due), grouped by opening family and collapsed. Keep the card view as an option. The tree view already exists; consider making it the default for large books. |
| 9.2 | P1 | **Four unlabelled icons on every card** (drill ⚡, edit ✎, settings ⚙, delete 🗑). Delete is one tap away, next to the others. | Put them behind one "⋯" menu, or swipe actions with labels. If delete stays visible, keep the undo toast. |
| 9.3 | P2 | The sub-tabs (My lines / Coverage / Discover / Packs) are a 2×2 grid of buttons, which looks like four actions rather than a tab control. | One segmented row, scrollable if needed. |
| 9.4 | P2 | The filter toolbar is icon-only (search, sort, view, tree), and the colour filter reads "All 12 · ○ 12 · ● 0". | Text chips: "All · White · Black". Give each icon a label or tooltip. |
| 9.5 | P2 | A "Training ON" switch on every card makes accidental changes easy, and it's a setting that rarely changes. | Move it into the ⋯ menu. Show a "Paused" badge only when it's off. |
| 9.6 | P2 | Coverage ("the replies your saved lines can't answer") is the most valuable advanced feature, but it's hidden as a sub-tab. | Show its headline count on My lines ("3 common replies not covered ›"). |
| 9.7 | P3 | Lines named "vs Petroff" sit in the White book, and "Italian…" lines next to them. Sorting by most recent shuffles opening families. | Default sort by opening (move order), with families grouped. |

---

## 10. Game import and My games
📸 `12-games.png`

| # | Sev | Problem | Proposal |
|---|---|---|---|
| 10.1 | P2 | The import button says **"Scan"**. In the app, "scan" also means the engine pass over games, so the user can't tell whether this imports or analyses. | "Import". |
| 10.2 | P2 | Two import entry points on one screen: the inline form and a separate "Import a game" button (single PGN, study, or manual). Their difference isn't explained. | "Import from Chess.com / Lichess" (main) and "Add a single game (PGN, study, by hand)" (secondary, with that subtitle). |
| 10.3 | P2 | Once connected, the weekly auto-refresh is silent. The user can't see when games were last fetched without going to Statistics. | Show "Updated 2 days ago · Refresh" at the top of My games. |
| 10.4 | P3 | The placeholder is lowercase ("your Chess.com username") while the first-run screen uses sentence case. | Use one style. |
| 10.5 | P3 | Bullet is off by default in the import panel. Good, but the reason isn't given. | "(bullet off — too fast to learn from)". |

---

## 11. The game analyser
🔎 `main.ts` (analyser mode), `builder-import.ts`, `line-analysis.ts`

| # | Sev | Problem | Proposal |
|---|---|---|---|
| 11.1 | P1 | **Two different jobs share one screen.** The analyser is the builder in another mode: the same chrome, a different set of tabs, and a header button that says "Save game". Users bring expectations from Lichess or Chess.com (an eval graph first, then moves). | Give the analyser its own identity. Show the eval graph and accuracy at the top on open, with a "Review" stepper ("Next mistake ›"). Hide the builder tabs that make no sense there. |
| 11.2 | P1 | **Analysis is manual.** The user has to find "Analyse game" in the Game tab. Tapping it again *cancels* and shows "Analysis paused.", which isn't discoverable. | Start the analysis on open (cloud eval first, so it's cheap). Show a visible Pause/Resume button with progress, not a toast. |
| 11.3 | P2 | **"Save game" is unclear.** The grades are saved automatically, but the user's own variations, notes and tags are saved only by "Save game". | "Save my notes & variations". Show an unsaved dot when there's something to save, and use the same save guard as the builder. |
| 11.4 | P2 | Going from an analysed mistake to "add this to my repertoire" works but isn't signposted. | Add a "Fix this in my repertoire" action on opening mistakes, which opens the builder at that position. |

---

## 12. Statistics
📸 `12-progress.png`

| # | Sev | Problem | Proposal |
|---|---|---|---|
| 12.1 | P2 | With no training yet, the page shows two empty rings, a 0-day streak, "0 days" and several 0 boxes. That's a lot of zeros on screen. | Collapse to one encouraging empty state ("Train once and this page comes alive") until there's data. |
| 12.2 | P2 | "Move memory" and "Remembered moves over time" are close in meaning, and both use a "RECALL" ring. | Merge them, or name them "Right now" and "Over time". |
| 12.3 | P3 | The FAB covers the Week / Month / All toggle. | See 3.2. |

---

## 13. Settings
📸 `17-settings.png`

| # | Sev | Problem | Proposal |
|---|---|---|---|
| 13.1 | P1 | **Settings starts with promotions.** In production the order is Go Pro CTA → Account → "Import your games" (a big card) → "Connect to Lichess" (a big card) → then the actual settings. That's four promotional blocks before Appearance. | Show a compact **Account row** (avatar, plan, sync status) at the top. Move the Import and Lichess cards into a "Connections" group with normal rows. Show the Pro offer as one row ("Bito Pro — unlock unlimited ›"). |
| 13.2 | P2 | Accordions hide everything else. Finding "Reset progress" or "Replace this device from the account" requires knowing which group it's in. | Add search, or a flat list of sub-pages ("Training ›") as iOS and Android do. |
| 13.3 | P2 | Settings has **dozens of icon-only buttons with no accessible name**. A scan of the rendered page found roughly 60 buttons with no text and no `aria-label` — a screen reader announces them as just "button". | See 16.4. |
| 13.4 | P3 | Daily challenge order uses "Move up" / "Move down" buttons per row, while Train tabs use long-press drag. | Use one reorder pattern across the app. |

---

## 14. Account, sign-up and sync
🔎 `account-ui.ts`, `auth.ts`, `repertoire-sync.ts`, `signing-in.ts`

| # | Sev | Problem | Proposal |
|---|---|---|---|
| 14.1 | P0 | Email links leave the PWA (C4). | Use a 6-digit code. |
| 14.2 | P0 | Deletions come back (C5). | Tombstones. |
| 14.3 | P1 | **The account tabs are named "Registration" and "Sign in".** "Registration" is formal and unusual in consumer apps. | "Create account" / "Sign in" (the original worry was about "Sign up" vs "Sign in" looking alike). |
| 14.4 | P1 | **Sync status is hard to find.** It lives in the Settings Account group ("Sync now", a "never" caption). A user can't tell from the main screens whether their work is safe. | Add a small cloud icon on the header avatar (synced ✓ / pending • / failed !). Tapping it opens the account sheet. |
| 14.5 | P2 | **Free accounts don't sync games** (`gateGamesToEntitlement`). A free user who signs in on a second device finds lines but no games and the Middlegame locked, with no explanation. | On a second device, show: "Your games stay on the phone you imported them on — re-import here, or get Pro to sync them". |
| 14.6 | P2 | Signing in reloads the app (`signing-in.ts`). It's covered by a splash, but any open sheet or unsaved builder state is lost. | Block or warn on sign-in while the builder has a draft. |
| 14.7 | P3 | Form errors appear as toasts (see C4). | Show them inline. |

---

## 15. Go Pro and checkout
🔎 `pro-sheet.ts`, `checkout.ts`, `entitlement.ts`, `pricing.ts`

Covered by C3 and C6. Additionally:

| # | Sev | Problem | Proposal |
|---|---|---|---|
| 15.1 | P1 | The training cap dialog's eyebrow "You've got 10 lines in training" states a fact but doesn't say what happened. Was the new line saved? | "Line saved — but not added to training (free plan trains 10 at a time)". Show the choice: **Swap it in** (pick a line to pause) / **Get Pro** / **Keep it saved**. Letting the user swap a line in is a good alternative to the paywall. |
| 15.2 | P1 | The bulk toast *"the rest were saved to My Lines"* names a screen that no longer exists as a tab (it's now Openings → My lines). | "…saved in Openings → My lines, paused". Add an action: "[Choose which to train]". |
| 15.3 | P2 | After a purchase: "You're in" / "Full access is on your account…" / "Let's go". Good, but it doesn't show what changed. | List the unlocked items and give one tap to the most relevant ("Turn on the 4 paused lines"). |
| 15.4 | P2 | Being a solo developer with no ads and no investors is a strong reason to buy, but it lives only on the landing page. | Add one line to the sheet: "Made by one person. No ads, no subscription." |
| 15.5 | P3 | The price can change from 12€ to 139 kr on screen after the fetch lands. | Fine. Keep the built-in fallback matched to the device's locale. |

---

## 16. Cross-cutting issues

### 16.1 Language and naming
The same thing has several names, and internal terms leak into the UI:

| Concept | Names in the UI today | Suggested single term |
|---|---|---|
| Paid plan | Full access, Full Access, Unlock full access, Pro | **Bito Pro** |
| Training the repertoire | Run your book, Repertoire run, Whole lines | **Review** (smart) · **Play full lines** |
| Repertoire | book, repertoire, "My White lines" | **Repertoire** (never "book" in the UI) |
| Importing games | Import, Scan, Pull, Add your games | **Import** (and "Analyse" for the engine pass) |
| Opening section | Openings tab, Openings domain on Train, Openings door, Openings in Discover | Keep "Openings" for the tab; call the Train domain **"Repertoire"** |
| Sign-up | Registration, Create account, Create a free account | **Create account** |

Copy tone: most of the copy is clear and kind. A few lines are negative or
lecturing ("which is where the habit dies"). Some of the reasoning written in
code comments also leaks into user-facing text, which makes it long, for example
the daily card's "this is the habit the whole app is built around". Aim for
**one sentence per message**.

### 16.2 Navigation
- **Five tabs plus a FAB plus an avatar plus Settings.** Home and Train overlap
  ("What's going on" vs "What do I train"). Consider merging them: Home *is* Train
  (Today, the daily challenge and Start at the top, domains below). That frees a
  tab, or gives Openings more room.
- **The back gesture** is handled carefully (`back-nav.ts`). Keep doing that.
- **Overlays on overlays.** Drill → Analyse → analyser → "Back to train" uses
  the suspended-session pattern. If the user then taps any tab other than Home or
  Train, the session is **discarded silently** (`APP-CONTEXT §3.4`). Ask first:
  "Leave your session? Your answers so far are saved."

### 16.3 Feedback and system status
- **Toasts carry too much:** validation errors, sync results, undo, tips. Errors
  belong next to the field; tips belong next to the feature.
- **No reminders.** The product is about a daily habit, but a PWA without a
  service worker can't send notifications. When the offline/service-worker phase
  comes, put **daily reminder notifications** at the top of the list. They usually
  help retention more than any single screen.
- **Offline:** puzzles, endgame tablebase checks, the explorer and cloud eval all
  fail when offline. Show one clear offline banner rather than a different error in
  each place.

### 16.4 Accessibility
| # | Sev | Problem | Proposal |
|---|---|---|---|
| A1 | P1 | Many icon-only buttons have no `aria-label` (roughly 60 found in Settings alone, plus the builder dock, card actions and filter icons). | Give every icon-only button an `aria-label`; make the label a required parameter of whatever helper builds icon buttons, so it can't be forgotten. |
| A2 | P1 | Correct and wrong are shown by colour alone (red/green squares, eval chips, W/D/L bars). | Add icons (✓ / ✗) and text, and check against colour-blind palettes. The "Not quite" text helps; do the same everywhere. |
| A3 | P2 | Figurine notation is the default. Screen readers read "♞f3" badly. | Keep figurines visually, and add `aria-label="Knight f3"` on move tokens. |
| A4 | P2 | Small text and icons (11 px padlocks, 10–11 px uppercase labels like "POSITION 1 OF 24"). | Minimum 12 px for labels and 24 px tap targets (the WCAG minimum; 44 px recommended). |
| A5 | P2 | The board can only be used by tapping. There's no keyboard or screen-reader input for moves on mobile. | Long term: a "type your move" field (SAN) as an alternative input in drills. It's also faster for advanced users on desktop. |
| A6 | P3 | Some screens freeze the page with `picker-open` and use `role=dialog` without trapping focus. | Trap focus inside full-screen overlays and return it on close. |

### 16.5 Visual consistency
- **Button hierarchy:** green primaries (Starter packs, Add & learn), orange
  primaries (Start daily challenge, tour Next) and filled red destructive buttons
  sit next to each other. Define one primary colour per screen, use red only for
  confirmed destruction, and use secondary styles elsewhere.
- **Cards inside cards** (Get started → Save your first lines → buttons) take
  three levels of borders and backgrounds. Flatten to two.
- **Mini boards** are Unicode glyphs while the big boards use the chosen piece
  set, so they look different (`board-mini.ts`). That's acceptable for
  performance, but use the same colour scheme.

---

## 17. Prioritised plan

### Now (1–2 rounds, mostly copy and small logic)
1. "New" vs "due" wording; hide meaningless counts (C1.1, 4.3).
2. Line name and Hint in the Repertoire run (C1.2–3, 5.2).
3. No Pro sheet in first run; "Selected" not "Added"; slots counter (C3).
4. Walkthrough waits for actions; drop Lichess from it; merge the duplicate
   "Build a line" items (C2.2–3).
5. Padlock only for Pro; Tactics never locked (4.2, 7.1).
6. "Scan" → "Import"; "Registration" → "Create account"; one name for Pro (10.1,
   14.3, C6.3).
7. Bottom padding under the FAB; the reorder tip shown later (3.2, 4.5).
8. Fix the bulk toast's "My Lines" reference and the "tomorrow" daily copy (15.2,
   2.4.4).

### Next (one feature round each)
9. **Learn mode** for new moves, plus a daily limit on new moves (C1.4–5).
10. **6-digit email code** instead of links (C4).
11. Pro sheet simplified to one action with before → after benefits (C6.1–2), and
    "Swap a line in" as the alternative to paying (15.1).
12. Compact My lines list with ⋯ actions (9.1–9.2).
13. Builder: Auto-reply off by default or clearly shown; simpler first-time mode
    (8.2, 8.4).
14. Username check with avatar before import (2.1.2).
15. Sync status icon in the header (14.4).

### Later (larger work)
16. **Tombstones** so deletions sync (C5).
17. Analyser as its own experience, with auto-analysis and a "next mistake" stepper
    (11.1–11.2).
18. Pay-first checkout (C6.4).
19. Merge Home and Train; one Middlegame deck with formats (16.2, 6.1).
20. Service worker: offline puzzles and **daily reminders** (16.3).
21. Accessibility pass: labels, non-colour cues, typed-move input (16.4).

---

*Screenshots referenced above live in `ux-audit/`. They were taken from the
`github`-target build at 412 × 915 on 2026-10-30, so account and Pro screens are
absent (no Supabase keys in that build). Re-check every 🔎 finding on a phone
before building the fix.*
