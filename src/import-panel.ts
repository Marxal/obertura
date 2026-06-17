// The one import panel — a two-step bottom sheet used everywhere games come in
// ("Refresh my games" in Settings and on the From-my-games tab today; the
// onboarding import and opponent scouting later). It owns the whole flow:
//
//   STEP 1 — pick a platform (Chess.com / Lichess), a username, and how far back
//            to look (1m / 3m / 12m / All), then Scan.
//   STEP 2 — step 1 collapses (an "Edit search" link brings it back) so the
//            focus is the import itself: the source echoed (@user · platform),
//            "Found N games", a how-many chooser (Last 100 / Last 500 / All,
//            defaulting to 500 once there's more than that), a row of
//            time-control toggles each showing its count (bullet OFF by
//            default), an amber alert when a big "All" import is chosen, an
//            Import button that always shows the resulting count, and the
//            White/Black split of exactly what will land.
//
// The scan always pulls every speed and caps at 1000 newest-first (import-core).
// The how-many chooser slices the most recent N off that; the time-control
// toggles are a local filter on top of whichever slice — so you decide what
// lands on the device. On import the panel persists the chosen games (replacing
// what's stored) and records the source, then hands control back so the caller
// can re-run its analysis and refresh badges/suggestions.

import {
  importGames,
  filterByTimeClasses,
  tallyTimeClasses,
  takeNewest,
  summariseGames,
  TIME_CLASS_LABELS,
  DEFAULT_TIME_CLASSES,
  HARD_CAP,
  type Platform,
  type TimeClass,
  type CountChoice,
  type ImportResult,
  type ImportedGame,
} from './import-games';
import {
  getUsername as getChesscomUser,
  setUsername as setChesscomUser,
  fetchAvatar,
} from './chesscom';
import {
  getUsername as getLichessUser,
  setUsername as setLichessUser,
} from './lichess';
import { clearGames, saveGames, countGames } from './storage';
import { pushBack } from './back-nav';
import { createImportLoader, type ImportLoader } from './import-progress';
import { userAvatar } from './avatar';
import { wdlBlock } from './wdl-bar';
import { showToast } from './toast';

// ── Remembered choices (device-local) ────────────────────────────────────────

const PLATFORM_KEY = 'obertura.importPlatform';
const SOURCE_KEY = 'obertura.gamesSource';
// The one timestamp the weekly auto-refresh checks against (see auto-refresh.ts).
// Set by every "my games" import AND by each successful auto-refresh, so the
// 7-day window is driven by a single key the user can poke from the console.
const REFRESH_KEY = 'obertura.lastGamesRefresh';

const PLATFORM_LABELS: Record<Platform, string> = {
  chesscom: 'Chess.com',
  lichess: 'Lichess',
};

// The last platform you imported from, so the panel opens where you left off.
export function getLastPlatform(): Platform {
  return localStorage.getItem(PLATFORM_KEY) === 'lichess' ? 'lichess' : 'chesscom';
}

function setLastPlatform(p: Platform): void {
  try { localStorage.setItem(PLATFORM_KEY, p); } catch { /* storage off */ }
}

// Per-platform saved username (each platform keeps its own).
function savedUsername(p: Platform): string {
  return p === 'lichess' ? getLichessUser() : getChesscomUser();
}

function saveUsername(p: Platform, name: string): void {
  if (p === 'lichess') setLichessUser(name);
  else setChesscomUser(name);
}

// Where the games currently on the device came from — shown in Settings as
// "connected as X on Chess.com", with the last-synced date and game count.
export interface GamesSource {
  platform: Platform;
  username: string;
  syncedAt: string; // ISO
  count: number;
  // Your Chess.com profile picture, when you have one. Undefined for Lichess
  // (no public avatar) or when the lookup turns up nothing.
  avatarUrl?: string;
}

// Fired whenever the connected account changes (a my-games import or an
// auto-refresh) so the header settings button and any open surface can refresh
// the picture without re-fetching. main.ts listens for it.
export const IDENTITY_CHANGED_EVENT = 'obertura:identity-changed';
function announceIdentityChange(): void {
  try { window.dispatchEvent(new CustomEvent(IDENTITY_CHANGED_EVENT)); } catch { /* SSR/no window */ }
}

