# Bito Chess — orientation map

**This is a map, not a spec.** It tells you where things live and which document
to read before touching them. It deliberately does *not* describe how features
work — that is what drifted in the previous version of this file, which is now at
`archive/APP-CONTEXT-2026-08.md` and should not be trusted.

If a line here disagrees with the code, the code is right. Keep entries to one
line so this file stays cheap to correct.

---

## Read this before touching that

| Touching… | Read first |
|---|---|
| The move tree, repertoires, what a "line" is | **`REPERTOIRE-REDESIGN.md`** |
| Saving, drilling, or counting a line; anything about duplicates | **`TRANSPOSITIONS.md`** (cited by §number from ~60 places in source) |
| Accounts, sync, the `profiles` table, RLS, email, providers | **`SUPABASE-SYNC.md`** |
| The buy flow, Stripe secrets, webhook, prices | **`STRIPE-SETUP.md`** |
| The beta access codes | **`BETA-ACCESS.md`** |
| The landing-page copy | **`docs/LANDING-COPY.md`** (source of truth — edit there, then mirror) |
| Store/monetization plans not yet built | **`PUBLISHING.md`** |
| Behaviour rules, stack decisions, hard constraints | **`CLAUDE.md`** |
| What shipped when | **`ROADMAP.md`**, and `archive/ROADMAP-history.md` for older rounds |

`archive/` is history. Nothing in it describes today's code — don't read it
unless you're asked to.

---

## Where things live

`src/` holds 188 modules plus 50 `*.selftest.ts` files. Grouped by area; every
non-selftest module appears exactly once.

### App shell, navigation, chrome
| Module | |
|---|---|
| `main.ts` | the entry point and the app's spine — 6,270 lines, routes every screen and owns the save path |
| `back-nav.ts` | back-gesture / hardware-back handling for the installed PWA |
| `theme.ts` | theme control — five named choices, persisted per device |
| `appearance.ts` | board colour scheme, piece set, coordinates |
| `notation.ts` | SAN vs figurine move notation preference |
| `icons.ts` | inlined Lucide-style icons |
| `dialog.ts` | the shared bottom-sheet dialog |
| `toast.ts` | the one transient status toast |
| `info-sheet.ts` | the shared "what is this?" popup behind (i) buttons |
| `empty-state.ts` | the one "nothing here yet" pattern |
| `load-error.ts` | the shared "data wouldn't load" + Retry panel |
| `fab.ts` | the floating action button on the four main tabs |
| `run-header.ts` | the bar across the top of every exercise overlay |
| `confetti.ts` | the celebration burst |
| `count-up.ts` | numbers that tick up on screen entry |
| `pixel-pawn.ts` | the blocky 8-bit pawn, inline SVG |
| `sound.ts` | optional correct/wrong training tones |
| `avatar.ts` | the small round user avatar |
| `about.ts` | the About sheet |
| `legal.ts` | resolves the public-document URLs per host |
| `promotion.ts` | the pawn-promotion picker |
| `board-brushes.ts` | per-board arrow brushes with collision-proof marker ids |
| `board-mini.ts` | a static SVG board miniature drawn straight from a FEN |
| `card-position.ts` | shared scaffold for any card representing a position |
| `position-peek.ts` | a small popup showing one position on a view-only board |
| `wdl-bar.ts` | the slim win/draw/loss bar |
| `selftest-panel.ts` | the shared "Run X self-test" panel |

### Data model and storage
| Module | |
|---|---|
| `repertoire.ts` | **the core** — one move tree per book, and the pure operations on it |
| `lines-view.ts` | repertoires in, `Line[]` out, plus the write-back — the projection that let ~50 modules stay unchanged |
| `tree.ts` | MoveNode shapes and the six annotation marks |
| `types.ts` | shared types, incl. line priority |
| `storage.ts` | the IndexedDB layer — DB `obertura` **v4**, stores `repertoires` (primary), `lines` (legacy), `games`, `opponents` |
| `repertoire-migrate.ts` | one-way migration: the old flat Line list becomes one tree per colour |
| `repertoire-picker.ts` | making, naming, archiving and removing repertoires |
| `repertoire-join.ts` | transposition joins — "from here, continue as in that line" |
| `position-index.ts` | the whole repertoire mapped by position (see `TRANSPOSITIONS.md`) |
| `save-index.ts` | the pure half of what the position index changes about saving |
| `train-index.ts` | the pure half of what the position index changes about training |
| `line-removal.ts` | what removing a move will actually do, in numbers and words |
| `line-status.ts` | what a line's card and popup say about it, in one place |
| `line-groups.ts` | groups a line list into collapsible opening families |
| `prefs.ts` | small device-local training preferences |
| `local-keys.ts` | **which localStorage keys may leave the device** — the single allow/deny rule, selftest-guarded |
| `backup.ts` | backup & restore UI (format v2) |

