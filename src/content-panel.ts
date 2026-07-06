// The builder/analyser Learn slide — YouTube videos for the opening on the
// board, searched from the side the user is playing (a White repertoire gets
// "… for white" videos; flip the board and the search flips too). The header
// names the opening via the offline database, falling back to the deepest
// NAMED position when the line runs past theory, with an honest note. On any
// fetch failure the list degrades to a one-tap "Search on YouTube" link —
// never an error.
//
// Render discipline — builderPanels.render() fires on EVERY move, so:
//   • while the slide is hidden, render() only marks the panel dirty (no DOM,
//     no network); entering the slide paints it once.
//   • while it's showing, each move repaints instantly and debounces the
//     search; the query is per opening NAME, so stepping around inside one
//     opening hits the week-long cache instead of the API.

import { openingForPath } from './openings';
import {
  fetchPage, peekPage, videoQuery, movesQuery, youtubeSearchUrl,
} from './youtube';
import { curatedForOpening } from './content-explore';
import { extLink, linksRow, learnNote, learnSection, videoRow, videoList } from './content-ui';
import { isHidden } from './video-lib';
import { Icons } from './icons';

export interface ContentPanelDeps {
  el: HTMLElement;                  // the #slide-learn section
  getSans: () => string[];          // SAN path to the current cursor node
  getFens: () => string[];          // FEN of every position along that path
  getColour: () => 'white' | 'black'; // the side this line/game is built for
  isAnalyser: () => boolean;        // analyser mode — flips the hint copy
}

export interface ContentPanel {
  render(): void;                   // a position change (cheap when hidden)
  setActive(on: boolean): void;     // the carousel entered / left this slide
}

const NET_DEBOUNCE_MS = 350;

export function createContentPanel(deps: ContentPanelDeps): ContentPanel {
  let active = false;
  let dirty = true;
  let netTimer: number | null = null;

  function cancelNet(): void {
    if (netTimer !== null) { clearTimeout(netTimer); netTimer = null; }
  }

  function render(): void {
    if (!active) { dirty = true; return; }
    paint();
  }

  function setActive(on: boolean): void {
    if (on === active) return;
    active = on;
    if (!on) {
      // Leaving — or merely scrolling PAST: the carousel's smooth scroll
      // reports intermediate slides, so an entry can arrive as on/off/on.
      // Cancel the pending fetch and mark dirty, so the next entry repaints
      // and reschedules it.
      cancelNet();
      dirty = true;
      return;
    }
    if (dirty) paint();
  }

  // The query the CURRENT board position wants — also the stale-guard: a
  // resolved fetch only renders if this still matches.
  function currentQuery(): string | null {
    const opening = openingForPath(deps.getFens());
    return opening ? videoQuery(opening.name, deps.getColour()) : null;
  }

  function paint(): void {
    dirty = false;
    cancelNet();
    const el = deps.el;
    el.innerHTML = '';

    const sans = deps.getSans();
    if (!sans.length) {
      el.appendChild(learnNote('Play a move to see videos for the opening on the board.'));
      return;
    }

    const opening = openingForPath(deps.getFens());

    // ── A discrete "search this exact position" escape hatch at the very top:
    //    the per-opening list below is broad; this deep-links to a YouTube
    //    search for the precise move order on the board.
    const exact = document.createElement('a');
    exact.className = 'learn-exact';
    exact.href = youtubeSearchUrl(movesQuery(sans));
    exact.target = '_blank';
    exact.rel = 'noopener noreferrer';
    exact.appendChild(Icons.search(14));
    const exactText = document.createElement('span');
    exactText.textContent = 'Search this exact position ↗';
    exact.appendChild(exactText);
    el.appendChild(exact);

    // ── Header: what we're finding videos for ──
    const head = document.createElement('div');
    head.className = 'learn-head';
    head.textContent = opening?.name ?? 'Off-book position';
    el.appendChild(head);
    if (opening && sans.length > opening.ply) {
      const endMove = Math.ceil(opening.ply / 2);
      const hint = document.createElement('div');
      hint.className = 'learn-hint';
      hint.textContent = deps.isAnalyser()
        ? `This game left named theory at move ${endMove}.`
        : `Named theory ends at move ${endMove} — the moves after it are your own prep.`;
      el.appendChild(hint);
    }
    if (!opening) {
      el.appendChild(learnNote('No named opening reaches this position yet — step back into theory to see videos.'));
      return;
    }

    // ── Videos ──
    el.appendChild(learnSection(`Videos for ${deps.getColour()}`));
    const curated = curatedForOpening(opening.name);
    if (curated?.note) el.appendChild(learnNote(curated.note));
    for (const v of curated?.videos ?? []) {
      if (!isHidden(v.id)) el.appendChild(videoRow(v));
    }

    const slot = document.createElement('div');
    el.appendChild(slot);

    const query = videoQuery(opening.name, deps.getColour());
    const cached = peekPage(query);
    if (cached !== undefined) {
      videoList(slot, query, cached);
      return;
    }
    slot.appendChild(learnNote('Loading videos…'));
    netTimer = window.setTimeout(() => {
      netTimer = null;
      void fetchPage(query).then(page => {
        if (!active || currentQuery() !== query) return; // moved on meanwhile
        slot.innerHTML = '';
        if (page === null) renderFallback(slot, query);
        else videoList(slot, query, page);
      });
    }, NET_DEBOUNCE_MS);
  }

  function renderFallback(slot: HTMLElement, query: string): void {
    slot.innerHTML = '';
    slot.appendChild(linksRow([extLink('Search on YouTube', youtubeSearchUrl(query))]));
  }

  return { render, setActive };
}
