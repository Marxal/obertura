import type { Line } from './types';
import type { MoveNode } from './tree';
import type { ImportedGame } from './chesscom';
import type { Opponent } from './scout';
import {
  allNodes, DEFAULT_REPERTOIRE_NAMES, emptyTree, lineTailStart, removeSubtree,
  type Repertoire,
} from './repertoire';
import {
  applyLineWrite, locateLine, mergeLineIntoRepertoire, mergeRepertoireInto,
  projectLines, projectRepertoire,
} from './lines-view';
import { migrateLines } from './repertoire-migrate';

// Thin IndexedDB wrapper. IndexedDB's native API is event-based: every call
// returns a request and you attach onsuccess / onerror handlers. This module
// wraps those requests in Promises so the rest of the app can just `await`.
//
// WHAT IS STORED, since the redesign: repertoires. A repertoire is one book of
// one colour holding ONE move tree, and a "line" is a path through it, derived
// on read (see repertoire.ts / lines-view.ts / REPERTOIRE-REDESIGN.md).
//
// The line-shaped API below — getAllLines, getLine, saveLine, deleteLine — is
// kept exactly as it was, and now projects out of the trees and writes back into
// them. That is deliberate: fifty-odd modules consume Lines, and none of them
// needed to change for the model underneath to.

const DB_NAME = 'obertura';
// v2 adds the 'games' store for Chess.com imports (see chesscom.ts).
// v3 adds the 'opponents' store for Explore scouting (see scout.ts).
// v4 adds the 'repertoires' store. The old 'lines' store is deliberately LEFT
// IN PLACE and untouched after migration, as a rollback for one version.
const DB_VERSION = 4;
const STORE = 'lines';
const GAMES_STORE = 'games';
const OPPONENTS_STORE = 'opponents';
const REPERTOIRES_STORE = 'repertoires';

// Wrap a single IndexedDB request in a Promise (the core of "no onsuccess
// handlers for callers"): resolve on success with its result, reject on error.
function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Open the database once and reuse the connection promise for the life of the
// page. We don't cache the IDBDatabase itself — we cache the promise — so a
// page reload re-runs this module and rebuilds it cleanly from scratch.
let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    // Runs only on first open (or version bump): create object stores. Each is
    // guarded by a `contains` check so upgrades from any prior version are safe.
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(GAMES_STORE)) {
        // Keyed by the game's id so re-imports overwrite instead of duplicating.
        // The endTime index lets later phases scan games newest-first cheaply.
        const games = db.createObjectStore(GAMES_STORE, { keyPath: 'id' });
        games.createIndex('endTime', 'endTime');
      }
      if (!db.objectStoreNames.contains(OPPONENTS_STORE)) {
        // One self-contained record per scouted opponent (games + precomputed
        // maps), keyed by id so deleting one wipes everything stored for them.
        db.createObjectStore(OPPONENTS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(REPERTOIRES_STORE)) {
        // One record per book, holding its whole move tree. Populated from the
        // old 'lines' store by ensureMigrated() on the first read, not here —
        // an upgrade transaction is the wrong place to run a long merge, and
        // doing it lazily means a fresh install pays nothing.
        db.createObjectStore(REPERTOIRES_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    // Another tab still holding the old version open blocks a DB_VERSION bump,
    // and without this the open would hang forever (no success, no error) and
    // leave every data screen stuck on "Loading…". Reject with a clear message
    // the screens' load-error panels can show.
    request.onblocked = () =>
      reject(new Error('Another tab has Bito Chess open. Close it and reload.'));
  });
  return dbPromise;
}

async function store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openDB();
  return db.transaction(STORE, mode).objectStore(STORE);
}

// ── Repertoire change notifications ──────────────────────────────────────────
//
// Lets interested modules (the account sync in repertoire-sync.ts) react to
// repertoire writes without this module importing them back — that would be a
// circular dependency. Listeners fire after the write committed.
// eraseAllData deliberately does NOT notify: auto-uploading an empty
// repertoire right after an erase would destroy the cloud copy the user may
// still want to restore from.

const linesListeners: (() => void)[] = [];

export function onLinesChanged(listener: () => void): void {
  linesListeners.push(listener);
}

function notifyLinesChanged(): void {
  for (const listener of linesListeners) listener();
}

// The same idea for the games store, kept as a SEPARATE channel because the two
// have wildly different weights: the lines + app-state snapshot is a few hundred
// KB, while a thousand games carrying saved analysis is measured in megabytes.
// The account sync pushes them to different columns off these two notifiers, so
// editing a line doesn't drag the games blob along with it (see
// repertoire-sync.ts). Nothing else subscribes: the manual export reads both
// stores on demand, so it needs no notification at all.
//
// Same erase exemption as above, for the same reason: eraseAllData clears the
// games store through its own transaction and never calls the helpers below, so
// wiping the device can't push an empty games list over the account's copy.

