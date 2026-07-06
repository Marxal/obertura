// Explore → Learn: your saved lines grouped by opening family, each family a
// clean card of YouTube miniatures searched from the side YOU play it (the
// majority colour of that family's lines) — plus the shared hand-curated pins
// from content-curated.json, which also lead the builder's Learn slide. The
// auto list means the tab is never empty once a line is saved; on any fetch
// failure a card degrades to a one-tap search link.

import curatedData from './content-curated.json';
import type { Line } from './types';
import { openingFamily } from './analysis';
import { Icons } from './icons';
import { buildEmptyState } from './empty-state';
import {
  searchYoutube, peekYoutube, videoQuery, youtubeSearchUrl, type VideoHit,
} from './youtube';
import { extLink, linksRow, learnNote, videoRow } from './content-ui';

export interface CuratedVideo { id: string; title: string; channel?: string }
export interface CuratedEntry {
  match: string;             // opening name / family prefix, case-insensitive
  note?: string;
  videos?: CuratedVideo[];
}

const CURATED: CuratedEntry[] = (curatedData as { families: CuratedEntry[] }).families;

// Keep Explore's cards short — the builder's Learn slide is the deep view.
const MAX_CARD_VIDEOS = 3;

/**
 * The hand-picked entry for an opening name or family — the LONGEST `match`
 * that prefixes it wins, so a "Sicilian Defense: Najdorf" entry beats a
 * family-wide "Sicilian Defense" one when both apply.
 */
export function curatedForOpening(name: string): CuratedEntry | null {
  const n = name.toLowerCase();
  let best: CuratedEntry | null = null;
  for (const entry of CURATED) {
    const m = entry.match.toLowerCase();
    if (m && n.startsWith(m) && (!best || m.length > best.match.length)) best = entry;
  }
  return best;
}

// openingFamily's two-word fallback can keep a trailing colon
// ("Sicilian Defense:") — trim it for display and search queries.
function familyLabel(family: string): string {
  return family.replace(/[:,]+$/, '').trim();
}

export function buildLearnTab(lines: Line[], onBuildLine: () => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'learn-tab';

  const named = lines.filter(l => l.openingName);
  if (!named.length) {
    wrap.appendChild(buildEmptyState({
      icon: Icons.bulb(44),
      line: 'Save a line and its opening shows up here.',
      body: 'Videos for every opening in your repertoire, from the side you play it.',
      cta: { label: 'Build a line', onClick: onBuildLine },
    }));
    return wrap;
  }

  // Group by family: line count + which colour you play it as (majority).
  const groups = new Map<string, { count: number; white: number }>();
  for (const line of named) {
    const fam = familyLabel(openingFamily(line.openingName!));
    if (!fam) continue;
    const g = groups.get(fam) ?? { count: 0, white: 0 };
    g.count++;
    if (line.colour === 'white') g.white++;
    groups.set(fam, g);
  }
  const sorted = [...groups.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));

  for (const [family, g] of sorted) {
    const colour: 'white' | 'black' = g.white * 2 >= g.count ? 'white' : 'black';
    wrap.appendChild(familyCard(family, g.count, colour));
  }
  return wrap;
}

function familyCard(family: string, count: number, colour: 'white' | 'black'): HTMLElement {
  const card = document.createElement('div');
  card.className = 'learn-family-card';

  const head = document.createElement('div');
  head.className = 'learn-family-head';
  const name = document.createElement('div');
  name.className = 'learn-family-name';
  name.textContent = family;
  head.appendChild(name);
  const tally = document.createElement('div');
  tally.className = 'learn-family-count';
  tally.textContent = `${count === 1 ? '1 line' : `${count} lines`} · ${colour}`;
  head.appendChild(tally);
  card.appendChild(head);

  // Hand-picked pins first, when this family has any.
  const curated = curatedForOpening(family);
  if (curated?.note) card.appendChild(learnNote(curated.note));
  for (const v of curated?.videos ?? []) card.appendChild(videoRow(v));

  // The auto miniatures — cached weekly per query, so reopening the tab is free.
  const slot = document.createElement('div');
  card.appendChild(slot);
  const query = videoQuery(family, colour);
  const cached = peekYoutube(query);
  if (cached !== undefined) {
    renderCardHits(slot, cached, query);
  } else {
    slot.appendChild(learnNote('Loading videos…'));
    void searchYoutube(query).then(hits => {
      if (!slot.isConnected) return; // the tab was rebuilt meanwhile
      if (hits === null || !hits.length) renderCardFallback(slot, query);
      else renderCardHits(slot, hits, query);
    });
  }

  return card;
}

function renderCardHits(slot: HTMLElement, hits: VideoHit[], query: string): void {
  slot.innerHTML = '';
  if (!hits.length) { renderCardFallback(slot, query); return; }
  for (const hit of hits.slice(0, MAX_CARD_VIDEOS)) slot.appendChild(videoRow(hit));
}

function renderCardFallback(slot: HTMLElement, query: string): void {
  slot.innerHTML = '';
  slot.appendChild(linksRow([extLink('Search on YouTube', youtubeSearchUrl(query))]));
}
