// Explore → Learn: your saved lines grouped by opening family, each family a
// card of content shortcuts (videos, studies, the Lichess opening page) — plus
// the shared hand-curated pins from content-curated.json, which also feed the
// builder's Learn slide. The auto list means the tab is never empty once a
// line is saved; curation only ever ADDS pinned picks on top.

import curatedData from './content-curated.json';
import type { Line } from './types';
import { openingFamily } from './analysis';
import { Icons } from './icons';
import { buildEmptyState } from './empty-state';
import {
  lichessOpeningUrl, lichessStudySearchUrl, youtubeSearchUrl, openingQuery,
} from './content-sources';
import { extLink, linksRow, learnNote, videoRow } from './content-ui';

export interface CuratedVideo { id: string; title: string; channel?: string }
export interface CuratedStudy { url: string; title: string }
export interface CuratedEntry {
  match: string;             // opening name / family prefix, case-insensitive
  note?: string;
  videos?: CuratedVideo[];
  studies?: CuratedStudy[];
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
  if (!named.length) {
    wrap.appendChild(buildEmptyState({
      icon: Icons.bulb(44),
      line: 'Save a line and its opening shows up here.',
      body: 'Videos, studies and theory for every opening in your repertoire, in one place.',
      cta: { label: 'Build a line', onClick: onBuildLine },
    }));
    return wrap;
  }

  // Group by family, the ones you play most first.
  const counts = new Map<string, number>();
  for (const line of named) {
    const fam = familyLabel(openingFamily(line.openingName!));
    if (!fam) continue;
    counts.set(fam, (counts.get(fam) ?? 0) + 1);
  }
  const sorted = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  for (const [family, count] of sorted) wrap.appendChild(familyCard(family, count));
  return wrap;
}

function familyCard(family: string, count: number): HTMLElement {
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
  tally.textContent = count === 1 ? '1 line' : `${count} lines`;
  head.appendChild(tally);
  card.appendChild(head);

  // Hand-picked pins first, when this family has any.
  const curated = curatedForOpening(family);
  if (curated) {
    if (curated.note) card.appendChild(learnNote(curated.note));
    for (const v of curated.videos ?? []) card.appendChild(videoRow(v));
    if (curated.studies?.length) {
      card.appendChild(linksRow(curated.studies.map(s => extLink(s.title, s.url))));
    }
  }

  // The always-on shortcuts, same set the builder's Learn slide offers.
  const query = openingQuery(family);
  const links = [extLink('YouTube', youtubeSearchUrl(query))];
  const openingPage = lichessOpeningUrl(family);
  if (openingPage) links.push(extLink('Opening page', openingPage));
  links.push(extLink('Studies', lichessStudySearchUrl(query)));
  card.appendChild(linksRow(links));

  return card;
}
