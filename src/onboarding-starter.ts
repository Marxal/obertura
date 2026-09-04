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
import { track } from './metrics';
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
//   'build'  — open the line in the BUILDER, laid out and played in, and let the
//              builder's own Save carry it the rest of the way. The default for
//              a single pack line: same route the first-run line takes, so a
//              pack line is something you look at and adjust before it's yours,
//              not something that drops you straight into a drill.
//   'learn'  — the normal add-to-training path, gated by the "Confirm run before
//              training" pref (a watch-then-play run under the default). Still
//              used by callers that add without a builder detour.
//   'enrol'  — straight into training, no run. The bulk "add all" path.
//   'save'   — save the line to My Lines but leave it OUT of training. What a
//              bulk add falls back to once the free tier's slots are used up, so
//              the lines are still there to rotate in later.
export type AddLineMode = 'build' | 'learn' | 'enrol' | 'save';

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
//
// Picking a line CLOSES the sheet, because picking a line now opens the builder
// behind it (mode 'build'): leaving a full-screen overlay up over the thing the
// tap just did is how you get "I pressed it and nothing happened". Only the bulk
// "add all" path repaints in place, and it restores whichever pack was open.
//
// `existing` is mutated in place so the sheet's own "✓ Added" state stays in
// sync across repaints without re-querying storage.
//
// There's no Close button: the sheet tops out at 85vh, so the backdrop above it
// is always tappable, and the system back gesture closes it too. A footer button
// that only repeats what the backdrop already does is a row of dead space at the
// bottom of every pack list.
function openPackPicker(
  packs: Pack[],
  existing: string[],
  onAddLine: AddLineFn,
  onAdded: () => void,
): void {
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    overlay.remove();
    removeBack();
  }
  const removeBack = pushBack(close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  // Which pack is expanded, held here rather than in the card so a repaint
  // doesn't snap every accordion shut under the user.
  let openPackId: string | null = null;

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
    const ctrls = packs.map(pack => packCard(pack, existing, onAddLine, repaint, close));
    ctrls.forEach((pc, i) => {
      pc.headBtn.addEventListener('click', () => {
        const willOpen = !pc.isOpen();
        ctrls.forEach(c => c.setOpen(false));
        pc.setOpen(willOpen);
        openPackId = willOpen ? packs[i].id : null;
      });
      packsWrap.appendChild(pc.card);
      // Restore the expanded pack after a repaint — with no transition, since
      // it was already open as far as the user is concerned.
      if (packs[i].id === openPackId) pc.setOpen(true, { animate: false });
    });
    sheet.appendChild(packsWrap);

    overlay.appendChild(sheet);
  }

  document.body.appendChild(overlay);
  render();
}

// ── Pack card (single-open accordion member) ───────────────────────────────────

interface PackCtrl {
  card: HTMLElement;
  headBtn: HTMLButtonElement;
  setOpen: (open: boolean, opts?: { animate?: boolean }) => void;
  isOpen: () => boolean;
}

function packCard(
  pack: Pack,
  existing: string[],
  onAddLine: AddLineFn,
  repaint: () => void,
  closeSheet: () => void,
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

  // The expanding half is three nested elements on purpose: the PANEL animates
  // its grid row from 0fr to 1fr (the one way to transition to "however tall the
  // content is" in CSS), the CLIP has the overflow hidden, and only the innermost
  // body carries padding — padding on a collapsing box never reaches zero, which
  // is what makes naive max-height accordions leave a stripe behind.
  //
  // The pack's blurb used to lead the body. It's gone: the sheet is a list of
  // LINES to pick, and a paragraph of pitch above each list pushed the actual
  // choices below the fold on a phone.
  const panel = document.createElement('div');
  panel.className = 'onb-pack-panel';
  const clip = document.createElement('div');
  clip.className = 'onb-pack-clip';
  const body = document.createElement('div');
  body.className = 'onb-pack-body';
  clip.appendChild(body);
  panel.appendChild(clip);

  const list = document.createElement('div');
  list.className = 'onb-lines';
  for (const line of pack.lines) {
    list.appendChild(packLineRow(line, pack.colour, existing, onAddLine, closeSheet));
  }
  body.appendChild(list);

  const pending = pack.lines.filter(l => !isLineAdded(existing, pack.colour, l.ucis));
  if (pending.length > 1) {
    const addAll = document.createElement('button');
    addAll.type = 'button';
    addAll.className = 'onb-addall';
    addAll.textContent = `Add all ${pending.length} without opening them`;
    addAll.addEventListener('click', () => {
      // ONE count for the tap, not one per line. addSequentially loops
      // onAddLine over every pending line, so counting inside that loop would
      // turn a single "add all" on a ten-line pack into ten events and make an
      // enthusiastic afternoon look like a busy month.
      track('starter_pack_added');
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
  card.appendChild(panel);

  let open = false;
  // `animate: false` is for restoring state after a repaint — the pack was
  // already open, so sliding it open again would look like a glitch.
  const setOpen = (next: boolean, opts: { animate?: boolean } = {}): void => {
    open = next;
    panel.classList.toggle('onb-pack-panel--instant', opts.animate === false);
    panel.classList.toggle('onb-pack-panel--open', next);
    headBtn.classList.toggle('onb-pack-head--open', next);
    headBtn.setAttribute('aria-expanded', String(next));
    // A closed panel is zero-height but still in the tree, so hide its contents
    // from the reading order and from tab stops the way `hidden` used to.
    clip.setAttribute('aria-hidden', String(!next));
    clip.toggleAttribute('inert', !next);
  };
  setOpen(false, { animate: false });

  return { card, headBtn, setOpen, isOpen: () => open };
}

// Add a batch of lines straight to training (without opening any of them in the
// builder), one after another.
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
  closeSheet: () => void,
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
    // Close FIRST, then open the line in the builder: the sheet is the thing in
    // the way of seeing what the tap did. From there it's an ordinary builder
    // session — look at the line, change what you don't like, Save — which is
    // the same route the first-run line takes.
    onAdd: () => {
      // The other half of the same count: one tap on one line. This route opens
      // the builder rather than saving, so `line_saved` fires later too — that
      // is the point, and the pair is what says how many pack lines survive
      // being looked at.
      track('starter_pack_added');
      closeSheet();
      onAddLine(seedFromPackLine(line), colour, 'build', () => {}, () => {});
    },
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
