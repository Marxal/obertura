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

import { openingLabel } from './opening-names';
import { buildPositionCard, fenFromUcis, colourPip } from './card-position';
import { userAvatar } from './avatar';
import { pushBack } from './back-nav';
import { Icons } from './icons';
import { t } from './i18n';
import { TIME_CLASS_LABELS, type TimeClass } from './import-games';
import { ownMoveCount, pickStarterOpenings, type OpeningGroup, type Recap } from './onboarding-recap';

// How many lines are ticked when the screen opens.
//
// Three clears TRAINING_UNLOCK_LINES, which is why it was the first number
// here; four gave both books a real pair rather than leaving one thinner than
// the other. Five is half the free tier's training rotation — enough that the
// screen's offer is a repertoire rather than a sample, while leaving room to
// add more without immediately meeting the cap. pickStarterOpenings deals
// alternately between the colours, so the spare goes to whichever they play
// more.
export const RECAP_STARTER_LINES = 5;

// How many MORE openings each "Show more" reveals. The list opens on the chosen
// four alone: a screen that opens on twelve cards is a list to get through
// rather than an offer to accept, and the four are already the answer for most
// people. Four at a time keeps every reveal a glance rather than a scroll.
const REVEAL_STEP = 4;

// The longest a line may be grown to, in the user's OWN moves. Ten is well past where a club player's
// games still agree with each other, so in practice the trunk runs out first;
// the ceiling exists so the button can't promise depth for ever.
const MAX_OWN_MOVES = 10;

export interface RecapScreenDeps {
  /** The recap for the current filter — rebuilt by onFilterChange. */
  recap: Recap;
  /** The user's handle, echoed so the screen is visibly about THEM. */
  username: string;
  /** Their profile picture, where the platform has one (Chess.com only). */
  avatarUrl?: string;
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
  /** Skipping the openings, on purpose and after being told what that means. */
  onSkip: () => void;
  /**
   * On a first run: say the game analysis has started, and ask before skipping.
   * Off when Get started reopens this screen later, where it's a tool someone
   * picked up and can put down without being asked.
   */
  firstRun: boolean;
  /** The system back gesture: step BACK to "Where do you play?". */
  onBack: () => void;
  /**
   * Tapped a card: show the whole line, steppable, with its own controls.
   * `ctx` is what the popup needs to act on THIS line without knowing anything
   * about the screen it came from.
   */
  onPreview: (opening: OpeningGroup, ctx: PreviewContext) => void;
  // No onOverLimit any more. Ticking past the free tier's training cap used to
  // open the paid pitch here — a price inside first run, which entitlement.ts
  // itself says must never happen (UX-AUDIT C3). Lines past the cap are now
  // simply saved paused, and the foot says so before the user commits.
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
  // Lines whose games have run out of shared moves, so their ＋ can go.
  const exhausted = new Set<string>();
  // The order on screen. Chosen first, but set when the list is (re)built and NOT
  // on every tick: the whole card is a target now, and a card that jumps away the
  // moment you tap it is a card you can't untick.
  let listOrder: string[] = [];
  // Ticked openings, held by NAME+COLOUR rather than by object identity: every
  // filter change rebuilds the OpeningGroup objects from scratch, and a Set of
  // stale references would silently untick everything the moment a chip moved.
  let chosen = new Set<string>();

  const keyOf = (o: OpeningGroup): string => `${o.colour}:${o.name}`;