const gamesListeners: (() => void)[] = [];

export function onGamesChanged(listener: () => void): void {
  gamesListeners.push(listener);
}

function notifyGamesChanged(): void {
  for (const listener of gamesListeners) listener();
}

// ── Repertoires ──────────────────────────────────────────────────────────────

async function repStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openDB();
  return db.transaction(REPERTOIRES_STORE, mode).objectStore(REPERTOIRES_STORE);
}

// The one-time move from the old flat 'lines' store to trees. Runs lazily on the
// first repertoire read rather than in the upgrade transaction: an upgrade is
// the wrong place for a long merge, and a fresh install never pays for it.
//
// The promise is cached, so a burst of concurrent reads at boot (My Lines, the
// Train hub and the position index all ask at once) migrates once.
let migration: Promise<void> | null = null;

let lastMigrationReport: ReturnType<typeof migrateLines>['report'] | null = null;

/** What the migration did, for the notice the app shows once. Null if it didn't run. */
export function takeMigrationReport(): typeof lastMigrationReport {
  const r = lastMigrationReport;
  lastMigrationReport = null;
  return r;
}

function ensureMigrated(): Promise<void> {
  if (!migration) migration = runMigration();
  return migration;
}

async function runMigration(): Promise<void> {
  const existing = await promisify((await repStore('readonly')).count());
  if (existing > 0) return; // already migrated (or already using the new model)

  const oldLines: Line[] = await promisify((await store('readonly')).getAll());
  if (oldLines.length === 0) return; // fresh install: nothing to move

  const { repertoires, report } = migrateLines(oldLines.map(reviveLine));
  const s = await repStore('readwrite');
  for (const rep of repertoires) s.put(rep);
  await txnDone(s.transaction);
  lastMigrationReport = report;
  // The old store is left exactly as it was. It is the rollback for one
  // version, and nothing reads it again unless a migration has to be re-run.
}

