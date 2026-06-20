// Explore → Opening traps: a full-screen overlay of curated traps, organised by
// level, with three things to do per trap — Practise (watch then play the whole
// line), Puzzle (find the winning moves), and Add to my lines (save it paused so
// you can opt it into training later from My Lines). Traps are inspiration, not
// repertoire: nothing here touches the SM-2 scheduler until you choose to.
//
// Relevance: when there are imported games we pin a "Traps for your openings"
// section up top; when opened from a scouted opponent we pin "Traps to set
// against <name>". Both reuse the same opening-family classification the rest of
// the app uses (openingFamily / analyseGames), so a trap lines up with the
// openings you actually meet.
//
// It leans on the same parts as the onboarding starter packs (single-open
// accordion, the shared position-card scaffold) and the existing drill engines,
// so there's almost no new runtime — a trap is just a Line.

import { Icons } from './icons';
import { pushBack } from './back-nav';
import { showToast } from './toast';
import { buildPositionCard, colourPip, fenFromUcis } from './card-position';
import { startDrill, startPositionsDrill, startTimedDrill } from './drill';
import { saveLine, getAllGames, getAllLines } from './storage';
import { analyseGames } from './analysis';
import { watchSpeedMs } from './prefs';
import {
  lineFromTrap, trapsForPairs, trapPuzzlePositions, decisivePuzzle,
  type Trap, type TrapPack, type TrapWant,
} from './traps';

type Colour = 'white' | 'black';

// A "spot the trap" timed run lasts this long.
const TIMED_MS = 60_000;

// What the caller can pin to the top of the screen.
export interface TrapsScreenOpts {
  // (family, colour) pairs to highlight — "a trap of this colour in this
  // family". From a scouted opponent: each opening they play, paired with YOUR
  // answering colour (the opposite of theirs). Omit to derive from your games.
  relevant?: TrapWant[];
  // The banner label for the pinned section.
  relevanceLabel?: string;
}

// Lazy-load the curated traps only when the screen opens (keeps them out of the
// initial bundle, like the starter packs and the opening library).
let packsPromise: Promise<TrapPack[]> | null = null;
function loadTraps(): Promise<TrapPack[]> {
  if (!packsPromise) {
    packsPromise = import('./traps.json').then(m => (m.default ?? m) as unknown as TrapPack[]);
  }
  return packsPromise;
}

export function openTrapsScreen(opts: TrapsScreenOpts = {}): void {
  void (async () => {
    const packs = await loadTraps();

    const overlay = document.createElement('div');
    overlay.className = 'rmap-overlay traps-screen';

    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      overlay.remove();
      removeBack();
    };
    const removeBack = pushBack(close);

    // Header.
    const header = document.createElement('div');
    header.className = 'rmap-header';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'rmap-back';
    back.setAttribute('aria-label', 'Close traps');
    back.appendChild(Icons.back(20));
    back.addEventListener('click', close);
    const titleEl = document.createElement('h2');
    titleEl.className = 'rmap-title';
    titleEl.textContent = 'Opening traps';
    header.appendChild(back);
    header.appendChild(titleEl);
    overlay.appendChild(header);

    const body = document.createElement('div');
    body.className = 'scout-detail-body traps-body';

    const intro = document.createElement('p');
    intro.className = 'section-desc';
    intro.textContent =
      'Famous traps to spring on a careless opponent. Practise them, solve them as puzzles, or add one to My Lines to train it later.';
    body.appendChild(intro);

    // ── Relevant traps (pinned) ──────────────────────────────────────────────
    // Explicit families from the caller (a scouted opponent) take priority;
    // otherwise we derive them from the openings you play in your imported games.
    let relevant: { trap: Trap; colour: Colour }[] = [];
    const relevanceLabel = opts.relevanceLabel ?? 'Traps for your openings';
    if (opts.relevant?.length) {
      relevant = trapsForPairs(packs, opts.relevant);
    } else {
      try {
        const [games, lines] = await Promise.all([getAllGames(), getAllLines()]);
        if (games.length > 0) {
          // You play family F as colour C → a trap of colour C in family F fits.
          const stats = analyseGames(games, lines).stats;
          relevant = trapsForPairs(packs, stats.map(s => ({ family: s.family, colour: s.colour })));
        }
      } catch { /* relevance is a bonus; ignore data errors */ }
    }
    if (relevant.length > 0) {
      body.appendChild(sectionTitle(relevanceLabel));
      const list = document.createElement('div');
      list.className = 'onb-lines';
      for (const { trap, colour } of relevant) list.appendChild(trapRow(trap, colour, close));
      body.appendChild(list);
    }

    // ── All packs, single-open accordion, traps grouped by level inside ───────
    body.appendChild(sectionTitle(relevant.length > 0 ? 'All traps' : 'Browse traps'));
    const packsWrap = document.createElement('div');
    packsWrap.className = 'onb-packs';
    const ctrls = packs.map(pack => packCard(pack, close));
    ctrls.forEach(pc => {
      pc.headBtn.addEventListener('click', () => {
        const willOpen = !pc.isOpen();
        ctrls.forEach(c => c.setOpen(false));
        pc.setOpen(willOpen);
      });
      packsWrap.appendChild(pc.card);
    });
    body.appendChild(packsWrap);

    overlay.appendChild(body);
    document.body.appendChild(overlay);
  })();
}

