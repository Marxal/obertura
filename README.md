# Bito Chess

**Learn chess openings your way. Build your own repertoire, train it, and let spaced repetition help you remember.**

Bito Chess is a phone-first chess opening trainer, installable as a PWA. Build a
repertoire that's genuinely yours, drill it, and let spaced repetition bring your
mistakes back until they stick.

- 🔗 **Open the app:** https://bitochess.com/app/
- 🌱 **Landing page:** https://bitochess.com
- 🧪 **Internal test mirror:** https://marxal.github.io/obertura *(the GitHub Pages build; its landing page is at `/obertura/docs/` — see [Deploying](#deploying))*

## What it does

- **Build your repertoire** — by hand on the board, from a built-in opening
  library, from your own games, suggested by the engine, or lifted from scouting
  an opponent.
- **Train it** — play a line once to confirm it, then drill it. Spaced repetition
  (SM-2) brings your mistakes back until they stick, never random.
- **See the whole picture** — a visual tree of your openings and every branch.
- **Know your openings by name** — recognised automatically.
- **Get a second opinion** — engine evaluation on any position.
- **Bring in your games** — import from Chess.com and Lichess.
- **Scout opponents** — see what they actually play and prepare a surprise.
- **Learn the traps** — a curated library of famous opening traps.
- **Track progress** — stats and streaks that follow your learning.
- **Make it yours** — light and dark themes, multiple piece sets, and your data
  stays on your device.

## A personal note

I'm a passionate chess player — not a very good one. I built Bito Chess to improve
my openings after never being satisfied with the tools out there, and now I hope
it helps other players too.

## Tech stack

[Vite](https://vitejs.dev) · [TypeScript](https://www.typescriptlang.org) ·
[chessground](https://github.com/lichess-org/chessground) ·
[chess.js](https://github.com/jhlywa/chess.js) · installable PWA. Storage is
local (IndexedDB) — there is no backend.

## Deploying

The app is built with Vite and deployed to GitHub Pages via the workflow in
`.github/workflows/`. The build output (`dist`) is published as the Pages
artifact, and the landing page in `/docs` is copied into that artifact so it goes
live at `…/obertura/docs/`. Pages stays in "GitHub Actions" source mode.

## Open source / licences

Bito Chess ships third-party software and data. The full list is maintained in the
in-app About sheet (`src/about.ts`):

| Component | Licence |
| --- | --- |
| chessground | GPL-3.0 |
| chess.js | BSD-2-Clause |
| Stockfish | GPL-3.0 |
| Lichess chess-openings data | CC0-1.0 (public domain) |
| cburnett piece set | GPL-2.0-or-later |
| Merida piece set (Armando H. Marroquín) | GPL-2.0-or-later |
| Chessnut piece set (Alexis Luengas) | Apache-2.0 |
| Kiwen-Suwi piece set (neverRare) | CC-BY-4.0 |

## Not affiliated

Bito Chess is a personal project and is **not affiliated with, endorsed by, or
connected to Chess.com or Lichess.** It simply imports public game data from
their APIs.

---

Made by [marxal](https://marxal.net).
