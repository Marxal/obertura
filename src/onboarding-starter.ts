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
// tick off, keeping the flow linear. A soft goal (GOAL) nudges toward "enough to
// train"; "Start training" is offered as soon as there's at least one line.

import { getAllLines, getAllGames } from './storage';
import { analyseGames, type OpeningStat } from './analysis';
import type { MoveNode } from './tree';
import { Icons } from './icons';
import { colourPip } from './card-position';
import { burstConfetti } from './confetti';

// Lines in training that make the screen feel "ready". Soft — training is offered
// from the first line; this just sets the progress target and the celebration.
const GOAL = 6;

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
  // Leave onboarding for the normal Train hub (used once there's ≥1 line).
  onFinish: () => void;
  // Open the builder to make a line by hand.
  onBuildManually: () => void;
  // Open the import-your-games flow.
  onImportGames: () => void;
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
  sub.textContent = 'Add a few lines and learn each one — watch it play, then try it yourself. Training opens up as soon as you have some.';
  head.appendChild(sub);
  root.appendChild(head);

  // ── Progress ──
  const reached = inTraining >= GOAL;
  const prog = document.createElement('div');
  prog.className = 'onb-progress';
  const bar = document.createElement('div');
  bar.className = 'onb-bar';
  const fill = document.createElement('div');
  fill.className = 'onb-bar-fill';
  fill.style.width = `${Math.min(1, inTraining / GOAL) * 100}%`;
  bar.appendChild(fill);
  prog.appendChild(bar);
  const plabel = document.createElement('div');
  plabel.className = 'onb-progress-label';
  plabel.textContent = reached
    ? `${inTraining} lines in training — nicely done!`
    : `${inTraining} / ${GOAL} lines in training`;
  prog.appendChild(plabel);
  root.appendChild(prog);

  // ── Start-training payoff (offered from the first line) ──
  if (inTraining >= 1) {
    if (reached && !goalCelebrated) {
      goalCelebrated = true;
      burstConfetti(root);
    }
    const start = document.createElement('button');
    start.type = 'button';
    start.className = 'btn-primary onb-start';
    start.textContent = reached ? 'Start training →' : `Start training (${inTraining}) →`;
    start.addEventListener('click', () => deps.onFinish());
    root.appendChild(start);
  }

  const repaint = () => void paint(root, deps);

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

  // Packs — first one open by default when it's the lead content.
  const packsWrap = document.createElement('div');
  packsWrap.className = 'onb-packs';
  packs.forEach((pack, i) => {
    packsWrap.appendChild(packCard(pack, i === 0 && suggestions.length === 0, existing, deps, repaint));
  });
  root.appendChild(packsWrap);

  // ── Footer routes (build by hand / import) ──
  const foot = document.createElement('div');
  foot.className = 'onb-foot';
  foot.appendChild(footLink('Build a line myself', () => deps.onBuildManually()));
  if (!deps.hasGames) {
    foot.appendChild(footLink('Import your games', () => deps.onImportGames()));
  }
  root.appendChild(foot);
}

// ── Pack card (collapsible) ────────────────────────────────────────────────────

function packCard(
  pack: Pack,
  open: boolean,
  existing: Set<string>,
  deps: StarterDeps,
  repaint: () => void,
): HTMLElement {
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
  const chips = document.createElement('span');
  chips.className = 'onb-pack-meta';
  chips.textContent = `${pack.level} · ${pack.style} · ${pack.lines.length} lines`;
  titleWrap.appendChild(chips);
  headBtn.appendChild(titleWrap);

  const chev = document.createElement('span');
  chev.className = 'onb-pack-chev';
  chev.setAttribute('aria-hidden', 'true');
  chev.appendChild(Icons.chevronRight(18));
  headBtn.appendChild(chev);

  const body = document.createElement('div');
  body.className = 'onb-pack-body';
  body.hidden = !open;
  headBtn.classList.toggle('onb-pack-head--open', open);
  headBtn.setAttribute('aria-expanded', String(open));

  headBtn.addEventListener('click', () => {
    const nowOpen = body.hidden;
    body.hidden = !nowOpen;
    headBtn.classList.toggle('onb-pack-head--open', nowOpen);
    headBtn.setAttribute('aria-expanded', String(nowOpen));
  });

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

  // "Add all" — a quieter route that skips the per-line walkthrough.
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
  return card;
}

// Add a batch of lines straight to training (no walkthrough), one after another.
function addSequentially(lines: PackLine[], colour: Colour, deps: StarterDeps): Promise<void> {
  return lines.reduce(
    (chain, l) => chain.then(() => new Promise<void>(res => deps.onAddLine(l.ucis, colour, false, res, res))),
    Promise.resolve(),
  );
}

// ── Rows ───────────────────────────────────────────────────────────────────────

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
  const sub = `${stat.games} game${stat.games === 1 ? '' : 's'} · ${stat.scorePct}% score`;
  return lineRow({
    name: stat.family,
    moves: formatSan(stat.repSans),
    sub,
    colour: stat.colour,
    added: existing.has(sig(stat.repUcis)),
    onAdd: () => deps.onAddLine(stat.repUcis, stat.colour, true, repaint, repaint),
  });
}

function lineRow(o: {
  name: string;
  moves: string;
  sub?: string;
  colour: Colour;
  added: boolean;
  onAdd: () => void;
}): HTMLElement {
  const row = document.createElement('div');
  row.className = 'onb-line';

  const info = document.createElement('div');
  info.className = 'onb-line-info';

  const nameEl = document.createElement('div');
  nameEl.className = 'onb-line-name';
  nameEl.appendChild(colourPip(o.colour));
  nameEl.appendChild(document.createTextNode(o.name));
  info.appendChild(nameEl);

  const movesEl = document.createElement('div');
  movesEl.className = 'onb-line-moves';
  movesEl.textContent = o.moves;
  info.appendChild(movesEl);

  if (o.sub) {
    const subEl = document.createElement('div');
    subEl.className = 'onb-line-sub';
    subEl.textContent = o.sub;
    info.appendChild(subEl);
  }
  row.appendChild(info);

  if (o.added) {
    const done = document.createElement('span');
    done.className = 'onb-added';
    done.textContent = '✓ Added';
    row.appendChild(done);
  } else {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn-primary onb-add';
    add.textContent = 'Add & learn';
    add.addEventListener('click', o.onAdd);
    row.appendChild(add);
  }

  return row;
}

// ── Small helpers ────────────────────────────────────────────────────────────

function sectionTitle(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'section-title onb-section-title';
  el.textContent = text;
  return el;
}

function footLink(label: string, onClick: () => void): HTMLElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'empty-state-link';
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