export function getGamesSource(): GamesSource | null {
  try {
    const raw = localStorage.getItem(SOURCE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as GamesSource;
    if (!s || (s.platform !== 'chesscom' && s.platform !== 'lichess')) return null;
    return s;
  } catch {
    return null;
  }
}

function setGamesSource(s: GamesSource): void {
  try { localStorage.setItem(SOURCE_KEY, JSON.stringify(s)); } catch { /* storage off */ }
}

export function platformLabel(p: Platform): string {
  return PLATFORM_LABELS[p];
}

// ── Auto-refresh bookkeeping (the weekly games refresh) ───────────────────────

// When games were last pulled (a manual import or an auto-refresh), as ISO — or
// null if never. Falls back to the source's sync date for installs that imported
// before this key existed, so the weekly check has a sensible baseline.
export function getLastGamesRefresh(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY) ?? getGamesSource()?.syncedAt ?? null;
  } catch {
    return null;
  }
}

function setLastGamesRefresh(iso: string): void {
  try { localStorage.setItem(REFRESH_KEY, iso); } catch { /* storage off */ }
}

// Merge an auto-refresh's new games into what's already stored (no clear), then
// stamp the refresh date and keep the source card honest. Called even with an
// empty batch so the date advances and we don't re-fetch on the next open.
export async function mergeRefreshedGames(newGames: ImportedGame[]): Promise<void> {
  const now = new Date().toISOString();
  if (newGames.length) await saveGames(newGames); // put() dedupes by id
  const source = getGamesSource();
  if (source) {
    // Re-fetch the picture so a newly-set Chess.com avatar shows up after an
    // auto-refresh; keep the one we had if the lookup turns up nothing.
    const avatarUrl =
      (source.platform === 'chesscom' ? await fetchAvatar(source.username) : undefined) ??
      source.avatarUrl;
    setGamesSource({ ...source, syncedAt: now, count: await countGames(), avatarUrl });
    announceIdentityChange();
  }
  setLastGamesRefresh(now);
}

// ── Persistence shared by every "my games" caller ────────────────────────────

// Replace the stored games with this import and record where they came from.
// (Opponent scouting will later sink elsewhere; today every caller is "my games".)
export async function saveMyGames(
  games: ImportedGame[],
  meta: { platform: Platform; username: string; avatarUrl?: string },
): Promise<void> {
  const now = new Date().toISOString();
  await clearGames();
  await saveGames(games);
  setGamesSource({
    platform: meta.platform,
    username: meta.username,
    syncedAt: now,
    count: games.length,
    avatarUrl: meta.avatarUrl,
  });
  // A manual import counts as a refresh — reset the weekly auto-refresh window.
  setLastGamesRefresh(now);
  // Update the header picture / "you" strips for the new account.
  announceIdentityChange();
}

// ── Range chooser ─────────────────────────────────────────────────────────────

type RangeChoice = 1 | 3 | 12 | 'all';
const RANGE_OPTIONS: { value: RangeChoice; label: string }[] = [
  { value: 1, label: '1m' },
  { value: 3, label: '3m' },
  { value: 12, label: '12m' },
  { value: 'all', label: 'All' },
];
const DEFAULT_RANGE_CHOICE: RangeChoice = 12;
// "All" reaches ~100 years back; the 500-game cap stops the fetch early anyway.
const ALL_MONTHS = 1200;
function rangeMonths(r: RangeChoice): number {
  return r === 'all' ? ALL_MONTHS : r;
}

// Order the time-control toggles are shown in.
const TC_ORDER: TimeClass[] = ['bullet', 'blitz', 'rapid', 'daily'];

// ── How-many chooser (after the scan) ─────────────────────────────────────────

// The count choices offered in Step 2. We only surface a smaller slice when the
// scan actually held more than it — "Last 100" is pointless with 80 games. "All"
// is always offered and is already ≤ HARD_CAP.
const DEFAULT_COUNT: CountChoice = 'all';

// Default the how-many chooser to a phone-friendly 500 once there's more than
// that to choose from; otherwise keep everything the scan held. Big imports
// (All, up to the 1000 cap) noticeably slow the map and the board browser on a
// phone, so we don't reach for them by default — the user can opt up.
function defaultCountFor(total: number): CountChoice {
  return total > 500 ? 500 : 'all';
}

