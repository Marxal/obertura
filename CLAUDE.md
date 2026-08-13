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
- Storage: IndexedDB on the device (use a thin wrapper). NO backend.
- Opening names: bundled offline table (CC0 lichess-org/chess-openings dataset,
  `src/openings.ts`). The live explorer API is login-gated nowadays — it's only
  an optional logged-in overlay on the Library slide, never a dependency.
- Engine (Phase 4 only): Stockfish lite WASM in a Web Worker, behind a toggle.
- Hosting / preview: GitHub Pages serving the built static app.

## Hard constraints
- Online-only is fine for v1. Offline (service worker) is LATER.
- Data lives on the phone. Google Drive sync is "someday," not now.
- Must run as a PWA installable on Android (manifest + add-to-home-screen).
- Keep files small and focused (keeps context/token cost low).

## The build order (do not skip ahead)
- Phase 1: working board on my phone (chessground + chess.js + PWA shell).
- Phase 2: repertoire builder — the heart. Get it genuinely good.
- Phase 3: training + spaced repetition (SM-2). Completes v1.
- Phase 4+: engine, explanations, Chess.com import, polish. All later.

## Where we are now
Shipped through v0.4 (the beta-polish round). The project uses a v0.x beta
scheme (old v1.x tags left intact; v1.0→v0.1 … v1.3→v0.3 conceptually). Latest
rollback tag is `v0.4`. `ROADMAP.md` records every round phase by phase.
Confirm scope before starting new work.

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
- Repertoire: "my White lines" or "my Black lines".
- Line: belongs to a repertoire; has name, tags, openingName, colour,
  confidence, lastTrained, inTraining (bool). A line is a TREE of moves.
- MoveNode: { san, uci, fen, children[], note?, review:{ease,interval,reps,
  lapses,due} }.
- Scheduler tracks MoveNodes; training always walks a full line.
  A "due line" = any line containing a due move.

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
