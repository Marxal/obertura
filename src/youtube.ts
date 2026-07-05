// Optional in-app YouTube search for the Learn tab. Entirely gated on a free,
// referrer-locked Data API key the user pastes into Settings (see
// YOUTUBE-SETUP.md) — without one, or on ANY error (bad key, quota spent,
// offline), searchYoutube answers null and the panel falls back to its
// keyless "Search on YouTube" deep link. Results are cached hard (memory +
// localStorage, 7 days) because queries are per OPENING NAME, not per move:
// the ~100-searches/day free quota is never a real limit that way.

import { getYoutubeApiKey } from './prefs';

export interface VideoHit {
  id: string;      // YouTube video id
  title: string;
  channel: string;
}

const API_URL = 'https://www.googleapis.com/youtube/v3/search';
const MAX_RESULTS = 5;
const FETCH_TIMEOUT_MS = 6000;

const LS_KEY = 'obertura.ytCache.v1';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_LS_ENTRIES = 30;

const memory = new Map<string, VideoHit[]>();

export function hasYoutubeKey(): boolean {
  return getYoutubeApiKey() !== null;
}

/** Keyless thumbnail for any known video id (320×180, always available). */
export function thumbUrl(id: string): string {
  return `https://img.youtube.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`;
}

export function watchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
}

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
 * Top videos for a query, from cache or one API call. null = no key or the
 * call failed (the caller shows its keyless fallback); [] = a real "no results".
 */
export async function searchYoutube(query: string): Promise<VideoHit[] | null> {
  const key = getYoutubeApiKey();
  if (!key) return null;
  const cached = peekYoutube(query);
  if (cached) return cached;

  try {
    const params = new URLSearchParams({
      part: 'snippet', type: 'video', maxResults: String(MAX_RESULTS),
      q: query, key,
    });
    const res = await fetch(`${API_URL}?${params}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null; // bad key, quota out, blocked — all downgrade
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
