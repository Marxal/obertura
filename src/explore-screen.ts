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
import { openSpar, type SparSaveFn } from './spar';
import { analyseGames, type OpeningStat } from './analysis';
import {
  getAllLines, getAllGames, getAllOpponents, getOpponent, saveOpponent, deleteOpponent, deleteLine,
  countOpponents,
} from './storage';
import {
  MAX_OPPONENTS, makeOpponent, opponentLine, colourGameCount, opponentTag, isOpponentTag,
  opponentSummary, buildScoutReport, buildOpponentTree, opponentReachPlies,
  MAP_START_PLIES, MAP_STEP_PLIES, MAP_MAX_PLIES,
  type Opponent, type ScoutReport, type OpeningRecord, type Recommendation,
} from './scout';
import { wdlBlock, wdlScoreRow } from './wdl-bar';
import { buildMoveStats } from './move-stats';
import { createFilterBar } from './filters';
import { pushBack } from './back-nav';

const PLATFORM_LABEL = { chesscom: 'Chess.com', lichess: 'Lichess' } as const;
// Most-played list cap before "Show all".
const TOP_OPENINGS = 6;
// Persistence key for the prepared-lines filter bar (shared across opponents;
// stale tags from another opponent are sanitised away on load).
const PREP_FILTER_KEY = 'obertura.prep.filter';

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
  // Persist a game sparred against the engine as a new auto-named line, then run
  // the post-save "add to training" flow (see spar.ts / main.ts).
  onSparSave: SparSaveFn;
}

let exploreDeps: ExploreDeps | null = null;

// Returns the rebuild promise so callers that must wait for a fresh list (the
// delete flow) can await it before revealing the screen; everyone else ignores
// it and renders fire-and-forget.
export function renderExploreScreen(container: HTMLElement, deps?: ExploreDeps): Promise<void> {
  if (deps) exploreDeps = deps;
  return buildScreen(container);
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
    list.className = 'group';
    for (const opp of opponents) list.appendChild(opponentCard(opp, container));
    section.appendChild(list);
  }

  container.appendChild(librarySection());
  container.appendChild(section);
  container.appendChild(sparSection());
}

// ── Spar with the engine ─────────────────────────────────────────────────────

// Friendly difficulty names mapped to Stockfish's UCI Skill Level (0–20).
const SPAR_LEVELS = [
  { id: 'casual', label: 'Casual', skill: 3 },
  { id: 'club', label: 'Club', skill: 8 },
  { id: 'strong', label: 'Strong', skill: 14 },
  { id: 'master', label: 'Master', skill: 20 },
] as const;

// Remembered across re-renders so the picker keeps its last setting.
let sparColour: 'white' | 'black' = 'white';
let sparLevelId: (typeof SPAR_LEVELS)[number]['id'] = 'club';

