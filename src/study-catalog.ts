// Pure logic for the Packs tab's Lichess-study browser: searching the bundled
// study index and ranking recommendations against the user's repertoire and
// imported games. No DOM, no fetch — the UI (study-browser.ts) lazy-loads the
// JSON index and hands it in, and the selftest feeds fixtures.
//
// Why a bundled index at all: Lichess's study search is a website route with
// no CORS headers, so the app (served from github.io) can't call it from the
// browser — only /api/* routes allow cross-origin, and none of them searches
// studies. scripts/build-study-index.mjs assembles the index at build time
// (Node has no CORS) from the most-liked studies per opening family; the
// PGN import itself stays live via the CORS-enabled /api/study/{id}.pgn.

import { familyKey, normalizeFamilyText, UNKNOWN_FAMILY } from './analysis';

export interface StudyIndexEntry {
  id: string;        // 8-char Lichess study id — /api/study/{id}.pgn fetches it
  name: string;      // study title
  by: string;        // author's Lichess username
  likes: number;
  chapters: number;
  families: string[]; // display names of the opening families it surfaced under
  keys: string[];     // familyKey()-normalised match keys (incl. synonyms)
}

// Lazy-load the bundled index only when the studies section actually renders,
// keeping it out of the initial bundle — same pattern as loadPacks().
let indexPromise: Promise<StudyIndexEntry[]> | null = null;
export function loadStudyIndex(): Promise<StudyIndexEntry[]> {
  if (!indexPromise) {
    indexPromise = import('./study-index.json').then(
      m => ((m.default ?? m) as { studies: StudyIndexEntry[] }).studies,
    );
  }
  return indexPromise;
}

// ── Repertoire profile ────────────────────────────────────────────────────────
// Which opening families the user actually lives in, as familyKey → weight.
// Saved lines weigh more than single games: a line is a deliberate choice,
// a game is one data point. Weights accumulate, so families you play a lot
// float their studies up.

const LINE_WEIGHT = 3;
const GAME_WEIGHT = 1;

export function buildStudyProfile(
  lines: Array<{ openingName: string | null }>,
  games: Array<{ opening: string | null }>,
): Map<string, number> {
  const profile = new Map<string, number>();
  const add = (name: string | null, w: number): void => {
    const key = familyKey(name);
    if (key === UNKNOWN_FAMILY) return;
    profile.set(key, (profile.get(key) ?? 0) + w);
  };
  for (const l of lines) add(l.openingName, LINE_WEIGHT);
  for (const g of games) add(g.opening, GAME_WEIGHT);
  return profile;
}

// ── Recommendations ───────────────────────────────────────────────────────────
// Studies in the families the user plays, best-matching first: score is the
// summed profile weight of every family key the study matches, likes break
// ties. Studies matching nothing are excluded — an empty result means "no
// profile yet"; the caller falls back to the most-liked studies overall.

export function recommendStudies(
  index: StudyIndexEntry[],
  profile: Map<string, number>,
  cap = 10,
): StudyIndexEntry[] {
  const scored = index
    .map(entry => ({
      entry,
      score: entry.keys.reduce((sum, k) => sum + (profile.get(k) ?? 0), 0),
    }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.likes - a.entry.likes);
  return scored.slice(0, cap).map(x => x.entry);
}

// ── Search ────────────────────────────────────────────────────────────────────
// Token search over title, author, and family names, normalised the same way
// as familyKey (case/apostrophes/defence-defense) so "caro kann" finds
// "Caro-Kann". Every token must match somewhere. Results sort by likes.

// Each entry's searchable text, built once — the search runs per keystroke,
// and re-normalising the whole index every keypress is wasted work on a phone.
const hayCache = new WeakMap<StudyIndexEntry, string>();

function haystack(e: StudyIndexEntry): string {
  let hay = hayCache.get(e);
  if (hay === undefined) {
    hay = normalizeFamilyText(`${e.name} ${e.by} ${e.families.join(' ')}`).replace(/[\-–—]/g, ' ');
    hayCache.set(e, hay);
  }
  return hay;
}

export function searchStudyIndex(
  index: StudyIndexEntry[],
  query: string,
  cap = 20,
): StudyIndexEntry[] {
  const tokens = normalizeFamilyText(query).split(/[\s\-–—:,./]+/).filter(Boolean);
  if (tokens.length === 0) return [];
  return index
    .filter(e => tokens.every(t => haystack(e).includes(t)))
    .sort((a, b) => b.likes - a.likes)
    .slice(0, cap);
}