/** Every book, oldest first. Migrates on the first call if it needs to. */
export async function getAllRepertoires(): Promise<Repertoire[]> {
  await ensureMigrated();
  const all: Repertoire[] = await promisify((await repStore('readonly')).getAll());
  return all
    .map(reviveRepertoire)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export async function getRepertoire(id: string): Promise<Repertoire | undefined> {
  await ensureMigrated();
  const rep: Repertoire | undefined = await promisify((await repStore('readonly')).get(id));
  return rep ? reviveRepertoire(rep) : undefined;
}

export async function saveRepertoire(rep: Repertoire): Promise<Repertoire> {
  const s = await repStore('readwrite');
  await promisify(s.put(rep));
  notifyLinesChanged();
  return rep;
}

/** Write several books in one transaction — a restore, a sync, a migration. */
export async function saveRepertoires(reps: Repertoire[]): Promise<void> {
  if (reps.length === 0) return;
  const s = await repStore('readwrite');
  for (const rep of reps) s.put(rep);
  await txnDone(s.transaction);
  notifyLinesChanged();
}

export async function deleteRepertoire(id: string): Promise<void> {
  const s = await repStore('readwrite');
  await promisify(s.delete(id));
  notifyLinesChanged();
}

/** Replace every book with these — the clean-restore path. */
export async function replaceAllRepertoires(reps: Repertoire[]): Promise<void> {
  const s = await repStore('readwrite');
  s.clear();
  for (const rep of reps) s.put(rep);
  await txnDone(s.transaction);
  notifyLinesChanged();
}

/**
 * The book a line of this colour belongs in when nothing said otherwise —
 * the oldest non-archived one, or a freshly created default. Every path that
 * saves a line without naming a repertoire (a starter pack, an import, the
 * onboarding walkthrough) lands here.
 */
export async function defaultRepertoireFor(colour: 'white' | 'black'): Promise<Repertoire> {
  const all = await getAllRepertoires();
  const found = all.find(r => r.colour === colour && !r.archived);
  if (found) return found;
  const rep: Repertoire = {
    id: `rep-${colour}`,
    name: DEFAULT_REPERTOIRE_NAMES[colour],
    colour,
    tree: emptyTree(),
    createdAt: Date.now(),
  };
  // A book with this id may already exist as an archived one; keep ids unique.
  if (all.some(r => r.id === rep.id)) rep.id = `rep-${colour}-${Date.now().toString(36)}`;
  await saveRepertoire(rep);
  return rep;
}

// `review.due` is a Date. IndexedDB preserves Dates, but a record that arrived
// through JSON (a restore, a sync payload) carries an ISO string instead, and
// the scheduler compares it directly.
function reviveRepertoire(rep: Repertoire): Repertoire {
  reviveTree(rep.tree);
  return rep;
}

function reviveLine(line: Line): Line {
  reviveTree(line.tree);
  return line;
}

// ── Lines: the derived view ──────────────────────────────────────────────────
//
// Everything below projects out of the trees above. The signatures are the ones
// the app has always used, so the fifty-odd modules that read lines are unaware
// the model changed.

/** Every derived line across every book. */
export async function getAllLines(): Promise<Line[]> {
  return projectLines(await getAllRepertoires());
}

/** One derived line by id, or undefined when it no longer exists. */
export async function getLine(id: string): Promise<Line | undefined> {
  const reps = await getAllRepertoires();
  const found = locateLine(reps, id);
  if (!found) return undefined;
  return projectRepertoire(found.repertoire).find(l => l.id === id);
}

/**
 * Write a Line back.
 *
 * Two jobs, decided by whether the line still exists in a tree:
 *
 *  • KNOWN LINE — write its per-move records (this is how a drill's grading
 *    lands) and its line-level metadata onto the nodes it came from. Its moves
 *    are not re-read from the projection: changing a line's MOVES is the
 *    builder's business and goes through the repertoire API, not through here.
 *
 *  • UNKNOWN LINE — a line built from scratch by something that predates the
 *    redesign (a starter pack, a game import, the onboarding walkthrough).
 *    Its path is MERGED into the default book for its colour, which is exactly
 *    the no-duplicates behaviour: importing a line you already have adds nothing.
 *
 * Returns the line as it now exists — with its real id, which for a newly
 * merged line is not the id it came in with.
 */
export async function saveLine(line: Line): Promise<Line> {
  const reps = await getAllRepertoires();
  const found = locateLine(reps, line.id);
  if (found) {
    applyLineWrite(reps, line);
    await saveRepertoire(found.repertoire);
    return projectRepertoire(found.repertoire).find(l => l.id === line.id) ?? line;
  }
  return mergeLineInto(await defaultRepertoireFor(line.colour), line);
}

/**
 * Merge a line's moves into a book and carry its metadata onto the end node.
 * Shared by saveLine's unknown-line path and the backup restore.
 */
export async function mergeLineInto(rep: Repertoire, line: Line): Promise<Line> {
  const merged = mergeLineIntoRepertoire(rep, line);
  if (!merged) return line; // no moves — nothing to store
  await saveRepertoire(rep);
  return merged;
}

/**
 * Remove a line — which means removing the moves that belong to IT ALONE.
 *
 * The cut is the deepest ancestor whose subtree holds only this line (see
 * repertoire.lineTailStart), so the moves it shares with its neighbours survive.
 * That distinction is the one the flat-line model could not make: deleting a
 * line there either took moves other lines still needed, or left the shared
 * opening behind with nothing attached to it.
 */
export async function deleteLine(id: string): Promise<void> {
  const reps = await getAllRepertoires();
  const found = locateLine(reps, id);
  if (!found) return;
  // A line that ends INSIDE a longer one owns no moves of its own — it exists
  // only as a mark, so deleting it is unmarking it. Cutting here would take the
  // longer line's moves with it.
  if (found.end.children.length > 0) {
    delete found.end.endpoint;
  } else {
    const cut = lineTailStart(found.repertoire.tree, found.end.id);
    if (!cut) return;
    removeSubtree(found.repertoire.tree, cut.id);
  }
  await saveRepertoire(found.repertoire);
}

// ── Imported Chess.com games ───────────────────────────────────────────────────

async function gamesStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openDB();
  return db.transaction(GAMES_STORE, mode).objectStore(GAMES_STORE);
}

// Bulk insert/overwrite games in a single transaction — far cheaper than one
// transaction per game when importing thousands. Duplicates (same id) just
// overwrite, so re-running an import is safe and idempotent.
export async function saveGames(games: ImportedGame[]): Promise<void> {
  if (games.length === 0) return;
  const s = await gamesStore('readwrite');
  await Promise.all(games.map(g => promisify(s.put(g))));
  notifyGamesChanged();
}

// Every stored game.
export async function getAllGames(): Promise<ImportedGame[]> {
  const s = await gamesStore('readonly');
  return promisify(s.getAll());
}

// One stored game by id (e.g. to attach/restore its saved analysis).
export async function getGame(id: string): Promise<ImportedGame | undefined> {
  const s = await gamesStore('readonly');
  return promisify(s.get(id));
}

// How many games are stored — used by the import readout without loading them all.
export async function countGames(): Promise<number> {
  const s = await gamesStore('readonly');
  return promisify(s.count());
}

// Wipe all imported games (e.g. before a fresh re-import).
export async function clearGames(): Promise<void> {
  const s = await gamesStore('readwrite');
  await promisify(s.clear());
  notifyGamesChanged();
}

