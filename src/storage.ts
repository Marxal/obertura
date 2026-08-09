import type { Line } from './types';
import type { MoveNode } from './tree';
import type { ImportedGame } from './chesscom';
import type { Opponent } from './scout';

// Thin IndexedDB wrapper. IndexedDB's native API is event-based: every call
// returns a request and you attach onsuccess / onerror handlers. This module
// wraps those requests in Promises so the rest of the app can just `await`.

const DB_NAME = 'obertura';
// v2 adds the 'games' store for Chess.com imports (see chesscom.ts).
// v3 adds the 'opponents' store for Explore scouting (see scout.ts).
const DB_VERSION = 3;
const STORE = 'lines';
const GAMES_STORE = 'games';
const OPPONENTS_STORE = 'opponents';

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
// Lets interested modules (the Drive auto-backup in drive-backup.ts, and the
// account sync in repertoire-sync.ts) react to repertoire writes without this
// module importing them back — that
// would be a circular dependency. Listeners fire after the write committed.
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

// Insert or overwrite a line by its id. Returns the saved line.
export async function saveLine(line: Line): Promise<Line> {
  const s = await store('readwrite');
  await promisify(s.put(line));
  notifyLinesChanged();
  return line;
}

// Return every stored line.
export async function getAllLines(): Promise<Line[]> {
  const s = await store('readonly');
  return promisify(s.getAll());
}

// Return one line by id, or undefined if it isn't stored.
export async function getLine(id: string): Promise<Line | undefined> {
  const s = await store('readonly');
  return promisify(s.get(id));
}

// Remove one line by id.
export async function deleteLine(id: string): Promise<void> {
  const s = await store('readwrite');
  await promisify(s.delete(id));
  notifyLinesChanged();
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
}

// Remove one game by id (the My games card's delete action).
export async function deleteGame(id: string): Promise<void> {
  const s = await gamesStore('readwrite');
  await promisify(s.delete(id));
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
  lines: Line[];
  games?: ImportedGame[];
  // localStorage snapshot: streaks, stats, puzzle ratings, prefs (v2+).
  local?: Record<string, string>;
}

const BACKUP_FORMAT = 'obertura-backup';
const BACKUP_VERSION = 2;

// Which localStorage keys belong in a backup. Everything the app writes starts
// with "obertura" (both the dot and dash spellings) except the engine toggle.
// Device/session-specific keys are excluded: the Drive connection and the
// account-sync state (restoring either onto a fresh device would lie — and the
// sync blob IS a backup, so carrying "last synced" inside it is circular), plus
// the OAuth return-path crumb.
//
// The entitlement cache is excluded for a sharper reason than "it would lie": it
// describes an ACCOUNT's plan, and this blob travels. It's what an export
// downloads, what Drive stores, and what the Supabase sync pushes to every other
// device — so carrying it would let an entitled user's backup grant full access
// to whatever phone restored it. Entitlement is only ever read back from the
// server (entitlement.ts); it must never arrive in a file.
function backupLocalKey(key: string): boolean {
  if (key === 'engineEnabled' || key === 'sparEngineEnabled') return true;
  if (!key.startsWith('obertura')) return false;
  if (key.startsWith('obertura.drive.')) return false;
  if (key.startsWith('obertura.sync.')) return false;
  if (key === 'obertura.entitled') return false;
  if (key === 'obertura.lichessReturnTo') return false;
  return true;
}

function snapshotLocalData(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !backupLocalKey(key)) continue;
    const value = localStorage.getItem(key);
    if (value !== null) out[key] = value;
  }
  return out;
}

// Gather everything into a plain object ready to serialise. Lines and games
// come straight from IndexedDB; JSON.stringify turns each move's `review.due`
// Date into an ISO string, which parseBackup() revives on the way back in.
export async function exportBackup(): Promise<BackupFile> {
  const [lines, games] = await Promise.all([getAllLines(), getAllGames()]);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    lines,
    games,
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
  if (!Array.isArray(obj.lines)) {
    throw new Error('Backup is missing its lines.');
  }
  const lines = obj.lines.map((l, i) => validateLine(l, i));
  return {
    format: BACKUP_FORMAT,
    version: typeof obj.version === 'number' ? obj.version : 1,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
    lines,
    games: validateGames(obj.games),
    local: validateLocal(obj.local),
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
// import and the Drive restore alike. Lines merge/replace as chosen; games
// always merge by id (replace additionally clears first); the localStorage
// snapshot simply overwrites its keys (stats/streaks aren't meaningfully
// mergeable, and the file is the state being restored).
export async function restoreBackup(backup: BackupFile, mode: 'merge' | 'replace'): Promise<void> {
  if (mode === 'replace') await replaceAllLines(backup.lines);
  else await mergeLines(backup.lines);
  if (backup.games && backup.games.length > 0) {
    if (mode === 'replace') await clearGames();
    await saveGames(backup.games);
  }
  if (backup.local) {
    for (const [k, v] of Object.entries(backup.local)) {
      try { localStorage.setItem(k, v); } catch { /* quota — keep restoring the rest */ }
    }
  }
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

// Replace the entire repertoire with the backup's lines: wipe what's stored,
// then write the file's lines. The result is exactly the file — the right
// choice for a clean restore onto a cleared browser or fresh device.
export async function replaceAllLines(lines: Line[]): Promise<void> {
  const s = await store('readwrite');
  s.clear();
  for (const line of lines) s.put(line);
  await txnDone(s.transaction);
  notifyLinesChanged();
}

// Merge the backup into what's already here: a line whose id matches an
// existing one overwrites it; new ids are added; untouched lines stay. Nothing
// is ever deleted, which makes this the safe default.
export async function mergeLines(lines: Line[]): Promise<void> {
  const s = await store('readwrite');
  for (const line of lines) s.put(line);
  await txnDone(s.transaction);
  notifyLinesChanged();
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
  const lines = await getAllLines();
  const s = await store('readwrite');
  for (const line of lines) {
    stripReviewData(line.tree);
    line.confidence = 0;
    line.lastTrained = null;
    line.timesTrained = 0;
    s.put(line);
  }
  await txnDone(s.transaction);
  notifyLinesChanged();
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
  const tx = db.transaction([STORE, GAMES_STORE, OPPONENTS_STORE], 'readwrite');
  tx.objectStore(STORE).clear();
  tx.objectStore(GAMES_STORE).clear();
  tx.objectStore(OPPONENTS_STORE).clear();
  await txnDone(tx);
}
