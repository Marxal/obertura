// The Explore tab — four top-level pillars, tabbed exactly like My Lines:
//   1. Recommended — openings you play a lot but score poorly in, built from
//                    your imported games. Build a solid line and train it.
//   2. Packs       — the curated library: starter packs and traps, both
//                    filterable by colour and by tag (skill level, or "Traps").
//   3. Learn       — content for the openings in your repertoire (videos,
//                    studies, theory shortcuts + hand-picked pins). Body lives
//                    in content-explore.ts.
//   4. Scouting    — scout imported opponents; tapping one opens a full-screen
//                    DETAIL view with their most-played openings per colour and
//                    their auto-built opening maps. "Add opponent" and a
//                    per-opponent "Refresh" reuse the one import panel, pointed
//                    at a scouting sink instead of "my games". Hidden entirely
//                    when scouting is off in Settings.
//
// (Distinct from explore.ts, the in-board explorer.)

import type { Line } from './types';
import type { ImportedGame } from './chesscom';
import { fetchAvatar } from './chesscom';
import type { MoveNode } from './tree';
import { Icons } from './icons';
import { showDialog } from './dialog';
import { openImportPanel } from './import-panel';
import { openRepertoireMap } from './repertoire-map';
import { openSpar, type SparMode } from './spar';
import { loadBookLines, pickBookLine, pickGameLine } from './book-lines';
import {
  analyseGames, UNKNOWN_FAMILY, MIN_GAMES_WEAK, WEAK_SCORE_PCT, type OpeningStat,
} from './analysis';
import { buildPositionCard, colourPip, fenFromUcis } from './card-position';
import {
  getAllLines, getAllGames, getAllOpponents, getOpponent, saveOpponent, deleteOpponent, deleteLine,
} from './storage';
import { isEntitled, buildCapNotice, showTrainingCapDialog, FREE_SCOUT_OPPONENTS } from './entitlement';
import {
  MAX_OPPONENTS, makeOpponent, opponentLine, colourGameCount, opponentTag, isOpponentTag,
  opponentSummary, buildOpponentTree, opponentReachPlies, MIN_REPORT_GAMES,
  MAP_START_PLIES, MAP_STEP_PLIES, MAP_MAX_PLIES,
  type Opponent,
} from './scout';
import { loadTraps, trapCard } from './traps-screen';
import { trapsForPairs, type TrapPack } from './traps';
import { buildLearnTab } from './content-explore';
import { loadPacks, type Pack, type PackLine, type LineSeed } from './onboarding-starter';
import { buildStudySection } from './study-browser';
import { wdlBlock, wdlScoreRow } from './wdl-bar';
import { buildMoveStats } from './move-stats';
import { createFilterBar, type FilterSelection } from './filters';
import { renderFamilyGroups } from './line-groups';
import { buildEmptyState } from './empty-state';
import { pushBack } from './back-nav';
import { formatSanLine } from './notation';

const PLATFORM_LABEL = { chesscom: 'Chess.com', lichess: 'Lichess' } as const;
// Most-played list cap before "Show all".
const TOP_OPENINGS = 6;
// How many openings the scouting report shows per group (struggle / score).
const REPORT_PICKS = 3;
// Persistence key for the prepared-lines filter bar (shared across opponents;
// stale tags from another opponent are sanitised away on load).
const PREP_FILTER_KEY = 'obertura.prep.filter';

// Persistence key for the "Their openings" colour filter (All / White / Black),
// shared across opponents — it carries no per-opponent state.
const OPENINGS_FILTER_KEY = 'obertura.scout.openings.filter';

// The scouting report's filters: a colour segment (All / White / Black) and a
// Weakest / Strongest toggle, both shared across opponents.
const REPORT_FILTER_KEY = 'obertura.scout.report.filter';
const REPORT_RANK_KEY = 'obertura.scout.report.rank';
type ReportRank = 'weakest' | 'strongest';

// What the Explore tab hands back to the app shell (main.ts): seed the builder
// with a prepared reply, or open one of my saved lines. Held at module scope —
// like train-screen's onViewLine — so the many internal re-renders (which only
// pass a container) keep working.
export interface ExploreDeps {
  // Open the builder seeded with the opponent's moves, flipped to my answering
  // colour, tagged to the opponent.
  onPrepareReply: (ucis: string[], answeringColour: 'white' | 'black', opponentName: string) => void;
  // Open a saved line in the builder/line view.
  onOpenLine: (line: Line) => void;
  // Seed the builder with a move sequence (from the opening library, a game
  // sparred against the engine, or a trap), oriented to the chosen colour. No
  // opponent tag — this is a plain reference line. `opts.description` shows a
  // transient hint under the builder title (used to carry a trap's idea across).
  onOpenInBuilder: (
    ucis: string[],
    colour: 'white' | 'black',
    opts?: { description?: string; notes?: Record<number, string> },
  ) => void;
  // Open the builder's Scouting tab on this opponent (the new "board browser").
  onScoutInBuilder: (opponentId: string) => void;
  // Save imported study chapters straight to My Lines (the Packs tab's Lichess
  // study browser). Resolves with how many were actually saved.
  onSaveLines: (seeds: LineSeed[], colour: 'white' | 'black') => Promise<number>;
}

let exploreDeps: ExploreDeps | null = null;

// Set by the builder's "Full report" action so the next Explore render opens
// straight into this opponent's detail.
let pendingOpponentId: string | null = null;
export function openExploreOpponent(id: string): void { pendingOpponentId = id; }

// Whether a new opponent may be added right now, and if not, tries to clear
// the way. Three cases:
//   • Under the applicable cap (MAX_OPPONENTS entitled, FREE_SCOUT_OPPONENTS
//     free) → proceed straight away.
//   • Free tier with EXACTLY one saved opponent → offer to REPLACE it (not a
//     refusal): confirming deletes it and proceeds.
//   • Anyone else at/over their cap (entitled at MAX_OPPONENTS, or a free
//     account grandfathered with more than one from before this cap existed)
//     → the existing refusal. Never auto-delete a user's pre-existing state —
//     they choose what goes, same as the entitled "delete one" flow.
async function ensureRoomForOpponent(): Promise<'proceed' | 'blocked'> {
  const entitled = isEntitled();
  const existing = await getAllOpponents();
  const cap = entitled ? MAX_OPPONENTS : FREE_SCOUT_OPPONENTS;
  if (existing.length < cap) return 'proceed';

  if (entitled || existing.length > FREE_SCOUT_OPPONENTS) {
    return new Promise(resolve => {
      showDialog({
        title: 'Opponent limit reached',
        body: entitled
          ? `You can scout up to ${MAX_OPPONENTS} opponents. Delete one to make room first.`
          : `Free accounts scout ${FREE_SCOUT_OPPONENTS} opponent at a time. Delete one to make room first, `
            + `or unlock full access to scout up to ${MAX_OPPONENTS}.`,
        buttons: entitled
          ? [{ label: 'OK', variant: 'primary', onClick: () => resolve('blocked') }]
          : [
            { label: 'Not now', variant: 'secondary', onClick: () => resolve('blocked') },
            { label: 'Unlock full access', variant: 'primary', onClick: () => { showTrainingCapDialog(); resolve('blocked'); } },
          ],
        onDismiss: () => resolve('blocked'),
      });
    });
  }

  // Free tier, exactly one saved opponent — offer the swap.
  const current = existing[0];
  return new Promise(resolve => {
    showDialog({
      title: `Replace ${current.name}?`,
      body: `Free accounts scout ${FREE_SCOUT_OPPONENTS} opponent at a time. Scouting someone new replaces `
        + `${current.name}.`,
      buttons: [
        { label: 'Cancel', variant: 'secondary', onClick: () => resolve('blocked') },
        {
          label: `Replace ${current.name}`,
          variant: 'primary',
          onClick: () => { void deleteOpponent(current.id).then(() => resolve('proceed')); },
        },
      ],
      onDismiss: () => resolve('blocked'),
    });
  });
}

// Import a new opponent without the Explore screen — used by the builder's
// Scouting tab. Imports + saves, then calls onDone (e.g. to refresh the list).
export function importOpponentFlow(onDone: () => void): void {
  void (async () => {
    if ((await ensureRoomForOpponent()) === 'blocked') return;
    openImportPanel({
      title: 'Scout an opponent',
      username: '',
      rememberUser: false,
      save: async (games, metaInfo) => {
        const avatarUrl = metaInfo.avatarUrl ??
          (metaInfo.platform === 'chesscom' ? await fetchAvatar(metaInfo.username) : undefined);
        await saveOpponent(makeOpponent(metaInfo, games, { avatarUrl }));
      },
      onImported: () => onDone(),
    });
  })();
}

