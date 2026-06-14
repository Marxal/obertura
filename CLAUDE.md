# Obertura — project guide for Claude Code

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
- Opening names: free Lichess opening explorer API (explorer.lichess.org).
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
Shipped through v0.3 (formerly v1.3 in the old internal scheme; old tags left
intact). The project has renumbered to a v0.x beta scheme (v1.0→v0.1 …
v1.3→v0.3 conceptually). The v0.4 round is the current beta-polish round and is
in progress. Latest rollback tag is `v0.3`. `ROADMAP.md` records every round
phase by phase. Confirm scope before starting new work.

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
