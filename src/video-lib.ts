// Device-local shelves for the Learn surfaces' videos, keyed by YouTube id and
// kept in localStorage (tiny, never synced) — the same style as prefs.ts:
//   hidden     → "not interested": filtered out of every auto video list.
//   favourites → the saved shelf at the top of Explore → Learn.
//   seen       → opened at least once: a history archive, newest first.
// Favourites and seen store the whole video (title/channel) so the shelves can
// render without another search; hidden needs only the id. Marking a video "not
// interested" also drops it from the seen archive, so the history stays a list
// of things you still care to see again.

const HIDDEN_KEY = 'obertura.learn.hidden.v1';
const FAV_KEY = 'obertura.learn.favourites.v1';
const SEEN_KEY = 'obertura.learn.seen.v1';

// The archive is a memory aid, not an infinite log — keep the newest N.
const MAX_SEEN = 60;

/** The minimum a video needs to render in a shelf (matches VideoHit / curated). */
export interface VideoLike {
  id: string;
  title: string;
  channel?: string;
}

export interface SavedVideo extends VideoLike {
  at: number; // when it was saved / last opened
}

// ── Hidden ("not interested") ────────────────────────────────────────────────

function readHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    const arr = raw ? JSON.parse(raw) as unknown : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeHidden(ids: Set<string>): void {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...ids])); } catch { /* full */ }
}

export function isHidden(id: string): boolean {
  return readHidden().has(id);
}

/** Mark a video "not interested": hide it everywhere and drop it from history. */
export function hideVideo(id: string): void {
  const ids = readHidden();
  ids.add(id);
  writeHidden(ids);
  removeSeen(id);
}

// ── Favourites ───────────────────────────────────────────────────────────────

function readList(key: string): SavedVideo[] {
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(arr) ? arr as SavedVideo[] : [];
  } catch {
    return [];
  }
}

function writeList(key: string, list: SavedVideo[]): void {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* full */ }
}

/** Saved videos, newest first. */
export function listFavourites(): SavedVideo[] {
  return readList(FAV_KEY).sort((a, b) => b.at - a.at);
}

export function isFavourite(id: string): boolean {
  return readList(FAV_KEY).some(v => v.id === id);
}

/** Add or remove a favourite. Returns the new state (true = now a favourite). */
export function toggleFavourite(video: VideoLike): boolean {
  const list = readList(FAV_KEY);
  const i = list.findIndex(v => v.id === video.id);
  if (i >= 0) {
    list.splice(i, 1);
    writeList(FAV_KEY, list);
    return false;
  }
  list.push({ id: video.id, title: video.title, channel: video.channel, at: Date.now() });
  writeList(FAV_KEY, list);
  return true;
}

// ── Seen (history archive) ───────────────────────────────────────────────────

/** Opened videos, newest first. */
export function listSeen(): SavedVideo[] {
  return readList(SEEN_KEY).sort((a, b) => b.at - a.at);
}

/** Record that a video was opened (bumps it to the top if already there). */
export function markSeen(video: VideoLike): void {
  const list = readList(SEEN_KEY).filter(v => v.id !== video.id);
  list.push({ id: video.id, title: video.title, channel: video.channel, at: Date.now() });
  const trimmed = list.sort((a, b) => b.at - a.at).slice(0, MAX_SEEN);
  writeList(SEEN_KEY, trimmed);
}

export function removeSeen(id: string): void {
  const list = readList(SEEN_KEY).filter(v => v.id !== id);
  writeList(SEEN_KEY, list);
}
