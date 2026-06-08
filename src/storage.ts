import type { Line } from './types';
import type { ImportedGame } from './chesscom';

// Thin IndexedDB wrapper. IndexedDB's native API is event-based: every call
// returns a request and you attach onsuccess / onerror handlers. This module
// wraps those requests in Promises so the rest of the app can just `await`.

const DB_NAME = 'obertura';
// v2 adds the 'games' store for Chess.com imports (see chesscom.ts).
const DB_VERSION = 2;
const STORE = 'lines';
const GAMES_STORE = 'games';

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
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openDB();
  return db.transaction(STORE, mode).objectStore(STORE);
}

// Insert or overwrite a line by its id. Returns the saved line.
export async function saveLine(line: Line): Promise<Line> {
  const s = await store('readwrite');
  await promisify(s.put(line));
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