// A launcher card for a casual game against the local engine. Picks a side and a
// difficulty, then opens the full-screen spar board.
function sparSection(): HTMLElement {
  const section = document.createElement('div');
  section.className = 'section';

  const head = document.createElement('div');
  head.className = 'section-head';
  const heading = document.createElement('h2');
  heading.className = 'section-title';
  heading.textContent = 'Build with the engine';
  head.appendChild(heading);
  section.appendChild(head);

  const desc = document.createElement('p');
  desc.className = 'section-desc';
  desc.textContent =
    'Play a casual game against the engine from the start, then save the moves as a new line whenever you like.';
  section.appendChild(desc);

  // Level picker.
  section.appendChild(sparPickerRow('Level',
    SPAR_LEVELS.map(l => ({ value: l.id, label: l.label })),
    sparLevelId,
    (v) => { sparLevelId = v as typeof sparLevelId; }));

  // Play-as side picker, sitting directly under the Level row.
  section.appendChild(sparPickerRow('Play as', [
    { value: 'white', label: '○ White' },
    { value: 'black', label: '● Black' },
  ], sparColour, (v) => { sparColour = v as 'white' | 'black'; }));

  // The front door: a full-width primary that starts the game.
  const startBtn = document.createElement('button');
  startBtn.type = 'button';
  startBtn.className = 'btn-primary spar-start-btn';
  startBtn.appendChild(Icons.play(15));
  startBtn.appendChild(document.createTextNode('Play'));
  startBtn.addEventListener('click', () => {
    const level = SPAR_LEVELS.find(l => l.id === sparLevelId) ?? SPAR_LEVELS[1];
    if (!exploreDeps) return;
    openSpar({
      colour: sparColour,
      skill: level.skill,
      levelLabel: level.label,
      onSparSave: exploreDeps.onSparSave,
    });
  });
  section.appendChild(startBtn);

  return section;
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
  body.className = 'line-card-body scout-card-body';
  body.setAttribute('role', 'button');
  body.tabIndex = 0;
  const open = () => openDetail(opp.id, container);
  body.addEventListener('click', open);
  body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });

  // Line 1: name, with a chevron pinned to the far right so the card reads as
  // tappable.
  const headRow = document.createElement('div');
  headRow.className = 'scout-card-head';
  const nameEl = document.createElement('div');
  nameEl.className = 'line-card-name';
  nameEl.textContent = opp.name;
  headRow.appendChild(nameEl);
  const chevron = Icons.chevronRight(18);
  chevron.classList.add('scout-card-chevron');
  headRow.appendChild(chevron);
  body.appendChild(headRow);

  const summary = opponentSummary(opp);

  // Line 2: their most-played opening, one truncated line.
  const openingEl = document.createElement('div');
  openingEl.className = 'scout-card-opening';
  openingEl.textContent = summary.topOpening ?? 'No openings yet';
  body.appendChild(openingEl);

  // Line 3: their W-D-L bar (the reusable component).
  body.appendChild(wdlBlock({
    wins: summary.wins,
    draws: summary.draws,
    losses: summary.losses,
    scorePct: summary.scorePct,
    games: summary.games,
  }));

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
    // My saved lines prepared against this opponent (tagged "vs <name>"), plus
    // my own imported games — the report ranks recommendations against how I
    // actually score in each opening family.
    const tag = opponentTag(opp.name);
    const [allLines, myGames] = await Promise.all([getAllLines(), getAllGames()]);
    const myPrep = allLines.filter(l => l.tags.includes(tag));
    const report = buildScoutReport(opp.games, myGames);

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
          body: 'This removes their imported games and scouting maps from this device.',
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
        body: `Their games and scouting maps will be removed. You have ${n} prepared line${n === 1 ? '' : 's'} tagged “vs ${opp.name}” — keep ${them} in My Lines, or delete ${them} too?`,
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

    // 1) Scouting report — the dossier opens on it: their overall W-D-L bar (the
    //    one "their results" caption for the whole screen) and the three findings
    //    groups (where they struggle, where they score, what to play).
    bodyWrap.appendChild(reportSection(opp, report));

    // 2) Opening maps (auto-built at import; open instantly).
    bodyWrap.appendChild(mapSection(opp, prepare));

    // 3) My prep against this opponent, when I have any.
    if (myPrep.length > 0) {
      bodyWrap.appendChild(yourPrepSection(myPrep, line => { close(); exploreDeps?.onOpenLine(line); }));
    }

    // 4) Their most-played openings, per colour.
    const analysis = analyseGames(opp.games, []);
    bodyWrap.appendChild(openingsSection(
      'Their openings as White',
      analysis.stats.filter(s => s.colour === 'white'),
      prepare,
    ));
    bodyWrap.appendChild(openingsSection(
      'Their openings as Black',
      analysis.stats.filter(s => s.colour === 'black'),
      prepare,
    ));

    overlay.appendChild(bodyWrap);
    document.body.appendChild(overlay);
  })();
}

// ── Scouting report (the dossier's headline) ──────────────────────────────────────