// Remove one game by id (the My games card's delete action).
export async function deleteGame(id: string): Promise<void> {
  const s = await gamesStore('readwrite');
  await promisify(s.delete(id));
  notifyGamesChanged();
}

// ── Scouted opponents ──────────────────────────────────────────────────────────
//
// Each opponent is one self-contained record (their imported games plus the two
// precomputed opening-map trees). Stored separately from "my games" so the two
// never collide; deleting a record removes everything kept for that opponent.

async function opponentsStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openDB();
  return db.transaction(OPPONENTS_STORE, mode).objectStore(OPPONENTS_STORE);
}

// Insert or overwrite an opponent by id (a refresh keeps the same id).
export async function saveOpponent(opp: Opponent): Promise<void> {
  const s = await opponentsStore('readwrite');
  await promisify(s.put(opp));
}

// Every stored opponent.
export async function getAllOpponents(): Promise<Opponent[]> {
  const s = await opponentsStore('readonly');
  return promisify(s.getAll());
}

// One opponent by id, or undefined if it isn't stored.
export async function getOpponent(id: string): Promise<Opponent | undefined> {
  const s = await opponentsStore('readonly');
  return promisify(s.get(id));
}

// Remove an opponent and everything stored for them.
export async function deleteOpponent(id: string): Promise<void> {
  const s = await opponentsStore('readwrite');
  await promisify(s.delete(id));
}

// How many opponents are stored — used to enforce the scouting cap.
export async function countOpponents(): Promise<number> {
  const s = await opponentsStore('readonly');
  return promisify(s.count());
}

// ── Backup & restore ─────────────────────────────────────────────────────────
//
// One self-contained JSON file holding everything that lives only on this
// device: the repertoire (every line with its move tree, notes, tags,
// confidence and review/scheduler stats), the imported games (they carry the
// mistake-scan spots and any saved analyses — training state that can't be
// re-fetched), and an app-state snapshot of the localStorage keys where the
// streaks, statistics, puzzle ratings and preferences live. Restoring a backup
// puts the app back exactly where it was left. Scouted opponents are the one
// deliberate omission — pure re-fetchable cache, and by far the bulkiest data.

// The exported file's shape. Versioned and tagged so a bad/foreign file is
// caught on import, and a format change can be told apart from older files.
// v1 files (lines only) still restore fine — the extras are optional.
export interface BackupFile {
  format: 'obertura-backup';
  version: number;
  exportedAt: string;
  /**
   * v3+: the books themselves. This is what the app writes now.
   */
  repertoires?: Repertoire[];
  /**
   * v1/v2: the old flat line list. Still READ (an old file, an old device's
   * sync payload) and migrated on the way in, never written.
   *
   * It is not written alongside `repertoires` on purpose. The projection would
   * carry a second copy of every review record, and this blob is what the
   * account sync pushes on every edit — the round that put that payload on a
   * diet is recent enough to respect.
   */
  lines?: Line[];
  games?: ImportedGame[];
  // localStorage snapshot: streaks, stats, puzzle ratings, prefs (v2+).
  local?: Record<string, string>;
  /**
   * v4+: which pieces this file deliberately carries. Absent on every file
   * written before partial exports existed, and absent is NOT the same as
   * empty — an old file simply carries everything it had, so readers must treat
   * `undefined` as "whatever fields are present" rather than as "nothing".
   *
   * Its only job is to tell "this export left the games out" apart from "this
   * user has no games", which matters on restore: a `replace` must not wipe a
   * section the file was never meant to speak for.
   */
  parts?: BackupPart[];
}

/**
 * The separable halves of a backup. The split is not arbitrary — each one is a
 * different KIND of thing to lose:
 *
 *   lines     the repertoires: the work. What nothing else can reproduce.
 *   games     the imported games. Re-fetchable from Chess.com/Lichess, but slow.
 *   stats     what training earned: review history, streaks, ratings, bests,
 *             endgame progress, the daily-challenge log.
 *   settings  everything else the app remembers about how you like it —
 *             board colours, piece set, notation, filters, onboarding flags.
 *
 * Scouted opponents are deliberately absent, here as everywhere: pure
 * re-fetchable cache, and by far the bulkiest thing on the device.
 */
export type BackupPart = 'lines' | 'games' | 'stats' | 'settings';

export const ALL_BACKUP_PARTS: readonly BackupPart[] = ['lines', 'games', 'stats', 'settings'];