// Returns the rebuild promise so callers that must wait for a fresh list (the
// delete flow) can await it before revealing the screen; everyone else ignores
// it and renders fire-and-forget.
export function renderExploreScreen(container: HTMLElement, deps?: ExploreDeps): Promise<void> {
  if (deps) exploreDeps = deps;
  return buildScreen(container);
}

// ── Direct entry points for the global FAB ────────────────────────────────────
// Let the FAB open Explore's "Build with the engine" and "Board browser" flows
// from any tab, without first navigating to (and rendering) Explore. They take
// the same deps object renderExploreScreen does, so the builder-seed handler is
// wired even on a cold open.

export async function openEngineSpar(deps: ExploreDeps): Promise<void> {
  exploreDeps = deps;
  const games = await getAllGames();
  openSparSheet(games.length > 0);
}

async function buildScreen(container: HTMLElement): Promise<void> {
  container.innerHTML = '';

  // Everything the screen needs, fetched once up front so the tabs render in the
  // agreed order without round-trips: my games + lines feed Recommended and the
  // traps relevance, and the opponents feed Scouting.
  const [opponents, lines, games] = await Promise.all([
    getAllOpponents(), getAllLines(), getAllGames(),
  ]);
  // Newest refresh first, so the one you just touched leads.
  opponents.sort((a, b) => b.refreshedAt.localeCompare(a.refreshedAt));
  const [trapPacks, starterPacks] = await Promise.all([loadTraps(), loadPacks()]);

  // A "Full report" tap from the builder's Scouting tab asks us to open straight
  // into one opponent's detail — force the Scouting tab active for it.
  if (pendingOpponentId) exploreTab = 'scouting';

  container.appendChild(
    exploreTabsSection(games, lines, trapPacks, starterPacks, opponents, container),
  );

  if (pendingOpponentId) {
    const id = pendingOpponentId;
    pendingOpponentId = null;
    openDetail(id, container);
  }
}


// ── Explore tabs (Recommended | Packs | Learn | Scouting) ────────────────────

// Which tab is showing. Module-level so it survives the screen's rebuilds.
type ExploreTab = 'recommended' | 'packs' | 'learn' | 'scouting';
let exploreTab: ExploreTab | null = null;

// One block with the pillars, laid out exactly like the My Lines screen
// (the same .lines-tabs switcher + padded .lines-tab-content body, so the side
// margins line up): Recommended picks from your games, the curated Packs library
// (starter packs + traps, filterable), Learn (content for your openings), and
// Scouting — hidden entirely when scouting is off in Settings. No section
// title: Explore leads straight with this.
function exploreTabsSection(
  games: ImportedGame[],
  lines: Line[],
  trapPacks: TrapPack[],
  starterPacks: Pack[],
  opponents: Opponent[],
  container: HTMLElement,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'lines-try';

  const recommended = buildRecommendedTab(games, lines, container);
  // Built on first visit, then reused: the Packs body is heavy enough (traps
  // relevance analysis + the lazily-fetched study catalogue) that it shouldn't
  // pay its cost when Explore opens onto Recommended and never leaves it.
  let packsTab: HTMLElement | null = null;

  // Default to Recommended when it has real picks, else Packs (always populated).
  if (exploreTab === null) {
    exploreTab = recommended.hasContent ? 'recommended' : 'packs';
  }

  const tabs = document.createElement('div');
  tabs.className = 'lines-tabs';
  const content = document.createElement('div');
  content.className = 'lines-tab-content';

  const tabEl = (tab: ExploreTab): HTMLElement => {
    if (tab === 'recommended') return recommended.el;
    if (tab === 'packs') return (packsTab ??= buildPacksTab(starterPacks, trapPacks, games, lines));
    if (tab === 'learn') {
      return buildLearnTab(lines, () => exploreDeps?.onOpenInBuilder([], 'white'));
    }
    return buildScoutingTab(opponents, container);
  };

  const render = (): void => {
    content.innerHTML = '';
    content.appendChild(tabEl(exploreTab!));
    tabs.querySelectorAll<HTMLElement>('.lines-tab').forEach(btn => {
      const active = btn.dataset.tab === exploreTab;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-current', active ? 'true' : 'false');
    });
  };

  const makeTab = (tab: ExploreTab, label: string, icon: SVGElement): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lines-tab';
    btn.dataset.tab = tab;
    icon.classList.add('lines-tab-icon');
    btn.appendChild(icon);
    const span = document.createElement('span');
    span.className = 'lines-tab-label';
    span.textContent = label;
    btn.appendChild(span);
    btn.addEventListener('click', () => {
      if (exploreTab === tab) return;
      exploreTab = tab;
      render();
    });
    return btn;
  };

  tabs.appendChild(makeTab('recommended', 'Recommended', Icons.sparkles(18)));
  tabs.appendChild(makeTab('packs', 'Packs', Icons.build(18)));
  tabs.appendChild(makeTab('learn', 'Learn', Icons.video(18)));
  tabs.appendChild(makeTab('scouting', 'Scouting', Icons.target(18)));
  wrap.appendChild(tabs);
  wrap.appendChild(content);
  render();
  return wrap;
}

// The Recommended tab body + whether it actually surfaced any picks (used to pick
// the default tab). Picks come from the same games heuristic as before.
function buildRecommendedTab(
  games: ImportedGame[],
  lines: Line[],
  container: HTMLElement,
): { el: HTMLElement; hasContent: boolean } {
  // The marker CSS needs to give the two colour groups a column each above the
  // desktop breakpoint (see .explore-recommended in style.css).
  const wrap = document.createElement('div');
  wrap.className = 'explore-recommended';
  const desc = document.createElement('p');
  desc.className = 'section-desc';
  desc.textContent =
    'Openings you play a lot but score poorly in — build a solid line and train it.';
  wrap.appendChild(desc);

  let white: OpeningStat[] = [];
  let black: OpeningStat[] = [];
  if (games.length > 0) {
    const analysis = analyseGames(games, lines);
    white = recommendedFor(analysis.stats, 'white');
    black = recommendedFor(analysis.stats, 'black');
  }

  if (games.length === 0) {
    wrap.appendChild(buildEmptyState({
      icon: Icons.sparkles(28),
      line: 'Import your games to get tailored picks — openings you play a lot but score poorly in.',
      cta: {
        label: 'Import your games',
        onClick: () => openImportPanel({ onImported: () => renderExploreScreen(container) }),
      },
    }));
    return { el: wrap, hasContent: false };
  }

  if (white.length === 0 && black.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'section-desc';
    empty.textContent = 'No weak spots to flag yet — nice. Check back after more games.';
    wrap.appendChild(empty);
    return { el: wrap, hasContent: false };
  }

  if (white.length > 0) wrap.appendChild(reportGroup('As White', white.map(recommendationCard)));
  if (black.length > 0) wrap.appendChild(reportGroup('As Black', black.map(recommendationCard)));
  return { el: wrap, hasContent: true };
}

// Pack.level isn't a clean skill-level tag for every pack (the onboarding data
// has one "Easy to learn" outlier) — normalise it so the filter chips match.
function normalizePackLevel(level: string): string {
  return level === 'Easy to learn' ? 'Beginner' : level;
}

