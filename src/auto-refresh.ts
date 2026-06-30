// The weekly games auto-refresh. A PWA without a service worker can't wake
// itself, so this runs only when the app opens — which, in practice, lands at
// roughly weekly. On startup (after the first view renders, never blocking
// launch) it quietly pulls only the games played since the last refresh, merges
// them exactly as a manual import would (dedupe included), advances the refresh
// date, and reports any new games with a toast. Failures — offline, an API
// hiccup — are silent; the next open simply tries again.

import { getGamesSource, getLastGamesRefresh, mergeRefreshedGames } from './import-panel';
import { getAllGames } from './storage';
import { importGames, DEFAULT_TIME_CLASSES, type TimeClass, type ImportedGame } from './import-games';

const ENABLED_KEY = 'obertura.autoRefreshGames';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// On by default. It only does anything once a username has been saved by a
// previous import, so it's safe to leave on for everyone.
export function getAutoRefreshEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) !== 'off';
}

export function setAutoRefreshEnabled(on: boolean): void {
  localStorage.setItem(ENABLED_KEY, on ? 'on' : 'off');
}

// Re-exported so Settings can show the "Last refreshed X days ago" caption from
// one import.
export { getLastGamesRefresh } from './import-panel';

// How many calendar months back to ask for so the fetch fully covers everything
// since the last refresh. +1 keeps the boundary month (e.g. refreshed on the 2nd
// of this month still needs last month's archive) — the per-game date/dedupe
// filter trims any overlap precisely afterwards.
function monthsSince(fromIso: string): number {
  const from = new Date(fromIso);
  const now = new Date();
  const span = (now.getFullYear() - from.getFullYear()) * 12 + (now.getMonth() - from.getMonth());
  return Math.max(1, span + 1);
}

// Which time controls to keep. Mirror what's already on the device (so a user who
// opted bullet in — or rapid-only — keeps getting the same), falling back to the
// manual-import default (everything but bullet) if the store is somehow empty.
function allowedTimeClasses(existing: ImportedGame[]): Set<TimeClass> {
  const present = new Set(existing.map((g) => g.timeClass));
  return present.size ? present : new Set(DEFAULT_TIME_CLASSES);
}

// Pull the latest games right now — the My-games "Refresh" button — bypassing
// the weekly gate and the enabled flag. Returns how many genuinely new games
// were merged. Throws 'no-source' when no username is saved yet (the button
// should be hidden then) and rethrows fetch failures so the caller can report
// them. Always merges (even an empty batch) so the refresh date advances.
export async function refreshGamesNow(): Promise<number> {
  const source = getGamesSource();
  if (!source) throw new Error('no-source');

  // Cover everything since the last refresh; fall back to a 3-month window when
  // there's no recorded baseline yet.
  const lastIso = getLastGamesRefresh();
  const months = lastIso ? monthsSince(lastIso) : 3;

  const result = await importGames(source.platform, source.username, { months });
  const existing = await getAllGames();
  const allowed = allowedTimeClasses(existing);
  const existingIds = new Set(existing.map((g) => g.id));
  const fresh = result.games.filter(
    (g) => allowed.has(g.timeClass) && !existingIds.has(g.id),
  );
  await mergeRefreshedGames(fresh); // also advances the refresh date
  return fresh.length;
}

// Run the weekly refresh if it's due. Returns how many genuinely new games were
// merged (0 when off, not connected, not yet due, or on any failure). Never
// throws — the caller can fire-and-forget it after the first paint.
export async function maybeAutoRefreshGames(): Promise<number> {
  if (!getAutoRefreshEnabled()) return 0;

  const source = getGamesSource();
  if (!source) return 0; // no username saved yet — nothing to refresh

  const lastIso = getLastGamesRefresh();
  if (!lastIso) return 0;
  const lastMs = new Date(lastIso).getTime();
  if (!Number.isFinite(lastMs)) return 0;
  if (Date.now() - lastMs < WEEK_MS) return 0; // refreshed within the week

  try {
    const result = await importGames(source.platform, source.username, {
      months: monthsSince(lastIso),
    });
    const existing = await getAllGames();
    const allowed = allowedTimeClasses(existing);
    const existingIds = new Set(existing.map((g) => g.id));
    const fresh = result.games.filter(
      (g) => allowed.has(g.timeClass) && !existingIds.has(g.id),
    );
    await mergeRefreshedGames(fresh); // also advances the refresh date
    return fresh.length;
  } catch {
    return 0; // offline / API hiccup — leave the date be and retry next open
  }
}
