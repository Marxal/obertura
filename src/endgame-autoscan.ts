// The endgame scan, run QUIETLY — the twin of mistake-autoscan.ts, for the End
// game tab's "From your games" section.
//
// THE SAME PROBLEM, THE SAME ANSWER. "Scan my games (312)" is a button that asks
// for ten minutes before it will show you anything, and the honest answer to
// that question is almost always "not now" — so the section stayed empty for
// exactly the people who had the most games in it. The work is identical either
// way; the only question is who waits for it. So it happens on its own, and the
// button stays for anyone who wants to sit and watch it.
//
// WHAT IS DIFFERENT FROM THE MISTAKE PASS, and why this isn't just a copy:
//
//   • IT GOES SECOND. Both passes queue on the same review worker (engine.ts
//     serialises analysePosition on one chain), so two of them running at once
//     would only make each take twice as long. The Middle game pane is the one
//     the app leads with, so this waits for the mistake pass to be idle and
//     subscribes for the moment it becomes so.
//   • IT CAN BE UNREACHABLE. Endgames ≤7 pieces are judged by the Lichess
//     tablebase, which a phone on a train simply cannot reach. scanEndgames
//     reports that rather than grinding, and a pass that comes back unreachable
//     STOPS trying until something changes (the app is reopened, games arrive,
//     the network comes back) — otherwise a plane journey would be a retry loop.
//
// Everything else is deliberately the same: one pass at a time, the manual scan
// always wins, aborting costs nothing (scanEndgames writes each game as it
// finishes), and the free-tier cap is the one the button obeys.

import { scanEndgames, unscannedEndgameCount } from './endgame-scan';
import type { EndgameScanProgress } from './endgame-scan';
import { getAllGames, onGamesChanged } from './storage';
import { isEntitled, FREE_ENDGAME_GAME_WINDOW, FREE_ENDGAME_SPOTS } from './entitlement';
import { autoScanState, onAutoScanChange, getAutoScanEnabled } from './mistake-autoscan';

/** What the background endgame pass is doing right now. */
export interface EndgameAutoScanState {
  running: boolean;
  /** Games finished in THIS pass. */
  done: number;
  /** Games this pass set out to do. */
  total: number;
  /** Playable endgames found in this pass. */
  found: number;
  /** Who the game being read was against — the one human detail in the status. */
  opponent?: string;
  /** The last pass gave up because the tablebase couldn't be reached. */
  unreachable: boolean;
}

let state: EndgameAutoScanState =
  { running: false, done: 0, total: 0, found: 0, unreachable: false };
let ctrl: AbortController | null = null;
// Set while a manual scan owns the tablebase/engine; start() refuses until it clears.
let suspended = false;
// Set by a pass that bailed unreachable, cleared by anything that could mean the
// network is back (a fresh start() from the screen or from new games) — but not
// before OFFLINE_RETRY_MS has passed. Without that delay the latch is useless:
// the finished pass rebuilds the section, the rebuild starts the pass, and a
// phone with no signal spins through the whole cycle as fast as it can.
const OFFLINE_RETRY_MS = 5 * 60_000;
let offline = false;
let offlineAt = 0;

const listeners = new Set<(s: EndgameAutoScanState) => void>();

/** Subscribe to progress. Returns an unsubscribe — call it when the host goes. */
export function onEndgameAutoScanChange(fn: (s: EndgameAutoScanState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function endgameAutoScanState(): EndgameAutoScanState {
  return state;
}

function publish(next: Partial<EndgameAutoScanState>): void {
  state = { ...state, ...next };
  for (const fn of listeners) {
    try { fn(state); } catch { /* a broken listener must not stop the scan */ }
  }
}

/**
 * Start (or resume) the background endgame pass. Safe to call as often as you
 * like: it returns at once when one is already running, when background
 * analysis is switched off, when the mistake pass still holds the worker, when a
 * manual scan is up, or when there is nothing left to read.
 *
 * `retryOffline` clears the "the tablebase was unreachable" latch — the screen
 * passes it when the user has come back to the section, which is as good a
 * signal as any that the network situation may have changed.
 */
export function startEndgameAutoScan(o: { retryOffline?: boolean } = {}): void {
  watchGames();
  waitForMistakePass();
  if (o.retryOffline && Date.now() - offlineAt >= OFFLINE_RETRY_MS) offline = false;
  if (state.running || suspended || offline || !getAutoScanEnabled()) return;
  // The Middle game pass leads. waitForMistakePass (above) has us subscribed to
  // its finish, so this is a deferral rather than a refusal.
  if (autoScanState().running) return;
  void run();
}

/** Stop the background pass. Work already finished is kept. */
export function stopEndgameAutoScan(): void {
  ctrl?.abort();
  ctrl = null;
  if (state.running) publish({ running: false, opponent: undefined });
}

/**
 * Hand the tablebase/engine to a manual scan: stop, and stay stopped until
 * `resumeEndgameAutoScan` says otherwise. The section wraps its own scan in these.
 */
export function suspendEndgameAutoScan(): void {
  suspended = true;
  stopEndgameAutoScan();
}

export function resumeEndgameAutoScan(): void {
  suspended = false;
  startEndgameAutoScan();
}

// Newly imported games should be read without anyone going back to the tab to
// ask. Subscribed on the first start rather than at module load, so importing
// this file costs nothing. New games are also the best evidence that the network
// is up again, so they clear the offline latch.
let watching = false;
let nudge = 0;
function watchGames(): void {
  if (watching) return;
  watching = true;
  onGamesChanged(() => {
    window.clearTimeout(nudge);
    nudge = window.setTimeout(() => startEndgameAutoScan({ retryOffline: true }), 4000);
  });
}

// Pick the worker up the moment the mistake pass puts it down.
let queued = false;
function waitForMistakePass(): void {
  if (queued) return;
  queued = true;
  onAutoScanChange((s) => {
    if (!s.running) startEndgameAutoScan();
  });
}

async function run(): Promise<void> {
  // Nothing to do is the common case on every launch after the first, and
  // finding that out costs one IndexedDB read rather than a scan.
  let pending = 0;
  try {
    pending = unscannedEndgameCount(await getAllGames());
  } catch {
    return;
  }
  if (pending === 0) return;
  if (state.running || suspended || offline || !getAutoScanEnabled()) return;
  if (autoScanState().running) return;

  ctrl = new AbortController();
  const signal = ctrl.signal;
  publish({
    running: true, done: 0, total: pending, found: 0, opponent: undefined, unreachable: false,
  });

  try {
    const result = await scanEndgames({
      signal,
      onProgress: (p: EndgameScanProgress) => {
        if (signal.aborted) return;
        publish({
          done: p.gamesDone, total: p.gamesTotal, found: p.found, opponent: p.opponent,
        });
      },
      cap: isEntitled()
        ? undefined
        : { windowGames: FREE_ENDGAME_GAME_WINDOW, maxUnplayed: FREE_ENDGAME_SPOTS },
    });
    // Latch off until something suggests the network is worth another try, and
    // not for at least OFFLINE_RETRY_MS whatever that something is. The games are
    // left unscanned, so nothing is lost by stopping here.
    offline = result.unreachable;
    if (result.unreachable) offlineAt = Date.now();
    publish({ unreachable: result.unreachable });
  } catch {
    // A wedged worker, a deleted game — the next start() picks up from wherever
    // this one got to. Never surfaced: nobody asked for this pass.
  } finally {
    if (ctrl?.signal === signal) ctrl = null;
    publish({ running: false, opponent: undefined });
  }
}