// The Packs tab body, three scannable layers:
//   1. Curated starter packs — one COLLAPSED accordion card per pack (title,
//      colour, level · style · line count at a glance; the line cards only
//      render when a pack is opened, so the tab reads as a short list instead
//      of a wall of every line in every pack).
//   2. Traps — one accordion card holding the flat, relevance-sorted pool
//      (traps in the families you play float to the top).
//   3. Lichess studies — the offline study catalogue: search + picks for your
//      repertoire, imported live as tagged lines (study-browser.ts).
// Packs and traps sit behind the All / White / Black + tag filter bar. Tags
// are skill level (Beginner / Intermediate / Advanced) plus a "Traps"
// content-type tag, OR-matched like every other tag filter in the app.
function buildPacksTab(
  starterPacks: Pack[],
  trapPacks: TrapPack[],
  games: ImportedGame[],
  lines: Line[],
): HTMLElement {
  const wrap = document.createElement('div');
  const desc = document.createElement('p');
  desc.className = 'section-desc';
  desc.textContent = 'Curated packs and traps — open one and build a line from it.';
  wrap.appendChild(desc);

  const buildTrap = (ucis: string[], colour: 'white' | 'black', description: string) =>
    exploreDeps?.onOpenInBuilder(ucis, colour, { description });

  // Flatten the traps, then float traps in the families you play to the top
  // (stable sort keeps the pack order — White then Black — within each group).
  const allTraps = trapPacks.flatMap(p => p.traps.map(t => ({ trap: t, colour: p.colour })));
  const relevant = new Set<string>();
  if (games.length > 0) {
    try {
      const wants = analyseGames(games, lines).stats
        .filter(s => s.family !== UNKNOWN_FAMILY)
        .map(s => ({ family: s.family, colour: s.colour }));
      trapsForPairs(trapPacks, wants).forEach(m => relevant.add(m.trap.name));
    } catch { /* relevance is a bonus; ignore data errors */ }
  }
  const orderedTraps = [...allTraps].sort(
    (a, b) => (relevant.has(a.trap.name) ? 0 : 1) - (relevant.has(b.trap.name) ? 0 : 1),
  );

  const list = document.createElement('div');
  list.className = 'onb-packs packs-list';

  const renderList = (sel: FilterSelection): void => {
    list.innerHTML = '';
    const matchingPacks = starterPacks.filter(pack =>
      (sel.colour === 'all' || pack.colour === sel.colour) &&
      (sel.tags.length === 0 || sel.tags.includes(normalizePackLevel(pack.level))));
    const matchingTraps = orderedTraps.filter(x =>
      (sel.colour === 'all' || x.colour === sel.colour) &&
      (sel.tags.length === 0 || sel.tags.includes(x.trap.level) || sel.tags.includes('Traps')));

    if (matchingPacks.length === 0 && matchingTraps.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'section-desc';
      empty.textContent = 'No packs match these filters.';
      list.appendChild(empty);
      return;
    }
    for (const pack of matchingPacks) {
      list.appendChild(packAccordion({
        title: pack.title,
        meta: `${normalizePackLevel(pack.level)} · ${pack.style} · ${pack.lines.length} lines`,
        colour: pack.colour,
        buildBody: () => {
          const blurb = document.createElement('p');
          blurb.className = 'onb-pack-blurb';
          blurb.textContent = pack.blurb;
          const cards = document.createElement('div');
          cards.className = 'group packs-pack-lines';
          for (const line of pack.lines) cards.appendChild(packLineCard(pack, line));
          return [blurb, cards];
        },
      }));
    }
    if (matchingTraps.length > 0) {
      list.appendChild(packAccordion({
        title: 'Traps',
        meta: `${matchingTraps.length} sneaky wins — ones in your openings first`,
        buildBody: () => {
          const cards = document.createElement('div');
          cards.className = 'group packs-pack-lines';
          for (const x of matchingTraps) cards.appendChild(trapCard(x.trap, x.colour, buildTrap));
          return [cards];
        },
      }));
    }
  };

  const filter = createFilterBar({
    persistKey: 'obertura.packs.filter',
    userTags: ['Beginner', 'Intermediate', 'Advanced', 'Traps'],
    onChange: renderList,
  });
  wrap.appendChild(filter.element);
  wrap.appendChild(list);
  renderList(filter.selection);

  // Lichess studies — its own titled section under the curated material. Not
  // part of the colour/level filter: studies are per-opening, not per-colour.
  const studiesTitle = document.createElement('div');
  studiesTitle.className = 'section-title packs-studies-title';
  studiesTitle.textContent = 'Lichess studies';
  wrap.appendChild(studiesTitle);
  wrap.appendChild(buildStudySection({
    lines,
    games,
    onSaveLines: (seeds, colour) =>
      exploreDeps ? exploreDeps.onSaveLines(seeds, colour) : Promise.resolve(0),
  }));

  return wrap;
}

// One collapsed, tappable card for the Packs list — title + one meta line to
// scan; the body only renders on first open (each pack holds several position
// cards with board miniatures, so building them all up front made the tab a
// heavy wall). Reuses the onboarding pack-picker's accordion look.
function packAccordion(o: {
  title: string;
  meta: string;
  colour?: 'white' | 'black';
  buildBody: () => HTMLElement[];
}): HTMLElement {
  const card = document.createElement('div');
  card.className = 'onb-pack';

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'onb-pack-head';
  head.setAttribute('aria-expanded', 'false');

  const titles = document.createElement('span');
  titles.className = 'onb-pack-titles';
  const title = document.createElement('span');
  title.className = 'onb-pack-title';
  if (o.colour) title.appendChild(colourPip(o.colour));
  title.appendChild(document.createTextNode(o.title));
  titles.appendChild(title);
  const meta = document.createElement('span');
  meta.className = 'onb-pack-meta';
  meta.textContent = o.meta;
  titles.appendChild(meta);
  head.appendChild(titles);

  const chev = document.createElement('span');
  chev.className = 'onb-pack-chev';
  chev.setAttribute('aria-hidden', 'true');
  chev.appendChild(Icons.chevronRight(18));
  head.appendChild(chev);

  const body = document.createElement('div');
  body.className = 'onb-pack-body';
  body.hidden = true;

  let built = false;
  head.addEventListener('click', () => {
    const open = body.hidden;
    if (open && !built) {
      built = true;
      for (const el of o.buildBody()) body.appendChild(el);
    }
    body.hidden = !open;
    head.classList.toggle('onb-pack-head--open', open);
    head.setAttribute('aria-expanded', String(open));
  });

  card.appendChild(head);
  card.appendChild(body);
  return card;
}

