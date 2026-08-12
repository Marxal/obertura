// Explore → Learn: your saved lines grouped by opening family, each family a
// clean card of YouTube miniatures searched from the side YOU play it (the
// majority colour of that family's lines) — plus the shared hand-curated pins
// from content-curated.json. The
// auto list means the tab is never empty once a line is saved; on any fetch
// failure a card degrades to a one-tap search link.

import curatedData from './content-curated.json';
import type { Line } from './types';
import { openingFamily } from './analysis';
import { Icons } from './icons';
import { buildEmptyState } from './empty-state';
import { colourPip } from './card-position';
import {
  fetchPage, peekPage, videoQuery, youtubeSearchUrl,
} from './youtube';
import {
  extLink, linksRow, learnNote, learnSection, videoRow, videoList, type ShelfKind,
} from './content-ui';
import { isHidden, listFavourites, listSeen, type SavedVideo } from './video-lib';

export interface CuratedVideo { id: string; title: string; channel?: string }
export interface CuratedEntry {
  match: string;             // opening name / family prefix, case-insensitive
  note?: string;
  videos?: CuratedVideo[];
}

const CURATED: CuratedEntry[] = (curatedData as { families: CuratedEntry[] }).families;

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
  const favs = listFavourites();
  const seen = listSeen();

  if (!named.length && !favs.length && !seen.length) {
    wrap.appendChild(buildEmptyState({
      icon: Icons.video(44),
      line: 'Save a line and its opening shows up here.',
      body: 'Videos for every opening in your repertoire, from the side you play it.',
      cta: { label: 'Build a line', onClick: onBuildLine },
    }));
    return wrap;
  }

  // A one-line orientation so the tab explains itself: what these videos are
  // and where they come from.
  const intro = document.createElement('p');
  intro.className = 'section-desc';
  intro.textContent =
    'Videos to study your openings — one shelf per opening in your repertoire, ' +
    'searched from the side you play it. Favourites you save stay on top.';
  wrap.appendChild(intro);

  // Your saved shelf leads, so favourites are one tap away.
  if (favs.length) wrap.appendChild(videoShelf('Favourites', favs, 'fav'));

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

  // …and the history archive trails at the bottom.
  if (seen.length) wrap.appendChild(videoShelf('Watched', seen, 'history'));
  return wrap;
}

// A titled shelf of saved / watched videos. Rows drop themselves as they're
// un-saved or marked not-interested; when the last one goes, the shelf follows.
// (Favourites are an explicit save, so they show even if hidden elsewhere; the
// Watched archive never holds hidden videos — hiding one forgets it.)
function videoShelf(title: string, videos: SavedVideo[], shelf: ShelfKind): HTMLElement {
  const box = document.createElement('div');
  box.className = 'learn-shelf';
  box.appendChild(learnSection(title));
  // The rows grid across the full tab width on desktop (see .learn-shelf-list
  // in style.css); on a phone this class draws nothing.
  const list = document.createElement('div');
  list.className = 'learn-shelf-list';
  let remaining = videos.length;
  for (const v of videos) {
    list.appendChild(videoRow(v, {
      shelf,
      onRemove: () => { if (--remaining <= 0) box.remove(); },
    }));
  }
  box.appendChild(list);
  return box;
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
  // The colour pip we use on every other card, plus the line count.
  tally.appendChild(colourPip(colour));
  const tallyText = document.createElement('span');
  tallyText.textContent = count === 1 ? '1 line' : `${count} lines`;
  tally.appendChild(tallyText);
  head.appendChild(tally);
  card.appendChild(head);

  // Hand-picked pins first, when this family has any (skipping any you've hidden).
  const curated = curatedForOpening(family);
  if (curated?.note) card.appendChild(learnNote(curated.note));
  for (const v of curated?.videos ?? []) {
    if (!isHidden(v.id)) card.appendChild(videoRow(v));
  }

  // The auto miniatures — cached weekly per query, so reopening the tab is free.
  const slot = document.createElement('div');
  card.appendChild(slot);
  const query = videoQuery(family, colour);
  const cached = peekPage(query);
  if (cached !== undefined) {
    videoList(slot, query, cached);
  } else {
    slot.appendChild(learnNote('Loading videos…'));
    void fetchPage(query).then(page => {
      if (!slot.isConnected) return; // the tab was rebuilt meanwhile
      slot.innerHTML = '';
      if (page === null) {
        slot.appendChild(linksRow([extLink('Search on YouTube', youtubeSearchUrl(query))]));
      } else {
        videoList(slot, query, page);
      }
    });
  }

  return card;
}
