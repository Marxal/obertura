# Back-navigation in training — diagnosis (v1.3, task 0.2)

Read-only investigation. No app code changed. Symptom: inside a training
session on installed Android Chrome (PWA), the system back gesture **and** the
hardware/nav-bar back button do nothing — no guard dialog, no navigation, dead.
Outside sessions, back works. There is also a cosmetic misalignment of the "<"
chevron against its "Back" label in the session header.

## TL;DR

The back chain is **not** broken in JavaScript — it runs end to end and creates
the "Abandon this session?" dialog correctly. The dialog is just **invisible and
untappable** because it renders *underneath* the opaque full-screen drill
overlay: `.edit-overlay` (the dialog) is `z-index: 100`, the drill `.pt-overlay`
is `z-index: 200` with a solid background. So pressing back fires the guard, the
guard mounts behind the board, and nothing visible happens — the drill stays put
("no navigation") and no dialog appears ("no guard dialog"). The on-screen "Back"
button in the header has the **exact same fate** for the same reason.

This is a regression from **`df3a15b`** ("Guard builder/training exits; smooth
post-save add-to-training"), which replaced the drill's immediate
`cleanup(); onCancel()` back action with a confirm dialog that is layered below
the screen it is supposed to sit on top of.

## 1) The exact broken chain (who should catch popstate, where it breaks)

The popstate plumbing itself is sound. The break is a CSS stacking-order fault at
the very last hop.

1. System back consumes the armed buffer history entry → `popstate` fires →
   `onPopState` (`src/back-nav.ts:57`).
2. The dismissible-layer stack is non-empty (the drill registered a layer), so
   `onPopState` pops it and calls it, then re-arms the buffer
   (`src/back-nav.ts:59-63`, `rearm` at `src/back-nav.ts:76-78`).
3. The popped layer is the drill's `exitViaBackGesture`
   (registered at `src/drill.ts:416`, defined at `src/drill.ts:411-414`). With
   `confirmAbandon: true` it calls `showAbandonDialog(...)` (`src/drill.ts:391`).
4. `showAbandonDialog` → `showDialog` (`src/dialog.ts:26`) builds an
   `.edit-overlay` element and appends it to `document.body`
   (`src/dialog.ts:27-28`, `:79`).
5. **Break point (CSS, not JS):** `.edit-overlay` is `z-index: 100`
   (`src/style.css:2088-2097`, value at **`:2094`**). The drill is still mounted
   as `.pt-overlay`, `position: fixed; inset: 0`, **opaque** `background:
   var(--bg-sheet)`, `z-index: 200` (`src/style.css:2311-2319`, value at
   **`:2315`**). 200 > 100, so the dialog is painted *behind* the opaque drill
   and is both invisible and non-interactive.

Net effect: the chain "completes" but produces no visible change. The drill
overlay never goes away (no navigation) and the guard is hidden (no dialog) —
exactly "dead."

Because the on-screen header "Back" button also routes through
`exitViaButton` → `showAbandonDialog` → `showDialog` (`src/drill.ts:404-407`),
it is hidden by the identical stacking fault. Both controls are affected; the
gesture is not special.

Why "outside sessions back works": elsewhere, dialogs (the builder save-guard,
edit sheets, etc.) sit over a normal *view* — there is no `z-index: 200` overlay
above them — so the same `.edit-overlay` at `z-index: 100` is on top and visible.
Only the drill mounts an opaque overlay above the dialog layer.

## 2) The commit that introduced it

**`df3a15b` — "Guard builder/training exits; smooth post-save add-to-training."**

- Before `df3a15b`, the drill's back layer was
  `pushBack(() => { cleanup(); opts.onCancel(); })` — back exited the drill
  immediately, so it always *did something*.
- `df3a15b` swapped that for `exitViaBackGesture`/`exitViaButton` →
  `showAbandonDialog` → the shared `showDialog` (new `src/dialog.ts`), which
  depends on the dialog rendering **above** the drill. The drill's `z-index: 200`
  vs `.edit-overlay`'s `z-index: 100` ordering predates this commit
  (both blame to the v1.2 base `304b9cf`), so the new dialog inherited a stacking
  context that cannot show over the drill. The regression is the new dependency,
  not the z-index values themselves.

`back-nav.ts` is **not** implicated: its logic is byte-for-byte identical to its
introduction in `373aafa`; the only later touch (`c04d5f2`) edited comments only.
(Note: `c04d5f2` did make Train the back-nav root, which makes the
`onPopState` fallback at `src/back-nav.ts:66-73` tear down the listener if it is
ever reached at the Train root — but in this bug the drill's layer *is* caught at
step 2, so that fallback is never reached. It is a latent sharp edge, not the
cause here.)

## 3) Do individual moves and pre-training share the bug?

- **Individual moves — YES, same bug.** `runIndividual` calls
  `startPositionsDrill` with `confirmAbandon: true` (`src/train-screen.ts:988`).
  Same `showDialog` under the same `z-index: 200` overlay → guard hidden.
- **Timed mode — YES, same bug.** `startTimedDrill` with `confirmAbandon: true`
  (`src/train-screen.ts:1311`). Same fault.
- **Pre-training — NO, does not share it.** `startPretrainingRun`
  (`src/pretraining.ts:46-58`) calls `startDrill` **without** `confirmAbandon`,
  so `exitViaBackGesture`/`exitViaButton` fall straight to `doExit()`
  (`src/drill.ts:405`, `:412`) — no dialog is created, so there is nothing to
  hide. Back exits the pre-training run immediately and visibly. (Side note: this
  means pre-training has *no* abandon guard at all — a separate inconsistency,
  not a defect for this task.)

## 4) Root cause of the chevron misalignment (one CSS finding)

`.pt-back-btn` (`src/style.css:2331-2343`) sets no `display` / alignment, so it
lays out its two children — the inline `<svg>` chevron from `Icons.back(15)`
(`src/drill.ts:263`) and the "Back" text node (`src/drill.ts:264`) — as inline
flow content. An inline replaced `<svg>` with explicit width/height defaults to
`vertical-align: baseline`, so the chevron's bottom edge sits on the text
baseline rather than centered on the label's cap height — the chevron reads as
dropped/misaligned next to "Back."

## 5) Recommended minimal fix (described, NOT implemented)

**Primary (the dead-back fix) — one line of CSS.** Lift the dialog overlay above
the drill so the guard is visible and tappable. Raise `.edit-overlay`'s
`z-index` above the drill's 200 — e.g. `z-index: 300` at `src/style.css:2094`.
This is safe: edit sheets elsewhere sit over plain views, so a higher value does
not change their appearance; it only ensures dialogs win over the
`z-index: 200` drill/explore/map overlays. (Equivalent alternative: give the
abandon dialog its own higher-stacked class instead of touching the shared
`.edit-overlay`, if a global bump feels too broad.) No JavaScript change is
needed — the popstate/stack flow already works.

**Secondary (chevron) — one CSS rule.** Add to `.pt-back-btn`:
`display: inline-flex; align-items: center; gap: 0.25rem;` (or, more locally,
`vertical-align: middle` on the icon). This centers the chevron against the
label.

Both are cosmetic-scoped, low-risk, and reversible; neither requires touching
`back-nav.ts`, `drill.ts`, or the session wiring.