function packLineCard(pack: Pack, line: PackLine): HTMLElement {
  const build = () => exploreDeps?.onOpenInBuilder(line.ucis, pack.colour, {
    description: line.plan ?? pack.blurb,
    notes: line.notes as Record<number, string> | undefined,
  });

  const { card, titleRow, content } = buildPositionCard({
    fen: fenFromUcis(line.ucis),
    orientation: pack.colour,
    className: 'games-card',
    onMiniClick: build,
    miniLabel: 'Build this line',
  });

  titleRow.appendChild(colourPip(pack.colour));
  const nameEl = document.createElement('span');
  nameEl.className = 'pcard-name';
  nameEl.textContent = line.name;
  titleRow.appendChild(nameEl);

  const movesEl = document.createElement('div');
  movesEl.className = 'review-moves stat-card-note';
  movesEl.textContent = formatSanLine(line.sans);
  content.appendChild(movesEl);

  if (line.plan) {
    const planEl = document.createElement('div');
    planEl.className = 'stat-card-note';
    planEl.textContent = line.plan;
    content.appendChild(planEl);
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-secondary stat-card-btn';
  btn.textContent = 'Build line';
  btn.addEventListener('click', e => {
    e.stopPropagation();
    build();
  });
  content.appendChild(btn);

  return card;
}

// ── Scouting ──────────────────────────────────────────────────────────────────

// The Scouting tab body. No section title here — the tab nav already reads
// "Scouting" — so the head row pairs the description with the opponent count.
function buildScoutingTab(opponents: Opponent[], container: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');

  // No opponents yet: the shared empty-state pattern carries the way in (its CTA
  // is the add-opponent flow), so the standalone description + Add button are
  // dropped here to avoid doubling up.
  if (opponents.length === 0) {
    wrap.appendChild(buildEmptyState({
      icon: Icons.target(28),
      line: 'Scout your first opponent.',
      cta: { label: 'Add opponent', onClick: () => addOpponent(container) },
    }));
    return wrap;
  }

  const head = document.createElement('div');
  head.className = 'section-head';
  const desc = document.createElement('p');
  desc.className = 'section-desc';
  desc.textContent =
    'Import an opponent’s games to scout their openings and build a map of what they play.';
  head.appendChild(desc);
  const meta = document.createElement('span');
  meta.className = 'section-meta';
  const entitled = isEntitled();
  // Silent above the free cap too (a grandfathered tester keeps every saved
  // opponent, same as the Train screen's line cap): once there are more than
  // FREE_SCOUT_OPPONENTS, the meta line reads against MAX_OPPONENTS like an
  // entitled account's, and the discreet notice below goes quiet with it.
  const overFreeCap = !entitled && opponents.length > FREE_SCOUT_OPPONENTS;
  meta.textContent = `${opponents.length} / ${entitled || overFreeCap ? MAX_OPPONENTS : FREE_SCOUT_OPPONENTS}`;
  head.appendChild(meta);
  wrap.appendChild(head);

  if (!entitled && opponents.length === FREE_SCOUT_OPPONENTS) {
    wrap.appendChild(buildCapNotice(`Scouting ${FREE_SCOUT_OPPONENTS} opponent`));
  }

  // Add-opponent button.
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'games-refresh-btn scout-add-btn';
  addBtn.appendChild(Icons.plus(15));
  addBtn.appendChild(document.createTextNode('Add opponent'));
  addBtn.addEventListener('click', () => addOpponent(container));
  wrap.appendChild(addBtn);

  // The roster grids into columns above the desktop breakpoint (see
  // .scout-opponents in style.css); the head and Add button stay full width.
  const list = document.createElement('div');
  list.className = 'group scout-opponents';
  for (const opp of opponents) list.appendChild(opponentCard(opp, container));
  wrap.appendChild(list);

  return wrap;
}

// ── Spar with the engine ─────────────────────────────────────────────────────

// Friendly difficulty names mapped to Stockfish's UCI Skill Level (0–20), each
// with a think-time budget. The top two levels actually get time to think; the
// easy levels stay snappy (skill, not time, is what makes them easy).
const SPAR_LEVELS = [
  { id: 'casual', label: 'Casual', skill: 3, movetime: 300 },
  { id: 'club', label: 'Club', skill: 8, movetime: 300 },
  { id: 'strong', label: 'Strong', skill: 14, movetime: 900 },
  { id: 'master', label: 'Master', skill: 20, movetime: 1400 },
] as const;

// Remembered across re-renders so the picker keeps its last setting.
let sparColour: 'white' | 'black' = 'white';
let sparLevelId: (typeof SPAR_LEVELS)[number]['id'] = 'club';

// The engine-opening mode is persisted device-local (tiny, like the library
// view mode in library.ts), so the picker survives a reload.
const SPAR_MODE_KEY = 'obertura.spar.mode';
function getSparMode(): SparMode {
  const v = localStorage.getItem(SPAR_MODE_KEY);
  return v === 'surprise' || v === 'games' || v === 'engine' ? v : 'surprise';
}
let sparMode: SparMode = getSparMode();

// The settings bottom sheet: Level / Play-as / Engine-opening pickers plus the
// Play button. The pickers mutate the same persisted module state as before, so
// the chosen settings survive between opens and reloads.
function openSparSheet(hasGames: boolean): void {
  // A persisted "From my games" with no games left falls back to Surprise me.
  if (sparMode === 'games' && !hasGames) sparMode = 'surprise';
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet spar-sheet';

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    overlay.remove();
    removeBack();
  }
  const removeBack = pushBack(close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const title = document.createElement('h3');
  title.className = 'edit-sheet-title';
  title.textContent = 'Build with the engine';
  sheet.appendChild(title);

  // Level picker.
  sheet.appendChild(sparPickerRow('Level',
    SPAR_LEVELS.map(l => ({ value: l.id, label: l.label })),
    sparLevelId,
    (v) => { sparLevelId = v as typeof sparLevelId; }));

  // Play-as side picker.
  sheet.appendChild(sparPickerRow('Play as', [
    { value: 'white', label: '○ White' },
    { value: 'black', label: '● Black' },
  ], sparColour, (v) => { sparColour = v as 'white' | 'black'; }));

  // Engine-opening picker — its own full-width row, since the labels are long.
  sheet.appendChild(sparModeRow(hasGames));

  // The Play button: close the sheet as the spar board opens, so the back stack
  // stays tidy. startSpar runs the chosen settings exactly as before.
  const startBtn = document.createElement('button');
  startBtn.type = 'button';
  startBtn.className = 'btn-primary spar-start-btn';
  startBtn.appendChild(Icons.play(15));
  startBtn.appendChild(document.createTextNode('Play'));
  startBtn.addEventListener('click', () => { void startSpar(startBtn, close); });
  sheet.appendChild(startBtn);

  document.body.appendChild(overlay);
  overlay.appendChild(sheet);
}

// Build the engine opening for the chosen mode, then open the spar board. For
// "Surprise me" we draw a fresh random book line per game; for "From my games"
// we sample a line from my imported games on the side I'm sparring.
async function startSpar(startBtn: HTMLButtonElement, onLaunch?: () => void): Promise<void> {
  if (!exploreDeps) return;
  const level = SPAR_LEVELS.find(l => l.id === sparLevelId) ?? SPAR_LEVELS[1];

  let nextBookLine: (() => string[]) | undefined;
  if (sparMode === 'surprise') {
    // The library file is lazy-loaded; guard against a double-tap while it lands.
    startBtn.disabled = true;
    try {
      const entries = await loadBookLines();
      nextBookLine = () => pickBookLine(entries);
    } finally {
      startBtn.disabled = false;
    }
  } else if (sparMode === 'games') {
    const games = await getAllGames();
    const colour = sparColour;
    nextBookLine = () => pickGameLine(games, colour);
  }

  // Dismiss the settings sheet just as the spar board opens.
  onLaunch?.();

  openSpar({
    colour: sparColour,
    skill: level.skill,
    movetimeMs: level.movetime,
    levelLabel: level.label,
    mode: sparMode,
    nextBookLine,
    onOpenInBuilder: exploreDeps.onOpenInBuilder,
  });
}

// The engine-opening picker: a full-width segmented control with a one-line hint
// beneath. "From my games" is disabled (with an explaining hint) until games are
// imported. The choice is persisted.
function sparModeRow(hasGames: boolean): HTMLElement {
  const row = document.createElement('div');
  row.className = 'spar-mode-row';

  const lab = document.createElement('span');
  lab.className = 'spar-picker-label';
  lab.textContent = 'Engine opening';
  row.appendChild(lab);

  const seg = document.createElement('div');
  seg.className = 'seg-control seg-control--full';
  seg.setAttribute('role', 'group');

  const hint = document.createElement('p');
  hint.className = 'spar-mode-hint';

  const opts: { value: SparMode; label: string; disabled: boolean }[] = [
    { value: 'surprise', label: 'Surprise me', disabled: false },
    { value: 'games', label: 'From my games', disabled: !hasGames },
    { value: 'engine', label: 'Pure engine', disabled: false },
  ];
  const buttons: HTMLButtonElement[] = [];
  const reflect = () => {
    for (const b of buttons) {
      const on = b.dataset.value === sparMode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    // When there are no games, the disabled option is the thing worth explaining.
    hint.textContent = !hasGames
      ? '“From my games” needs imported games — import some in My games first.'
      : sparMode === 'surprise' ? 'The engine opens with a random recognisable book line.'
      : sparMode === 'games' ? 'The engine opens with an opening from your imported games.'
      : 'No book — the engine plays its own moves from the first move.';
  };

  for (const opt of opts) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'seg-btn';
    btn.dataset.value = opt.value;
    btn.textContent = opt.label;
    if (opt.disabled) {
      btn.disabled = true;
    } else {
      btn.addEventListener('click', () => {
        sparMode = opt.value;
        localStorage.setItem(SPAR_MODE_KEY, sparMode);
        reflect();
      });
    }
    buttons.push(btn);
    seg.appendChild(btn);
  }
  reflect();

  row.appendChild(seg);
  row.appendChild(hint);
  return row;
}

// A labelled segmented control (reusing the settings .seg-control look).
function sparPickerRow(
  label: string,
  options: { value: string; label: string }[],
  current: string,
  onChange: (v: string) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'spar-picker-row';

  const lab = document.createElement('span');
  lab.className = 'spar-picker-label';
  lab.textContent = label;
  row.appendChild(lab);

  const seg = document.createElement('div');
  seg.className = 'seg-control';
  seg.setAttribute('role', 'group');
  const buttons: HTMLButtonElement[] = [];
  const reflect = (active: string) => {
    for (const b of buttons) {
      const on = b.dataset.value === active;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  };
  for (const opt of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'seg-btn';
    btn.dataset.value = opt.value;
    btn.textContent = opt.label;
    btn.addEventListener('click', () => { reflect(opt.value); onChange(opt.value); });
    buttons.push(btn);
    seg.appendChild(btn);
  }
  reflect(current);
  row.appendChild(seg);
  return row;
}

// ── Visualize your play (board browser + your games / repertoire trees) ───────
//
// Three ways to see YOUR play on the board:
//   • Board browser — walk positions on a real board with your games' per-move
//     W/D/L (formerly the "Line browser"); a White/Black toggle flips the side.
//   • Your games tree — what you actually play, from imported games (like an
//     opponent map, but yours).
//   • Your repertoire tree — your saved lines merged into one tree.
// The data wiring — buildMoveStats for per-move W/D/L, the depth configs, and the
// opponent-tree builder for the games map — is carried over intact. (Opponent
// maps stay inside the scouting detail view, untouched.)

// Plies in a line's longest variation (root has no move, so its children are
// ply 1). Drives whether the repertoire map can "Go deeper" than the default.
function treeDepth(node: MoveNode): number {
  if (!node.children.length) return 0;
  return 1 + Math.max(...node.children.map(treeDepth));
}

// A single full-width entry (icon + title + count + chevron) for a map type.
// Opens the Tree; the White/Black choice now lives INSIDE, at the top of the
// opened tree, rather than as a pre-split pair of buttons out here.
function mapEntryBtn(
  icon: SVGElement,
  title: string,
  countText: string,
  onClick: () => void,
  variant?: 'primary' | 'discrete',
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'rmap-entry' + (variant ? ` rmap-entry--${variant}` : '');
  icon.classList.add('rmap-entry-icon');
  btn.appendChild(icon);

  const text = document.createElement('span');
  text.className = 'rmap-entry-text';
  const titleEl = document.createElement('span');
  titleEl.className = 'rmap-entry-title';
  titleEl.textContent = title;
  text.appendChild(titleEl);
  const count = document.createElement('span');
  count.className = 'rmap-entry-count';
  count.textContent = countText;
  text.appendChild(count);
  btn.appendChild(text);

  const chev = Icons.chevronRight(18);
  chev.classList.add('rmap-entry-chevron');
  btn.appendChild(chev);

  btn.addEventListener('click', onClick);
  return btn;
}

// ── Opponent card ────────────────────────────────────────────────────────────────

// A small round avatar for a scouted player: their Chess.com picture when we
// have one, otherwise a fallback user icon. Used on the opponent card and in
// the detail header so they read as people, not just usernames.
function buildAvatar(opp: Opponent, size: number): HTMLElement {
  if (opp.avatarUrl) {
    const img = document.createElement('img');
    img.className = 'scout-avatar';
    img.src = opp.avatarUrl;
    img.alt = '';
    img.width = size;
    img.height = size;
    img.loading = 'lazy';
    // A broken/blocked image quietly falls back to the icon.
    img.addEventListener('error', () => img.replaceWith(buildAvatarIcon(size)));
    return img;
  }
  return buildAvatarIcon(size);
}

function buildAvatarIcon(size: number): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'scout-avatar scout-avatar--icon';
  wrap.style.width = `${size}px`;
  wrap.style.height = `${size}px`;
  wrap.appendChild(Icons.userCircle(Math.round(size * 0.7)));
  return wrap;
}

function opponentCard(opp: Opponent, container: HTMLElement): HTMLElement {
  const summary = opponentSummary(opp);
  const open = () => openDetail(opp.id, container);

  // A roster card — no board, no opening: just who they are and how they score.
  // The position-card scaffold (with no fen) gives us the title-row + content
  // layout without a miniature, so opponents still read like the app's cards.
  const { card, titleRow, content } = buildPositionCard({
    fen: null,
    className: 'opponent-card',
  });
  card.setAttribute('role', 'button');
  card.tabIndex = 0;
  card.addEventListener('click', open);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });

  // Title row: avatar + name + platform chip + a chevron pinned right so it
  // reads tappable.
  titleRow.appendChild(buildAvatar(opp, 28));
  const nameEl = document.createElement('span');
  nameEl.className = 'pcard-name';
  nameEl.textContent = opp.name;
  titleRow.appendChild(nameEl);
  const plat = document.createElement('span');
  plat.className = 'tag-chip opponent-card-platform';
  plat.textContent = PLATFORM_LABEL[opp.platform];
  titleRow.appendChild(plat);
  const chevron = Icons.chevronRight(18);
  chevron.classList.add('scout-card-chevron');
  titleRow.appendChild(chevron);

  // Their overall W-D-L bar (the reusable component).
  content.appendChild(wdlBlock({
    wins: summary.wins,
    draws: summary.draws,
    losses: summary.losses,
    scorePct: summary.scorePct,
    games: summary.games,
  }, `${opp.name}'s results`));

  // Meta: games analysed + when last refreshed.
  const meta = document.createElement('div');
  meta.className = 'opponent-card-meta';
  meta.textContent =
    `${summary.games} game${summary.games === 1 ? '' : 's'} · refreshed ${timeAgo(opp.refreshedAt)}`;
  content.appendChild(meta);

  return card;
}