### Training, drills and the scheduler
| Module | |
|---|---|
| `scheduler.ts` | the spaced-repetition brain (SM-2), pure, zero DOM |
| `session.ts` | a training session — an ordered queue of lines to walk once each |
| `drill.ts` | the training session runner, 1,620 lines — the main drill overlay |
| `train-screen.ts` | the Train tab, 2,572 lines |
| `training-goal.ts` | the three-line goal, shared by four screens |
| `pretraining.ts` | enrol a line straight into training with no confirm run |
| `repertoire-run.ts` | one walk through a book, asking each move once |
| `individual.ts` | picks which single positions "Individual moves" drills |
| `review.ts` | Game Review — turns a line of moves into a list of judgements |
| `forgotten-moves.ts` | tracks which exact moves you miss, per time window |
| `forgotten-section.ts` | the "Forgotten moves" block on Train |
| `struggle.ts` | chronic misses — what you keep forgetting |
| `struggle-nudge.ts` | the quiet nudge below the board when you keep missing |
| `fix-it.ts` | the playful "Fix it" drill for a forgotten move |
| `filters.ts` | the reusable two-row filter bar for line lists |
| `streak.ts` | the daily-training streak |
| `progress.ts` | cross-references imported-game results with training progress |

### The daily challenge
| Module | |
|---|---|
| `daily-challenge.ts` | the dynamic card at the top of Train, and the day's queue |
| `daily-prefs.ts` | which parts the daily includes, and how many of each |
| `daily-recap.ts` | the day-by-day results log and the recap numbers |
| `daily-review.ts` | looking back at a past day in the log |
| `daily-celebration.ts` | the popup when the whole daily is cleared |
| `exercise-identity.ts` | the "from your games" exercises' colours, import-free |

### Exercises built from your own games
| Module | |
|---|---|
| `mistake-scan.ts` | the scan that turns imported games into training material |
| `mistake-autoscan.ts` | the same scan, run quietly in the background |
| `mistake-run.ts` | the Mistake Retry drill overlay |
| `mistakes-screen.ts` | the Mistake retry pane on Train |
| `brilliant.ts` | Brilliant Moves — the "find it again" source |
| `brilliant-run.ts` | the Brilliant Moves drill |
| `brilliant-log.ts` | its "come back after a while" store |
| `detective.ts` | Blunder detective — the pure core |
| `detective-run.ts` | the Blunder-detective drill overlay |
| `which-move.ts` / `which-move-run.ts` | the two-move question: pure core, then overlay |
| `grow-line.ts` | Grow your lines — the pure "add one more move" core |
| `grow-panel.ts` | the builder's Grow line tab |
| `grow-log.ts` | which lines have had their turn |
| `middle-log.ts` | rest logs for the two "read your own games" exercises |
| `spot-rest.ts` | one blunder, three doors — the shared rest log |
| `spot-peek.ts` | the results-row popup for those exercises |
| `fixed-sheet.ts` | the list behind the Middle-game pane's middle figure |

### The builder / board / analyser
| Module | |
|---|---|
| `builder-book.ts` | the builder's side of the redesign — edits a book, not one line |
| `builder-panels.ts` | the builder's list slides: Library and My lines |
| `builder-import.ts` | the builder's "Import a game" popup |
| `builder-info.ts` | one sentence per builder tab, behind the (i) |
| `branch-sheet.ts` | branch actions — what you can do to a whole subtree at once |
| `draft-sheet.ts` | "what am I actually saving?" — the draft as the lines it will add |
| `note-sheet.ts` | writing the note on one move |
| `line-info.ts` | the two blocks at the foot of the Line info tab |
| `line-peek.ts` | the whole line in one steppable popup |
| `line-analysis.ts` | the Line-tab analysis block for a loaded game |
| `analysis.ts` | turns imported games into a coaching report |
| `accuracy.ts` | per-player game accuracy, following Lichess's model |
| `winprob.ts` | move classification — pure, deterministic core |
| `move-facts.ts` | board facts about a move, for the classifier's judgement calls |
| `book-check.ts` | "is this move opening theory?" for the reviewer |
| `explore.ts` | the throw-away "where does this go?" board over the drill |
| `manual-game.ts` | "Add a game" — manual entry for My games |

### Engines
| Module | |
|---|---|
| `engine.ts` | Stockfish WASM in a Web Worker; all values normalised to white |
| `engine-panel.ts` | the Engine tab |
| `eval-panel.ts` | the docked eval bar's fixed-height 3-best-moves view |
| `remote-engine.ts` | opt-in deep analysis via chess-api.com |
| `lichess-tablebase.ts` | the free Lichess 7-piece tablebase client |

