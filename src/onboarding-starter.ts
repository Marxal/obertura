// The starter packs — curated ready-made lines (src/starter-packs.json), and the
// lightbox that picks from them.
//
// This used to be a whole first-run SCREEN as well: Train swapped itself for a
// "Build your first lines" page (progress bar, game-based suggestions, packs)
// until enough lines were in training. That page is gone. The first-run picker
// (onboarding-picker.ts) now gets the first line, and the Get-started checklist
// (first-steps.ts) covers the rest without taking the hub away from the user —
// so what's left here is the pack data and the picker sheet, which My Lines and
// the checklist both open.
//
// Adding a line runs the app's normal add-to-training path (addLineToTraining via
// the caller's onAddLine), which — with the default "confirm run" pref — plays
// the line through once (watch), then has you play it before it joins training.

import { getAllLines } from './storage';
import type { MoveNode } from './tree';
import { Icons } from './icons';
import { buildPositionCard, colourPip, fenFromUcis } from './card-position';
import { formatSanLine } from './notation';
import { pushBack } from './back-nav';
import { freeTrainingSlots, showBulkCapToast } from './entitlement';

// Lines in training that count as "onboarded". The Train screen stamps the
// completion flag once this is reached, which is how the first-run picker knows
// it has had its turn.
//
// Now 1. It was 6, then 5, on the theory that a repertoire needs a bit of bulk
// before training makes sense — but that made "unlock training" a chore bar the
// user had to grind out before seeing what they'd come for. One line IS a
// repertoire: it's due tomorrow, it comes back, the loop works.
export const ONBOARDING_GOAL = 1;

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
  // Tags stamped onto the saved line — a study import passes its (shortened)
  // study title here so all chapters group under one chip.
  tags?: string[];
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

// What adding a starter/suggested line should actually do:
//   'learn'  — the normal add-to-training path, gated by the "Confirm run before
//              training" pref (a watch-then-play run under the default). This is
//              a single, deliberate add, so it's also the one that meets the
//              free-tier cap dialog.
//   'enrol'  — straight into training, no run. The bulk "add all" path.
//   'save'   — save the line to My Lines but leave it OUT of training. What a
//              bulk add falls back to once the free tier's slots are used up, so
//              the lines are still there to rotate in later.
export type AddLineMode = 'learn' | 'enrol' | 'save';

// Add a line (moves + optional notes/plan), per AddLineMode above. onDone fires
// once it's in; onCancel if the confirm run was abandoned. main.ts owns the real
// implementation (lineFromUcis + addLineToTraining); everything here just calls it.
export type AddLineFn = (
  seed: LineSeed,
  colour: Colour,
  mode: AddLineMode,
  onDone: () => void,
  onCancel: () => void,
) => void;

// Lazy-load the curated packs only when onboarding actually shows (keeps them out
// of the initial bundle, like the opening library). Also reused by the Explore
// screen's Packs tab, so both surfaces read the same starter-packs.json.
let packsPromise: Promise<Pack[]> | null = null;
export function loadPacks(): Promise<Pack[]> {
  if (!packsPromise) {
    packsPromise = import('./starter-packs.json').then(m => (m.default ?? m) as unknown as Pack[]);
  }
  return packsPromise;
}

