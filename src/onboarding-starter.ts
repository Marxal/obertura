// The first-run onboarding for the Train screen's empty state — the fastest path
// from "no lines" to a trainable repertoire.
//
// It adapts to what the user has:
//   • games imported  → "Based on your games" suggestions (the same analysis the
//     My Lines → Games tab uses), so the first lines are the openings they
//     actually play. Ready-made starter packs sit below as a fallback.
//   • nothing yet     → curated "Starter packs" (src/starter-packs.json) — pick a
//     pack, add its lines one by one.
//
// Adding a line runs the app's normal add-to-training path (addLineToTraining via
// the deps), which — with the default "confirm run" pref — plays the line through
// once (watch), then has you play it (the "Learn" step) before it joins training.
// After each add we repaint in place so the progress bar climbs and added lines
// tick off, keeping the flow linear. Training stays gated until ONBOARDING_GOAL
// lines are in (the Train screen owns that gate); "Start training" only appears
// once the goal is reached.

import { getAllLines, getAllGames } from './storage';
import { analyseGames, type OpeningStat } from './analysis';
import type { MoveNode } from './tree';
import { Icons } from './icons';
import { buildPositionCard, colourPip, fenFromUcis } from './card-position';
import { burstConfetti } from './confetti';
import { formatSanLine } from './notation';
import { showDialog } from './dialog';
import { pushBack } from './back-nav';

// Lines in training needed to unlock the Train hub. The Train screen reads this
// for its gate; onboarding shows progress toward it. Lowered from 6 → 5 to make
// the climb feel a little shorter.
export const ONBOARDING_GOAL = 5;

type Colour = 'white' | 'black';

export interface PackLine {
  name: string;
  sans: string[];
  ucis: string[];
  // Sparse per-move explanations: 0-based ply index (as a JSON string key) →
  // note text. Shown as note cards during learn/drill.
  notes?: Record<string, string>;
  // One-paragraph middlegame plan for the line — what to do once the moves run
  // out. Lands on the final move's note when the line is added.
  plan?: string;
}
export interface Pack {
  id: string;
  title: string;
  colour: Colour;
  level: string;
  style: string;
  blurb: string;
  lines: PackLine[];
}

// Everything needed to turn a move sequence into a saved Line: the moves, plus
// optional per-ply notes, a middlegame plan, and a display name. The shared
// currency between pack/suggestion pickers and main.ts's lineFromUcis.
export interface LineSeed {
  ucis: string[];
  notes?: Record<number, string>; // 0-based ply index → note
  plan?: string;
  name?: string;
}

// A pack line as a LineSeed, ready for onAddLine. (JSON object keys are always
// strings; numeric indexing works on them at runtime, so the cast is safe.)
export function seedFromPackLine(line: PackLine): LineSeed {
  return {
    ucis: line.ucis,
    notes: line.notes as Record<number, string> | undefined,
    plan: line.plan,
    name: line.name,
  };
}

export interface StarterDeps {
  // Whether any games have been imported (decides which path leads).
  hasGames: boolean;
  // Add a line (moves + optional notes/plan) to training. learn=true takes the
  // normal add path (a watch-then-play confirm run under the default pref);
  // learn=false enrols it straight away. onDone fires once it's in; onCancel if
  // the run was abandoned.
  onAddLine: (
    seed: LineSeed,
    colour: Colour,
    learn: boolean,
    onDone: () => void,
    onCancel: () => void,
  ) => void;
  // Leave onboarding for the normal Train hub (offered once the goal is reached).
  onFinish: () => void;
  // Open the builder to make a line by hand.
  onBuildManually: () => void;
  // Open the import-your-games flow.
  onImportGames: () => void;
  // Open the opening library browser.
  onBrowseLibrary: () => void;
  // Open the "play the engine to build a line" flow.
  onBuildWithEngine: () => void;
}

// Lazy-load the curated packs only when onboarding actually shows (keeps them out
// of the initial bundle, like the opening library). Also reused by the Explore
// screen's Packs tab, so both surfaces read the same starter-packs.json.
let packsPromise: Promise<Pack[]> | null = null;
export function loadPacks(): Promise<Pack[]> {
  if (!packsPromise) {
    packsPromise = import('./starter-packs.json').then(m => (m.default ?? m) as Pack[]);
  }
  return packsPromise;
}

// Once we've celebrated hitting the goal in this view, don't burst again on
// every repaint.
let goalCelebrated = false;

// A one-time dialog before the very first "Build a line myself" — the builder
// itself has no onboarding chrome, so this is the only explanation a brand-new
// user gets before being dropped onto an empty board.
const BUILD_WALKTHROUGH_KEY = 'obertura.buildWalkthroughSeen';

function hasSeenBuildWalkthrough(): boolean {
  try {
    return localStorage.getItem(BUILD_WALKTHROUGH_KEY) === '1';
  } catch {
    return false;
  }
}

