---
name: verify
description: Build, launch and drive Bito Chess (the built PWA) headlessly to verify changes at the real UI. Use when a change needs runtime verification on this repo.
---

# Verifying Bito Chess changes at the running app

## Build + serve

```bash
npm ci                      # once per container
npm run build               # tsc + tsc -p tsconfig.worker.json + vite build → dist/
npx vite preview --port 4173 &   # serves dist at http://localhost:4173/obertura/
```

`npm run selftest` runs the headless data-layer tests (1482 as of v0.5), but
that's CI's job — verification means driving the app below.

## Drive it (Playwright)

Playwright is not a repo dependency. Install it in the scratchpad
(`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i playwright chess.js`) and launch
Chromium with an explicit executable path (`/opt/pw-browsers/chromium-*/chrome-linux/chrome`
on the remote runner). Use a phone viewport (412×915) — the app is phone-first.

## Getting past the front door

Set these in `localStorage` before reloading into the app:

```js
localStorage.setItem('obertura.onboardingComplete', '1');
localStorage.setItem('obertura.builderTourDone', '1');  // skips the coach-marks
```

⚠️ `obertura.introSeen` and `obertura.wizardSeen` **no longer exist** — the
guest-first round replaced the intro + wizard with a single picker screen, and
`obertura.onboardingComplete` is the flag that stands in for both. Setting the
old two does nothing and you'll land in onboarding.

⚠️ `obertura.betaUnlocked` is gone too — the beta access gate was removed
(2026-09) and `gate.ts` now only captures the PWA install prompt. There is no
front door any more; a fresh profile lands straight on first run.

**First run is now games-first** (`onboarding-where.ts`): "Where do you play?"
with a Chess.com / Lichess / I'm new toggle, then an import, then a recap of
the user's own openings (`onboarding-recap-screen.ts`). To test it you want a
profile with `onboardingComplete` UNSET and no saved lines — the two halves of
`shouldShowFirstRun()`. To skip it, set the flag as above.

## Seeding data

**DB `obertura`, version 4.** Opening it at any lower version throws
`VersionError`. Stores:

| Store | keyPath | Notes |
|---|---|---|
| `repertoires` | `id` | **the primary store** — one record per book, holding its whole move tree |
| `lines` | `id` | legacy flat store, left in place as a one-version rollback |
| `games` | `id` | index `endTime` |
| `opponents` | `id` | one record per scouted opponent |

**Seed `repertoires`, not `lines`.** A `Repertoire` is
`{ id, name, colour: 'white'|'black', tree, createdAt }` — see `src/repertoire.ts`
for `emptyTree()`, `newRepertoire()` and `mergePath()`, and
`REPERTOIRE-REDESIGN.md` for the model. Generate real FENs/UCIs with chess.js in
Node and inject the JSON via `page.evaluate`.

Seeding the old `lines` store still works — `ensureMigrated()` in `storage.ts`
converts it on the first repertoire read — but only while `repertoires` is
empty, and it's the legacy path. Prefer the store the app actually reads.

Nodes default to in-training (`DEFAULT_TRAINING = true` in `repertoire.ts`), so
seeded lines are enrolled without setting anything.

## Gotchas (each cost a retry once)

- **Training is locked below 3 saved lines** — `TRAINING_UNLOCK_LINES` in
  `src/training-goal.ts`. Seed at least 3 or you get the Get-started panel
  instead of the training list. (The daily challenge counts toward the same
  number.)
- **Bottom nav** is `#bottom-nav [data-view="train|lines|explore|games|progress"]`;
  Settings opens via `#nav-settings` and HIDES the bottom nav — leave it with
  `#nav-back` before tapping a tab.
- **Settings groups are `<details>` accordions** — click the `summary`
  (e.g. "Appearance") before looking for rows inside. Toggles are `label.switch`
  (a checkbox), not buttons.
- **Statistics screen** = `data-view="progress"`; the games sections render only
  when the `games` store has rows.
- Opening a saved line: My Lines → tap `.pcard-title` → builder with
  `#builder-engine` (engine dock toggle) and `#eval-bar-top` (docked eval bar).

## Keeping this file honest

Every fact above is a fact about code that moves. If a step here fails, check the
source before working around it — this file has drifted before (it claimed DB v3,
the retired `introSeen`/`wizardSeen` keys, and a 5-line training gate). Fix it
here when you find it wrong.