function countOptionsFor(total: number, truncated: boolean): { value: CountChoice; label: string }[] {
  const opts: { value: CountChoice; label: string }[] = [];
  if (total > 100) opts.push({ value: 100, label: 'Last 100' });
  if (total > 500) opts.push({ value: 500, label: 'Last 500' });
  // When the hard cap bit, "All" is the most recent HARD_CAP — spell it out.
  opts.push({ value: 'all', label: truncated ? `All (${HARD_CAP.toLocaleString()})` : 'All' });
  return opts;
}

// ── The panel ─────────────────────────────────────────────────────────────────

export interface ImportPanelOptions {
  // Prefill — defaults to the last-used platform and its saved username.
  platform?: Platform;
  username?: string;
  // Sheet title — defaults to "Import games". Scouting overrides it.
  title?: string;
  // Whether a successful scan remembers the typed username as *yours*. True for
  // "my games"; opponent scouting passes false so it doesn't clobber your handle.
  rememberUser?: boolean;
  // Where to persist the chosen games. Defaults to saveMyGames (replace "my
  // games"); opponent scouting passes its own sink.
  save?: (games: ImportedGame[], meta: { platform: Platform; username: string; avatarUrl?: string }) => Promise<void>;
  // Run after a successful import (games already saved): re-render badges etc.
  onImported?: (count: number) => void;
}