// ── Add / refresh flows (the shared import panel, scouting sink) ──────────────────

function addOpponent(container: HTMLElement): void {
  void (async () => {
    if ((await ensureRoomForOpponent()) === 'blocked') return;
    let addedId: string | null = null;
    openImportPanel({
      title: 'Scout an opponent',
      username: '',
      rememberUser: false,
      save: async (games, metaInfo) => {
        // The opponent's Chess.com picture, when they have one (Lichess has
        // none). The panel already fetched it for the loader; fall back to a
        // fresh lookup just in case. Purely cosmetic — a miss shows the icon.
        const avatarUrl = metaInfo.avatarUrl ??
          (metaInfo.platform === 'chesscom' ? await fetchAvatar(metaInfo.username) : undefined);
        const opp = makeOpponent(metaInfo, games, { avatarUrl });
        await saveOpponent(opp);
        addedId = opp.id;
      },
      onImported: () => {
        renderExploreScreen(container);
        if (addedId) openDetail(addedId, container);
      },
    });
  })();
}

function refreshOpponent(opp: Opponent, container: HTMLElement, onDone: () => void): void {
  openImportPanel({
    title: `Refresh ${opp.name}`,
    platform: opp.platform,
    username: opp.username,
    rememberUser: false,
    save: async (games, metaInfo) => {
      // Prefer the picture the panel just fetched (so a newly-set one appears),
      // then a fresh lookup, then the one we already had.
      const avatarUrl = metaInfo.avatarUrl ??
        (metaInfo.platform === 'chesscom' ? await fetchAvatar(metaInfo.username) : undefined) ??
        opp.avatarUrl;
      await saveOpponent(makeOpponent(metaInfo, games, { id: opp.id, avatarUrl }));
    },
    onImported: () => {
      renderExploreScreen(container);
      onDone();
    },
  });
}

// ── Detail view (full-screen overlay) ────────────────────────────────────────────