  const overlay = document.createElement('div');
  overlay.className = 'picker-overlay recap-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', t('recap.label'));

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
  function refilter(opts: { keepOrder?: boolean } = {}): void {
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
    if (!opts.keepOrder) {
      listOrder = [
        ...recap.openings.filter(o => chosen.has(keyOf(o))),
        ...recap.openings.filter(o => !chosen.has(keyOf(o))),
      ].map(keyOf);
      visibleCount = Math.max(visibleCount, chosen.size);
    }
    paint();
  }

  function paint(): void {
    stage.replaceChildren();
    foot.replaceChildren();

    // ── Who this is about ──────────────────────────────────────────────────
    //
    // Identity first, then the shape of their play, then the instruction. The
    // screen used to open on "We read 31 of your games", which is a statement
    // about what the APP just did; the number is still here, under their name,
    // where it belongs as evidence rather than as the headline.
    stage.appendChild(buildIdentity());
    stage.appendChild(buildRecord());
    if (deps.firstRun) stage.appendChild(buildAnalysisNote());

    // The title is the ACTION, not the report.
    const lead = document.createElement('h1');
    lead.className = 'recap-lead';
    lead.textContent = t('recap.title');
    stage.appendChild(lead);

    const sub = document.createElement('p');
    sub.className = 'recap-sub';
    sub.textContent = t('recap.sub');
    stage.appendChild(sub);

    // ── The two controls ──
    stage.appendChild(buildControls());

    if (recap.openings.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'recap-note';
      empty.textContent = t(timeClass ? 'recap.empty.format' : 'recap.empty.spread');
      stage.appendChild(empty);
      buildFoot();
      return;
    }

    const heading = document.createElement('h2');
    heading.className = 'recap-heading';
    heading.textContent = t('recap.picked');
    stage.appendChild(heading);

    // listOrder holds chosen lines at the front, as of when the list was built.
    const rank = new Map(listOrder.map((k, i) => [k, i]));
    const ordered = [...recap.openings].sort(
      (a, b) => (rank.get(keyOf(a)) ?? 1e6) - (rank.get(keyOf(b)) ?? 1e6));
    const shown = visibleCount;

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
      more.textContent = t('recap.showMore', { n: next });
      more.addEventListener('click', () => { visibleCount = shown + REVEAL_STEP; paint(); });
      stage.appendChild(more);
    }

    buildFoot();
  }

  // What's happening to the rest of their games while they choose. One line, then
  // Home's banner, then a word when it's ready (game-analysis.ts).
  function buildAnalysisNote(): HTMLElement {
    const note = document.createElement('div');
    note.className = 'recap-analysis';
    note.setAttribute('role', 'status');
    note.appendChild(Icons.review(18));
    const text = document.createElement('p');
    const lead = document.createElement('strong');
    lead.textContent = `${t('recap.analysis.lead')} `;
    text.appendChild(lead);
    text.appendChild(document.createTextNode(t('recap.analysis.rest')));
    note.appendChild(text);
    return note;
  }

  // Their picture and handle, the way every other identity surface in the app
  // shows them. The avatar is Chess.com-only (Lichess publishes none), and
  // userAvatar falls back to the generic glyph on its own.
  function buildIdentity(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'recap-identity';
    row.appendChild(userAvatar(deps.avatarUrl, 52));

    const text = document.createElement('div');
    text.className = 'recap-identity-text';
    const handle = document.createElement('span');
    handle.className = 'recap-identity-handle';
    handle.textContent = deps.username ? `@${deps.username}` : t('recap.yourGames');
    text.appendChild(handle);
    const count = document.createElement('span');
    count.className = 'recap-identity-count';
    count.textContent = t('recap.gamesRead', { n: recap.total });
    text.appendChild(count);
    row.appendChild(text);
    return row;
  }

  // How their play splits, as two bars rather than a sentence of numbers.
  //
  // "16 as White · 15 as Black · 52% wins" made the reader do arithmetic to
  // find the one thing that matters here — which colour they play, and how it
  // goes. Two proportional bars answer both at a glance, and the colour of the
  // pip ties each row to the pips on the cards below.
  function buildRecord(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'recap-record';

    for (const colour of ['white', 'black'] as const) {
      const games = colour === 'white' ? recap.white : recap.black;
      if (games === 0) continue;

      const row = document.createElement('div');
      row.className = 'recap-record-row';

      row.appendChild(colourPip(colour));

      const label = document.createElement('span');
      label.className = 'recap-record-label';
      label.textContent = t(colour === 'white' ? 'common.white' : 'common.black');
      row.appendChild(label);

      // The win/draw/loss split for that colour, summed from its openings.
      // Games whose opening we could not name are not in any group, so this is
      // a share of the games we can actually speak about — the bar is
      // normalised to that, never to a total it doesn't cover.
      let w = 0;
      let d = 0;
      let l = 0;
      for (const o of recap.openings) {
        if (o.colour !== colour) continue;
        w += o.wins; d += o.draws; l += o.losses;
      }
      const decided = w + d + l;

      const bar = document.createElement('span');
      bar.className = 'recap-bar';
      if (decided > 0) {
        for (const [cls, n] of [['win', w], ['draw', d], ['loss', l]] as const) {
          if (n === 0) continue;
          const seg = document.createElement('span');
          seg.className = `recap-bar-seg recap-bar-seg--${cls}`;
          seg.style.width = `${(n / decided) * 100}%`;
          bar.appendChild(seg);
        }
      }
      row.appendChild(bar);

      const pct = document.createElement('span');
      pct.className = 'recap-record-pct';
      pct.textContent = decided > 0 ? `${Math.round((w / decided) * 100)}%` : '—';
      row.appendChild(pct);

      wrap.appendChild(row);
    }
    return wrap;
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
      row.setAttribute('aria-label', t('recap.timeFormat'));

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
          exhausted.clear(); // fewer games can agree for longer, or for less
          refilter();
        });
        row.appendChild(b);
      };

      chip(t('recap.all'), null, recap.byTimeClass.reduce((n, b) => n + b.games, 0));
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
      save.textContent = n === 0 ? t('recap.pickOne') : t('recap.save', { n });
      save.disabled = n === 0;
      save.addEventListener('click', () => { close(); deps.onSave(selectedOpenings()); });
      foot.appendChild(save);

      // The free tier's training slots, counted where the decision is made.
      if (Number.isFinite(deps.freeLimit) && deps.freeLimit < Number.MAX_SAFE_INTEGER && n > 0) {
        const slots = document.createElement('p');
        slots.className = 'recap-slots';
        const over = n - deps.freeLimit;
        slots.textContent = over > 0
          ? t('recap.slots.over', { n: over, limit: deps.freeLimit })
          : t('recap.slots.used', { n, limit: deps.freeLimit });
        foot.appendChild(slots);
      }
    }

    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = recap.openings.length > 0 ? 'recap-skip' : 'btn-primary recap-save';
    skip.textContent = t(recap.openings.length > 0 ? 'recap.skipForNow' : 'common.continue');
    skip.addEventListener('click', () => {
      // One quiet word used to be all that stood between a first run and an
      // empty app. It now says what skipping costs, once, in the place the tap
      // landed. No dialog: this is the same decision, not a new one.
      if (deps.firstRun && recap.openings.length > 0) { askBeforeSkipping(); return; }
      close();
      deps.onSkip();
    });
    foot.appendChild(skip);
  }

  function askBeforeSkipping(): void {
    foot.replaceChildren();
    const note = document.createElement('p');
    note.className = 'recap-slots';
    note.textContent = t('recap.skipNote');
    foot.appendChild(note);

    const keep = document.createElement('button');
    keep.type = 'button';
    keep.className = 'btn-primary recap-save';
    keep.textContent = t('recap.keepPicking');
    keep.addEventListener('click', () => { foot.replaceChildren(); buildFoot(); });
    foot.appendChild(keep);

    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'recap-skip';
    skip.textContent = t('recap.skipOpenings');
    skip.addEventListener('click', () => { close(); deps.onSkip(); });
    foot.appendChild(skip);
  }

  // One more of the user's own moves on this line, if their games agree on one.
  function deepenLine(opening: OpeningGroup): void {
    const key = keyOf(opening);
    const next = ownMoveCount(opening.ucis.length, opening.colour) + 1;
    const grown = next <= MAX_OWN_MOVES ? deps.onDeepen(opening, next) : null;
    if (!grown) {
      exhausted.add(key);
      paint();
      return;
    }
    depths.set(key, next);
    refilter({ keepOrder: true });
  }

  // Add or remove a line. The free tier's ceiling is NOT enforced here: the
  // foot shows how many training slots the choice uses, and anything past them
  // is saved paused — said before the save, never discovered after it.
  function toggleChosen(key: string): void {
    if (chosen.has(key)) {
      chosen.delete(key);
    } else {
      chosen.add(key);
    }
    paint();
  }

  // The popup, handed everything it needs to act on this one line.
  function openPreview(opening: OpeningGroup): void {
    const key = keyOf(opening);
    const current = ownMoveCount(opening.ucis.length, opening.colour);
    deps.onPreview(opening, {
      selected: chosen.has(key),
      canDeepen: current < MAX_OWN_MOVES && deps.onDeepen(opening, current + 1) !== null,
      onToggle: () => toggleChosen(key),
      onDeepen: () => {
        const next = Math.min(MAX_OWN_MOVES, current + 1);
        const grown = deps.onDeepen(opening, next);
        if (!grown) return;
        depths.set(key, next);
        refilter({ keepOrder: true });
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
      // The miniature and "See the line" open the preview; the rest of the card
      // toggles the tick (UX-AUDIT 2.2.3).
      onMiniClick: () => openPreview(opening),
      miniLabel: t('recap.card.playThrough', { opening: openingLabel(opening.name) }),
    });

    titleRow.appendChild(colourPip(opening.colour));
    const name = document.createElement('span');
    name.className = 'recap-card-name';
    name.textContent = openingLabel(opening.name);
    titleRow.appendChild(name);

    const meta = document.createElement('p');
    meta.className = 'recap-card-meta';
    meta.textContent = t(opening.colour === 'white' ? 'recap.card.metaWhite' : 'recap.card.metaBlack',
      { n: opening.games, share: opening.share });
    content.appendChild(meta);

    const record = document.createElement('p');
    record.className = 'recap-card-record';
    record.appendChild(Icons.barChart(13));
    const text = document.createElement('span');
    text.textContent = t('recap.card.record', { wins: opening.wins, draws: opening.draws, losses: opening.losses });
    record.appendChild(text);
    content.appendChild(record);

    // ── How long it is, and how to see it ──
    //
    // Length was only changeable inside the preview, where most people would never
    // find it (UX-AUDIT 2.2.5). It's the user's OWN moves: what they'd have to learn.
    const tools = document.createElement('div');
    tools.className = 'recap-card-tools';
    const own = ownMoveCount(opening.ucis.length, opening.colour);
    const length = document.createElement('span');
    length.className = 'recap-card-length';
    length.textContent = t('recap.card.moves', { n: own });
    tools.appendChild(length);
    if (own < MAX_OWN_MOVES && !exhausted.has(key)) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'recap-card-more';
      more.textContent = '＋';
      more.setAttribute('aria-label', t('recap.card.addMove', { opening: openingLabel(opening.name) }));
      more.addEventListener('click', (e) => { e.stopPropagation(); deepenLine(opening); });
      tools.appendChild(more);
    }
    const see = document.createElement('button');
    see.type = 'button';
    see.className = 'recap-card-see';
    see.textContent = t('recap.card.seeLine');
    see.addEventListener('click', (e) => { e.stopPropagation(); openPreview(opening); });
    tools.appendChild(see);
    content.appendChild(tools);

    // ── Selected or not ──
    //
    // What the card's own tap does, shown where it can be read. The press lands on
    // the card behind it, so it needs no handler of its own.
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'recap-toggle' + (on ? ' recap-toggle--on' : '');
    toggle.setAttribute('aria-pressed', String(on));
    toggle.textContent = t(on ? 'recap.card.selected' : 'recap.card.select');
    content.appendChild(toggle);

    // THE CARD IS THE CHOICE. It used to open the preview, with a smaller pill on
    // it doing the actual choosing: two targets, and the one people expected was
    // the one that did something else.
    card.addEventListener('click', () => toggleChosen(key));

    return card;
  }

  refilter();
  document.body.appendChild(overlay);
  document.documentElement.classList.add('picker-open');
}


