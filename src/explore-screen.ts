// The Explore tab — opponent scouting.
//
// Lists the opponents you've imported games for (capped at MAX_OPPONENTS) as
// cards; tapping one opens a full-screen DETAIL view with their most-played
// openings per colour and their auto-built opening maps. "Add opponent" and a
// per-opponent "Refresh" both reuse the one import panel, pointed at a scouting
// sink instead of "my games". (Distinct from explore.ts, the in-board explorer.)
//
// The opening library and engine sparring arrive in later v1.2 tasks.

import type { Line } from './types';
import { Icons } from './icons';
import { showDialog } from './dialog';
import { openImportPanel } from './import-panel';
import { openRepertoireMap } from './repertoire-map';
import { openLibrary } from './library';
import { analyseGames, type OpeningStat } from './analysis';
import {
  getAllLines, getAllOpponents, getOpponent, saveOpponent, deleteOpponent, countOpponents,
} from './storage';
import {
  MAX_OPPONENTS, makeOpponent, opponentLine, colourGameCount, opponentTag, type Opponent,
} from './scout';
import { pushBack } from './back-nav';

const PLATFORM_LABEL = { chesscom: 'Chess.com', lichess: 'Lichess' } as const;
// Most-played list cap before "Show all".
const TOP_OPENINGS = 6;

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
  // Seed the builder with a move sequence (from the opening library), oriented
  // to the chosen colour. No opponent tag — this is a plain reference line.
  onOpenInBuilder: (ucis: string[], colour: 'white' | 'black') => void;
}

let exploreDeps: ExploreDeps | null = null;

export function renderExploreScreen(container: HTMLElement, deps?: ExploreDeps): void {
  if (deps) exploreDeps = deps;
  void buildScreen(container);
}

async function buildScreen(container: HTMLElement): Promise<void> {
  container.innerHTML = '';
  const opponents = await getAllOpponents();
  // Newest refresh first, so the one you just touched leads.
  opponents.sort((a, b) => b.refreshedAt.localeCompare(a.refreshedAt));

  const section = document.createElement('div');
  section.className = 'section';

  const head = document.createElement('div');
  head.className = 'section-head';
  const heading = document.createElement('h2');
  heading.className = 'section-title';
  heading.textContent = 'Opponents';
  head.appendChild(heading);
  const meta = document.createElement('span');
  meta.className = 'section-meta';
  meta.textContent = `${opponents.length} / ${MAX_OPPONENTS}`;
  head.appendChild(meta);
  section.appendChild(head);

  const desc = document.createElement('p');
  desc.className = 'section-desc';
  desc.textContent =
    'Import an opponent’s games to scout their openings and build a map of what they play.';
  section.appendChild(desc);

  // Add-opponent button.
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'games-refresh-btn scout-add-btn';
  addBtn.appendChild(Icons.plus(15));
  addBtn.appendChild(document.createTextNode('Add opponent'));
  addBtn.addEventListener('click', () => addOpponent(container));
  section.appendChild(addBtn);

  // Cards (or an empty note).
  if (opponents.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'stats-no-games scout-empty';
    empty.textContent = 'No opponents yet. Add one to start scouting.';
    section.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'lines-section';
    for (const opp of opponents) list.appendChild(opponentCard(opp, container));
    section.appendChild(list);
  }

  container.appendChild(section);
  container.appendChild(librarySection());
}

// ── Opening library ────────────────────────────────────────────────────────────────

// A launcher card for the opening library. The ~490 KB dataset is lazy-loaded
// only when the library is actually opened, so this section is free to render.
function librarySection(): HTMLElement {
  const section = document.createElement('div');
  section.className = 'section';

  const head = document.createElement('div');
  head.className = 'section-head';
  const heading = document.createElement('h2');
  heading.className = 'section-title';
  heading.textContent = 'Opening library';
  head.appendChild(heading);
  section.appendChild(head);

  const desc = document.createElement('p');
  desc.className = 'section-desc';
  desc.textContent =
    'Browse the bundled opening book — search ~3,700 openings by name or ECO code, step through the moves, and open any into the builder.';
  section.appendChild(desc);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'games-refresh-btn scout-add-btn';
  btn.appendChild(Icons.search(15));
  btn.appendChild(document.createTextNode('Browse openings'));
  btn.addEventListener('click', () => {
    openLibrary((ucis, colour) => exploreDeps?.onOpenInBuilder(ucis, colour));
  });
  section.appendChild(btn);

  return section;
}

