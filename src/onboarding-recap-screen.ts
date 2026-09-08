// The payoff screen: what we found in YOUR games, and what to keep from it.
//
// This is the moment the games-first first run exists to reach. A minute ago a
// stranger typed a username; now the app is telling them which openings they
// actually play, how those go, and offering to turn the best of them into a
// repertoire — rather than the ten minutes of building by hand the old first
// run asked for.
//
// ── IT PAINTS INSTANTLY, AND THAT IS THE POINT ──────────────────────────────
// Everything here comes from onboarding-recap.ts: replay plus a bundled
// opening-table lookup, no engine and no network. See that file for why the
// mistake and brilliancy cards are NOT here — they need mistake-scan's engine
// pass at 15-40 seconds a game, and the background autoscan prepares them for
// later instead. Nothing on this screen may ever start waiting on an engine.
//
// That is also what lets the two controls at the top re-derive everything on
// the spot: changing the time format or the depth re-runs buildRecap over the
// games ALREADY on the device. No re-scan, no network, no wait.
//
// ── IT ABSORBED THE IMPORT'S REVIEW STEP ────────────────────────────────────
// There used to be a screen between the scan and this one: "Found N games",
// a how-many chooser, and a row of time-control toggles. It asked the user to
// make decisions about raw games before they had seen a single thing the app
// could do with them. The only choice there that mattered was the time format,
// so it moved HERE, where its effect is visible — change the chip and the
// openings underneath change with it. One screen fewer, and the remaining
// question is asked next to its own answer.
//
// ── THE LINES OFFERED ARE THEIR OWN MOVES ───────────────────────────────────
// Each opening's line is the majority-vote trunk through that opening's games
// (trunkOf) — the shared stem of how this person really plays it, ending on one
// of their own moves.

import { buildPositionCard, fenFromUcis, colourPip } from './card-position';
import { pushBack } from './back-nav';
import { Icons } from './icons';
import { TIME_CLASS_LABELS, type TimeClass } from './import-games';
import { pickStarterOpenings, type OpeningGroup, type Recap } from './onboarding-recap';

// How many lines are ticked when the screen opens.
//
// FOUR, NOT THREE — so the split can be 2 White + 2 Black. Three clears
// TRAINING_UNLOCK_LINES, which is why it was the first number here, but an odd
// count means one book always starts thinner than the other, and the thin one
// is the half a new user is least likely to go and fill in themselves.
// pickStarterOpenings deals alternately between the colours, so four is the
// smallest number that gives both books a real pair.
export const RECAP_STARTER_LINES = 4;

// How many openings the list shows before "Show more". Enough that the default
// four aren't the only thing visible — the point of the tick boxes is that the
// choice is real — without opening on a wall of twelve cards.
const VISIBLE_BEFORE_MORE = 6;

// The depth choices, in the user's OWN moves. Deliberately three coarse steps
// rather than a slider: the difference between 4 and 5 is not a judgement
// anybody can make here, and a slider invites fiddling with a number whose
// effect they can't see. Matches onboarding-lines.ts's curated cuts.
const DEPTH_CHOICES: { value: number; label: string }[] = [
  { value: 4, label: 'Short' },
  { value: 6, label: 'Standard' },
  { value: 8, label: 'Deep' },
];

export interface RecapScreenDeps {
  /** The recap for the current filter — rebuilt by onFilterChange. */
  recap: Recap;
  /** The user's handle, echoed so the screen is visibly about THEM. */
  username: string;
  /** How many lines may be kept before the free tier's training cap bites. */
  freeLimit: number;
  /**
   * Re-derive the recap under a different time format / depth. Synchronous by
   * contract — it reads games already on the device — so the screen can repaint
   * in place without a spinner.
   */
  onFilterChange: (opts: { timeClass: TimeClass | null; depth: number }) => Recap;
  /** Keep these openings as lines. The screen has closed by the time this runs. */
  onSave: (openings: OpeningGroup[]) => void;
  /** "Not now" — a decision to skip, which ends first run and goes to the app. */
  onSkip: () => void;
  /** The system back gesture: step BACK to "Where do you play?". */
  onBack: () => void;
  /** Tapped a card: show the whole line, steppable, before deciding. */
  onPreview: (opening: OpeningGroup) => void;
  /** Tried to tick past `freeLimit` — the paid pitch, shown by the caller. */
  onOverLimit: () => void;
}

