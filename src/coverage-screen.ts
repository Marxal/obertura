// Coverage, as a screen of its own — the same section coverage-section.ts puts
// in the builder's My lines panel, given the whole width and both colours.
//
// It reuses the map viewer's full-screen chrome (.rmap-overlay: header, back
// arrow, back-gesture registration) exactly as the opponent detail and the
// library detail already do, so this is not a new kind of screen — it is the
// kind the app already has, with a different body.
//
// Two books, one at a time. The White and Black repertoires are separate books
// everywhere else in this app (TRANSPOSITIONS.md says so about transpositions,
// and it is just as true here: a Black gap means nothing to a White line), so
// the screen shows one and offers the other on a toggle.

import { pushBack } from './back-nav';
import { renderCoverageSection, type CoverageSection } from './coverage-section';
import { MAX_GAPS } from './coverage-gaps';

export interface CoverageScreenDeps {
  /** The Prepare mechanism — same signature the section takes. */
  onPrepare: (ucis: string[], answeringColour: 'white' | 'black', opponentName?: string) => void;
  /** Which book to open on. Defaults to White. */
  colour?: 'white' | 'black';
}

export function openCoverageScreen(deps: CoverageScreenDeps): void {
  let colour: 'white' | 'black' = deps.colour ?? 'white';
  let section: CoverageSection | null = null;

  const overlay = document.createElement('div');
  overlay.className = 'rmap-overlay cvg-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  function close(): void {
    section?.dispose();
    section = null;
    overlay.remove();
    removeBack();
  }
  const removeBack = pushBack(close);

  // Header — the map viewer's, so the back arrow sits where it always does.
  const header = document.createElement('div');
  header.className = 'rmap-header';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'rmap-back';
  back.setAttribute('aria-label', 'Close coverage');
  back.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none"
    stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M19 12H5M12 5l-7 7 7 7"/></svg>`;
  back.addEventListener('click', close);
  const title = document.createElement('h2');
  title.className = 'rmap-title';
  title.textContent = 'Coverage';
  header.appendChild(back);
  header.appendChild(title);
  overlay.appendChild(header);

  const body = document.createElement('div');
  body.className = 'cvg-screen';
  overlay.appendChild(body);

  const seg = document.createElement('div');
  seg.className = 'lib-db-seg cvg-colour-seg';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Which repertoire');
  const buttons = new Map<'white' | 'black', HTMLButtonElement>();
  for (const c of ['white', 'black'] as const) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lib-db-opt';
    btn.textContent = c === 'white' ? 'White' : 'Black';
    btn.addEventListener('click', () => {
      if (colour === c) return;
      colour = c;
      syncSeg();
      mount();
    });
    buttons.set(c, btn);
    seg.appendChild(btn);
  }
  function syncSeg(): void {
    for (const [c, btn] of buttons) btn.classList.toggle('is-active', c === colour);
  }
  syncSeg();
  body.appendChild(seg);

  const sectionHost = document.createElement('div');
  sectionHost.className = 'cvg-screen-body';
  body.appendChild(sectionHost);

  // One line of framing, once, at the bottom of the screen rather than the top:
  // what a gap IS and where the floors sit. Above the list it would be a
  // paragraph between the user and the thing they came for.
  const foot = document.createElement('p');
  foot.className = 'cvg-foot';
  foot.textContent =
    'A gap is a reply you have started answering somewhere and missed here. ' +
    'Only replies you have faced twice, or that a real share of players at your ' +
    'level play, or that a scouted opponent plays, are counted — and only in the ' +
    'first six moves. Nothing here is saved; it is worked out fresh each time.';
  body.appendChild(foot);

  function mount(): void {
    section?.dispose();
    sectionHost.replaceChildren();
    section = renderCoverageSection(sectionHost, {
      colour,
      limit: MAX_GAPS,
      showFamilies: true,
      title: null,
      onPrepare: (ucis, answering, opponentName) => {
        // Preparing takes the user to the builder — this screen must not stay
        // mounted over it.
        close();
        deps.onPrepare(ucis, answering, opponentName);
      },
    });
  }

  document.body.appendChild(overlay);
  mount();
}