// ── Pack card (single-open accordion member) ──────────────────────────────────

interface PackCtrl {
  card: HTMLElement;
  headBtn: HTMLButtonElement;
  setOpen: (open: boolean) => void;
  isOpen: () => boolean;
}

const LEVELS: Trap['level'][] = ['Intermediate', 'Advanced'];

function packCard(pack: TrapPack, closeScreen: () => void): PackCtrl {
  const card = document.createElement('div');
  card.className = 'onb-pack';

  const headBtn = document.createElement('button');
  headBtn.type = 'button';
  headBtn.className = 'onb-pack-head';

  const titleWrap = document.createElement('span');
  titleWrap.className = 'onb-pack-titles';
  const title = document.createElement('span');
  title.className = 'onb-pack-title';
  title.textContent = pack.title;
  titleWrap.appendChild(title);
  const meta = document.createElement('span');
  meta.className = 'onb-pack-meta';
  meta.textContent = `${pack.colour === 'white' ? '○ White' : '● Black'} · ${pack.traps.length} trap${pack.traps.length === 1 ? '' : 's'}`;
  titleWrap.appendChild(meta);
  headBtn.appendChild(titleWrap);

  const chev = document.createElement('span');
  chev.className = 'onb-pack-chev';
  chev.setAttribute('aria-hidden', 'true');
  chev.appendChild(Icons.chevronRight(18));
  headBtn.appendChild(chev);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'onb-pack-body';
  bodyEl.hidden = true;

  const blurb = document.createElement('p');
  blurb.className = 'onb-pack-blurb';
  blurb.textContent = pack.blurb;
  bodyEl.appendChild(blurb);

  // Pack-level practice over the decisive blows of every trap in the pack.
  bodyEl.appendChild(packActions(pack));

  // Traps grouped by level (only levels that have traps).
  for (const level of LEVELS) {
    const traps = pack.traps.filter(t => t.level === level);
    if (traps.length === 0) continue;
    const groupTitle = document.createElement('div');
    groupTitle.className = 'trap-level-title';
    groupTitle.textContent = level;
    bodyEl.appendChild(groupTitle);
    const list = document.createElement('div');
    list.className = 'onb-lines';
    for (const trap of traps) list.appendChild(trapRow(trap, pack.colour, closeScreen));
    bodyEl.appendChild(list);
  }

  card.appendChild(headBtn);
  card.appendChild(bodyEl);

  const setOpen = (open: boolean): void => {
    bodyEl.hidden = !open;
    headBtn.classList.toggle('onb-pack-head--open', open);
    headBtn.setAttribute('aria-expanded', String(open));
  };
  setOpen(false);

  return { card, headBtn, setOpen, isOpen: () => !bodyEl.hidden };
}

// The "Puzzle this pack" / "Timed" row: collect the decisive blow of every trap
// in the pack and quiz them as a stream of find-the-move puzzles.
function packActions(pack: TrapPack): HTMLElement {
  const row = document.createElement('div');
  row.className = 'trap-pack-actions';

  const positionsFor = () =>
    pack.traps
      .map(t => { const l = lineFromTrap(t, pack.colour); return l ? decisivePuzzle(l) : null; })
      .filter((p): p is NonNullable<typeof p> => p != null);

  const puzzle = document.createElement('button');
  puzzle.type = 'button';
  puzzle.className = 'btn-secondary trap-pack-btn';
  puzzle.appendChild(Icons.target(15));
  puzzle.appendChild(document.createTextNode('Puzzle this pack'));
  puzzle.addEventListener('click', () => {
    const positions = positionsFor();
    if (positions.length === 0) return;
    startPositionsDrill(positions, {
      wrongMoveMode: 'full',
      playPrelude: true,
      confirmAbandon: true,
      modeLabel: `${pack.title} — puzzles`,
      celebrateOnComplete: true,
      completeMessage: 'Pack cleared ✓',
      onComplete: () => {},
      onCancel: () => {},
    });
  });
  row.appendChild(puzzle);

  const timed = document.createElement('button');
  timed.type = 'button';
  timed.className = 'btn-secondary trap-pack-btn';
  timed.appendChild(Icons.clock(15));
  timed.appendChild(document.createTextNode('Timed'));
  timed.addEventListener('click', () => {
    const positions = positionsFor();
    if (positions.length === 0) return;
    startTimedDrill(positions, {
      timedMs: TIMED_MS,
      playPrelude: true,
      modeLabel: `${pack.title} — timed`,
      completeMessage: 'Time!',
      onComplete: () => {},
      onCancel: () => {},
    });
  });
  row.appendChild(timed);

  return row;
}