// Which localStorage keys are STATISTICS rather than preferences. Listed
// explicitly, and by prefix where a family of keys shares one (per-mode timed
// bests, per-account rating history), because the alternative — guessing from
// the name — would quietly file a new key under the wrong half the day someone
// adds one. Anything not named here is a preference.
const STATS_KEY_PREFIXES = [
  'obertura-review-log',
  'obertura-reviewed-today',
  'obertura-training-days',
  'obertura.brilliantLog',
  'obertura.dailyChallenge.log',
  'obertura.endgameProgress',
  'obertura.endgamePuzzleRating',
  'obertura.endgamePuzzleRatingHistory',
  'obertura.endgamePuzzleStreak',
  'obertura.forgottenMoves',
  'obertura.lichessRatingHistory.',
  'obertura.liveRatings',
  'obertura.puzzleByOpening',
  'obertura.puzzleLog',
  'obertura.puzzleRating',
  'obertura.puzzleRatingHistory',
  'obertura.puzzleRepeat',
  'obertura.puzzleSeen',
  'obertura.puzzleStreak',
  'obertura.puzzles.taBest.',
  'obertura.timedBest',
];

export function localKeyPart(key: string): 'stats' | 'settings' {
  return STATS_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)) ? 'stats' : 'settings';
}

const BACKUP_FORMAT = 'obertura-backup';
// v3 carried repertoires instead of lines; v4 adds the optional `parts` list so
// a partial export can say what it deliberately left out. Both are additive —
// a v4 file with every part in it is a v3 file with one extra field, and an
// older build reads it unchanged.
const BACKUP_VERSION = 4;

/**
 * The books a backup describes, whichever era it comes from. An old file's flat
 * lines are migrated through exactly the same code the one-time device
 * migration uses, so a v1 file and a v1 device produce identical trees.
 */
export function repertoiresFrom(backup: BackupFile): Repertoire[] {
  if (backup.repertoires?.length) return backup.repertoires.map(reviveRepertoire);
  if (backup.lines?.length) return migrateLines(backup.lines.map(reviveLine)).repertoires;
  return [];
}

/** How many lines a backup holds, for the "restored N lines" readouts. */
export function backupLineCount(backup: BackupFile): number {
  if (backup.repertoires?.length) return projectLines(backup.repertoires).length;
  return backup.lines?.length ?? 0;
}

// Keys left behind by features that no longer exist. Today that is the Google
// Drive backup, retired in favour of the account sync: nothing reads these, but
// a phone that once connected Drive still carries them, so they are swept once
// at boot (purgeRetiredLocalKeys) and refused a place in any backup meanwhile.
const RETIRED_KEY_PREFIXES = ['obertura.drive.'];

/**
 * Remove retired features' leftovers from this device. Called once at boot;
 * safe to call again, and a no-op on a device that never had them.
 */
export function purgeRetiredLocalKeys(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && RETIRED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    /* storage blocked — nothing to clean up, nothing to break */
  }
}

// Which localStorage keys belong in a backup. Everything the app writes starts
// with "obertura" (both the dot and dash spellings) except the engine toggle.
// Device/session-specific keys are excluded: the account-sync state (restoring
// it onto a fresh device would lie — and the sync blob IS a backup, so carrying
// "last synced" inside it is circular), plus the OAuth return-path crumb.
//
// The entitlement cache is excluded for a sharper reason than "it would lie": it
// describes an ACCOUNT's plan, and this blob travels. It's what an export
// downloads and what the Supabase sync pushes to every other device — so
// carrying it would let an entitled user's backup grant full access to whatever
// phone restored it. Entitlement is only ever read back from the server
// (entitlement.ts); it must never arrive in a file.
function backupLocalKey(key: string): boolean {
  if (key === 'engineEnabled' || key === 'sparEngineEnabled') return true;
  if (!key.startsWith('obertura')) return false;
  // Retired features' leftovers. Cheap to keep listed: it costs one comparison
  // and it guarantees a phone that still has them can't push them anywhere.
  if (RETIRED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) return false;
  if (key.startsWith('obertura.sync.')) return false;
  if (key === 'obertura.entitled') return false;
  // The cached Stripe prices (pricing.ts). Excluded for a milder version of the
  // entitlement reason: they are per-locale and cheap to re-fetch, so carrying
  // them would quote a Swedish restore a Swedish price on a Spanish phone, for no
  // gain at all.
  if (key === 'obertura.pricing') return false;
  if (key === 'obertura.lichessReturnTo') return false;
  return true;
}

function snapshotLocalData(parts?: readonly BackupPart[]): Record<string, string> {
  const wantStats = !parts || parts.includes('stats');
  const wantSettings = !parts || parts.includes('settings');
  const out: Record<string, string> = {};
  if (!wantStats && !wantSettings) return out;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !backupLocalKey(key)) continue;
    const half = localKeyPart(key);
    if (half === 'stats' ? !wantStats : !wantSettings) continue;
    const value = localStorage.getItem(key);
    if (value !== null) out[key] = value;
  }
  return out;
}

/**
 * Write the localStorage half of a backup back onto this device. Split out of
 * restoreBackup so the account sync can apply just this piece after a pull
 * without going through a whole restore — and so both paths share the one guard
 * that stops a doctored file planting keys the app doesn't own.
 */
