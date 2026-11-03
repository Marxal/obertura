// "Game analysis": telling someone the engine is reading their games, and telling
// them again when there is something to show for it.
//
// THE ENGINE TAKES 15–40 SECONDS A GAME, so an import can't arrive with its
// mistakes. The pass itself (mistake-autoscan.ts) has always run on its own; what
// was missing is the two sentences around it. A first run used to mention it
// nowhere, and the mistakes simply turned up in Train for anyone who went looking.
// So: one line while the openings are being chosen, the Home banner while it runs,
// and when it's ready a toast with a button, then a card on Home that stays until
// it's been acted on.
//
// "READY" IS NOT "FINISHED". A pass over 500 games runs for hours. Waiting for the
// end would mean saying nothing for a very long time about something usable after a few minutes, so it's
// ready at READY_MISTAKES found, or when the pass ends with fewer.
//
// IT ONLY RUNS WHILE THE APP IS OPEN. There is no service worker and no push: close
// the app and the pass stops, then picks up at the next launch. The copy says
// "in the background" because that is what it is to someone using the app, and the
// recap note says so plainly. A phone notification is a separate, later feature.
//
// ONCE PER DEVICE. The state is device-local (local-keys.ts): the scan results it
// describes don't sync either. Someone who already has analysed games never gets it.

import { autoScanState, onAutoScanChange, type AutoScanState } from './mistake-autoscan';
import { collectSpots, pickSpots, type SpotRef } from './mistake-scan';
import { Icons } from './icons';
import { getAllGames } from './storage';

const NOTICE_KEY = 'obertura.analysisNotice';
type NoticeState = 'armed' | 'ready' | 'done';

/** How many mistakes make the analysis worth announcing. */
const READY_MISTAKES = 5;

/** How many mistakes the notice reads, best first. */
const NOTICE_MISTAKES = 10;

/** The most a session started from the notice deals. */
export const ANALYSIS_SESSION_SPOTS = 5;

function readState(): NoticeState | null {
  try {
    const v = localStorage.getItem(NOTICE_KEY);
    return v === 'armed' || v === 'ready' || v === 'done' ? v : null;
  } catch {
    return null;
  }
}

function writeState(state: NoticeState): void {
  try { localStorage.setItem(NOTICE_KEY, state); } catch { /* storage off: no notice */ }
}

/** Every unfixed mistake this account can see, best first. */
export async function readAnalysisMistakes(): Promise<SpotRef[]> {
  return pickSpots(collectSpots(await getAllGames()), null, NOTICE_MISTAKES);
}

/** Is an analysis running that the user will hear about when it's ready? */
export function isAnalysisPending(): boolean {
  return readState() === 'armed';
}

/** Has the analysis been acted on, or dismissed? The Home card goes. */
export function markAnalysisSeen(): void {
  writeState('done');
}

export interface AnalysisNoticeHandlers {
  /** There are mistakes to show. Fires once. */
  onReady: (count: number) => void;
  /** The whole pass finished and found nothing. Fires once. */
  onNothingFound: () => void;
}

let handlers: AnalysisNoticeHandlers | null = null;
let stopWatching: (() => void) | null = null;
let checking = false;

/** Called once at boot. Picks up an analysis left running by the last launch. */
export function startAnalysisNotice(h: AnalysisNoticeHandlers): void {
  handlers = h;
  if (readState() === 'armed') {
    watch();
    void check(autoScanState());
  }
}

/**
 * Games just landed. From here on the user is owed a word when they've been read,
 * unless this device has already had that word, or already holds analysed games.
 */
export async function armAnalysisNotice(): Promise<void> {
  if (readState()) return;
  try {
    const games = await getAllGames();
    if (games.some(g => g.retry)) { writeState('done'); return; }
  } catch {
    return;
  }
  writeState('armed');
  watch();
}

function watch(): void {
  if (stopWatching) return;
  stopWatching = onAutoScanChange((st) => { void check(st); });
}

async function check(st: AutoScanState): Promise<void> {
  if (checking) return;
  if (readState() !== 'armed') { stopWatching?.(); stopWatching = null; return; }
  checking = true;
  try {
    const found = (await readAnalysisMistakes()).length;
    if (found >= READY_MISTAKES || (!st.running && found > 0)) {
      finish('ready');
      handlers?.onReady(found);
    } else if (!st.running && st.total > 0 && st.done >= st.total) {
      // The whole pass, and nothing. Not the same as a pass that stopped early
      // (offline, a wedged worker), which stays armed for the next launch.
      finish('done');
      handlers?.onNothingFound();
    }
  } catch {
    // Storage hiccup: the next game read asks again.
  } finally {
    checking = false;
  }
}

function finish(state: NoticeState): void {
  writeState(state);
  stopWatching?.();
  stopWatching = null;
}

// The card at the top of Home, for as long as the news hasn't been acted on. A
// toast is easy to miss, particularly over the top of something else.
export function buildAnalysisReadyCard(deps: {
  onFix: () => void;
  onDismiss: () => void;
}): HTMLElement | null {
  if (readState() !== 'ready') return null;

  const card = document.createElement('div');
  card.className = 'ga-ready';

  const icon = document.createElement('span');
  icon.className = 'home-scan-icon';
  icon.appendChild(Icons.review(20));
  card.appendChild(icon);

  const text = document.createElement('div');
  text.className = 'ga-ready-text';
  const title = document.createElement('p');
  title.className = 'ga-ready-title';
  title.textContent = 'Your game analysis is ready';
  text.appendChild(title);
  const sub = document.createElement('p');
  sub.className = 'ga-ready-sub';
  sub.textContent = 'Fix the mistakes it found in your games.';
  text.appendChild(sub);
  card.appendChild(text);

  void readAnalysisMistakes().then((refs) => {
    if (refs.length > 0) {
      sub.textContent = refs.length === 1
        ? '1 mistake from your games to fix.'
        : `${refs.length} mistakes from your games to fix.`;
    }
  }).catch(() => { /* the plain sentence stands */ });

  const fix = document.createElement('button');
  fix.type = 'button';
  fix.className = 'btn-primary ga-ready-fix';
  fix.textContent = 'Fix them';
  fix.addEventListener('click', deps.onFix);
  card.appendChild(fix);

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'ga-ready-dismiss';
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.appendChild(Icons.close(15));
  dismiss.addEventListener('click', deps.onDismiss);
  card.appendChild(dismiss);

  return card;
}