function openDetail(id: string, container: HTMLElement): void {
  void (async () => {
    const opp = await getOpponent(id);
    if (!opp) { renderExploreScreen(container); return; }
    // My saved lines prepared against this opponent (tagged "vs <name>").
    const tag = opponentTag(opp.name);
    const allLines = await getAllLines();
    const myPrep = allLines.filter(l => l.tags.includes(tag));
    // One analysis pass over their games — the openings list and the scouting
    // report findings are both read off the same OpeningStat[].
    const stats = analyseGames(opp.games, []).stats;

    const overlay = document.createElement('div');
    overlay.className = 'rmap-overlay scout-detail';
    // Header + body mount into this box rather than the overlay directly, so
    // that above the desktop breakpoint the overlay can become a dimmed
    // backdrop and the box a centred card — see .scout-detail/.scout-detail-box
    // in style.css. Below the breakpoint the box is just a 100% passthrough.
    const box = document.createElement('div');
    box.className = 'scout-detail-box';
    overlay.appendChild(box);

    let closed = false;
    function close(): void {
      if (closed) return;
      closed = true;
      overlay.remove();
      removeBack();
    }
    const removeBack = pushBack(close);
    // Backdrop tap only does anything once the overlay is a dimmed backdrop
    // (desktop, ≥960px) — harmless no-op below that, since the box fills it.
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // Header.
    const header = document.createElement('div');
    header.className = 'rmap-header';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'rmap-back';
    back.setAttribute('aria-label', 'Close opponent');
    back.appendChild(Icons.back(20));
    back.addEventListener('click', close);
    const titleEl = document.createElement('h2');
    titleEl.className = 'rmap-title';
    titleEl.textContent = opp.name;
    const badge = document.createElement('span');
    badge.className = 'rmap-title-count';
    badge.textContent = PLATFORM_LABEL[opp.platform];
    header.appendChild(back);
    header.appendChild(buildAvatar(opp, 32));
    header.appendChild(titleEl);
    header.appendChild(badge);
    box.appendChild(header);

    // Scrollable body.
    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'scout-detail-body';

    // Summary + actions.
    const summary = document.createElement('p');
    summary.className = 'section-desc scout-summary';
    summary.textContent = `${opp.gamesAnalysed} game${opp.gamesAnalysed === 1 ? '' : 's'} analysed · refreshed ${timeAgo(opp.refreshedAt)}`;
    bodyWrap.appendChild(summary);

    const actions = document.createElement('div');
    actions.className = 'scout-actions';
    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'btn-secondary';
    refreshBtn.appendChild(Icons.reset(15));
    refreshBtn.appendChild(document.createTextNode('Refresh'));
    refreshBtn.addEventListener('click', () => {
      refreshOpponent(opp, container, () => { close(); openDetail(id, container); });
    });
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-danger';
    deleteBtn.appendChild(Icons.trash(15));
    deleteBtn.appendChild(document.createTextNode('Delete'));
    // Delete. The games and the scouting maps always go; the only choice is what
    // happens to the prepared lines tagged against this opponent. Refresh the
    // list FIRST and only then drop the detail overlay, so the back of the deck
    // is already fresh — never the stale list the old ordering flashed.
    const removeOpponent = (alsoDeleteLines: boolean) => {
      void (async () => {
        if (alsoDeleteLines) await Promise.all(myPrep.map(l => deleteLine(l.id)));
        await deleteOpponent(id);
        await renderExploreScreen(container);
        close();
      })();
    };
    deleteBtn.addEventListener('click', () => {
      // No prep against them — a plain two-button confirm.
      if (myPrep.length === 0) {
        showDialog({
          title: `Delete ${opp.name}?`,
          body: `This removes ${opp.name}'s imported games and scouting maps from this device.`,
          buttons: [
            { label: 'Delete', variant: 'danger', onClick: () => removeOpponent(false) },
            { label: 'Cancel', variant: 'secondary' },
          ],
        });
        return;
      }
      // They have prepared lines — offer to keep them (still useful, tagged) or
      // sweep them away too, with a live count.
      const n = myPrep.length;
      const them = n === 1 ? 'it' : 'them';
      showDialog({
        title: `Delete ${opp.name}?`,
        body: `${opp.name}'s games and scouting maps will be removed. You have ${n} prepared line${n === 1 ? '' : 's'} tagged “vs ${opp.name}” — keep ${them} in My Lines, or delete ${them} too?`,
        buttons: [
          { label: `Keep my ${n} line${n === 1 ? '' : 's'}`, variant: 'primary', onClick: () => removeOpponent(false) },
          { label: 'Delete the lines too', variant: 'danger', onClick: () => removeOpponent(true) },
          { label: 'Cancel', variant: 'secondary' },
        ],
      });
    });
    actions.appendChild(refreshBtn);
    actions.appendChild(deleteBtn);
    bodyWrap.appendChild(actions);

    // Prepare a reply: leave the detail (and any open map) for the builder,
    // seeded with the opponent's moves and flipped to MY answering colour —
    // the opposite of the colour they played in this map/opening.
    const prepare = (ucis: string[], opponentColour: 'white' | 'black') => {
      close();
      exploreDeps?.onPrepareReply(ucis, opponentColour === 'white' ? 'black' : 'white', opp.name);
    };

    // 1) Visualize their games — at the top (mirrors the Explore tab's
    //    "Visualize your play"): a Board browser and their games tree, both
    //    pointed at THEIR games and handing "Prepare a reply" back here.
    // Board browser closes this overlay first — otherwise it stays mounted on
    // top of the builder we open and the button looks dead.
    bodyWrap.appendChild(visualizeOpponentSection(opp, prepare,
      () => { close(); exploreDeps?.onScoutInBuilder(opp.id); }));

    // 2) Scouting report — their overall W-D-L bar, then the two findings
    //    (where they struggle / where they score) tucked in an accordion, each
    //    shown as the same rich card as Their openings.
    bodyWrap.appendChild(reportSection(opp, stats, prepare));

    // 3) My prep against this opponent, when I have any.
    if (myPrep.length > 0) {
      bodyWrap.appendChild(yourPrepSection(myPrep, line => { close(); exploreDeps?.onOpenLine(line); }));
    }

    // 4) Their most-played openings — one list with an All / White / Black
    //    filter (mirrors My Lines), rather than two split colour sections.
    bodyWrap.appendChild(openingsSection(opp, stats, prepare));

    box.appendChild(bodyWrap);
    document.body.appendChild(overlay);
  })();
}

// ── Scouting report (their record + a filtered findings list) ─────────────────────

// The report: the opponent's overall W-D-L bar ("Their results" — the one place
// that caption appears, fixing the perspective for the whole detail), then —
// once they have a deep enough sample — a single findings list driven by two
// filters: a colour segment (All / White / Black) and a Weakest / Strongest
// toggle. Each finding is the SAME rich card as "Their openings" (board, moves,
// W-D-L, "Prepare a reply"), fed the matching OpeningStat. With no opening
// reaching the games floor, an honest empty line replaces the list.
function reportSection(opp: Opponent, stats: OpeningStat[], prepare: PrepareFn): HTMLElement {
  const section = document.createElement('div');
  // A stronger border/background than the plain .section — this accordion
  // needs to read as its own boxed card, distinct from the openings list
  // right below it, even when collapsed to just its header.
  section.className = 'section scout-report-box';

  // Collapsed by default — this section doubles the W-D-L bar already shown
  // on the roster card, so it's detail you opt into, not a first read.
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'section-head section-head--toggle';
  head.setAttribute('aria-expanded', 'false');
  const h = document.createElement('h2');
  h.className = 'section-title';
  h.textContent = `Quick report of ${opp.name}`;
  head.appendChild(h);
  const chev = document.createElement('span');
  chev.className = 'section-toggle-chev';
  chev.setAttribute('aria-hidden', 'true');
  chev.appendChild(Icons.chevronRight(18));
  head.appendChild(chev);
  section.appendChild(head);

  const body = document.createElement('div');
  body.className = 'section-toggle-body';
  body.hidden = true;
  section.appendChild(body);

  head.addEventListener('click', () => {
    const open = body.hidden;
    body.hidden = !open;
    head.setAttribute('aria-expanded', String(open));
  });

  const summary = opponentSummary(opp);
  body.appendChild(wdlBlock({
    wins: summary.wins,
    draws: summary.draws,
    losses: summary.losses,
    scorePct: summary.scorePct,
    games: summary.games,
  }, `${opp.name}'s results`));

  // Only recognised families with a real sample of their games count — fewer is
  // noise, not a tendency.
  const qualifying = stats.filter(s => s.family !== UNKNOWN_FAMILY && s.games >= MIN_REPORT_GAMES);
  if (qualifying.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'section-desc scout-report-empty';
    empty.textContent = 'Not enough games for a report yet — import more.';
    body.appendChild(empty);
    return section;
  }

  // Colour segment (shared filter bar, no sort/tags) + a Weakest/Strongest
  // toggle riding alongside it on the same row.
  let rank: ReportRank = localStorage.getItem(REPORT_RANK_KEY) === 'strongest' ? 'strongest' : 'weakest';
  const list = document.createElement('div');
  list.className = 'group';

  const filter = createFilterBar({
    persistKey: REPORT_FILTER_KEY,
    onChange: () => rebuildList(),
  });
  filter.element.querySelector('.fbar-top')?.appendChild(
    buildRankSeg(rank, r => { rank = r; localStorage.setItem(REPORT_RANK_KEY, r); rebuildList(); }),
  );
  body.appendChild(filter.element);
  body.appendChild(list);

  function rebuildList(): void {
    list.innerHTML = '';
    const sel = filter.selection;
    const filtered = sel.colour === 'all' ? qualifying : qualifying.filter(s => s.colour === sel.colour);
    const shown = [...filtered].sort(rank === 'weakest'
      ? (a, b) => a.scorePct - b.scorePct || b.games - a.games || a.family.localeCompare(b.family)
      : (a, b) => b.scorePct - a.scorePct || b.games - a.games || a.family.localeCompare(b.family));

    if (shown.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'section-desc';
      empty.textContent = 'No openings on this side.';
      list.appendChild(empty);
      return;
    }

    shown.forEach((stat, i) => {
      const card = openingCard(stat, prepare);
      if (i >= REPORT_PICKS) card.hidden = true;
      list.appendChild(card);
    });

    if (shown.length > REPORT_PICKS) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'btn-secondary scout-show-all';
      more.textContent = `Show all ${shown.length}`;
      more.addEventListener('click', () => {
        for (const c of Array.from(list.children) as HTMLElement[]) c.hidden = false;
        more.remove();
      });
      list.appendChild(more);
    }
  }

  rebuildList();
  return section;
}

// A small two-button Weakest/Strongest segment, styled like the colour segment.
function buildRankSeg(current: ReportRank, onPick: (r: ReportRank) => void): HTMLElement {
  const seg = document.createElement('div');
  seg.className = 'dfilter-seg';
  const opts: { key: ReportRank; label: string }[] = [
    { key: 'weakest', label: 'Weakest' },
    { key: 'strongest', label: 'Strongest' },
  ];
  for (const o of opts) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `dfilter-btn${current === o.key ? ' active' : ''}`;
    btn.textContent = o.label;
    btn.addEventListener('click', () => {
      seg.querySelectorAll('.dfilter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onPick(o.key);
    });
    seg.appendChild(btn);
  }
  return seg;
}

