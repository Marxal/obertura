---
name: verify
description: Build, launch and drive Obertura (the built PWA) headlessly to verify changes at the real UI. Use when a change needs runtime verification on this repo.
---

# Verifying Obertura changes at the running app

## Build + serve

```bash
npm ci                      # once per container
npm run build               # tsc + vite build → dist/ (also copies the engine)
npx vite preview --port 4173 &   # serves dist at http://localhost:4173/obertura/
```

`npm run selftest` runs the headless data-layer tests (533+), but that's CI's
job — verification means driving the app below.

## Drive it (Playwright)

Playwright is not a repo dependency. Install it in the scratchpad
(`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i playwright chess.js`) and launch
Chromium with an explicit executable path (`/opt/pw-browsers/chromium-*/chrome-linux/chrome`
on the remote runner). Use a phone viewport (412×915) — the app is phone-first.

## Gotchas (each cost a retry once)

- **Beta gate + onboarding block first load.** Before reloading into the app set:
  `localStorage obertura.betaUnlocked=1, obertura.introSeen=1, obertura.wizardSeen=1`.
- **Seed data via IndexedDB** — DB `obertura` v3, stores `lines` (keyPath `id`),
  `games` (keyPath `id`, index `endTime`), `opponents`. Line/ImportedGame shapes:
  `src/types.ts` / `src/chesscom.ts`. Generate real FENs/UCIs with chess.js in
  Node and inject the JSON via `page.evaluate`.
- **Training hub is gated** until 5 saved lines exist — seed at least 5
  (`inTraining: true`) or you get the "Build your first lines" card instead of
  the training list.
- **Bottom nav** is `#bottom-nav [data-view="train|lines|explore|games|progress"]`;
  Settings opens via `#nav-settings` and HIDES the bottom nav — leave it with
  `#nav-back` before tapping a tab.
- **Settings groups are `<details>` accordions** — click the
  `summary` (e.g. "Appearance") before looking for rows inside. Toggles are
  `label.switch` (a checkbox), not buttons.
- **Statistics screen** = `data-view="progress"`; the games sections render only
  when the `games` store has rows.
- Opening a saved line: My Lines → tap `.pcard-title` → builder with
  `#builder-engine` (engine dock toggle) and `#eval-bar-top` (docked eval bar).