function markBuildWalkthroughSeen(): void {
  try { localStorage.setItem(BUILD_WALKTHROUGH_KEY, '1'); } catch { /* storage off */ }
}

function handleBuildManually(deps: StarterDeps): void {
  if (hasSeenBuildWalkthrough()) {
    deps.onBuildManually();
    return;
  }
  showDialog({
    title: 'Build your first line',
    body: 'Make your first move on the board — when you reach the end of a line, hit Save. That\'s it.',
    buttons: [{
      label: 'Got it',
      variant: 'primary',
      onClick: () => {
        markBuildWalkthroughSeen();
        deps.onBuildManually();
      },
    }],
  });
}

export function renderStarterOnboarding(container: HTMLElement, deps: StarterDeps): void {
  const root = document.createElement('div');
  root.className = 'onb section';
  container.appendChild(root);
  void paint(root, deps);
}

async function paint(root: HTMLElement, deps: StarterDeps): Promise<void> {
  const lines = await getAllLines();
  const inTraining = lines.filter(l => l.inTraining).length;
  const existing = existingMainlines(lines);

  // Games-based suggestions (only when there are games to learn from).
  let suggestions: OpeningStat[] = [];
  if (deps.hasGames) {
    try {
      const games = await getAllGames();
      suggestions = analyseGames(games, lines).suggestions.slice(0, 8);
    } catch {
      suggestions = [];
    }
  }

  const packs = await loadPacks();

  root.innerHTML = '';
  const reached = inTraining >= ONBOARDING_GOAL;
  const repaint = () => void paint(root, deps);

  // ── Header ──
  const head = document.createElement('div');
  head.className = 'onb-head';
  const icon = document.createElement('div');
  icon.className = 'onb-head-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.appendChild(Icons.zap(26));
  head.appendChild(icon);
  const h = document.createElement('h2');
  h.className = 'onb-title';
  h.textContent = 'Build your first lines';
  head.appendChild(h);
  const sub = document.createElement('p');
  sub.className = 'onb-sub';
  sub.textContent = reached
    ? 'Your starter repertoire is ready — jump into training, or keep adding lines.'
    : `Add ${ONBOARDING_GOAL} lines to unlock training. Watch each one play, then try it yourself.`;
  head.appendChild(sub);
  root.appendChild(head);

  // ── Progress ──
  const prog = document.createElement('div');
  prog.className = 'onb-progress';
  const bar = document.createElement('div');
  bar.className = 'onb-bar';
  const fill = document.createElement('div');
  fill.className = 'onb-bar-fill';
  fill.style.width = `${Math.min(1, inTraining / ONBOARDING_GOAL) * 100}%`;
  bar.appendChild(fill);
  prog.appendChild(bar);
  const plabel = document.createElement('div');
  plabel.className = 'onb-progress-label';
  plabel.textContent = reached
    ? `${inTraining} lines in training — training unlocked!`
    : `${inTraining} / ${ONBOARDING_GOAL} lines — training unlocks at ${ONBOARDING_GOAL}`;
  prog.appendChild(plabel);
  root.appendChild(prog);

  // ── Payoff: only once the goal is reached ──
  if (reached) {
    if (!goalCelebrated) {
      goalCelebrated = true;
      burstConfetti(root);
    }
    const start = document.createElement('button');
    start.type = 'button';
    start.className = 'btn-primary onb-start';
    start.textContent = 'Start training →';
    start.addEventListener('click', () => deps.onFinish());
    root.appendChild(start);
  }

  // ── Content: suggestions (if any) ──
  if (suggestions.length > 0) {
    root.appendChild(sectionTitle('Based on your games'));
    const list = document.createElement('div');
    list.className = 'onb-lines';
    for (const s of suggestions) {
      list.appendChild(suggestionRow(s, existing, deps, repaint));
    }
    root.appendChild(list);
  }

  // ── Footer: "Build a line myself" and "Pick a starter pack" lead, side by
  // side — building manually opens the board; the pack button opens a lightbox
  // (openPackPicker) rather than an inline accordion. Quieter routes sit below. ──
  const foot = document.createElement('div');
  foot.className = 'onb-foot';
  foot.appendChild(mainButton('Build a line myself', Icons.plus(18), () => handleBuildManually(deps)));
  foot.appendChild(mainButton('Pick a starter pack', Icons.build(18), () => openPackPicker(packs, existing, deps, repaint)));
  const discrete = document.createElement('div');
  discrete.className = 'onb-foot-discrete';
  discrete.appendChild(footLink('Import your games', () => deps.onImportGames()));
  discrete.appendChild(footLink('Browse opening library', () => deps.onBrowseLibrary()));
  discrete.appendChild(footLink('Build with the engine', () => deps.onBuildWithEngine()));
  foot.appendChild(discrete);
  root.appendChild(foot);
}

