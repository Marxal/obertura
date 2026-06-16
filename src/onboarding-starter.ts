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

// Lines in training needed to unlock the Train hub. The Train screen reads this
// for its gate; onboarding shows progress toward it.
export const ONBOARDING_GOAL = 6;

type Colour = 'white' | 'black';

interface PackLine {
  name: string;
  sans: string[];
  ucis: string[];
}
interface Pack {
  id: string;
  title: string;
  colour: Colour;
  level: string;
  style: string;
  blurb: string;
  lines: PackLine[];
}

export interface StarterDeps {
  // Whether any games have been imported (decides which path leads).
  hasGames: boolean;
  // Add a line's moves to training. learn=true takes the normal add path (a
  // watch-then-play confirm run under the default pref); learn=false enrols it
  // straight away. onDone fires once it's in; onCancel if the run was abandoned.
  onAddLine: (
    ucis: string[],
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
// of the initial bundle, like the opening library).
let packsPromise: Promise<Pack[]> | null = null;
function loadPacks(): Promise<Pack[]> {
  if (!packsPromise) {
    packsPromise = import('./starter-packs.json').then(m => (m.default ?? m) as Pack[]);
  }
  return packsPromise;
}

// Once we've celebrated hitting the goal in this view, don't burst again on
// every repaint.
let goalCelebrated = false;

export function renderStarterOnboarding(container: HTMLElement, deps: StarterDeps): void {
  const root = document.createElement('div');
  root.className = 'onb section';
  container.appendChild(root);
  void paint(root, deps);
}

async function paint(root: HTMLElement, deps: StarterDeps): Promise<void> {
  const lines = await getAllLines();
  const inTraining = lines.filter(l => l.inTraining).length;
  const existing = new Set(lines.map(l => sig(mainlineUcis(l.tree))));

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

  // ── Content: suggestions (if any) then packs ──
  if (suggestions.length > 0) {
    root.appendChild(sectionTitle('Based on your games'));
    const list = document.createElement('div');
    list.className = 'onb-lines';
    for (const s of suggestions) {
      list.appendChild(suggestionRow(s, existing, deps, repaint));
    }
    root.appendChild(list);
    root.appendChild(sectionTitle('Or start from a ready-made pack'));
  } else {
    root.appendChild(sectionTitle('Pick a starter pack'));
  }

  // Packs — a single-open accordion (opening one closes the others).
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
  // All packs start collapsed (including the first); tapping a header opens that
  // one and closes the others.
  root.appendChild(packsWrap);

  // ── Footer: primary routes, then quieter ones ──
  const foot = document.createElement('div');
  foot.className = 'onb-foot';
  foot.appendChild(mainButton('Build a line myself', Icons.plus(18), () => deps.onBuildManually()));
  foot.appendChild(mainButton('Import your games', Icons.download(18), () => deps.onImportGames()));
  const discrete = document.createElement('div');
  discrete.className = 'onb-foot-discrete';
  discrete.appendChild(footLink('Browse opening library', () => deps.onBrowseLibrary()));
  discrete.appendChild(footLink('Build with the engine', () => deps.onBuildWithEngine()));
  foot.appendChild(discrete);
  root.appendChild(foot);
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
  existing: Set<string>,
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

  const pending = pack.lines.filter(l => !existing.has(sig(l.ucis)));
  if (pending.length > 1) {
    const addAll = document.createElement('button');
    addAll.type = 'button';
    addAll.className = 'onb-addall';
    addAll.textContent = `Add all ${pending.length} without the walkthrough`;
    addAll.addEventListener('click', () => {
      addAll.disabled = true;
      addAll.textContent = 'Adding…';
      void addSequentially(pending, pack.colour, deps).then(repaint);
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
    (chain, l) => chain.then(() => new Promise<void>(res => deps.onAddLine(l.ucis, colour, false, res, res))),
    Promise.resolve(),
  );
}

// ── Rows (shared position-card look, with a board miniature) ────────────────────

function packLineRow(
  line: PackLine,
  colour: Colour,
  existing: Set<string>,
  deps: StarterDeps,
  repaint: () => void,
): HTMLElement {
  return lineRow({
    name: line.name,
    moves: formatSan(line.sans),
    fen: fenFromUcis(line.ucis),
    colour,
    added: existing.has(sig(line.ucis)),
    onAdd: () => deps.onAddLine(line.ucis, colour, true, repaint, repaint),
  });
}

function suggestionRow(
  stat: OpeningStat,
  existing: Set<string>,
  deps: StarterDeps,
  repaint: () => void,
): HTMLElement {
  return lineRow({
    name: stat.family,
    moves: formatSan(stat.repSans),
    sub: `${stat.games} game${stat.games === 1 ? '' : 's'} · ${stat.scorePct}% score`,
    fen: fenFromUcis(stat.repUcis),
    colour: stat.colour,
    added: existing.has(sig(stat.repUcis)),
    onAdd: () => deps.onAddLine(stat.repUcis, stat.colour, true, repaint, repaint),
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

// "1.e4 e5 2.Nf3 Nc6" from a flat SAN list.
function formatSan(sans: string[]): string {
  let out = '';
  for (let i = 0; i < sans.length; i++) {
    out += i % 2 === 0 ? `${i / 2 + 1}.${sans[i]} ` : `${sans[i]} `;
  }
  return out.trim();
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

// A stable signature for "is this line already in my repertoire": the opening's
// first several plies. Matches a curated/suggested line against a saved one even
// if one runs a little deeper than the other.
function sig(ucis: string[]): string {
  return ucis.slice(0, 8).join(' ');
}