// Open the starter-pack picker. Reached from the My Lines empty states, the
// Get-started checklist and the Explore tab's Packs section.
export async function openStarterPackPicker(onAddLine: AddLineFn): Promise<void> {
  const [packs, lines] = await Promise.all([loadPacks(), getAllLines()]);
  openPackPicker(packs, existingMainlines(lines), onAddLine, () => {});
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
  onAddLine: AddLineFn,
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
    const ctrls = packs.map(pack => packCard(pack, existing, onAddLine, repaint));
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
  onAddLine: AddLineFn,
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
    list.appendChild(packLineRow(line, pack.colour, existing, onAddLine, repaint));
  }
  body.appendChild(list);

  const pending = pack.lines.filter(l => !isLineAdded(existing, pack.colour, l.ucis));
  if (pending.length > 1) {
    const addAll = document.createElement('button');
    addAll.type = 'button';
    addAll.className = 'onb-addall';
    addAll.textContent = `Add all ${pending.length} without the walkthrough`;
    addAll.addEventListener('click', () => {
      addAll.disabled = true;
      addAll.textContent = 'Adding…';
      void addSequentially(pending, pack.colour, onAddLine).then(() => {
        for (const l of pending) existing.push(lineKey(pack.colour, l.ucis));
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
//
// The free tier caps how many lines TRAIN at once, so a batch bigger than the
// remaining slots enrols as many as fit and saves the rest to My Lines unenrolled
// — nothing is lost, and the user rotates them in whenever they like. The
// leftover is reported with a quiet toast rather than the upsell dialog: a batch
// add is usually the first thing someone does, and a price tag in the first
// minute is the wrong first impression.
async function addSequentially(lines: PackLine[], colour: Colour, onAddLine: AddLineFn): Promise<void> {
  const slots = await freeTrainingSlots(); // Infinity when entitled
  let enrolled = 0;
  for (const l of lines) {
    const mode: AddLineMode = enrolled < slots ? 'enrol' : 'save';
    await new Promise<void>(res => onAddLine(seedFromPackLine(l), colour, mode, res, res));
    if (mode === 'enrol') enrolled++;
  }
  if (enrolled < lines.length) showBulkCapToast(enrolled, lines.length);
}

// ── Rows (shared position-card look, with a board miniature) ────────────────────

function packLineRow(
  line: PackLine,
  colour: Colour,
  existing: string[],
  onAddLine: AddLineFn,
  repaint: () => void,
): HTMLElement {
  const noteCount = Object.keys(line.notes ?? {}).length;
  return lineRow({
    name: line.name,
    moves: formatSanLine(line.sans),
    sub: line.plan,
    noteCount,
    fen: fenFromUcis(line.ucis),
    colour,
    added: isLineAdded(existing, colour, line.ucis),
    onAdd: () => onAddLine(seedFromPackLine(line), colour, 'learn', () => {
      existing.push(lineKey(colour, line.ucis));
      repaint();
    }, repaint),
  });
}

function lineRow(o: {
  name: string;
  moves: string;
  sub?: string;
  noteCount?: number;
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

  if (o.noteCount) {
    const notesEl = document.createElement('div');
    notesEl.className = 'onb-line-notes';
    notesEl.textContent = `✎ ${o.noteCount} move note${o.noteCount === 1 ? '' : 's'}`;
    content.appendChild(notesEl);
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
// added when a saved line OF THE SAME COLOUR has a mainline that is a ply-prefix
// of it (or vice versa — depths can differ). Full-length prefix matching (not a
// fixed-ply signature) keeps two pack lines that diverge deep in the line from
// shadowing each other; the colour key keeps the same moves in a White and a
// Black pack from shadowing each other. The `+ ' '` guard makes it a whole-ply
// prefix, never a mid-UCI string prefix.
export function lineKey(colour: Colour, ucis: string[]): string {
  return `${colour}:${ucis.join(' ')}`;
}

export function isLineAdded(existing: string[], colour: Colour, ucis: string[]): boolean {
  if (ucis.length === 0) return false;
  const s = lineKey(colour, ucis);
  return existing.some(e => e === s || e.startsWith(s + ' ') || s.startsWith(e + ' '));
}

// The saved lines' mainlines as colour-keyed joined-UCI strings, for isLineAdded.
export function existingMainlines(lines: { colour: Colour; tree: MoveNode }[]): string[] {
  return lines
    .filter(l => mainlineUcis(l.tree).length > 0)
    .map(l => lineKey(l.colour, mainlineUcis(l.tree)));
}