// Open the starter-pack picker on its own (e.g. from the My Lines empty states),
// without the surrounding Train onboarding. Only needs a way to add a line; the
// other StarterDeps routes are unused by the picker, so they're stubbed.
export async function openStarterPackPicker(
  onAddLine: StarterDeps['onAddLine'],
): Promise<void> {
  const [packs, lines] = await Promise.all([loadPacks(), getAllLines()]);
  const existing = existingMainlines(lines);
  const deps: StarterDeps = {
    hasGames: false,
    onAddLine,
    onFinish: () => {},
    onBuildManually: () => {},
    onImportGames: () => {},
    onBrowseLibrary: () => {},
    onBuildWithEngine: () => {},
  };
  openPackPicker(packs, existing, deps, () => {});
}

// ── Starter-pack lightbox ────────────────────────────────────────────────────
// "Pick a starter pack" opens this instead of an inline accordion — a focused
// sheet, titled and dismissible like the rest of the app's edit-overlays.
// Adding a line repaints the onboarding view underneath (the progress bar
// climbs) without closing the sheet, so several packs/lines can be added in one
// sitting; `existing` is mutated in place so this sheet's own "✓ Added" state
// stays in sync across repaints without re-querying storage.
function openPackPicker(
  packs: Pack[],
  existing: string[],
  deps: StarterDeps,
  onAdded: () => void,
): void {
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';

  function close(): void {
    overlay.remove();
    removeBack();
  }
  const removeBack = pushBack(close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  function render(): void {
    overlay.innerHTML = '';
    const sheet = document.createElement('div');
    sheet.className = 'edit-sheet';

    const h = document.createElement('h3');
    h.className = 'edit-sheet-title';
    h.textContent = 'Starter packs';
    sheet.appendChild(h);

    const repaint = () => { onAdded(); render(); };

    const packsWrap = document.createElement('div');
    packsWrap.className = 'onb-packs';
    const ctrls = packs.map(pack => packCard(pack, existing, deps, repaint));
    ctrls.forEach(pc => {
      pc.headBtn.addEventListener('click', () => {
        const willOpen = !pc.isOpen();
        ctrls.forEach(c => c.setOpen(false));
        pc.setOpen(willOpen);
      });
      packsWrap.appendChild(pc.card);
    });
    sheet.appendChild(packsWrap);

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'edit-cancel-btn';
    cancel.textContent = 'Close';
    cancel.addEventListener('click', close);
    sheet.appendChild(cancel);

    overlay.appendChild(sheet);
  }

  document.body.appendChild(overlay);
  render();
}

// ── Pack card (single-open accordion member) ───────────────────────────────────

interface PackCtrl {
  card: HTMLElement;
  headBtn: HTMLButtonElement;
  setOpen: (open: boolean) => void;
  isOpen: () => boolean;
}

function packCard(
  pack: Pack,
  existing: string[],
  deps: StarterDeps,
  repaint: () => void,
): PackCtrl {
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
  meta.textContent = `${pack.level} · ${pack.style} · ${pack.lines.length} lines`;
  titleWrap.appendChild(meta);
  headBtn.appendChild(titleWrap);

  const chev = document.createElement('span');
  chev.className = 'onb-pack-chev';
  chev.setAttribute('aria-hidden', 'true');
  chev.appendChild(Icons.chevronRight(18));
  headBtn.appendChild(chev);

  const body = document.createElement('div');
  body.className = 'onb-pack-body';
  body.hidden = true;

  const blurb = document.createElement('p');
  blurb.className = 'onb-pack-blurb';
  blurb.textContent = pack.blurb;
  body.appendChild(blurb);

  const list = document.createElement('div');
  list.className = 'onb-lines';
  for (const line of pack.lines) {
    list.appendChild(packLineRow(line, pack.colour, existing, deps, repaint));
  }
  body.appendChild(list);

  const pending = pack.lines.filter(l => !isLineAdded(existing, l.ucis));
  if (pending.length > 1) {
    const addAll = document.createElement('button');
    addAll.type = 'button';
    addAll.className = 'onb-addall';
    addAll.textContent = `Add all ${pending.length} without the walkthrough`;
    addAll.addEventListener('click', () => {
      addAll.disabled = true;
      addAll.textContent = 'Adding…';
      void addSequentially(pending, pack.colour, deps).then(() => {
        for (const l of pending) existing.push(l.ucis.join(' '));
        repaint();
      });
    });
    body.appendChild(addAll);
  }

  card.appendChild(headBtn);
  card.appendChild(body);

  const setOpen = (open: boolean): void => {
    body.hidden = !open;
    headBtn.classList.toggle('onb-pack-head--open', open);
    headBtn.setAttribute('aria-expanded', String(open));
  };
  setOpen(false);

  return { card, headBtn, setOpen, isOpen: () => !body.hidden };
}

// Add a batch of lines straight to training (no walkthrough), one after another.
function addSequentially(lines: PackLine[], colour: Colour, deps: StarterDeps): Promise<void> {
  return lines.reduce(
    (chain, l) => chain.then(() => new Promise<void>(res => deps.onAddLine(seedFromPackLine(l), colour, false, res, res))),
    Promise.resolve(),
  );
}

// ── Rows (shared position-card look, with a board miniature) ────────────────────

function packLineRow(
  line: PackLine,
  colour: Colour,
  existing: string[],
  deps: StarterDeps,
  repaint: () => void,
): HTMLElement {
  return lineRow({
    name: line.name,
    moves: formatSanLine(line.sans),
    sub: line.plan,
    fen: fenFromUcis(line.ucis),
    colour,
    added: isLineAdded(existing, line.ucis),
    onAdd: () => deps.onAddLine(seedFromPackLine(line), colour, true, () => {
      existing.push(line.ucis.join(' '));
      repaint();
    }, repaint),
  });
}

function suggestionRow(
  stat: OpeningStat,
  existing: string[],
  deps: StarterDeps,
  repaint: () => void,
): HTMLElement {
  return lineRow({
    name: stat.family,
    moves: formatSanLine(stat.repSans),
    sub: `${stat.games} game${stat.games === 1 ? '' : 's'} · ${stat.scorePct}% score`,
    fen: fenFromUcis(stat.repUcis),
    colour: stat.colour,
    added: isLineAdded(existing, stat.repUcis),
    onAdd: () => deps.onAddLine({ ucis: stat.repUcis }, stat.colour, true, repaint, repaint),
  });
}

function lineRow(o: {
  name: string;
  moves: string;
  sub?: string;
  fen: string;
  colour: Colour;
  added: boolean;
  onAdd: () => void;
}): HTMLElement {
  // Reuse the shared position-card scaffold so onboarding lines read like the
  // Saved / Games / In-training cards (miniature on the left, info + action on
  // the right). The board honours the global "show miniatures" pref.
  const { card, titleRow, content } = buildPositionCard({
    fen: o.fen,
    orientation: o.colour,
    className: 'onb-line',
  });

  titleRow.appendChild(colourPip(o.colour));
  const nameEl = document.createElement('span');
  nameEl.className = 'pcard-name';
  nameEl.textContent = o.name;
  titleRow.appendChild(nameEl);

  const movesEl = document.createElement('div');
  movesEl.className = 'onb-line-moves';
  movesEl.textContent = o.moves;
  content.appendChild(movesEl);

  if (o.sub) {
    const subEl = document.createElement('div');
    subEl.className = 'onb-line-sub';
    subEl.textContent = o.sub;
    content.appendChild(subEl);
  }

  if (o.added) {
    const done = document.createElement('span');
    done.className = 'onb-added';
    done.textContent = '✓ Added';
    content.appendChild(done);
  } else {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn-primary onb-add';
    add.textContent = 'Add & learn';
    add.addEventListener('click', o.onAdd);
    content.appendChild(add);
  }

  return card;
}

// ── Small helpers ────────────────────────────────────────────────────────────

function sectionTitle(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'section-title onb-section-title';
  el.textContent = text;
  return el;
}

function mainButton(label: string, icon: SVGElement, onClick: () => void): HTMLElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn-primary onb-foot-btn';
  b.appendChild(icon);
  b.appendChild(document.createTextNode(label));
  b.addEventListener('click', onClick);
  return b;
}

function footLink(label: string, onClick: () => void): HTMLElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'empty-state-link onb-foot-link';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

// The mainline UCIs of a saved line's tree (children[0] all the way down).
function mainlineUcis(tree: MoveNode): string[] {
  const out: string[] = [];
  let node: MoveNode | undefined = tree.children[0];
  while (node) {
    out.push(node.uci);
    node = node.children[0];
  }
  return out;
}

// "Is this line already in my repertoire?" — a curated/suggested line counts as
// added when one line's mainline is a ply-prefix of the other (so depths can
// differ). Full-length prefix matching (not a fixed-ply signature) keeps two
// pack lines that diverge deep in the line from shadowing each other. The
// `+ ' '` guard makes it a whole-ply prefix, never a mid-UCI string prefix.
export function isLineAdded(existing: string[], ucis: string[]): boolean {
  const s = ucis.join(' ');
  if (!s) return false;
  return existing.some(e => e === s || e.startsWith(s + ' ') || s.startsWith(e + ' '));
}

// The saved lines' mainlines as joined-UCI strings, for isLineAdded.
export function existingMainlines(lines: { tree: MoveNode }[]): string[] {
  return lines.map(l => mainlineUcis(l.tree).join(' ')).filter(s => s.length > 0);
}
