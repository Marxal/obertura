// The builder/analyser Learn slide — learning content for the opening on the
// board. Serves BOTH modes (one shared carousel): the header names the opening
// via the offline database, falling back to the deepest NAMED position when the
// line runs past theory (openingForPath); Wikibooks supplies position-exact
// theory text; everything else is one-tap deep links, so the whole panel except
// the theory/video fetches works in airplane mode.
//
// Render discipline — builderPanels.render() fires on EVERY move, so:
//   • while the slide is hidden, render() only marks the panel dirty (no DOM,
//     no network); entering the slide paints it once.
//   • while it's showing, each move repaints the offline parts immediately and
//     debounces the network work, so stepping through a line fires at most one
//     Wikibooks request per pause (plus at most one YouTube search per opening
//     NAME — see youtube.ts's week-long cache).
// Every fetch fails soft: a section with no data simply isn't there.

import { openingForPath } from './openings';
import {
  fetchWikibooksTheory, peekWikibooksTheory, type TheoryExtract,
  lichessOpeningUrl, lichessAnalysisUrl, lichessStudySearchUrl,
  youtubeSearchUrl, openingQuery, exactQuery,
} from './content-sources';
import { hasYoutubeKey, searchYoutube, peekYoutube, type VideoHit } from './youtube';
import { curatedForOpening } from './content-explore';
import { extLink, linksRow, learnNote, learnSection, videoRow } from './content-ui';

