// The mistake scan, run QUIETLY, so nobody has to press a button and then watch
// a progress bar for ten minutes.
//
// THE PROBLEM IT SOLVES. Everything on the Middle game pane is downstream of one
// long job: the engine reading every imported game and marking the moves where
// the evaluation swung. Behind a button that job is a decision — "do I want to
// give this ten minutes right now?" — and the honest answer is almost always no,
// so the pane stays empty and the feature never happens for that user. The work
// is exactly the same either way; the only question is who waits for it.
//
// SO IT RUNS ON ITS OWN, and the rules that make that safe are the whole file:
//
//   • ONE AT A TIME, EVER. A module-level controller means two calls to start()
//     don't run two scans over the same games and write over each other.
//   • THE MANUAL SCAN ALWAYS WINS. Pressing "Analyse my games" pauses this and
//     resumes it afterwards. They'd otherwise queue on the same engine worker
//     and each make the other look broken.
//   • IT NEVER BLOCKS A LAUNCH. Started well after first paint, and never
//     awaited by anything on the way in.
//   • ABORTING COSTS NOTHING. scanGames persists each game the moment it
//     finishes and picks up from "which games have no result yet", so a stop is
//     a pause and a resume is just another start().
//   • THE TIER CAP IS THE SAME ONE the button obeys — a free account never
//     spends more cloud calls in the background than it would in the foreground.
//
// It reports through a plain listener list rather than a DOM event so the pane
// can paint live counts, and the counts survive the pane being closed and
// reopened mid-scan.

import { scanGames, unscannedCount, type ScanProgress } from './mistake-scan';
import { getAllGames, onGamesChanged } from './storage';
import { isEntitled, FREE_MISTAKE_GAME_WINDOW, FREE_MISTAKE_SPOTS } from './entitlement';

const ENABLED_KEY = 'obertura.autoScanGames';

/** On by default — it is the behaviour the pane is designed around now. */
export function getAutoScanEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) !== 'off';
}

export function setAutoScanEnabled(on: boolean): void {
  localStorage.setItem(ENABLED_KEY, on ? 'on' : 'off');
  if (on) startAutoScan();
  else stopAutoScan();
}

/** What the background pass is doing right now, for anything that wants to say so. */
export interface AutoScanState {
  running: boolean;
  /** Games finished in THIS pass. */
  done: number;
  /** Games this pass set out to do. */
  total: number;
  /** Spots found in this pass. */
  spots: number;
  /** Who the game being read was against — the one human detail in the status. */
  opponent?: string;
}

let state: AutoScanState = { running: false, done: 0, total: 0, spots: 0 };
let ctrl: AbortController | null = null;
// Set while a manual scan owns the engine; start() refuses until it clears.
let suspended = false;

const listeners = new Set<(s: AutoScanState) => void>();

/** Subscribe to progress. Returns an unsubscribe — call it when the host goes. */
export function onAutoScanChange(fn: (s: AutoScanState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function autoScanState(): AutoScanState {
  return state;
}

function publish(next: Partial<AutoScanState>): void {
  state = { ...state, ...next };
  for (const fn of listeners) {
    try { fn(state); } catch { /* a broken listener must not stop the scan */ }
  }
}

/**
 * Start (or resume) the background pass. Safe to call as often as you like:
 * it returns immediately when one is already running, when the user has turned
 * it off, when a manual scan holds the engine, or when there is nothing left to
 * read.
 */
export function startAutoScan(): void {
  watchGames();
  if (state.running || suspended || !getAutoScanEnabled()) return;
  void run();
}

// Newly imported games should be read without anyone going back to the pane to
// ask. Subscribed on the first start rather than at module load, so importing
// this file costs nothing.
//
// The scan itself writes each finished game, so this fires throughout a pass —
// which is harmless (a start while one is running returns at once) but pointless
// often enough to be worth a small debounce.
let watching = false;
let nudge = 0;
function watchGames(): void {
  if (watching) return;
  watching = true;
  onGamesChanged(() => {
    window.clearTimeout(nudge);
    nudge = window.setTimeout(() => startAutoScan(), 2500);
  });
}

/** Stop the background pass. Work already finished is kept (see the header). */
export function stopAutoScan(): void {
  ctrl?.abort();
  ctrl = null;
  if (state.running) publish({ running: false, opponent: undefined });
}

/**
 * Hand the engine to a manual scan: stop, and stay stopped until
 * `resumeAutoScan` says otherwise. The pane wraps its own scan in these.
 */
export function suspendAutoScan(): void {
  suspended = true;
  stopAutoScan();
}

export function resumeAutoScan(): void {
  suspended = false;
  startAutoScan();
}

async function run(): Promise<void> {
  // Nothing to do is the common case on every launch after the first, and
  // finding that out costs one IndexedDB read rather than a scan.
  let pending = 0;
  try {
    pending = unscannedCount(await getAllGames());
  } catch {
    return;
  }
  if (pending === 0) return;
  if (state.running || suspended || !getAutoScanEnabled()) return;

  ctrl = new AbortController();
  const signal = ctrl.signal;
  publish({ running: true, done: 0, total: pending, spots: 0, opponent: undefined });

  try {
    await scanGames({
      signal,
      onProgress: (p: ScanProgress) => {
        if (signal.aborted) return;
        publish({ done: p.gamesDone, total: p.gamesTotal, spots: p.spotsFound, opponent: p.opponent });
      },
      cap: isEntitled()
        ? undefined
        : { windowGames: FREE_MISTAKE_GAME_WINDOW, maxUnfixed: FREE_MISTAKE_SPOTS },
    });
  } catch {
    // Offline, a wedged worker, a deleted game — the next start() tries again
    // from wherever this one got to. Never surfaced: nobody asked for this pass.
  } finally {
    if (ctrl?.signal === signal) ctrl = null;
    publish({ running: false, opponent: undefined });
  }
}