// The report: a title, the opponent's overall W-D-L bar (the one place the
// "their results" caption appears, fixing the perspective for the whole detail),
// then — once they have a deep enough sample — three compact groups. With no
// opening reaching the games floor, an honest empty line replaces the groups.
function reportSection(opp: Opponent, report: ScoutReport): HTMLElement {
  const section = document.createElement('div');
  section.className = 'section';

  const head = document.createElement('div');
  head.className = 'section-head';
  const h = document.createElement('h2');
  h.className = 'section-title';
  h.textContent = 'Scouting report';
  head.appendChild(h);
  section.appendChild(head);

  const summary = opponentSummary(opp);
  section.appendChild(wdlBlock({
    wins: summary.wins,
    draws: summary.draws,
    losses: summary.losses,
    scorePct: summary.scorePct,
    games: summary.games,
  }));

  if (!report.enoughGames) {
    const empty = document.createElement('p');
    empty.className = 'section-desc scout-report-empty';
    empty.textContent = 'Not enough games for a report yet — import more.';
    section.appendChild(empty);
    return section;
  }

  section.appendChild(reportGroup('Where they struggle',
    report.weakest.map(r => recordRow(r))));
  section.appendChild(reportGroup('Where they score',
    report.strongest.map(r => recordRow(r))));
  section.appendChild(reportGroup('What to play',
    report.recommendations.map(rec => recommendationRow(rec))));

  return section;
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

// A compact report row: the opening name + games count on the top line, their
// W-D-L bar below. `extra`, when given, hangs a small line under the bar.
function recordRow(rec: OpeningRecord, extra?: HTMLElement): HTMLElement {
  const card = document.createElement('div');
  card.className = 'line-card review-card scout-report-row';

  const body = document.createElement('div');
  body.className = 'line-card-body review-card-body';

  const headRow = document.createElement('div');
  headRow.className = 'scout-report-row-head';
  const nameEl = document.createElement('div');
  nameEl.className = 'line-card-name';
  nameEl.textContent = rec.family;
  headRow.appendChild(nameEl);
  const gamesChip = document.createElement('span');
  gamesChip.className = 'review-stat-chip';
  gamesChip.textContent = `${rec.games} game${rec.games === 1 ? '' : 's'}`;
  headRow.appendChild(gamesChip);
  body.appendChild(headRow);

  // Their record as a slim bar; the perspective is captioned once up top, so no
  // caption repeats here.
  body.appendChild(wdlScoreRow({
    wins: rec.wins,
    draws: rec.draws,
    losses: rec.losses,
    scorePct: rec.scorePct,
    games: rec.games,
  }));

  if (extra) body.appendChild(extra);

  card.appendChild(body);
  return card;
}

// A "what to play" row: the opponent's (weak) record, plus a small line giving
// the side I'd play and my own score in the family — or admitting I have none.
function recommendationRow(rec: Recommendation): HTMLElement {
  const sideWord = rec.myColour === 'white' ? 'White' : 'Black';
  const note = document.createElement('div');
  note.className = 'scout-report-mine';
  if (rec.mine) {
    note.textContent =
      `Play ${sideWord} · you score ${rec.mine.scorePct}% here ` +
      `(${rec.mine.wins}-${rec.mine.draws}-${rec.mine.losses})`;
  } else {
    note.classList.add('scout-report-mine--nodata');
    note.textContent = `Play ${sideWord} · no data on your side`;
  }
  return recordRow(rec.their, note);
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

  // The shared filter bar (filters.ts). These lines are all prepared against the
  // one opponent, so there's no opponent-tag group, no status and no sort — just
  // colour on row 1 and any of my own tags on row 2. The bar drops empty groups.
  const list = document.createElement('div');
  list.className = 'group';

  const filter = createFilterBar({
    persistKey: PREP_FILTER_KEY,
    userTags: distinctUserTags(lines),
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

    for (const line of shown) list.appendChild(prepCard(line, onOpen));
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
        // The map rebuilds the pruned tree from stored games at each depth (see
        // `atDepth`); this line is just the seed used for preview association.
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
          depth: {
            startPlies: MAP_START_PLIES,
            stepPlies: MAP_STEP_PLIES,
            maxPlies: opponentReachPlies(opp, colour),
            // Feed the FULL (unpruned) tree so the map's "All replies" view
            // shows every move they played; "Frequent" prunes it by stats.
            atDepth: plies => [
              opponentLine(buildOpponentTree(opp.games, colour, plies, false), colour, opp.name),
            ],
            importHint: true,
          },
          // Per-move W/D/L from THEIR perspective (the scouted user was "me" at
          // import), built to the deep limit so the deeper view has stats too.
          stats: {
            tree: buildMoveStats(opp.games, colour, MAP_MAX_PLIES),
            caption: 'their results',
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
  list.className = 'group';
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

  // Their result on this opening, as a slim bar: score% left, the W-D-L split as
  // segments, the bare counts in small text on the right. The perspective is
  // already captioned once up in the scouting report, so no caption repeats here.
  body.appendChild(wdlScoreRow({
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