// One titled cluster of report rows.
function reportGroup(title: string, rows: HTMLElement[]): HTMLElement {
  const group = document.createElement('div');
  group.className = 'scout-report-group';

  const label = document.createElement('div');
  label.className = 'scout-report-group-title';
  label.textContent = title;
  group.appendChild(label);

  const list = document.createElement('div');
  list.className = 'group';
  for (const row of rows) list.appendChild(row);
  group.appendChild(list);
  return group;
}

// ── Your prep (my saved lines tagged to this opponent) ────────────────────────────

// Expanded opening families in the grouped prep list (module scope; survives the
// list's in-place rebuilds within an opponent view).
const prepExpanded = new Set<string>();

function yourPrepSection(lines: Line[], onOpen: (line: Line) => void): HTMLElement {
  const section = document.createElement('div');
  section.className = 'section';
  const head = document.createElement('div');
  head.className = 'section-head';
  const h = document.createElement('h2');
  h.className = 'section-title';
  h.textContent = 'Your prep';
  head.appendChild(h);
  const m = document.createElement('span');
  m.className = 'section-meta';
  m.textContent = `${lines.length} line${lines.length === 1 ? '' : 's'}`;
  head.appendChild(m);
  section.appendChild(head);

  // The shared filter bar (filters.ts). These lines are all prepared against the
  // one opponent, so there's no opponent-tag group, no status and no sort — just
  // colour on row 1 and any of my own tags on row 2. The bar drops empty groups.
  const list = document.createElement('div');
  list.className = 'group';

  const filter = createFilterBar({
    persistKey: PREP_FILTER_KEY,
    userTags: distinctUserTags(lines),
    group: true,
    onChange: () => rebuildList(),
  });
  section.appendChild(filter.element);
  section.appendChild(list);

  function rebuildList(): void {
    list.innerHTML = '';
    const sel = filter.selection;
    let shown = sel.colour === 'all' ? lines : lines.filter(l => l.colour === sel.colour);
    if (sel.tags.length > 0) shown = shown.filter(l => sel.tags.some(t => l.tags.includes(t)));

    if (shown.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'section-desc';
      empty.textContent = 'No prep matches these filters.';
      list.appendChild(empty);
      return;
    }

    if (filter.selection.group) {
      renderFamilyGroups(list, shown, line => prepCard(line, onOpen), prepExpanded);
    } else {
      for (const line of shown) list.appendChild(prepCard(line, onOpen));
    }
  }

  rebuildList();
  return section;
}

// Every distinct user-authored tag (everything that isn't a "vs <name>" tag).
function distinctUserTags(lines: Line[]): string[] {
  const set = new Set<string>();
  for (const l of lines) for (const t of l.tags) if (!isOpponentTag(t)) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}

function prepCard(line: Line, onOpen: (line: Line) => void): HTMLElement {
  const card = document.createElement('div');
  card.className = 'line-card';
  const body = document.createElement('div');
  body.className = 'line-card-body';
  body.setAttribute('role', 'button');
  body.tabIndex = 0;
  const open = () => onOpen(line);
  body.addEventListener('click', open);
  body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });

  const nameEl = document.createElement('div');
  nameEl.className = 'line-card-name';
  nameEl.textContent = line.name || line.openingName || 'Untitled line';
  body.appendChild(nameEl);

  const metaRow = document.createElement('div');
  metaRow.className = 'line-card-meta';
  metaRow.appendChild(chip(line.colour === 'white' ? '○ White' : '● Black'));
  if (line.openingName && line.openingName !== nameEl.textContent) {
    metaRow.appendChild(chip(line.openingName));
  }
  body.appendChild(metaRow);

  card.appendChild(body);
  return card;
}

// Seed a prepared reply from the opponent's move sequence; the colour passed is
// the colour THEY played (the answering side is the opposite).
type PrepareFn = (ucis: string[], opponentColour: 'white' | 'black') => void;

// Visualize their games — a Board browser + their games tree, mirroring the
// Explore tab's "Visualize your play" but pointed at THIS opponent's games. Both
// hand "Prepare a reply" back through `prepare`, and each carries its own
// White/Black toggle (greying out a side they never played).
function visualizeOpponentSection(opp: Opponent, prepare: PrepareFn, onBoardBrowser: () => void): HTMLElement {
  const section = document.createElement('div');
  section.className = 'section';
  const head = document.createElement('div');
  head.className = 'section-head';
  const h = document.createElement('h2');
  h.className = 'section-title';
  h.textContent = `Visualize ${opp.name}’s games`;
  head.appendChild(h);
  section.appendChild(head);

  const entries = document.createElement('div');
  entries.className = 'rmap-entries';
  section.appendChild(entries);

  const has = (c: 'white' | 'black') => colourGameCount(opp, c) > 0;
  if (!has('white') && !has('black')) {
    const empty = document.createElement('p');
    empty.className = 'section-desc';
    empty.textContent = 'No games to visualize yet.';
    section.appendChild(empty);
    return section;
  }
  const start: 'white' | 'black' = has('white') ? 'white' : 'black';
  const enabled = { white: has('white'), black: has('black') };

  // Board browser — now opens the builder's Scouting tab on this opponent, where
  // you walk their games from the live position and play replies straight onto
  // the line you're building.
  entries.appendChild(mapEntryBtn(Icons.compass(24), 'Board browser',
    `Walk ${opp.name}’s games in the builder`,
    onBoardBrowser, 'primary'));

  // Their games tree — the auto-built opponent map, colour toggling inside.
  const openTree = (colour: 'white' | 'black'): void => {
    const games = colourGameCount(opp, colour);
    openRepertoireMap(
      // The map rebuilds the pruned tree from stored games at each depth (see
      // `atDepth`); this line is just the seed used for preview association.
      [opponentLine(buildOpponentTree(opp.games, colour, MAP_START_PLIES, false), colour, opp.name)],
      colour,
      () => { /* opponent maps have no "open in builder" */ },
      {
        title: `${opp.name} — ${colour === 'white' ? 'White' : 'Black'}`,
        subtitle: `${games} game${games === 1 ? '' : 's'}`,
        // Prepare a reply from any node: seed the builder with the path to it.
        nodeAction: { label: 'Prepare a reply', onAct: ({ ucis }) => prepare(ucis, colour) },
        depth: {
          startPlies: MAP_START_PLIES,
          stepPlies: MAP_STEP_PLIES,
          maxPlies: opponentReachPlies(opp, colour),
          // Feed the FULL (unpruned) tree so the map's "All replies" view shows
          // every move they played; "Frequent" prunes it by stats.
          atDepth: plies => [opponentLine(buildOpponentTree(opp.games, colour, plies, false), colour, opp.name)],
          importHint: true,
        },
        // Per-move W/D/L from THEIR perspective (the scouted user was "me" at
        // import), built to the deep limit so the deeper view has stats too.
        stats: { tree: buildMoveStats(opp.games, colour, MAP_MAX_PLIES), caption: `${opp.name}'s results`, games: opp.games },
        // Preview the position from MY answering side, with their avatar/name.
        perspective: {
          you: colour === 'white' ? 'black' : 'white',
          opponent: { name: opp.name, avatarUrl: opp.avatarUrl },
        },
        colourToggle: { current: colour, enabled, onPick: openTree },
      },
    );
  };
  entries.appendChild(mapEntryBtn(Icons.search(24), `${opp.name}'s games tree`,
    `${opp.gamesAnalysed} game${opp.gamesAnalysed === 1 ? '' : 's'}`, () => openTree(start), 'discrete'));

  return section;
}

// Sort order for an opening list. Mirrors saved lines' sort menu, but over the
// stats we have here: most-played by default, then by their score, then name.
const OPENING_ORDERS: { key: string; label: string }[] = [
  { key: 'played', label: 'Most played' },
  { key: 'weakest', label: 'Weakest' },
  { key: 'strongest', label: 'Strongest' },
  { key: 'name', label: 'Name' },
];

function sortStats(stats: OpeningStat[], mode: string): OpeningStat[] {
  const copy = [...stats];
  switch (mode) {
    case 'weakest':
      return copy.sort((a, b) => a.scorePct - b.scorePct || b.games - a.games);
    case 'strongest':
      return copy.sort((a, b) => b.scorePct - a.scorePct || b.games - a.games);
    case 'name':
      return copy.sort((a, b) => a.family.localeCompare(b.family));
    case 'played':
    default:
      return copy.sort((a, b) => b.games - a.games);
  }
}