// ── One trap row (shared position-card look, with a board miniature) ──────────

function trapRow(trap: Trap, colour: Colour, closeScreen: () => void): HTMLElement {
  const { card, titleRow, content } = buildPositionCard({
    fen: fenFromUcis(trap.ucis),
    orientation: colour,
    className: 'onb-line trap-row',
  });

  titleRow.appendChild(colourPip(colour));
  const nameEl = document.createElement('span');
  nameEl.className = 'pcard-name';
  nameEl.textContent = trap.name;
  titleRow.appendChild(nameEl);
  const lvl = document.createElement('span');
  lvl.className = 'tag-chip trap-level-chip';
  lvl.textContent = trap.level;
  titleRow.appendChild(lvl);

  const fam = document.createElement('div');
  fam.className = 'onb-line-sub';
  fam.textContent = trap.family;
  content.appendChild(fam);

  const movesEl = document.createElement('div');
  movesEl.className = 'onb-line-moves';
  movesEl.textContent = formatSan(trap.sans);
  content.appendChild(movesEl);

  const idea = document.createElement('div');
  idea.className = 'trap-idea';
  const baitEl = document.createElement('span');
  baitEl.className = 'trap-bait';
  baitEl.textContent = `Bait: ${trap.bait}. `;
  idea.appendChild(baitEl);
  idea.appendChild(document.createTextNode(trap.idea));
  content.appendChild(idea);

  // Actions: Practise (watch then play), Puzzle (find the moves), Add to lines.
  const actions = document.createElement('div');
  actions.className = 'trap-actions';

  actions.appendChild(actionBtn('btn-primary', Icons.play(15), 'Practise', () => {
    const line = lineFromTrap(trap, colour);
    if (!line) return;
    startDrill(line, {
      wrongMoveMode: 'full',
      // Watch the whole trap play out once, then play it yourself.
      watchFirstMs: watchSpeedMs(),
      modeLabel: trap.name,
      celebrateOnComplete: true,
      completeMessage: 'Trap sprung ✓',
      onComplete: () => {},
      onCancel: () => {},
    });
  }));

  actions.appendChild(actionBtn('btn-secondary', Icons.target(15), 'Puzzle', () => {
    const line = lineFromTrap(trap, colour);
    if (!line) return;
    const positions = trapPuzzlePositions(line);
    if (positions.length === 0) return;
    startPositionsDrill(positions, {
      wrongMoveMode: 'full',
      playPrelude: true,
      confirmAbandon: true,
      modeLabel: `${trap.name} — puzzle`,
      celebrateOnComplete: true,
      completeMessage: 'Solved ✓',
      onComplete: () => {},
      onCancel: () => {},
    });
  }));

  actions.appendChild(actionBtn('btn-secondary', Icons.plus(15), 'Add to my lines', () => {
    const line = lineFromTrap(trap, colour, { tags: ['trap'], inTraining: false });
    if (!line) return;
    void saveLine(line).then(() => {
      showToast(`“${trap.name}” saved to My Lines — add it to training when you’re ready.`);
    });
  }));

  content.appendChild(actions);
  return card;
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function actionBtn(variant: string, icon: SVGElement, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `${variant} trap-action-btn`;
  b.appendChild(icon);
  b.appendChild(document.createTextNode(label));
  b.addEventListener('click', onClick);
  return b;
}

function sectionTitle(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'section-title onb-section-title';
  el.textContent = text;
  return el;
}

// "1.e4 e5 2.Nf3 Nc6" from a flat SAN list.
function formatSan(sans: string[]): string {
  let out = '';
  for (let i = 0; i < sans.length; i++) {
    out += i % 2 === 0 ? `${i / 2 + 1}.${sans[i]} ` : `${sans[i]} `;
  }
  return out.trim();
}