export function applyLocalSnapshot(local: Record<string, string>): void {
  for (const [k, v] of Object.entries(local)) {
    if (!backupLocalKey(k)) continue;
    try { localStorage.setItem(k, v); } catch { /* quota — keep restoring the rest */ }
  }
}

/**
 * Gather a backup ready to serialise. Lines and games come straight from
 * IndexedDB; JSON.stringify turns each move's `review.due` Date into an ISO
 * string, which parseBackup() revives on the way back in.
 *
 * `parts` narrows it. Omitted means everything, which is what every caller
 * before partial exports existed meant — so the default is unchanged and the
 * file it produces is byte-compatible apart from the `parts` list itself.
 *
 * A narrowed export omits the FIELD, it does not write an empty one: a file with
 * no `games` key and a `parts` list that doesn't mention games is unambiguous
 * about the difference between "left out" and "you have none".
 */
export async function exportBackup(
  parts: readonly BackupPart[] = ALL_BACKUP_PARTS,
): Promise<BackupFile> {
  const wanted = ALL_BACKUP_PARTS.filter((p) => parts.includes(p));
  const local = snapshotLocalData(wanted);
  const file: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    parts: [...wanted],
  };
  if (wanted.includes('lines')) file.repertoires = await getAllRepertoires();
  if (wanted.includes('games')) file.games = await getAllGames();
  if (Object.keys(local).length > 0) file.local = local;
  return file;
}

/** How many localStorage entries of each half a backup carries. */
export function backupLocalCounts(backup: BackupFile): { stats: number; settings: number } {
  let stats = 0;
  let settings = 0;
  for (const key of Object.keys(backup.local ?? {})) {
    if (localKeyPart(key) === 'stats') stats++;
    else settings++;
  }
  return { stats, settings };
}

/**
 * What a backup actually contains, as the parts a restore would touch. Reads the
 * `parts` list when the file has one (v4+) and falls back to looking at which
 * fields are present, which is the only thing an older file can tell us.
 */
export function partsInBackup(backup: BackupFile): BackupPart[] {
  if (backup.parts?.length) {
    return ALL_BACKUP_PARTS.filter((p) => backup.parts!.includes(p));
  }
  const found: BackupPart[] = [];
  if (backup.repertoires?.length || backup.lines?.length) found.push('lines');
  if (backup.games?.length) found.push('games');
  const counts = backupLocalCounts(backup);
  if (counts.stats > 0) found.push('stats');
  if (counts.settings > 0) found.push('settings');
  return found;
}

/** A human list of what's inside — "42 lines, 300 games and your statistics". */
export function describeBackup(backup: BackupFile): string {
  const bits: string[] = [];
  const parts = partsInBackup(backup);
  if (parts.includes('lines')) {
    const n = backupLineCount(backup);
    bits.push(`${n} line${n === 1 ? '' : 's'}`);
  }
  if (parts.includes('games')) {
    const g = backup.games?.length ?? 0;
    bits.push(`${g} game${g === 1 ? '' : 's'}`);
  }
  if (parts.includes('stats')) bits.push('your statistics');
  if (parts.includes('settings')) bits.push('your settings');
  if (bits.length === 0) return 'nothing this app can restore';
  if (bits.length === 1) return bits[0];
  return `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}`;
}

// Everything EXCEPT the imported games: the lines and the localStorage
// snapshot. A valid BackupFile in its own right (`games` is optional), and the
// half the account sync pushes on every edit — measured at a few hundred KB
// against several megabytes for the games, which is the entire reason the two
// are separable. Reading the games out of IndexedDB just to throw them away
// would defeat the point, so this deliberately never opens that store.
export async function exportCore(): Promise<BackupFile> {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    // Everything but the games — named explicitly so a pull can tell this half
    // apart from a partial export that happened to have no games in it.
    parts: ['lines', 'stats', 'settings'],
    repertoires: await getAllRepertoires(),
    local: snapshotLocalData(),
  };
}

// Parse and validate backup text, throwing a clear, human Error on anything
// malformed so the caller can show a friendly message rather than a stack
// trace. On success the lines are clean and ready to store (Dates revived).
export function parseBackup(text: string): BackupFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file isn’t valid JSON.');
  }
  if (!data || typeof data !== 'object') {
    throw new Error('This doesn’t look like a Bito Chess backup.');
  }
  const obj = data as Record<string, unknown>;
  if (obj.format !== BACKUP_FORMAT) {
    throw new Error('This doesn’t look like a Bito Chess backup.');
  }
  const hasReps = Array.isArray(obj.repertoires);
  const hasLines = Array.isArray(obj.lines);
  const games = validateGames(obj.games);
  const local = validateLocal(obj.local);
  // A file is allowed to carry only some of the pieces — that is the whole point
  // of a parts export. What it may NOT be is empty: a file with no repertoire,
  // no games and no snapshot restores nothing, and saying so here is kinder than
  // a silent "restored 0 lines".
  if (!hasReps && !hasLines && !games && !local) {
    throw new Error('That backup has nothing in it to restore.');
  }
  return {
    format: BACKUP_FORMAT,
    version: typeof obj.version === 'number' ? obj.version : 1,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
    parts: validateParts(obj.parts),
    repertoires: hasReps
      ? (obj.repertoires as unknown[]).map((r, i) => validateRepertoire(r, i))
      : undefined,
    lines: hasLines ? (obj.lines as unknown[]).map((l, i) => validateLine(l, i)) : undefined,
    games,
    local,
  };
}

