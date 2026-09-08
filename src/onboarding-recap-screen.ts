// The payoff screen: what we found in YOUR games, and one tap to keep it.
//
// This is the moment the games-first first run exists to reach. Thirty seconds
// ago a stranger typed a username; now the app is telling them which openings
// they actually play, how those go, and offering to turn the top few into their
// first repertoire — in one tap, rather than the ten minutes of building by
// hand the old first run asked for.
//
// ── IT PAINTS INSTANTLY, AND THAT IS THE POINT ──────────────────────────────
// Everything here comes from onboarding-recap.ts: replay plus a bundled
// opening-table lookup, no engine and no network. See that file for why the
// mistake and brilliancy cards are NOT here — they need mistake-scan's engine
// pass at 15-40 seconds a game, and the background autoscan prepares them for
// later instead. Nothing on this screen may ever start waiting on an engine.
//
// ── THE LINES OFFERED ARE THEIR OWN MOVES ───────────────────────────────────
// Each opening's line is the majority-vote trunk through that opening's games
// (trunkOf) — the shared stem of how this person really plays it, ending on one
// of their own moves. So "save these" hands them a repertoire that already
// looks like their game, which is the difference between this and a starter
// pack.

import { buildPositionCard, fenFromUcis, colourPip } from './card-position';
import { pushBack } from './back-nav';
import { Icons } from './icons';
import { pickStarterOpenings, type OpeningGroup, type Recap } from './onboarding-recap';

// How many lines the one-tap offer covers. Three because that is
// TRAINING_UNLOCK_LINES — clearing the goal in one tap is the entire promise of
// this screen, and offering two would leave the user one short of the thing
// they were just told they had unlocked.
export const RECAP_STARTER_LINES = 3;

export interface RecapScreenDeps {
  recap: Recap;
  /** The user's handle, echoed so the screen is visibly about THEM. */
  username: string;
  /**
   * Save these openings as lines. The screen has already closed by the time this
   * runs, and it is the caller's job to enrol them and land the user on Train.
   */
  onSave: (openings: OpeningGroup[]) => void;
  /** "Not now" — skip saving anything and go on to the app. */
  onSkip: () => void;
}

export function showRecapScreen(deps: RecapScreenDeps): void {
  const picked = pickStarterOpenings(deps.recap, RECAP_STARTER_LINES);

  const overlay = document.createElement('div');
  overlay.className = 'picker-overlay recap-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'What we found in your games');

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.remove();
    document.documentElement.classList.remove('picker-open');
    removeBack();
  };
  // Back skips rather than saving: the system gesture must never commit
  // something to the user's repertoire on their behalf.
  const removeBack = pushBack(() => { close(); deps.onSkip(); });

  const stage = document.createElement('div');
  stage.className = 'recap-stage';

  // ── The headline: their number, their name ──
  const lead = document.createElement('h1');
  lead.className = 'recap-lead';
  lead.textContent = `We read ${deps.recap.total} of your games`;
  stage.appendChild(lead);

  const sub = document.createElement('p');
  sub.className = 'recap-sub';
  sub.textContent = `@${deps.username} · ${describeSplit(deps.recap)}`;
  stage.appendChild(sub);

  // ── What they play ──
  if (picked.length > 0) {
    const heading = document.createElement('h2');
    heading.className = 'recap-heading';
    heading.textContent = picked.length === 1
      ? 'Your most-played opening'
      : `Your top ${picked.length} openings`;
    stage.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'recap-list';
    for (const opening of picked) list.appendChild(openingCard(opening));
    stage.appendChild(list);

    const note = document.createElement('p');
    note.className = 'recap-note';
    note.textContent = picked.length === 1
      ? 'Saving it starts your repertoire — you can add more any time.'
      : 'These become your first lines, built from the moves you actually play.';
    stage.appendChild(note);
  } else {
    // The floor (RECAP_MIN_GAMES) means we rarely land here, but a library of
    // wildly varied games can still produce no group with a usable trunk. Say so
    // plainly rather than showing an empty list under a confident heading.
    const empty = document.createElement('p');
    empty.className = 'recap-note';
    empty.textContent =
      'Your games are spread across a lot of different openings, so there’s no '
      + 'clear favourite to start from. You can build a line by hand instead — '
      + 'your games are saved either way.';
    stage.appendChild(empty);
  }

  overlay.appendChild(stage);

  // ── The commit ──
  const foot = document.createElement('div');
  foot.className = 'recap-foot';

  if (picked.length > 0) {
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn-primary recap-save';
    save.textContent = picked.length === 1
      ? 'Save this line →'
      : `Save these ${picked.length} lines →`;
    save.addEventListener('click', () => { close(); deps.onSave(picked); });
    foot.appendChild(save);
  }

  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = picked.length > 0 ? 'recap-skip' : 'btn-primary recap-save';
  skip.textContent = picked.length > 0 ? 'Not now' : 'Continue';
  skip.addEventListener('click', () => { close(); deps.onSkip(); });
  foot.appendChild(skip);

  overlay.appendChild(foot);

  document.body.appendChild(overlay);
  document.documentElement.classList.add('picker-open');
}

// "38 as White, 22 as Black · 54% wins" — the one-line shape of their play.
// Percentages rather than raw W/D/L because the raw three numbers invite
// arithmetic, and this line is meant to be glanced at.
function describeSplit(recap: Recap): string {
  const bits: string[] = [];
  if (recap.white > 0) bits.push(`${recap.white} as White`);
  if (recap.black > 0) bits.push(`${recap.black} as Black`);
  const decided = recap.wins + recap.draws + recap.losses;
  if (decided > 0) {
    bits.push(`${Math.round((recap.wins / decided) * 100)}% wins`);
  }
  return bits.join(' · ');
}

function openingCard(opening: OpeningGroup): HTMLElement {
  const { card, titleRow, content } = buildPositionCard({
    fen: fenFromUcis(opening.ucis),
    orientation: opening.colour,
    className: 'recap-card',
  });

  titleRow.appendChild(colourPip(opening.colour));
  const name = document.createElement('span');
  name.className = 'recap-card-name';
  name.textContent = opening.name;
  titleRow.appendChild(name);

  const meta = document.createElement('p');
  meta.className = 'recap-card-meta';
  // "12 games · 38% of your White games" — the share is what makes it read as
  // theirs rather than as a number about chess in general.
  meta.textContent = `${opening.games} game${opening.games === 1 ? '' : 's'}`
    + ` · ${opening.share}% of your ${opening.colour === 'white' ? 'White' : 'Black'} games`;
  content.appendChild(meta);

  const moves = document.createElement('p');
  moves.className = 'recap-card-moves';
  moves.textContent = formatMoves(opening.sans);
  content.appendChild(moves);

  const record = document.createElement('p');
  record.className = 'recap-card-record';
  record.appendChild(Icons.barChart(13));
  const text = document.createElement('span');
  text.textContent = `${opening.wins}W · ${opening.draws}D · ${opening.losses}L`;
  record.appendChild(text);
  content.appendChild(record);

  return card;
}

// SAN list → "1. e4 e5 2. Nf3 Nc6 3. Bb5". Numbered from White's first move, so
// a Black line still shows the White move it answers — a bare "…e5 …Nc6" reads
// as a fragment rather than a line.
function formatMoves(sans: readonly string[]): string {
  const out: string[] = [];
  for (let i = 0; i < sans.length; i++) {
    if (i % 2 === 0) out.push(`${i / 2 + 1}.`);
    out.push(sans[i]);
  }
  return out.join(' ');
}