### Opening knowledge: library, book, explorer
| Module | |
|---|---|
| `openings.ts` | offline opening-name lookups from the bundled database |
| `book-tree.ts` | the bundled opening book as a SAN-keyed trie |
| `library.ts` | the browsable opening Library |
| `library-explorer.ts` | the playable board over the bundled library |
| `board-explorer.ts` | the chess.com-style opening explorer board |
| `explorer-stats.ts` | the bundled win/draw/loss database |
| `explorer-bands.ts` | which rating band the explorer's numbers are filtered to |
| `explorer-level.ts` | "what level does this user actually play at?" |
| `explorer-resolve.ts` | one place to answer "how has this position scored?" |
| `lichess-explorer.ts` | the free Lichess opening-explorer client (login-gated; optional overlay only) |
| `move-stats.ts` | per-move WDL keyed by UCI path from the start |
| `traps.ts` / `traps-screen.ts` | opening traps: pure data, then the Explore tab pane |
| `study-catalog.ts` | pure logic for the Lichess-study browser |
| `study-browser.ts` | the Packs tab's Lichess studies section |
| `study-import.ts` | Lichess study import — pure PGN helpers |
| `study-sheet.ts` | the study-chapter list, shared by two callers |

### Explore, maps and coverage
| Module | |
|---|---|
| `explore-screen.ts` | the Explore tab — everything you don't have yet |
| `explore-panel.ts` | the builder's Explore slide — three curated moves |
| `repertoire-map.ts` | the zoomable full-colour repertoire tree |
| `map-merge.ts` | merging saved lines into one map tree — the data half |
| `lines-tree-view.ts` | My Lines → tree view, the whole repertoire as one map |
| `lines-screen.ts` | the My Lines tab |
| `coverage-gaps.ts` | the opponent replies your repertoire can't answer (pure) |
| `coverage-data.ts` | its impure half — reading the device, and the explorer budget |
| `coverage-section.ts` | the coverage block on screen |
| `scout.ts` | opponent scouting — the data layer behind Explore's opponents |

### Puzzles and endgames
| Module | |
|---|---|
| `puzzles.ts` | the free Lichess Puzzle API client, and opening mapping |
| `puzzles-screen.ts` | the Puzzles tab |
| `puzzle-run.ts` | the puzzle-solving overlay |
| `puzzle-rating.ts` | the personal puzzle Elo |
| `puzzle-repeat.ts` | a lightweight spaced-repetition-lite repeat queue |
| `puzzle-alt.ts` | "is this other move just as good?" |
| `puzzle-log.ts` | device-local record of puzzles solved |
| `puzzle-themes.ts` | the bundled Lichess theme catalogue |
| `endgame-screen.ts` | the End game tab — three pillars |
| `endgame-catalog.ts` | the bundled fundamental-endgame catalogue |
| `endgame-playout.ts` | play a classic endgame out against the engine |
| `endgame-scan.ts` | "from your games" — the endgames you actually reached |
| `endgame-autoscan.ts` | the same scan, run quietly |
| `endgame-progress.ts` | device-local progress on the Classic Endgames list |

### Statistics
| Module | |
|---|---|
| `progress-screen.ts` | the Statistics screen — one scrolling page, three blocks |
| `stats.ts` | pure aggregations, no DOM |
| `stats-charts.ts` | the one line-chart renderer behind every trend |
| `stats-ui.ts` | the small layout pieces the stats blocks are built from |
| `rating-stats.ts` | your current site ratings and their history |

### Game import
| Module | |
|---|---|
| `import-core.ts` | the one import core, shared by both platforms |
| `import-games.ts` | the unified entry point — pick a platform, get one shape |
| `chesscom.ts` / `lichess.ts` | the two platform sources |
| `import-panel.ts` | the two-step bottom sheet used everywhere games come in |
| `import-inline.ts` | the boxed form empty states show instead of a button |
| `import-last.ts` | "import my last game" — the FAB shortcut |
| `import-progress.ts` | the pixel-pawn progress bar |
| `import-tier.ts` | the pure "how many games may this person import?" |
| `auto-refresh.ts` | the weekly games auto-refresh |
| `my-games-screen.ts` | the My games tab |
| `lichess-auth.ts` | "Connect to Lichess" — OAuth 2.0 + PKCE, browser-only |

### Accounts, sync and payment
| Module | |
|---|---|
| `supabase.ts` | the one shared Supabase client |
| `auth.ts` | sign-up / in / out / password reset — the only module that talks to auth |
| `account-ui.ts` | the Account group in Settings |
| `account-delete.ts` | "Delete my account" — the app half |
| `repertoire-sync.ts` | account sync — the cross-device copy |
| `sync-core.ts` | the sync's pure logic: no Supabase, no auth, no browser |
| `signing-in.ts` | the cover that makes signing in look like one step |
| `entitlement.ts` | the free tier — how many lines may be in training at once |
| `entitlement-cache.ts` | the last-known "is this account entitled?" answer |
| `checkout.ts` | the buy flow's app half |
| `pricing.ts` | what the unlock costs, in the reader's currency |
| `pro-sheet.ts` | the Full Access popup |
| `gate.ts` | the beta access gate + install screen (self-contained, removable) |

