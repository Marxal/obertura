# Bito Chess — project guide for Claude Code

Public product name is "Bito Chess"; the GitHub repo stays "obertura" as an
internal codename (folders, keys, and internal identifiers keep the old name).

A personal chess-openings trainer (a focused Lotus-style clone, openings only).
Built as an installable PWA. Personal use first; zero budget; slow-burn side project.

## Who I'm working with
Marçal — a designer/WordPress developer who does NOT write code and doesn't
want to. Explain decisions briefly and teach as you build, but assume I
understand concepts, not syntax. I direct; you build; I test on my phone.

## How to behave
- Lead with the answer, then brief reasoning. No long preambles.
- Work one layer at a time. End every change with a clear "how to test on
  my phone" step.
- Give whole files, not fragments. Say where each file goes.
- Flag uncertainty; never invent library APIs.
- Protect the v1 scope — push back on scope creep.
- Never reach for a paid service without flagging it first.

## Tech stack (decided)
- Build tool: Vite, vanilla TypeScript (no heavy framework for v1).
- Board UI: chessground.
- Chess rules / move validation / PGN: chess.js.
- Storage: IndexedDB on the device (use a thin wrapper). The only backend is
  Supabase (accounts + one `profiles` row of synced data) and a small Cloudflare
  Worker (`worker/`) for Stripe and account deletion.
- Opening names: bundled offline table (CC0 lichess-org/chess-openings dataset,
  `src/openings.ts`). The live explorer API is login-gated nowadays — it's only
  an optional logged-in overlay on the Library slide, never a dependency.
- Engine (Phase 4 only): Stockfish lite WASM in a Web Worker, behind a toggle.
- Hosting / preview: GitHub Pages serving the built static app.

## Hard constraints
- Online-only is fine for v1. Offline (service worker) is LATER.
- Data lives on the phone. Signing in keeps a synced copy in the user's Supabase
  account (`SUPABASE-SYNC.md`); the retired Google Drive backup is gone for good.
- Must run as a PWA installable on Android (manifest + add-to-home-screen).
- Keep files small and focused (keeps context/token cost low).

## The build order (do not skip ahead)
- Phase 1: working board on my phone (chessground + chess.js + PWA shell).
- Phase 2: repertoire builder — the heart. Get it genuinely good.
- Phase 3: training + spaced repetition (SM-2). Completes v1.
- Phase 4+: engine, explanations, Chess.com import, polish. All later.

## Where we are now
Latest rollback tag is `v0.5`. The project uses a v0.x beta scheme (old v1.x
tags left intact; v1.0→v0.1 … v1.3→v0.3 conceptually). `v0.5` was cut to close
a gap: everything from the "v0.5" ROADMAP.md round through the Stripe
migration (~30 rounds) shipped on `main` without anyone cutting a tag or
bumping `package.json`, so `v0.4` had been stale as a restore point for a long
time. Going forward, cut a new tag (and bump `package.json`) before starting
each risky round — see "Declaring a version" below. `ROADMAP.md` records every
round phase by phase. Confirm scope before starting new work.

### Declaring a version (before a risky round of changes)
1. Make sure `main` is clean: `npm run selftest` and `npm run build` both pass.
2. Bump the `version` field in `package.json` (e.g. `0.5.0` → `0.6.0`).
3. Commit just that bump: `git commit -am "Bump version to 0.6.0"`.
4. Tag it and push both: `git tag v0.6 && git push origin main && git push origin v0.6`.
5. To roll back later: `git checkout v0.6 -- .` restores the files from that
   tag into your working copy (review with `git status`/`git diff` before
   committing), or `git reset --hard v0.6` throws away everything after it —
   ask Claude Code to do this rather than typing raw git.

## Public documents
`docs/` holds four hand-written static pages, copied wholesale by both deploy
targets: `index.html` (the landing page), `privacy.html`, `terms.html` and
`licences.html`, sharing `legal.css`. Nothing generates them. The landing copy's
source of truth is `docs/LANDING-COPY.md` — edit there first, then mirror.
`src/legal.ts` resolves the right URL for each host so the app can link to them.

No Google Fonts, anywhere. Chakra Petch is self-hosted (`src/fonts/` for the
app, `docs/fonts/` for the static pages) because the privacy policy promises no
third-party requests. Don't reintroduce the `<link>`.

## Data model (get right early)
Read `REPERTOIRE-REDESIGN.md` before touching any of this.

- **Repertoire — the stored thing.** One book of one colour holding ONE move
  tree: `{ id, name, colour, tree, createdAt, archived? }`. Two by default
  ("My White lines", "My Black lines"); more can be added.
- **Line — derived, never stored.** The path from the root to a *line end* (a
  leaf, or a node marked `endpoint`). Its name, tags, training state and
  priority are resolved from the nodes along the path; its confidence and due
  dates are computed from their review records. `lines-view.ts` does the
  projection, and `storage.getAllLines()` still hands out `Line[]` exactly as
  before — which is why ~50 modules never had to change.
- **MoveNode**: `{ san, uci, fen, children[], note?, review:{…} }` plus the
  repertoire fields — `label?`, `tags?`, `training?`, `priority?`, `endpoint?`,
  `timesTrained?`, `lastTrained?`, `createdAt?`. The first four **inherit**: set
  on a node they apply to the whole subtree unless a deeper node overrides.
  That is what makes "pause the whole French" one toggle.
- Scheduler tracks MoveNodes; training always walks a full line.
  A "due line" = any line containing a due move.
- **The same moves are never stored twice.** Saving a longer version of a line
  extends its branch; a second answer at a position is a second child. Anything
  that writes moves goes through `repertoire.mergePath`, never through a copy.

## Deploy / preview loop
This repo is built by Claude Code on the web and previewed via GitHub Pages.
After meaningful changes: build the static site and push so the live URL
updates. Keep a .gitignore (never commit node_modules or secrets).

## Hosting targets
The same repo and build produce two different output shapes, picked by the
`DEPLOY_TARGET` env var (`vite.config.ts`):
- `DEPLOY_TARGET=github` (or unset, the default) — the trainer builds to the
  `dist/` root with base `/obertura/`, exactly as before. The GitHub Actions
  workflow then copies `docs/` to `dist/docs/` itself, unchanged.
- `DEPLOY_TARGET=cloudflare` — the trainer builds under `dist/app/` with base
  `/app/`, and `docs/index.html` (the marketing landing page) is copied to the
  `dist/` root instead, so it serves at the bitochess.com domain root while
  the trainer lives at bitochess.com/app/. Set this one env var in the
  Cloudflare Pages dashboard; no other config differs.
`public/manifest.webmanifest` is shared by both targets unchanged — its
`start_url: "."` is relative, so it resolves correctly under either base.