// Their most-played openings — both colours in one list, filtered by an
// All / White / Black segment and a sort menu (the shared filter bar, mirroring
// My Lines). Top-N per filter, with a "Show all" reveal.
function openingsSection(opp: Opponent, stats: OpeningStat[], prepare: PrepareFn): HTMLElement {
  const section = document.createElement('div');
  section.className = 'section';
  const head = document.createElement('div');
  head.className = 'section-head';
  const h = document.createElement('h2');
  h.className = 'section-title';
  h.textContent = `${opp.name}'s openings`;
  head.appendChild(h);
  if (stats.length > 0) {
    const m = document.createElement('span');
    m.className = 'section-meta';
    m.textContent = `${stats.length} opening${stats.length === 1 ? '' : 's'}`;
    head.appendChild(m);
  }
  section.appendChild(head);

  if (stats.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'section-desc';
    empty.textContent = 'No openings yet.';
    section.appendChild(empty);
    return section;
  }

  // Colour segment + sort menu (no tags/status) — the same All/White/Black
  // segment and sort dropdown used by saved lines and the prep list.
  const list = document.createElement('div');
  list.className = 'group';
  const filter = createFilterBar({
    persistKey: OPENINGS_FILTER_KEY,
    sorts: OPENING_ORDERS,
    defaultSort: 'played',
    onChange: () => rebuildList(),
  });
  section.appendChild(filter.element);
  section.appendChild(list);

  function rebuildList(): void {
    list.innerHTML = '';
    const sel = filter.selection;
    const filtered = sel.colour === 'all' ? stats : stats.filter(s => s.colour === sel.colour);
    const shown = sortStats(filtered, sel.sort);

    if (shown.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'section-desc';
      empty.textContent = 'No openings on this side.';
      list.appendChild(empty);
      return;
    }

    shown.forEach((stat, i) => {
      const card = openingCard(stat, prepare);
      if (i >= TOP_OPENINGS) card.hidden = true;
      list.appendChild(card);
    });

    if (shown.length > TOP_OPENINGS) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'btn-secondary scout-show-all';
      more.textContent = `Show all ${shown.length}`;
      more.addEventListener('click', () => {
        for (const c of Array.from(list.children) as HTMLElement[]) c.hidden = false;
        more.remove();
      });
      list.appendChild(more);
    }
  }

  rebuildList();
  return section;
}

function openingCard(stat: OpeningStat, prepare: PrepareFn): HTMLElement {
  // The shared position-card scaffold, so each opening shows a miniature of its
  // representative line (gated by the global "show line miniatures" toggle) and
  // reads like the rest of the app's cards.
  const { card, titleRow, content } = buildPositionCard({
    fen: stat.repUcis.length > 0 ? fenFromUcis(stat.repUcis) : null,
    orientation: stat.colour,
    className: 'opening-card',
  });

  // Title row: colour pip + opening family name.
  titleRow.appendChild(colourPip(stat.colour));
  const nameEl = document.createElement('span');
  nameEl.className = 'pcard-name';
  nameEl.textContent = stat.family;
  titleRow.appendChild(nameEl);

  // Played-count chip.
  const metaRow = document.createElement('div');
  metaRow.className = 'line-card-meta';
  const gamesChip = document.createElement('span');
  gamesChip.className = 'review-stat-chip';
  gamesChip.textContent = `Played ${stat.games}×`;
  metaRow.appendChild(gamesChip);
  content.appendChild(metaRow);

  // Their result on this opening, as a slim bar: score% left, the W-D-L split as
  // segments, the bare counts in small text on the right. The perspective is
  // already captioned once up in the scouting report, so no caption repeats here.
  content.appendChild(wdlScoreRow({
    wins: stat.wins,
    draws: stat.draws,
    losses: stat.losses,
    scorePct: stat.scorePct,
    games: stat.games,
  }));

  if (stat.repSans.length > 0) {
    const lineEl = document.createElement('div');
    lineEl.className = 'review-moves';
    lineEl.textContent = formatSanLine(stat.repSans);
    content.appendChild(lineEl);
  }

  // Prepare a reply against this opening's representative line.
  const prepareBtn = document.createElement('button');
  prepareBtn.type = 'button';
  prepareBtn.className = 'btn-secondary scout-prepare';
  prepareBtn.textContent = 'Prepare a reply';
  if (stat.repUcis.length === 0) {
    prepareBtn.disabled = true;
    prepareBtn.title = 'No moves to seed from';
  } else {
    prepareBtn.addEventListener('click', () => prepare(stat.repUcis, stat.colour));
  }
  content.appendChild(prepareBtn);

  return card;
}

// ── Recommended lines to try (games-gated) ───────────────────────────────────
//
// Once games are imported, surface up to 4 openings per colour worth building a
// solid line for. HEURISTIC: openings you reach OFTEN ENOUGH to matter
// (≥ MIN_GAMES_WEAK games) but UNDER-PERFORM in (score under WEAK_SCORE_PCT, i.e.
// below even). That's the honest "you keep playing this and keep losing — go prep
// a solid line" signal. Worst score leads; ties break on most games. We require a
// recognised family (so the card has a real name) and a representative line (so
// "Build line" has moves to seed). This reuses analysis.ts's existing per-opening
// stats untouched — no extra signal was needed for a decent pick. (A future
// refinement could weight how *recent* the losses are, or down-rank openings
// you've since prepped; both would need analysis to expose more than it does now.)
function recommendedFor(stats: OpeningStat[], colour: 'white' | 'black'): OpeningStat[] {
  return stats
    .filter(s =>
      s.colour === colour &&
      s.family !== UNKNOWN_FAMILY &&
      s.repUcis.length > 0 &&
      s.games >= MIN_GAMES_WEAK &&
      s.scorePct < WEAK_SCORE_PCT)
    .sort((a, b) => a.scorePct - b.scorePct || b.games - a.games)
    .slice(0, 4);
}

// One recommendation, built on the shared position-card scaffold so it reads
// exactly like the From-my-games suggestion cards: family + colour pip on row 1,
// a miniature (honouring the global toggle) on the left of row 2 with the score,
// line and Build action on the right. "Build line" reuses the same builder seed
// path as those suggestions (onOpenInBuilder → buildFromUcis in main.ts).
function recommendationCard(stat: OpeningStat): HTMLElement {
  const { card, titleRow, content } = buildPositionCard({
    fen: fenFromUcis(stat.repUcis),
    orientation: stat.colour,
    className: 'games-card',
    onMiniClick: () => exploreDeps?.onOpenInBuilder(stat.repUcis, stat.colour),
    miniLabel: 'Build this line',
  });

  titleRow.appendChild(colourPip(stat.colour));
  const nameEl = document.createElement('span');
  nameEl.className = 'pcard-name';
  nameEl.textContent = stat.family;
  titleRow.appendChild(nameEl);

  const meta = document.createElement('div');
  meta.className = 'stat-card-chips';
  const gamesChip = document.createElement('span');
  gamesChip.className = 'review-stat-chip';
  gamesChip.textContent = `Played ${stat.games}×`;
  meta.appendChild(gamesChip);
  content.appendChild(meta);

  // Score line — bar + "42% · W-D-L".
  const scoreRow = document.createElement('div');
  scoreRow.className = 'review-score-row';
  scoreRow.appendChild(scoreBar(stat.scorePct));
  const scoreText = document.createElement('span');
  scoreText.className = 'review-score-text';
  scoreText.textContent = `${stat.scorePct}% · ${stat.wins}-${stat.draws}-${stat.losses} W-D-L`;
  scoreRow.appendChild(scoreText);
  content.appendChild(scoreRow);

  if (stat.repSans.length > 0) {
    const lineEl = document.createElement('div');
    lineEl.className = 'review-moves stat-card-note';
    lineEl.textContent = formatSanLine(stat.repSans);
    content.appendChild(lineEl);
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-secondary stat-card-btn';
  btn.textContent = 'Build line';
  btn.addEventListener('click', e => {
    e.stopPropagation();
    exploreDeps?.onOpenInBuilder(stat.repUcis, stat.colour);
  });
  content.appendChild(btn);

  return card;
}

// A win/draw/loss score bar, green→amber→red by how good the score is. (Same
// shape as the From-my-games suggestion cards in lines-screen.)
function scoreBar(pct: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'review-score-bar';
  const fill = document.createElement('div');
  fill.className = 'review-score-fill';
  fill.style.width = `${Math.max(4, Math.min(100, pct))}%`;
  fill.style.background = pct >= 55 ? '#2a6b3a' : pct >= 45 ? '#d8961f' : '#c0531f';
  wrap.appendChild(fill);
  return wrap;
}

// ── Small shared helpers ──────────────────────────────────────────────────────────

function chip(text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'tag-chip';
  el.textContent = text;
  return el;
}

// "just now" / "3h ago" / "5d ago" from an ISO timestamp.
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}
