// The one import panel — a two-step bottom sheet used everywhere games come in
// ("Refresh my games" in Settings and on the From-my-games tab today; the
// onboarding import and opponent scouting later). It owns the whole flow:
//
//   STEP 1 — pick a platform (Chess.com / Lichess), a username, and how far back
//            to look (1m / 3m / 12m / All), then Scan.
//   STEP 2 — "Found N games", a how-many chooser (Last 100 / Last 500 / All), a
//            row of time-control toggles each showing its count (bullet OFF by
//            default), a cap notice if the 1000-game hard cap was hit, and an
//            Import button that always shows the resulting count.
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
} from './chesscom';
import {
  getUsername as getLichessUser,
  setUsername as setLichessUser,
} from './lichess';
import { clearGames, saveGames, countGames } from './storage';
import { pushBack } from './back-nav';

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
    setGamesSource({ ...source, syncedAt: now, count: await countGames() });
  }
  setLastGamesRefresh(now);
}

// ── Persistence shared by every "my games" caller ────────────────────────────

// Replace the stored games with this import and record where they came from.
// (Opponent scouting will later sink elsewhere; today every caller is "my games".)
export async function saveMyGames(
  games: ImportedGame[],
  meta: { platform: Platform; username: string },
): Promise<void> {
  const now = new Date().toISOString();
  await clearGames();
  await saveGames(games);
  setGamesSource({
    platform: meta.platform,
    username: meta.username,
    syncedAt: now,
    count: games.length,
  });
  // A manual import counts as a refresh — reset the weekly auto-refresh window.
  setLastGamesRefresh(now);
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
// is always offered and is already ≤ HARD_CAP. Default to All so the user keeps
// everything they scanned unless they deliberately trim it.
const DEFAULT_COUNT: CountChoice = 'all';

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
  save?: (games: ImportedGame[], meta: { platform: Platform; username: string }) => Promise<void>;
  // Run after a successful import (games already saved): re-render badges etc.
  onImported?: (count: number) => void;
}

export function openImportPanel(opts: ImportPanelOptions = {}): void {
  let platform: Platform = opts.platform ?? getLastPlatform();
  let range: RangeChoice = DEFAULT_RANGE_CHOICE;
  let scan: ImportResult | null = null;
  let count: CountChoice = DEFAULT_COUNT;
  const selected = new Set<TimeClass>();

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

  // Scan button + progress.
  const scanBtn = document.createElement('button');
  scanBtn.type = 'button';
  scanBtn.className = 'btn-primary import-scan-btn';
  scanBtn.textContent = 'Scan';
  const scanStatus = document.createElement('p');
  scanStatus.className = 'import-status';
  scanStatus.setAttribute('aria-live', 'polite');
  scanBtn.addEventListener('click', runScan);
  step1.appendChild(scanBtn);
  step1.appendChild(scanStatus);

  sheet.appendChild(step1);

  // ── STEP 2 (built fresh on each scan) ──
  const step2 = document.createElement('div');
  step2.className = 'import-step import-step2';
  step2.hidden = true;
  sheet.appendChild(step2);

  // ── Behaviour ──

  // A step-1 change makes any prior scan stale; clear step 2.
  function resetScan(): void {
    scan = null;
    count = DEFAULT_COUNT;
    selected.clear();
    step2.hidden = true;
    step2.innerHTML = '';
    scanStatus.textContent = '';
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
    scanStatus.textContent = 'Looking up your games…';
    try {
      const result = await importGames(platform, user, {
        months: rangeMonths(range),
        onProgress: (p) => {
          scanStatus.textContent = p.monthsTotal > 1
            ? `Scanning ${p.label} (${p.monthsDone}/${p.monthsTotal}) — ${p.gamesSoFar} games so far…`
            : `${p.gamesSoFar} games so far…`;
        },
      });
      scan = result;
      if (opts.rememberUser !== false) saveUsername(platform, user); // remember for next time
      scanStatus.textContent = '';
      buildStep2(result);
    } catch (err) {
      showError(friendlyError(err, platform));
      scanStatus.textContent = '';
    } finally {
      scanBtn.disabled = false;
      scanBtn.textContent = scan ? 'Re-scan' : 'Scan';
    }
  }

  function buildStep2(result: ImportResult): void {
    step2.innerHTML = '';
    count = DEFAULT_COUNT;
    selected.clear();
    const total = result.games.length; // newest-first, already ≤ HARD_CAP

    // "Found N games" — the true count in range. If the hard cap bit, there are
    // genuinely more than HARD_CAP and we say so.
    const found = document.createElement('p');
    found.className = 'import-found';
    found.textContent = result.truncated
      ? `Found more than ${HARD_CAP.toLocaleString()} games in this range.`
      : `Found ${total.toLocaleString()} game${total === 1 ? '' : 's'}.`;
    step2.appendChild(found);

    if (total === 0) {
      const none = document.createElement('p');
      none.className = 'import-status';
      none.textContent = 'Nothing to import in this range — try a longer range.';
      step2.appendChild(none);
      step2.hidden = false;
      return;
    }

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
      step2.appendChild(countLabel);

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
      step2.appendChild(countRow);
    }

    // ── Cap notice (rebuilt per slice — only honest for the chosen count) ──
    const capNote = document.createElement('p');
    capNote.className = 'import-cap-note';
    capNote.hidden = true;
    step2.appendChild(capNote);

    // ── Which to import (time-control toggles, counts reflect the slice) ──
    const tcLabel = document.createElement('div');
    tcLabel.className = 'edit-label';
    tcLabel.textContent = 'Which to import';
    step2.appendChild(tcLabel);

    const tcRow = document.createElement('div');
    tcRow.className = 'import-chips';
    step2.appendChild(tcRow);

    // Import button — always shows the resulting count.
    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'btn-primary import-go-btn';
    step2.appendChild(importBtn);

    const importStatus = document.createElement('p');
    importStatus.className = 'import-status';
    importStatus.setAttribute('aria-live', 'polite');
    step2.appendChild(importStatus);

    // The games for the current count choice, newest-first.
    const sliceGames = () => takeNewest(result.games, count);

    // Re-render the time-control toggles (counts within the current slice) and
    // the cap note, then refresh the import button's count.
    function renderSlice(): void {
      const slice = sliceGames();
      const tally = tallyTimeClasses(slice);

      // Cap note: only when "All" is chosen AND the hard cap actually bit. The
      // smaller slices are a deliberate choice, not a forced truncation.
      if (count === 'all' && result.truncated) {
        capNote.textContent = `More than ${HARD_CAP.toLocaleString()} games found — importing only the most recent ${HARD_CAP.toLocaleString()} (phone-friendly cap).`;
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
      const n = filterByTimeClasses(sliceGames(), selected).length;
      importBtn.textContent = n === 0
        ? 'Pick at least one'
        : `Import ${n.toLocaleString()} game${n === 1 ? '' : 's'}`;
      importBtn.disabled = n === 0;
    }

    importBtn.addEventListener('click', async () => {
      const games = filterByTimeClasses(sliceGames(), selected);
      if (games.length === 0) return;
      importBtn.disabled = true;
      scanBtn.disabled = true;
      importStatus.textContent = 'Saving to this device…';
      try {
        const persist = opts.save ?? saveMyGames;
        await persist(games, { platform: result.platform, username: userInput.value.trim() });
        close();
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
