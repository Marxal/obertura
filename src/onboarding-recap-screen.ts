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
// That is also what lets the time-format chips re-derive everything on the
// spot: changing one re-runs buildRecap over the games ALREADY on the device.
// No re-scan, no network, no wait. Line length works the same way, but per
// line and from inside that line's own popup — a global "make every line
// longer" was a setting about lines the user had not looked at yet.
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

// How many MORE openings each "Show more" reveals. The list opens on the chosen
// four alone: a screen that opens on twelve cards is a list to get through
// rather than an offer to accept, and the four are already the answer for most
// people. Four at a time keeps every reveal a glance rather than a scroll.
const REVEAL_STEP = 4;

// The length a line is built at, and the longest it may be grown to from its own
// popup — both in the user's OWN moves. Ten is well past where a club player's
// games still agree with each other, so in practice the trunk runs out first;
// the ceiling exists so the button can't promise depth for ever.
const DEFAULT_OWN_MOVES = 6;
const MAX_OWN_MOVES = 10;

export interface RecapScreenDeps {
  /** The recap for the current filter — rebuilt by onFilterChange. */
  recap: Recap;
  /** The user's handle, echoed so the screen is visibly about THEM. */
  username: string;
  /** How many lines may be kept before the free tier's training cap bites. */
  freeLimit: number;
  /**
   * Re-derive the recap under a different time format. Synchronous by contract —
   * it reads games already on the device — so the screen repaints in place with
   * no spinner.
   */
  onFilterChange: (opts: { timeClass: TimeClass | null }) => Recap;
  /**
   * Rebuild ONE opening's trunk at a different length, in the user's own moves.
   * Returns null when that opening has no more shared moves to give — which is
   * what stops "add more moves" promising depth the games don't support.
   */
  onDeepen: (opening: OpeningGroup, ownMoves: number) => OpeningGroup | null;
  /** Keep these openings as lines. The screen has closed by the time this runs. */
  onSave: (openings: OpeningGroup[]) => void;
  /** "Not now" — a decision to skip, which ends first run and goes to the app. */
  onSkip: () => void;
  /** The system back gesture: step BACK to "Where do you play?". */
  onBack: () => void;
  /**
   * Tapped a card: show the whole line, steppable, with its own controls.
   * `ctx` is what the popup needs to act on THIS line without knowing anything
   * about the screen it came from.
   */
  onPreview: (opening: OpeningGroup, ctx: PreviewContext) => void;
  /** Tried to tick past `freeLimit` — the paid pitch, shown by the caller. */
  onOverLimit: () => void;
}

export interface PreviewContext {
  /** Is this line currently going to be saved? */
  selected: boolean;
  /** Can it still grow — more shared moves, and under the ceiling? */
  canDeepen: boolean;
  /** Add / remove this line. Closes the popup: a decision has been made. */
  onToggle: () => void;
  /** Lengthen this one line by a move, and reopen on the longer version. */
  onDeepen: () => void;
}

export function showRecapScreen(deps: RecapScreenDeps): void {
  let recap = deps.recap;
  let timeClass: TimeClass | null = null;
  // How many cards are on screen. Starts at the chosen four; "Show more" adds
  // REVEAL_STEP at a time.
  let visibleCount = RECAP_STARTER_LINES;
  // Per-line length, in the user's own moves, set from each line's own popup.
  // Absent means the default the recap was built at.
  const depths = new Map<string, number>();
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
    const base = deps.onFilterChange({ timeClass });
    // Re-apply any per-line lengths the user set before the filter moved. A
    // line that no longer exists simply drops its override with it.
    recap = {
      ...base,
      openings: base.openings.map((o) => {
        const want = depths.get(keyOf(o));
        return want ? (deps.onDeepen(o, want) ?? o) : o;
      }),
    };
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

    // Chosen lines always sort to the front, so the four the user is actually
    // saving stay together at the top however far the list is expanded.
    const ordered = [
      ...recap.openings.filter(o => chosen.has(keyOf(o))),
      ...recap.openings.filter(o => !chosen.has(keyOf(o))),
    ];
    const shown = Math.max(visibleCount, chosen.size);

    const list = document.createElement('div');
    list.className = 'recap-list';
    for (const opening of ordered.slice(0, shown)) list.appendChild(openingCard(opening));
    stage.appendChild(list);

    const remaining = ordered.length - shown;
    if (remaining > 0) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'recap-more';
      const next = Math.min(REVEAL_STEP, remaining);
      more.textContent = `Show ${next} more opening${next === 1 ? '' : 's'}`;
      more.addEventListener('click', () => { visibleCount = shown + REVEAL_STEP; paint(); });
      stage.appendChild(more);
    }

    buildFoot();
  }

  // ── Time format ─────────────────────────────────────────────────────────────
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
          visibleCount = RECAP_STARTER_LINES;
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

  // Add or remove a line, enforcing the free tier's ceiling at the moment of
  // choosing rather than after the fact — ticking past it would otherwise save
  // lines that silently never enter the training rotation.
  function toggleChosen(key: string): void {
    if (chosen.has(key)) {
      chosen.delete(key);
    } else {
      if (chosen.size >= deps.freeLimit) { deps.onOverLimit(); return; }
      chosen.add(key);
    }
    paint();
  }

  // The popup, handed everything it needs to act on this one line.
  function openPreview(opening: OpeningGroup): void {
    const key = keyOf(opening);
    const current = depths.get(key) ?? DEFAULT_OWN_MOVES;
    deps.onPreview(opening, {
      selected: chosen.has(key),
      canDeepen: current < MAX_OWN_MOVES && deps.onDeepen(opening, current + 1) !== null,
      onToggle: () => toggleChosen(key),
      onDeepen: () => {
        const next = Math.min(MAX_OWN_MOVES, current + 1);
        const grown = deps.onDeepen(opening, next);
        if (!grown) return;
        depths.set(key, next);
        refilter();
        // Reopen on the longer line, so "add more moves" visibly does something
        // rather than closing the thing the user was reading.
        const fresh = recap.openings.find(o => keyOf(o) === key);
        if (fresh) openPreview(fresh);
      },
    });
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
      onMiniClick: () => openPreview(opening),
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

    // ── Add / added ──
    //
    // A real toggle rather than a checkbox in the corner: on this screen the
    // decision IS "keep it or not", so it deserves the card's action slot.
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'recap-toggle' + (on ? ' recap-toggle--on' : '');
    toggle.setAttribute('aria-pressed', String(on));
    toggle.textContent = on ? '✓ Added' : 'Add this line';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation(); // the card behind it opens the popup
      toggleChosen(key);
    });
    content.appendChild(toggle);

    // THE CARD OPENS THE POPUP; the toggle is the only thing on it that doesn't.
    // Looking at a line before deciding is the commoner action and wants the
    // bigger target, and the toggle already says plainly what it does.
    card.addEventListener('click', () => openPreview(opening));

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