export interface ContentPanelDeps {
  el: HTMLElement;                  // the #slide-learn section
  getSans: () => string[];          // SAN path to the current cursor node
  getFens: () => string[];          // FEN of every position along that path
  getFen: () => string;             // FEN of the current position
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
      // Cancel the pending network work and mark dirty, so the next entry
      // repaints and reschedules it; without the dirty mark that entry would
      // sit on a stale "Loading…" slot with no fetch coming.
      cancelNet();
      dirty = true;
      return;
    }
    if (dirty) paint();
  }

  function paint(): void {
    dirty = false;
    cancelNet();
    const el = deps.el;
    el.innerHTML = '';

    const sans = deps.getSans();
    const fens = deps.getFens();

    if (!sans.length) {
      el.appendChild(learnNote('Play a move to see learning content for the opening on the board.'));
      return;
    }

    const opening = openingForPath(fens);
    const name = opening?.name ?? null;

    // ── Header: what we're finding content for ──
    const head = document.createElement('div');
    head.className = 'learn-head';
    head.textContent = name ?? 'Off-book position';
    el.appendChild(head);
    if (opening && sans.length > opening.ply) {
      const endMove = Math.ceil(opening.ply / 2);
      const hint = document.createElement('div');
      hint.className = 'learn-hint';
      hint.textContent = deps.isAnalyser()
        ? `This game left named theory at move ${endMove}.`
        : `Named theory ends at move ${endMove} — the moves after it are your own prep.`;
      el.appendChild(hint);
    } else if (!opening) {
      el.appendChild(learnNote('No named opening reaches this position — the exact-position links below still work.'));
    }

    // ── Theory (Wikibooks) — async slot, hidden until it answers ──
    const theorySlot = document.createElement('div');
    el.appendChild(theorySlot);
    const cachedTheory = peekWikibooksTheory(sans);
    if (cachedTheory !== undefined) {
      renderTheory(theorySlot, cachedTheory, sans.length);
    } else {
      theorySlot.appendChild(learnNote('Loading theory…'));
    }

    // ── Videos ──
    let videoQuery: string | null = null;
    if (name) {
      el.appendChild(learnSection('Videos'));
      const curated = curatedForOpening(name);
      if (curated?.note) el.appendChild(learnNote(curated.note));
      for (const v of curated?.videos ?? []) el.appendChild(videoRow(v));
      if (curated?.studies?.length) {
        el.appendChild(linksRow(curated.studies.map(s => extLink(s.title, s.url))));
      }

      videoQuery = openingQuery(name);
      const videoSlot = document.createElement('div');
      videoSlot.dataset.role = 'videos';
      el.appendChild(videoSlot);
      if (!hasYoutubeKey()) {
        renderVideoFallback(videoSlot, videoQuery);
        videoQuery = null; // nothing to fetch
      } else {
        const cachedHits = peekYoutube(videoQuery);
        if (cachedHits !== undefined) {
          renderVideoHits(videoSlot, cachedHits, videoQuery);
          videoQuery = null; // already answered
        } else {
          videoSlot.appendChild(learnNote('Loading videos…'));
        }
      }

      // ── On Lichess ──
      el.appendChild(learnSection('On Lichess'));
      const links: HTMLElement[] = [];
      const openingPage = lichessOpeningUrl(name);
      if (openingPage) links.push(extLink('Opening page', openingPage));
      links.push(extLink('Search studies', lichessStudySearchUrl(openingQuery(name))));
      el.appendChild(linksRow(links));
    }

    // ── This exact position — permanent, fully offline-computed ──
    el.appendChild(learnSection('This exact position'));
    const exact = exactQuery(sans, name);
    el.appendChild(linksRow([
      extLink('Analyse on Lichess', lichessAnalysisUrl(deps.getFen())),
      extLink('YouTube', youtubeSearchUrl(exact)),
      extLink('Studies', lichessStudySearchUrl(exact)),
    ]));

    // ── The debounced network work for whatever wasn't cached ──
    const needsTheory = cachedTheory === undefined;
    const ytQuery = videoQuery;
    if (needsTheory || ytQuery) {
      const pathKey = sans.join(' ');
      netTimer = window.setTimeout(() => {
        netTimer = null;
        if (needsTheory) {
          void fetchWikibooksTheory(sans, opening?.ply).then(theory => {
            if (!active || deps.getSans().join(' ') !== pathKey) return; // moved on
            renderTheory(theorySlot, theory, sans.length);
          });
        }
        if (ytQuery) {
          void searchYoutube(ytQuery).then(hits => {
            if (!active || deps.getSans().join(' ') !== pathKey) return;
            const slot = el.querySelector<HTMLElement>('[data-role="videos"]');
            if (!slot) return;
            if (hits === null) renderVideoFallback(slot, ytQuery);
            else renderVideoHits(slot, hits, ytQuery);
          });
        }
      }, NET_DEBOUNCE_MS);
    }
  }

  // The theory block: deepest existing Wikibooks page for this path, with the
  // CC BY-SA credit linking the exact page quoted. null → the section is gone.
  function renderTheory(slot: HTMLElement, theory: TheoryExtract | null, pathLen: number): void {
    slot.innerHTML = '';
    if (!theory || !theory.text) return;
    const coversAll = theory.plies >= pathLen;
    slot.appendChild(learnSection(coversAll
      ? 'Theory'
      : `Theory · up to move ${Math.ceil(theory.plies / 2)}`));
    const text = document.createElement('div');
    text.className = 'learn-theory';
    text.textContent = theory.text;
    slot.appendChild(text);

    const attrib = document.createElement('div');
    attrib.className = 'learn-attrib';
    const a = document.createElement('a');
    a.href = theory.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = 'Continue on Wikibooks ↗';
    attrib.appendChild(a);
    attrib.appendChild(document.createTextNode(' · From “Chess Opening Theory” (CC BY-SA)'));
    slot.appendChild(attrib);
  }

  function renderVideoHits(slot: HTMLElement, hits: VideoHit[], query: string): void {
    slot.innerHTML = '';
    if (!hits.length) { renderVideoFallback(slot, query); return; }
    for (const hit of hits) slot.appendChild(videoRow(hit));
    slot.appendChild(linksRow([extLink('More on YouTube', youtubeSearchUrl(query))]));
  }

  // The query is the opening named in the header right above — repeating it in
  // the label just clips on a phone, so the pill stays short.
  function renderVideoFallback(slot: HTMLElement, query: string): void {
    slot.innerHTML = '';
    slot.appendChild(linksRow([extLink('Search on YouTube', youtubeSearchUrl(query))]));
  }

  return { render, setActive };
}
