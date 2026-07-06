// In-app YouTube search for the Learn tab, plus the query and deep-link
// builders it shares with the fallback pill. ONE key serves every user of the
// app. Committing it here is safe by design: in Google's console the key is
// restricted to this app's origin (Application restrictions → Websites →
// https://marxal.github.io/*) and to the YouTube Data API v3 only, so outside
// the deployed app it's dead weight. All users share its free quota (roughly
// 100 searches/day); queries are per OPENING NAME (not per move) and cached
// for a week (memory + localStorage), which keeps real usage far under the
// cap. On ANY failure — quota spent, offline, blocked network — searchYoutube
// answers null and callers degrade to a one-tap YouTube search link, so
// nothing ever breaks.
//
// To rotate the key: create a new one in the console (same two restrictions),
// replace the constant below, redeploy.

export interface VideoHit {
  id: string;      // YouTube video id
  title: string;
  channel: string;
}

const API_KEY = 'AIzaSyC5vT68-SVEj6BUYJiZZXLFdorz6GmbH_k';
const API_URL = 'https://www.googleapis.com/youtube/v3/search';
const MAX_RESULTS = 5;
const FETCH_TIMEOUT_MS = 6000;

const LS_KEY = 'obertura.ytCache.v1';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_LS_ENTRIES = 30;

// ── Queries and deep links ────────────────────────────────────────────────────

// The opening name flattened for a search box: "Sicilian Defense: Najdorf
// Variation, English Attack" → "Sicilian Defense Najdorf Variation English Attack".
export function openingQuery(name: string): string {
  return name.replace(/[:,]/g, ' ').replace(/\s+/g, ' ').trim();
}

// THE search the Learn tab runs: the opening plus the side the user is
// building it for — "Sicilian Defense Najdorf Variation chess opening for
// black". Creators title repertoire videos exactly this way, "chess opening"
// keeps ambiguous names (English Opening, Catalan, Bird) on the board, and
// the colour keeps a White repertoire from surfacing play-it-as-Black videos.
export function videoQuery(name: string, colour: 'white' | 'black'): string {
  return `${openingQuery(name)} chess opening for ${colour}`;
}

/** The same search on youtube.com — the keyless fallback and "More" link. */
export function youtubeSearchUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

/** Keyless thumbnail for any known video id (320×180, always available). */
export function thumbUrl(id: string): string {
  return `https://img.youtube.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`;
}

export function watchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
}

// ── Cached search ─────────────────────────────────────────────────────────────

const memory = new Map<string, VideoHit[]>();

type LsCache = Record<string, { at: number; hits: VideoHit[] }>;

function readLs(): LsCache {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) as LsCache : {};
  } catch {
    return {};
  }
}

function writeLs(cache: LsCache): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cache));
  } catch { /* storage full or blocked — the in-memory cache still works */ }
}

/** The cached hits for a query, if fresh (undefined = would need a fetch). */
export function peekYoutube(query: string): VideoHit[] | undefined {
  const hot = memory.get(query);
  if (hot) return hot;
  const entry = readLs()[query];
  if (entry && Date.now() - entry.at < TTL_MS) {
    memory.set(query, entry.hits);
    return entry.hits;
  }
  return undefined;
}

/**
 * Top videos for a query, from cache or one API call. null = the call failed
 * (quota, offline — the caller shows its search-link fallback); [] = a real
 * "no results".
 */
export async function searchYoutube(query: string): Promise<VideoHit[] | null> {
  const cached = peekYoutube(query);
  if (cached) return cached;

  try {
    const params = new URLSearchParams({
      part: 'snippet', type: 'video', maxResults: String(MAX_RESULTS),
      q: query, key: API_KEY,
    });
    const res = await fetch(`${API_URL}?${params}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null; // quota out, blocked — all downgrade silently
    const data = await res.json() as {
      items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string } }>;
    };
    const hits: VideoHit[] = [];
    for (const item of data.items ?? []) {
      const id = item.id?.videoId;
      if (typeof id !== 'string' || !item.snippet) continue;
      hits.push({
        id,
        title: decodeEntities(String(item.snippet.title ?? '')),
        channel: decodeEntities(String(item.snippet.channelTitle ?? '')),
      });
    }
    memory.set(query, hits);
    const ls = readLs();
    ls[query] = { at: Date.now(), hits };
    pruneLs(ls);
    writeLs(ls);
    return hits;
  } catch {
    return null;
  }
}

// Keep the localStorage cache bounded: oldest entries out first.
function pruneLs(cache: LsCache): void {
  const keys = Object.keys(cache);
  if (keys.length <= MAX_LS_ENTRIES) return;
  keys.sort((a, b) => cache[a].at - cache[b].at);
  for (const k of keys.slice(0, keys.length - MAX_LS_ENTRIES)) delete cache[k];
}

// search.list returns titles HTML-entity-encoded ("Bobby&#39;s Najdorf").
// Decode through an inert parsed document — we only ever read textContent.
function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  const doc = new DOMParser().parseFromString(s, 'text/html');
  return doc.documentElement.textContent ?? s;
}