export function showRecapScreen(deps: RecapScreenDeps): void {
  let recap = deps.recap;
  let timeClass: TimeClass | null = null;
  let depth = 6;
  let showAll = false;
  // Ticked openings, held by NAME+COLOUR rather than by object identity: every
  // filter change rebuilds the OpeningGroup objects from scratch, and a Set of
  // stale references would silently untick everything the moment a chip moved.
  let chosen = new Set<string>();

  const keyOf = (o: OpeningGroup): string => `${o.colour}:${o.name}`;

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
  // Back steps back through first run; it neither saves (the gesture must never
  // commit something to the user's repertoire on their behalf) nor counts as
  // declining the offer.
  const removeBack = pushBack(() => { close(); deps.onBack(); });

  const stage = document.createElement('div');
  stage.className = 'recap-stage';
  overlay.appendChild(stage);

  const foot = document.createElement('div');
  foot.className = 'recap-foot';
  overlay.appendChild(foot);

  // Seed the ticks from the balanced picker, then keep whatever the user does.
  for (const o of pickStarterOpenings(recap, RECAP_STARTER_LINES)) chosen.add(keyOf(o));

  function selectedOpenings(): OpeningGroup[] {
    return recap.openings.filter(o => chosen.has(keyOf(o)));
  }

  // Re-run the arithmetic under the current controls and repaint. Ticks survive
  // by name, so a line that still exists under the new filter stays chosen.
  function refilter(): void {
    recap = deps.onFilterChange({ timeClass, depth });
    const live = new Set(recap.openings.map(keyOf));
    chosen = new Set([...chosen].filter(k => live.has(k)));
    // A filter that wiped every tick would leave the user staring at a disabled
    // button; re-seed from the balanced picker instead.
    if (chosen.size === 0) {
      for (const o of pickStarterOpenings(recap, RECAP_STARTER_LINES)) chosen.add(keyOf(o));
    }
    paint();
  }

  function paint(): void {
    stage.replaceChildren();
    foot.replaceChildren();

    // ── The headline: their number, their name ──
    const lead = document.createElement('h1');
    lead.className = 'recap-lead';
    lead.textContent = `We read ${recap.total} of your games`;
    stage.appendChild(lead);

    const sub = document.createElement('p');
    sub.className = 'recap-sub';
    sub.textContent = `@${deps.username} · ${describeSplit(recap)}`;
    stage.appendChild(sub);

    // ── The two controls ──
    stage.appendChild(buildControls());

    if (recap.openings.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'recap-note';
      empty.textContent = timeClass
        ? 'No clear openings in that time format — try another, or All.'
        : 'Your games are spread across a lot of different openings, so there’s '
          + 'no clear favourite to start from. You can build a line by hand '
          + 'instead — your games are saved either way.';
      stage.appendChild(empty);
      buildFoot();
      return;
    }

    const heading = document.createElement('h2');
    heading.className = 'recap-heading';
    heading.textContent = 'Your openings — pick the ones to keep';
    stage.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'recap-list';
    const visible = showAll ? recap.openings : recap.openings.slice(0, VISIBLE_BEFORE_MORE);
    for (const opening of visible) list.appendChild(openingCard(opening));
    stage.appendChild(list);

    if (!showAll && recap.openings.length > VISIBLE_BEFORE_MORE) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'recap-more';
      more.textContent = `Show ${recap.openings.length - VISIBLE_BEFORE_MORE} more openings`;
      more.addEventListener('click', () => { showAll = true; paint(); });
      stage.appendChild(more);
    }

    buildFoot();
  }

  // ── Time format and depth ───────────────────────────────────────────────────
  function buildControls(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'recap-controls';

    // Only worth offering when there is more than one bucket to choose between.
    if (recap.byTimeClass.length > 1) {
      const row = document.createElement('div');
      row.className = 'recap-chips';
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', 'Time format');

      const chip = (label: string, value: TimeClass | null, count: number): void => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'recap-chip' + (timeClass === value ? ' recap-chip--on' : '');
        b.textContent = `${label} ${count}`;
        b.setAttribute('aria-pressed', String(timeClass === value));
        b.addEventListener('click', () => {
          if (timeClass === value) return;
          timeClass = value;
          showAll = false;
          refilter();
        });
        row.appendChild(b);
      };

      chip('All', null, recap.byTimeClass.reduce((n, b) => n + b.games, 0));
      for (const bucket of recap.byTimeClass) {
        chip(TIME_CLASS_LABELS[bucket.timeClass], bucket.timeClass, bucket.games);
      }
      wrap.appendChild(row);
    }

    // Depth: quieter than the chips above it, because it is the rarer question.
    const depthRow = document.createElement('div');
    depthRow.className = 'recap-depth';
    const depthLabel = document.createElement('span');
    depthLabel.className = 'recap-depth-label';
    depthLabel.textContent = 'Line length';
    depthRow.appendChild(depthLabel);

    for (const choice of DEPTH_CHOICES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'recap-depth-btn' + (depth === choice.value ? ' recap-depth-btn--on' : '');
      b.textContent = choice.label;
      b.title = `${choice.value} of your own moves`;
      b.setAttribute('aria-pressed', String(depth === choice.value));
      b.addEventListener('click', () => {
        if (depth === choice.value) return;
        depth = choice.value;
        refilter();
      });
      depthRow.appendChild(b);
    }
    wrap.appendChild(depthRow);

    return wrap;
  }

  // ── The commit ──────────────────────────────────────────────────────────────
  function buildFoot(): void {
    const n = chosen.size;

    if (recap.openings.length > 0) {
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'btn-primary recap-save';
      save.textContent = n === 0
        ? 'Pick at least one line'
        : `Save ${n} line${n === 1 ? '' : 's'} →`;
      save.disabled = n === 0;
      save.addEventListener('click', () => { close(); deps.onSave(selectedOpenings()); });
      foot.appendChild(save);
    }

    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = recap.openings.length > 0 ? 'recap-skip' : 'btn-primary recap-save';
    skip.textContent = recap.openings.length > 0 ? 'Not now' : 'Continue';
    skip.addEventListener('click', () => { close(); deps.onSkip(); });
    foot.appendChild(skip);
  }

  function openingCard(opening: OpeningGroup): HTMLElement {
    const key = keyOf(opening);
    const on = chosen.has(key);

    const { card, titleRow, content } = buildPositionCard({
      fen: fenFromUcis(opening.ucis),
      orientation: opening.colour,
      className: 'recap-card' + (on ? ' recap-card--on' : ''),
      // The miniature opens the preview; the rest of the card toggles the tick.
      // Two different jobs, so they are two different targets rather than one
      // ambiguous one.
      onMiniClick: () => deps.onPreview(opening),
      miniLabel: `Play through ${opening.name}`,
    });

    titleRow.appendChild(colourPip(opening.colour));
    const name = document.createElement('span');
    name.className = 'recap-card-name';
    name.textContent = opening.name;
    titleRow.appendChild(name);

    const meta = document.createElement('p');
    meta.className = 'recap-card-meta';
    meta.textContent = `${opening.games} game${opening.games === 1 ? '' : 's'}`
      + ` · ${opening.share}% of your ${opening.colour === 'white' ? 'White' : 'Black'} games`;
    content.appendChild(meta);

    const record = document.createElement('p');
    record.className = 'recap-card-record';
    record.appendChild(Icons.barChart(13));
    const text = document.createElement('span');
    text.textContent = `${opening.wins}W · ${opening.draws}D · ${opening.losses}L`;
    record.appendChild(text);
    content.appendChild(record);

    // ── Save this line / saved ──
    //
    // A real toggle rather than a checkbox in the corner: on this screen the
    // decision IS "keep it or not", so it deserves the card's action slot.
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'recap-toggle' + (on ? ' recap-toggle--on' : '');
    toggle.setAttribute('aria-pressed', String(on));
    toggle.textContent = on ? '✓ Saving this line' : 'Save this line';
    toggle.addEventListener('click', () => {
      if (chosen.has(key)) {
        chosen.delete(key);
      } else {
        // The free tier trains a fixed number of lines at once. Ticking past it
        // would save lines that silently never enter the rotation, so the cap is
        // enforced HERE, where the user can still choose which ones they want,
        // rather than after the fact.
        if (chosen.size >= deps.freeLimit) { deps.onOverLimit(); return; }
        chosen.add(key);
      }
      paint();
    });
    content.appendChild(toggle);

    // Tapping the card body is the same as tapping its toggle — the toggle is
    // the affordance, the whole card is the target.
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.recap-toggle, .pcard-mini')) return;
      toggle.click();
    });

    return card;
  }

  refilter();
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
  if (decided > 0) bits.push(`${Math.round((recap.wins / decided) * 100)}% wins`);
  return bits.join(' · ');
}