### Onboarding, settings, feedback
| Module | |
|---|---|
| `onboarding-picker.ts` | the first-run screen — one question, and out |
| `onboarding-lines.ts` | the eight curated first lines |
| `onboarding-starter.ts` | the starter packs |
| `onboarding-signup.ts` | the sign-up sheet that closes the first run |
| `onboarding-tour.ts` | coach-marks, anchored beside what they describe |
| `first-steps.ts` | the "Get started" to-do panel at the top of Train |
| `settings-screen.ts` | every device-local preference, grouped |
| `settings-controls.ts` | the three controls every preference row is made of |
| `settings-lightbox.ts` | Settings as a centred lightbox (desktop path) |
| `feedback.ts` | the in-app feedback form |

### Bundled data (`src/*.json`)
`openings-data.json` · `openings-library.json` · `explorer-stats.json` ·
`starter-packs.json` · `onboarding-lines.json` · `traps.json` · `endgames.json` ·
`puzzle-openings.json` · `study-index.json`. All generated by `scripts/build-*.mjs`
— regenerate, don't hand-edit. `src/style.css`, `src/fonts/`, `src/pieces/` are
the app's assets (Chakra Petch is self-hosted; **never** add a Google Fonts link).

### `worker/` — the Cloudflare Worker
`index.ts` (routes `/api/*`, else static assets) · `stripe-checkout.ts` ·
`stripe-webhook.ts` · `stripe-env.ts` · `stripe-prices.ts` · `account-delete.ts`.
Config in `wrangler.jsonc`. Setup in `STRIPE-SETUP.md` / `SUPABASE-SYNC.md`.

### `scripts/`
`build-*.mjs` regenerate the bundled JSON above. `copy-engine.mjs` stages
Stockfish (runs before dev and build). `generate-icons.mjs` makes the PWA icons.
`run-selftests.ts` + `register-ts.mjs` + `ts-resolve.mjs` run the 50 selftests.
`probe-sync-limit.mjs` measures account storage.

### `docs/` — the public static pages
`index.html` (landing) · `privacy.html` · `terms.html` · `licences.html`, sharing
`legal.css` and `docs/fonts/`. **Nothing generates them.** `LANDING-COPY.md` is
the copy's source of truth — edit there first, then mirror by hand.

---

## Build and deploy

| Script | What it does |
|---|---|
| `npm run dev` | stage engine, then Vite dev server |
| `npm run build` | stage engine → `tsc` → `tsc -p tsconfig.worker.json` → `vite build` |
| `npm run selftest` | the 50 headless data-layer selftests |
| `npm run preview` | serve `dist/` |

Two output shapes from one repo, picked by `DEPLOY_TARGET` (`vite.config.ts`):

- **`github`** (default) — app at `dist/` root, base `/obertura/`. The Actions
  workflow copies `docs/` → `dist/docs/` itself.
- **`cloudflare`** — app under `dist/app/` with base `/app/`; `docs/index.html`
  goes to the `dist/` root, so the landing page serves at the domain root and the
  trainer at `/app/`. Set this one env var in the Cloudflare Pages dashboard.

`public/manifest.webmanifest` is shared unchanged — `start_url: "."` is relative.

---

## Conventions worth knowing

- **The same moves are never stored twice.** Anything that writes moves goes
  through `repertoire.mergePath`, never a copy.
- **Four repertoire fields inherit** — `label`, `tags`, `training`, `priority`.
  Set on a node, they apply to the whole subtree unless a deeper node overrides.
  That is what makes "pause the whole French" one toggle.
- **`localStorage` keys are not documented in prose** — they drift. The code has
  ~99 distinct `obertura.*` keys; enumerate them with
  `grep -oh "'obertura\.[a-zA-Z.]*'" src/*.ts | sort -u`. What may leave the
  device is decided in one place: **`src/local-keys.ts`**, which explains every
  exception and is held by `local-keys.selftest.ts`.
- **Pure cores are split from their overlays on purpose** (`detective.ts` vs
  `detective-run.ts`, `which-move.ts` vs `which-move-run.ts`, `coverage-gaps.ts`
  vs `coverage-data.ts`) so the logic can be selftested without a browser. Keep
  new logic on the pure side.
- **No third-party requests.** The privacy policy promises it. No Google Fonts,
  no CDNs.