export function openImportPanel(opts: ImportPanelOptions = {}): void {
  let platform: Platform = opts.platform ?? getLastPlatform();
  let range: RangeChoice = DEFAULT_RANGE_CHOICE;
  let scan: ImportResult | null = null;
  let count: CountChoice = DEFAULT_COUNT;
  const selected = new Set<TimeClass>();

  // The full-screen scan loader (mounted only while a scan is running) and the
  // picture it found, captured here so the Import click can persist it.
  let loader: ImportLoader | null = null;
  let removeLoaderBack: (() => void) | null = null;
  let scanCancelled = false;
  let scannedAvatarUrl: string | undefined;

  function unmountLoader(): void {
    loader?.remove();
    loader = null;
    removeLoaderBack?.();
    removeLoaderBack = null;
  }

  // Step 2 (choose what to import) takes the whole screen — a clearer review
  // page with your picture, your results and the Import button pinned at the
  // bottom. Step 1 stays the compact bottom sheet, so we flip the shell's mode.
  function setFullScreen(on: boolean): void {
    overlay.classList.toggle('edit-overlay--full', on);
    sheet.classList.toggle('edit-sheet--full', on);
  }

  // ── Shell ──
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet import-sheet';

  // Lift the sheet above the on-screen keyboard while the username field is
  // focused, so the Scan/Import buttons stay reachable (mirrors the edit sheet).
  const vv = window.visualViewport;
  function syncKeyboardInset(): void {
    if (!vv) return;
    overlay.style.paddingBottom = `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`;
  }
  vv?.addEventListener('resize', syncKeyboardInset);
  vv?.addEventListener('scroll', syncKeyboardInset);

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    clearTimeout(hideBarTimer);
    unmountLoader();
    vv?.removeEventListener('resize', syncKeyboardInset);
    vv?.removeEventListener('scroll', syncKeyboardInset);
    overlay.remove();
    removeBack();
  }
  const removeBack = pushBack(close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const title = document.createElement('h3');
  title.className = 'edit-sheet-title';
  title.textContent = opts.title ?? 'Import games';
  sheet.appendChild(title);

  // Inline, friendly error line (unknown user, network, …). Never silent.
  const errorEl = document.createElement('p');
  errorEl.className = 'import-error';
  errorEl.hidden = true;
  errorEl.setAttribute('aria-live', 'assertive');
  sheet.appendChild(errorEl);
  const showError = (msg: string) => { errorEl.textContent = msg; errorEl.hidden = false; };
  const clearError = () => { errorEl.hidden = true; };

  // ── STEP 1 ──
  const step1 = document.createElement('div');
  step1.className = 'import-step';

  // Platform toggle.
  const platSeg = document.createElement('div');
  platSeg.className = 'seg-control import-platform';
  platSeg.setAttribute('role', 'group');
  const platButtons: HTMLButtonElement[] = [];
  for (const p of ['chesscom', 'lichess'] as Platform[]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg-btn';
    b.dataset.value = p;
    b.textContent = PLATFORM_LABELS[p];
    b.addEventListener('click', () => {
      if (platform === p) return;
      platform = p;
      reflectPlatform();
      userInput.value = opts.username ?? savedUsername(platform);
      userInput.placeholder = `your ${PLATFORM_LABELS[platform]} username`;
      resetScan();
    });
    platButtons.push(b);
    platSeg.appendChild(b);
  }
  const reflectPlatform = () => {
    for (const b of platButtons) {
      const on = b.dataset.value === platform;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  };
  reflectPlatform();
  step1.appendChild(field('Platform', platSeg));

  // Username.
  const userInput = document.createElement('input');
  userInput.type = 'text';
  userInput.className = 'settings-input';
  userInput.autocomplete = 'off';
  userInput.autocapitalize = 'none';
  userInput.spellcheck = false;
  userInput.placeholder = `your ${PLATFORM_LABELS[platform]} username`;
  userInput.value = opts.username ?? savedUsername(platform);
  userInput.addEventListener('input', resetScan);
  step1.appendChild(field('Username', userInput));

  // Range chips (single choice).
  const rangeRow = document.createElement('div');
  rangeRow.className = 'import-chips';
  const rangeChips: HTMLButtonElement[] = [];
  for (const opt of RANGE_OPTIONS) {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'tag-chip';
    c.textContent = opt.label;
    c.addEventListener('click', () => {
      range = opt.value;
      reflectRange();
      resetScan();
    });
    rangeChips.push(c);
    rangeRow.appendChild(c);
  }
  const reflectRange = () => {
    rangeChips.forEach((c, i) => c.classList.toggle('tag-chip--on', RANGE_OPTIONS[i].value === range));
  };
  reflectRange();
  step1.appendChild(field('How far back', rangeRow));

  // Scan button — the progress itself takes over the whole screen (the import
  // loader, mounted in runScan) rather than living inline in the sheet.
  const scanBtn = document.createElement('button');
  scanBtn.type = 'button';
  scanBtn.className = 'btn-primary import-scan-btn';
  scanBtn.textContent = 'Scan';
  scanBtn.addEventListener('click', runScan);
  step1.appendChild(scanBtn);

  // Holds the brief "leave the finished bar up for a beat" timer between a
  // successful scan and the loader handing off to step 2.
  let hideBarTimer: ReturnType<typeof setTimeout> | undefined;

  sheet.appendChild(step1);

  // ── STEP 2 (built fresh on each scan) ──
  const step2 = document.createElement('div');
  step2.className = 'import-step import-step2';
  step2.hidden = true;
  sheet.appendChild(step2);

  // ── Behaviour ──

  // A step-1 change makes any prior scan stale; clear step 2 and bring step 1
  // back into view (it's hidden while step 2 is up).
  function resetScan(): void {
    scan = null;
    count = DEFAULT_COUNT;
    selected.clear();
    scanCancelled = false;
    scannedAvatarUrl = undefined;
    step1.hidden = false;
    step2.hidden = true;
    step2.innerHTML = '';
    setFullScreen(false);
    clearTimeout(hideBarTimer);
    unmountLoader();
    // Bring the prominent Scan button back: editing step 1 invalidates the scan,
    // so the obvious next action is to scan again (step 2 hides its quiet link).
    scanBtn.hidden = false;
    scanBtn.textContent = 'Scan';
    clearError();
  }

  async function runScan(): Promise<void> {
    const user = userInput.value.trim();
    if (!user) { showError(`Enter your ${PLATFORM_LABELS[platform]} username first.`); return; }
    clearError();
    resetScan();
    if (opts.rememberUser !== false) setLastPlatform(platform);
    scanBtn.disabled = true;
    scanBtn.textContent = 'Scanning…';

    // The scan takes over the whole screen. "All" reaches an unknown end (the
    // 1000-game cap can trip in any month), so it stays indeterminate; the fixed
    // ranges switch to a proportional fill on the first progress with a real
    // total.
    const indeterminate = range === 'all';
    loader = createImportLoader();
    loader.start(indeterminate);
    loader.setStatus('Looking up your games…');
    document.body.appendChild(loader.el);
    // The system back gesture dismisses the loader and returns to step 1; the
    // in-flight fetch resolves into a closed loader harmlessly (scanCancelled
    // skips the step-2 hand-off).
    removeLoaderBack = pushBack(() => {
      scanCancelled = true;
      unmountLoader();
      scanBtn.disabled = false;
      scanBtn.textContent = 'Scan';
    });

    // Fetch the subject's Chess.com picture alongside the scan and fade it into
    // the loader the moment it lands — your picture for a my-games import, the
    // opponent's for a scout. Lichess has no public picture. The handler that
    // saves decides what to do with it (persist as my identity, or onto the
    // scouted opponent).
    if (platform === 'chesscom') {
      void fetchAvatar(user).then((url) => {
        if (!url) return;
        scannedAvatarUrl = url;
        loader?.setAvatar(url);
      });
    }

    try {
      const result = await importGames(platform, user, {
        months: rangeMonths(range),
        onProgress: (p) => {
          loader?.setStatus(p.monthsTotal > 1
            ? `Scanning ${p.label} (${p.monthsDone}/${p.monthsTotal}) — ${p.gamesSoFar} games so far…`
            : `${p.gamesSoFar} games so far…`);
          if (!indeterminate && p.monthsTotal > 1) loader?.set(p.monthsDone / p.monthsTotal);
        },
      });
      if (scanCancelled) return; // backed out mid-scan — drop the result quietly
      scan = result;
      if (opts.rememberUser !== false) saveUsername(platform, user); // remember for next time
      // Snap the pawn home, hold the finished bar for a beat, then let the loader
      // hand off to step 2's "Found N games".
      loader?.done();
      hideBarTimer = setTimeout(() => {
        if (scanCancelled) return; // backed out during the hold
        unmountLoader();
        buildStep2(result);
      }, 650);
    } catch (err) {
      if (scanCancelled) return;
      unmountLoader();
      showError(friendlyError(err, platform));
    } finally {
      scanBtn.disabled = false;
      scanBtn.textContent = 'Scan';
    }
  }

  function buildStep2(result: ImportResult): void {
    step2.innerHTML = '';
    const total = result.games.length; // newest-first, already ≤ HARD_CAP
    count = defaultCountFor(total);
    selected.clear();
    // A my-games import shows "your results"; a scout (rememberUser: false) is
    // the opponent's games, so the same graph reads "their results".
    const isMine = opts.rememberUser !== false;

    // Step 2 takes over the whole screen: hide step 1 (platform / username /
    // range) and switch the shell to full-screen so the review reads cleanly.
    // The big Scan button goes with it; "Edit search" brings step 1 back.
    step1.hidden = true;
    scanBtn.hidden = true;
    setFullScreen(true);

    // Header: the step heading + an "Edit search" link that reveals step 1 again
    // (to change platform, username or range, then Scan afresh).
    const head = document.createElement('div');
    head.className = 'import-step2-head';
    const heading = document.createElement('h4');
    heading.className = 'import-step-title';
    heading.textContent = 'Choose what to import';
    head.appendChild(heading);
    const editSearch = document.createElement('button');
    editSearch.type = 'button';
    editSearch.className = 'import-rescan-link';
    editSearch.textContent = '← Edit search';
    editSearch.addEventListener('click', () => {
      step1.hidden = false;
      step2.hidden = true;
      scanBtn.hidden = false;
      setFullScreen(false);
      clearError();
    });
    head.appendChild(editSearch);
    step2.appendChild(head);

    // Scrollable body holds everything above the pinned footer.
    const body = document.createElement('div');
    body.className = 'import-step2-body';
    step2.appendChild(body);

    // Your picture leads the screen (Chess.com only; Lichess / none → icon).
    const avatarRow = document.createElement('div');
    avatarRow.className = 'import-step2-avatar';
    avatarRow.appendChild(userAvatar(scannedAvatarUrl, 72));
    body.appendChild(avatarRow);

    // Whose games these are — the username field now lives only in step 1, so
    // echo the source here so it's never lost.
    const source = document.createElement('p');
    source.className = 'import-source';
    source.textContent = `@${userInput.value.trim()} · ${PLATFORM_LABELS[result.platform]}`;
    body.appendChild(source);

    // "Found N games" — the true count in range. If the hard cap bit, there are
    // genuinely more than HARD_CAP and we say so.
    const found = document.createElement('p');
    found.className = 'import-found';
    found.textContent = result.truncated
      ? `Found more than ${HARD_CAP.toLocaleString()} games in this range.`
      : `Found ${total.toLocaleString()} game${total === 1 ? '' : 's'}.`;
    body.appendChild(found);

    if (total === 0) {
      const none = document.createElement('p');
      none.className = 'import-status';
      none.textContent = 'Nothing to import in this range — try a longer range.';
      body.appendChild(none);
      step2.hidden = false;
      return;
    }

    // Your won/lost graph for exactly the games that will land — updated live as
    // you change the count / time-control selection.
    const wdlWrap = document.createElement('div');
    wdlWrap.className = 'import-wdl';
    body.appendChild(wdlWrap);

    // Seed the time-control selection once from the defaults present in the full
    // scan (bullet OFF). It then stays stable as the count slice changes.
    const fullTally = tallyTimeClasses(result.games);
    for (const tc of TC_ORDER) {
      if (fullTally.byTimeClass[tc] > 0 && DEFAULT_TIME_CLASSES.includes(tc)) selected.add(tc);
    }

    // ── How many to import (Last 100 / Last 500 / All) ──
    const countOpts = countOptionsFor(total, result.truncated);
    if (countOpts.length > 1) {
      const countLabel = document.createElement('div');
      countLabel.className = 'edit-label';
      countLabel.textContent = 'How many';
      body.appendChild(countLabel);

      const countRow = document.createElement('div');
      countRow.className = 'import-chips';
      const countChips: HTMLButtonElement[] = [];
      countOpts.forEach((opt) => {
        const c = document.createElement('button');
        c.type = 'button';
        c.className = 'tag-chip' + (opt.value === count ? ' tag-chip--on' : '');
        c.textContent = opt.label;
        c.addEventListener('click', () => {
          count = opt.value;
          countChips.forEach((b, i) => b.classList.toggle('tag-chip--on', countOpts[i].value === count));
          renderSlice();
        });
        countChips.push(c);
        countRow.appendChild(c);
      });
      body.appendChild(countRow);
    }

    // ── Large-import warning (rebuilt per slice — only shown for big "All") ──
    const capNote = document.createElement('div');
    capNote.className = 'import-cap-note';
    capNote.hidden = true;
    body.appendChild(capNote);

    // ── Which to import (time-control toggles, counts reflect the slice) ──
    const tcLabel = document.createElement('div');
    tcLabel.className = 'edit-label';
    tcLabel.textContent = 'Which to import';
    body.appendChild(tcLabel);

    const tcRow = document.createElement('div');
    tcRow.className = 'import-chips';
    body.appendChild(tcRow);

    // ── Pinned footer: the split, a status line, and the Import button ──
    const footer = document.createElement('div');
    footer.className = 'import-step2-footer';
    step2.appendChild(footer);

    // White/Black split of exactly what will land — useful context for an
    // openings trainer, where each colour is mapped on its own.
    const splitNote = document.createElement('p');
    splitNote.className = 'import-split';
    splitNote.hidden = true;
    footer.appendChild(splitNote);

    const importStatus = document.createElement('p');
    importStatus.className = 'import-status';
    importStatus.setAttribute('aria-live', 'polite');
    footer.appendChild(importStatus);

    // Import button — always shows the resulting count.
    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'btn-primary import-go-btn';
    footer.appendChild(importBtn);

    // The games for the current count choice, newest-first.
    const sliceGames = () => takeNewest(result.games, count);

    // Re-render the time-control toggles (counts within the current slice) and
    // the cap note, then refresh the import button's count.
    function renderSlice(): void {
      const slice = sliceGames();
      const tally = tallyTimeClasses(slice);

      // Large-import warning ("alert mode"): "All" can pull up to the 1000 cap,
      // which makes the map and the board browser sluggish on a phone. Warn
      // whenever All is chosen and it lands a big batch (the cap bit, or > 500).
      // The smaller slices are a deliberate, safe choice — no warning.
      const bigImport = count === 'all' && (result.truncated || slice.length > 500);
      if (bigImport) {
        capNote.innerHTML = '';
        capNote.appendChild(warnIcon());
        const msg = document.createElement('span');
        msg.textContent = result.truncated
          ? `Importing the most recent ${HARD_CAP.toLocaleString()} games — the cap. Big imports make the map and the board browser slow on a phone; around 500 keeps it snappy.`
          : `Importing all ${slice.length.toLocaleString()} games. More than ~500 can make the map and the board browser slow on a phone.`;
        capNote.appendChild(msg);
        capNote.hidden = false;
      } else {
        capNote.hidden = true;
      }

      tcRow.innerHTML = '';
      for (const tc of TC_ORDER) {
        const n = tally.byTimeClass[tc];
        if (n === 0) continue;
        const on = selected.has(tc);
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'tag-chip' + (on ? ' tag-chip--on' : '');
        chip.textContent = `${TIME_CLASS_LABELS[tc]} ${n}`;
        chip.addEventListener('click', () => {
          if (selected.has(tc)) { selected.delete(tc); chip.classList.remove('tag-chip--on'); }
          else { selected.add(tc); chip.classList.add('tag-chip--on'); }
          reflectImportCount();
        });
        tcRow.appendChild(chip);
      }
      reflectImportCount();
    }

    function reflectImportCount(): void {
      const games = filterByTimeClasses(sliceGames(), selected);
      const n = games.length;
      importBtn.textContent = n === 0
        ? 'Pick at least one'
        : `Import ${n.toLocaleString()} game${n === 1 ? '' : 's'}`;
      importBtn.disabled = n === 0;

      // Your won/lost graph for exactly what will land (hidden when nothing is).
      wdlWrap.innerHTML = '';
      if (n > 0) {
        const s = summariseGames(games);
        const scorePct = Math.round(((s.wins + s.draws / 2) / n) * 100);
        wdlWrap.appendChild(wdlBlock(
          { wins: s.wins, draws: s.draws, losses: s.losses, scorePct, games: n },
          isMine ? 'your results' : `${userInput.value.trim()}'s results`,
        ));
      }

      if (n === 0) {
        splitNote.hidden = true;
      } else {
        const white = games.filter(g => g.colour === 'white').length;
        splitNote.textContent = `${white.toLocaleString()} as White · ${(n - white).toLocaleString()} as Black`;
        splitNote.hidden = false;
      }
    }

    importBtn.addEventListener('click', async () => {
      const games = filterByTimeClasses(sliceGames(), selected);
      if (games.length === 0) return;
      importBtn.disabled = true;
      scanBtn.disabled = true;
      importStatus.textContent = 'Saving to this device…';
      try {
        const persist = opts.save ?? saveMyGames;
        await persist(games, {
          platform: result.platform,
          username: userInput.value.trim(),
          avatarUrl: scannedAvatarUrl,
        });
        close();
        showToast(
          `Imported ${games.length.toLocaleString()} game${games.length === 1 ? '' : 's'}`,
          { variant: 'success' },
        );
        opts.onImported?.(games.length);
      } catch (err) {
        showError(`Couldn’t save your games — ${(err as Error).message}`);
        importBtn.disabled = false;
        scanBtn.disabled = false;
        importStatus.textContent = '';
      }
    });

    renderSlice();
    step2.hidden = false;
  }

  document.body.appendChild(overlay);
  overlay.appendChild(sheet);
  // Focus the username if it's empty so the keyboard is ready.
  if (!userInput.value) setTimeout(() => userInput.focus(), 50);
}

// A small triangle-bang glyph for the large-import warning.
function warnIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('import-cap-icon');
  svg.innerHTML = '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>';
  return svg;
}

// A titled control block, matching the sheet's label style.
function field(labelText: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'import-field';
  const l = document.createElement('div');
  l.className = 'edit-label';
  l.textContent = labelText;
  wrap.appendChild(l);
  wrap.appendChild(control);
  return wrap;
}

// Turn whatever the fetch threw into a friendly, human line.
function friendlyError(err: unknown, platform: Platform): string {
  // fetch() rejects with a TypeError on a network/CORS/offline failure.
  if (err instanceof TypeError) {
    return `Couldn’t reach ${PLATFORM_LABELS[platform]} — check your connection and try again.`;
  }
  const msg = (err as Error)?.message ?? '';
  return msg || 'Something went wrong — try again.';
}