// ── Opponent card ────────────────────────────────────────────────────────────────

function opponentCard(opp: Opponent, container: HTMLElement): HTMLElement {
  const card = document.createElement('div');
  card.className = 'line-card';

  const body = document.createElement('div');
  body.className = 'line-card-body';
  body.setAttribute('role', 'button');
  body.tabIndex = 0;
  const open = () => openDetail(opp.id, container);
  body.addEventListener('click', open);
  body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });

  const nameEl = document.createElement('div');
  nameEl.className = 'line-card-name';
  nameEl.textContent = opp.name;
  body.appendChild(nameEl);

  const metaRow = document.createElement('div');
  metaRow.className = 'line-card-meta';
  metaRow.appendChild(chip(PLATFORM_LABEL[opp.platform]));
  metaRow.appendChild(chip(`${opp.gamesAnalysed} game${opp.gamesAnalysed === 1 ? '' : 's'}`));
  metaRow.appendChild(chip(timeAgo(opp.refreshedAt)));
  body.appendChild(metaRow);

  card.appendChild(body);
  return card;
}

// ── Add / refresh flows (the shared import panel, scouting sink) ──────────────────

function addOpponent(container: HTMLElement): void {
  void (async () => {
    if (await countOpponents() >= MAX_OPPONENTS) {
      showDialog({
        title: 'Opponent limit reached',
        body: `You can scout up to ${MAX_OPPONENTS} opponents. Delete one to make room first.`,
        buttons: [{ label: 'OK', variant: 'primary' }],
      });
      return;
    }
    let addedId: string | null = null;
    openImportPanel({
      title: 'Scout an opponent',
      username: '',
      rememberUser: false,
      save: async (games, metaInfo) => {
        const opp = makeOpponent(metaInfo, games);
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
      await saveOpponent(makeOpponent(metaInfo, games, { id: opp.id }));
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
    const myPrep = (await getAllLines()).filter(l => l.tags.includes(tag));

    const overlay = document.createElement('div');
    overlay.className = 'rmap-overlay scout-detail';

    let closed = false;
    function close(): void {
      if (closed) return;
      closed = true;
      overlay.remove();
      removeBack();
    }
    const removeBack = pushBack(close);

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
    header.appendChild(titleEl);
    header.appendChild(badge);
    overlay.appendChild(header);

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
    deleteBtn.addEventListener('click', () => {
      showDialog({
        title: `Delete ${opp.name}?`,
        body: 'This removes their imported games and scouting maps from this device.',
        buttons: [
          { label: 'Delete', variant: 'danger', onClick: () => {
            void deleteOpponent(id).then(() => { close(); renderExploreScreen(container); });
          } },
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

    // My prep against this opponent, when I have any.
    if (myPrep.length > 0) {
      bodyWrap.appendChild(yourPrepSection(myPrep, line => { close(); exploreDeps?.onOpenLine(line); }));
    }

    // Opening maps (auto-built at import; open instantly).
    bodyWrap.appendChild(mapSection(opp, prepare));

    // Most-played openings, per colour.
    const analysis = analyseGames(opp.games, []);
    bodyWrap.appendChild(openingsSection(
      'Most played as White',
      analysis.stats.filter(s => s.colour === 'white'),
      prepare,
    ));
    bodyWrap.appendChild(openingsSection(
      'Most played as Black',
      analysis.stats.filter(s => s.colour === 'black'),
      prepare,
    ));

    overlay.appendChild(bodyWrap);
    document.body.appendChild(overlay);
  })();
}

// ── Your prep (my saved lines tagged to this opponent) ────────────────────────────

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

  const list = document.createElement('div');
  list.className = 'lines-section';
  for (const line of lines) {
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
    list.appendChild(card);
  }
  section.appendChild(list);
  return section;
}

// Opening-map launchers, one per colour. Disabled when there's nothing to show.
function mapSection(opp: Opponent, prepare: PrepareFn): HTMLElement {
  const section = document.createElement('div');
  section.className = 'section';
  const head = document.createElement('div');
  head.className = 'section-head';
  const h = document.createElement('h2');
  h.className = 'section-title';
  h.textContent = 'Opening map';
  head.appendChild(h);
  section.appendChild(head);

  const row = document.createElement('div');
  row.className = 'scout-map-row';
  row.appendChild(mapButton(opp, 'white', prepare));
  row.appendChild(mapButton(opp, 'black', prepare));
  section.appendChild(row);
  return section;
}

// Seed a prepared reply from the opponent's move sequence; the colour passed is
// the colour THEY played (the answering side is the opposite).
type PrepareFn = (ucis: string[], opponentColour: 'white' | 'black') => void;

function mapButton(opp: Opponent, colour: 'white' | 'black', prepare: PrepareFn): HTMLElement {
  const tree = colour === 'white' ? opp.whiteTree : opp.blackTree;
  const games = colourGameCount(opp, colour);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-secondary scout-map-btn';
  btn.textContent = colour === 'white' ? '○ White map' : '● Black map';
  if (tree.children.length === 0) {
    btn.disabled = true;
    btn.title = `No games as ${colour}`;
  } else {
    btn.addEventListener('click', () => {
      openRepertoireMap(
        [opponentLine(tree, colour, opp.name)],
        colour,
        () => { /* opponent maps have no "open in builder" */ },
        {
          title: `${opp.name} — ${colour === 'white' ? 'White' : 'Black'}`,
          subtitle: `${games} game${games === 1 ? '' : 's'}`,
          // Prepare a reply from any node: seed the builder with the path to it.
          nodeAction: {
            label: 'Prepare a reply',
            onAct: ({ ucis }) => prepare(ucis, colour),
          },
        },
      );
    });
  }
  return btn;
}

// One colour's most-played openings: top N, with a "Show all" reveal.
function openingsSection(title: string, stats: OpeningStat[], prepare: PrepareFn): HTMLElement {
  const section = document.createElement('div');
  section.className = 'section';
  const head = document.createElement('div');
  head.className = 'section-head';
  const h = document.createElement('h2');
  h.className = 'section-title';
  h.textContent = title;
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
    empty.textContent = 'No games on this side yet.';
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement('div');
  list.className = 'lines-section';
  stats.forEach((stat, i) => {
    const card = openingCard(stat, prepare);
    if (i >= TOP_OPENINGS) card.hidden = true;
    list.appendChild(card);
  });
  section.appendChild(list);

  if (stats.length > TOP_OPENINGS) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'btn-secondary scout-show-all';
    more.textContent = `Show all ${stats.length}`;
    more.addEventListener('click', () => {
      for (const c of Array.from(list.children) as HTMLElement[]) c.hidden = false;
      more.remove();
    });
    section.appendChild(more);
  }
  return section;
}

function openingCard(stat: OpeningStat, prepare: PrepareFn): HTMLElement {
  const card = document.createElement('div');
  card.className = 'line-card review-card';

  const body = document.createElement('div');
  body.className = 'line-card-body review-card-body';

  const nameEl = document.createElement('div');
  nameEl.className = 'line-card-name';
  nameEl.textContent = stat.family;
  body.appendChild(nameEl);

  const metaRow = document.createElement('div');
  metaRow.className = 'line-card-meta';
  const gamesChip = document.createElement('span');
  gamesChip.className = 'review-stat-chip';
  gamesChip.textContent = `Played ${stat.games}×`;
  metaRow.appendChild(gamesChip);
  body.appendChild(metaRow);

  const scoreRow = document.createElement('div');
  scoreRow.className = 'review-score-row';
  scoreRow.appendChild(scoreBar(stat.scorePct));
  const scoreText = document.createElement('span');
  scoreText.className = 'review-score-text';
  // Score is from the opponent's perspective — say so.
  scoreText.textContent = `${stat.scorePct}% · ${stat.wins}-${stat.draws}-${stat.losses} W-D-L`;
  scoreRow.appendChild(scoreText);
  body.appendChild(scoreRow);

  if (stat.repSans.length > 0) {
    const lineEl = document.createElement('div');
    lineEl.className = 'review-moves';
    lineEl.textContent = formatSanLine(stat.repSans);
    body.appendChild(lineEl);
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
  body.appendChild(prepareBtn);

  card.appendChild(body);
  return card;
}

// ── Small shared helpers ──────────────────────────────────────────────────────────

function chip(text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'tag-chip';
  el.textContent = text;
  return el;
}

// A win/draw/loss score bar, green→amber→red by how good the score is.
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

// "1.e4 e5 2.Nf3 Nc6 3.Bc4" from a flat SAN list.
function formatSanLine(sans: string[]): string {
  let out = '';
  for (let i = 0; i < sans.length; i++) {
    if (i % 2 === 0) out += `${i / 2 + 1}.${sans[i]} `;
    else out += `${sans[i]} `;
  }
  return out.trim();
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