// The `parts` list, kept only if it names parts this build knows. An unknown
// name from a future version is dropped rather than trusted — the fields that
// are actually present are the fallback, and they can't lie.
function validateParts(raw: unknown): BackupPart[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const parts = ALL_BACKUP_PARTS.filter((p) => raw.includes(p));
  return parts.length > 0 ? [...parts] : undefined;
}

// One book, checked the way validateLine checks a line: a single bad record
// aborts the whole import rather than half-restoring someone's repertoire.
function validateRepertoire(raw: unknown, index: number): Repertoire {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Repertoire ${index + 1} is not an object.`);
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) {
    throw new Error(`Repertoire ${index + 1} is missing an id.`);
  }
  if (r.colour !== 'white' && r.colour !== 'black') {
    throw new Error(`Repertoire ${index + 1} has an invalid colour.`);
  }
  if (!r.tree || typeof r.tree !== 'object' || !Array.isArray((r.tree as MoveNode).children)) {
    throw new Error(`Repertoire ${index + 1} has no move tree.`);
  }
  return {
    id: r.id,
    name: typeof r.name === 'string' && r.name ? r.name : DEFAULT_REPERTOIRE_NAMES[r.colour],
    colour: r.colour,
    tree: reviveTree(r.tree as MoveNode),
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
    archived: r.archived === true ? true : undefined,
  };
}

// The games ride along as-is (their shape is whatever the importer stored) —
// just make sure each is an object with a usable id, and drop anything that
// isn't rather than failing the whole file over re-fetchable data.
function validateGames(raw: unknown): ImportedGame[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const games = raw.filter(
    (g): g is ImportedGame =>
      !!g && typeof g === 'object' && typeof (g as { id?: unknown }).id === 'string',
  );
  return games.length > 0 ? games : undefined;
}

// The localStorage snapshot: keep only string→string entries on the app's own
// keys (backupLocalKey guards restore too, so a doctored file can't plant
// foreign keys).
function validateLocal(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && backupLocalKey(k)) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// Apply a whole backup in one call — the single restore path for the manual
// import and the account sync alike. Lines merge/replace as chosen; games
// always merge by id (replace additionally clears first); the localStorage
// snapshot simply overwrites its keys (stats/streaks aren't meaningfully
// mergeable, and the file is the state being restored).
export async function restoreBackup(backup: BackupFile, mode: 'merge' | 'replace'): Promise<void> {
  const parts = partsInBackup(backup);

  // A part the file doesn't carry is a part this restore says nothing about,
  // and `replace` must respect that: importing a lines-only export must not
  // wipe the games, and importing a games-only export must not wipe the lines.
  // Before partial exports existed every file spoke for everything, so this
  // narrowing only ever fires on a file that asked for it.
  if (parts.includes('lines')) {
    const incoming = repertoiresFrom(backup);
    if (mode === 'replace') await replaceAllRepertoires(incoming);
    else await mergeRepertoires(incoming);
  }
  if (parts.includes('games')) {
    if (mode === 'replace') await clearGames();
    if (backup.games && backup.games.length > 0) await saveGames(backup.games);
  }
  if (backup.local) applyLocalSnapshot(backup.local);
}

// Does this backup carry more than lines? Drives the "reload after restore"
// choice — modules cache localStorage state in memory, so a page reload is the
// reliable way to make a restored snapshot take everywhere.
export function backupHasExtras(backup: BackupFile): boolean {
  return !!(backup.games?.length || (backup.local && Object.keys(backup.local).length));
}

// Check one line has the shape we expect and return a normalised copy. A single
// bad line aborts the whole import (better to refuse than half-restore).
function validateLine(raw: unknown, index: number): Line {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Line ${index + 1} is not an object.`);
  }
  const l = raw as Record<string, unknown>;
  if (typeof l.id !== 'string' || !l.id) {
    throw new Error(`Line ${index + 1} is missing an id.`);
  }
  if (l.colour !== 'white' && l.colour !== 'black') {
    throw new Error(`Line ${index + 1} has an invalid colour.`);
  }
  if (!l.tree || typeof l.tree !== 'object' || !Array.isArray((l.tree as MoveNode).children)) {
    throw new Error(`Line ${index + 1} has no move tree.`);
  }
  return {
    id: l.id,
    name: typeof l.name === 'string' ? l.name : 'Untitled line',
    tags: Array.isArray(l.tags) ? l.tags.filter((t): t is string => typeof t === 'string') : [],
    colour: l.colour,
    openingName: typeof l.openingName === 'string' ? l.openingName : null,
    confidence: typeof l.confidence === 'number' ? l.confidence : 0,
    lastTrained: typeof l.lastTrained === 'string' ? l.lastTrained : null,
    inTraining: l.inTraining === true,
    tree: reviveTree(l.tree as MoveNode),
    createdAt: typeof l.createdAt === 'number' ? l.createdAt : undefined,
  };
}

// Walk a move tree and turn each node's `review.due` (an ISO string after JSON
// round-trips) back into a real Date, so restored lines match what the app
// produces natively. The scheduler also coerces `due` defensively, so this is
// belt-and-braces rather than strictly required.
function reviveTree(node: MoveNode): MoveNode {
  if (node.review && node.review.due != null) {
    node.review = { ...node.review, due: new Date(node.review.due) };
  }
  node.children = (node.children ?? []).map(reviveTree);
  return node;
}

// Resolve once a transaction has fully committed (or reject if it aborts). Used
// when several writes share one transaction — awaiting individual requests
// between writes can let IndexedDB auto-commit early, so we issue all writes
// synchronously and wait on the transaction itself.
function txnDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Merge incoming books into what's already here: a book with the same id has
 * the incoming moves folded into its tree; a book we don't have is added whole.
 * Nothing is ever removed, which is what makes merge the safe default.
 *
 * Merging by MOVE rather than by record is the part that got better with the
 * redesign: restoring a backup over a device that has since added moves used to
 * overwrite whole lines, and now the two sets of moves simply coexist in one
 * tree, with the better review record surviving on any move both had.
 */
export async function mergeRepertoires(incoming: Repertoire[]): Promise<void> {
  if (incoming.length === 0) return;
  const existing = await getAllRepertoires();
  const byId = new Map(existing.map(r => [r.id, r]));
  const write: Repertoire[] = [];

  for (const rep of incoming) {
    const target = byId.get(rep.id);
    if (target) {
      mergeRepertoireInto(target, rep);
      write.push(target);
    } else {
      write.push(rep);
    }
  }
  await saveRepertoires(write);
}

// ── Reset progress ─────────────────────────────────────────────────────────────
//
// Wipe everything the spaced-repetition trainer learned, while KEEPING the
// repertoire itself: each move loses its review record (so it's "never trained"
// and due immediately again), and every line's confidence + last-trained reset.
// Lines, notes, tags and training membership are untouched — this is "forget my
// scores", not "delete my work". The Settings screen guards it with a confirm.

function stripReviewData(node: MoveNode): void {
  delete node.review;
  delete node.missedThisSession;
  // The chronic-miss prompt's snooze is a score, not work — a move with no
  // lapses left must be able to ask again if it starts slipping afresh.
  delete node.noteAskedAtLapses;
  for (const child of node.children) stripReviewData(child);
}

export async function resetAllProgress(): Promise<void> {
  const reps = await getAllRepertoires();
  for (const rep of reps) {
    stripReviewData(rep.tree);
    // Confidence is derived from the records just stripped, so it resets
    // itself. The run counters and dates are recorded on the line ends and
    // have to be cleared explicitly.
    for (const node of allNodes(rep.tree)) {
      delete node.timesTrained;
      delete node.lastTrained;
    }
  }
  await saveRepertoires(reps);
}

// ── Erase everything ─────────────────────────────────────────────────────────
//
// The nuclear option behind Settings → "Erase everything": empty every
// IndexedDB store — lines, imported games and scouted opponents alike — in one
// transaction, so the app reopens with no data at all. Device preferences live
// in localStorage and are wiped separately by the caller; together with a page
// reload that lands the app in a true first-launch state. Unlike resetAllProgress
// (which keeps your lines), this leaves nothing behind, so the Settings dialog
// guards it with a two-step confirm and a "back up first" offer.

export async function eraseAllData(): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(
    [STORE, GAMES_STORE, OPPONENTS_STORE, REPERTOIRES_STORE], 'readwrite',
  );
  tx.objectStore(STORE).clear();
  tx.objectStore(GAMES_STORE).clear();
  tx.objectStore(OPPONENTS_STORE).clear();
  tx.objectStore(REPERTOIRES_STORE).clear();
  await txnDone(tx);
  // The old lines store is now empty too, so a later read must not try to
  // migrate from it and must not hand back a cached "already migrated" answer.
  migration = null;
}
