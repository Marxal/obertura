// Branch actions: what you can do to a whole part of your repertoire at once.
//
// This is where the inheritance rule in repertoire.ts stops being a data
// structure and becomes the feature it was built for. `training`, `priority`,
// `tags` and `label` set on a node apply to everything below it, so "pause the
// whole French", "call this branch my Anti-Sicilian" and "tag all of this for
// Tuesday's game" are one tap at the branch point instead of twenty edits in a
// list.
//
// Reached from the tree view: tap a node, then this sheet. It always names how
// many lines it is about to affect, because a control that silently moves twelve
// things is a control nobody trusts twice.

import type { MoveNode } from './tree';
import type { LinePriority } from './types';
import {
  getAllRepertoires, getRepertoire, saveRepertoire,
} from './storage';
import {
  nodeAtPath, pathToNode, resolveTraining, resolvePriority, resolveTags,
  resolveLabel, removeSubtree, moveCount, type Repertoire,
} from './repertoire';
import { endsUnder, setBranchTraining, setBranchValue, projectLine, locateLine } from './lines-view';
import { joinCandidates, joinContinuation } from './repertoire-join';
import { requestTrainingSlots } from './entitlement';
import { pushBack } from './back-nav';
import { showDialog } from './dialog';
import { showToast } from './toast';

export interface BranchSheetOptions {
  repertoireId: string;
  /** UCI path from the start to the branch node. */
  ucis: string[];
  /** SAN path, for naming the branch in the sheet's own words. */
  sans: string[];
  /** "Build from here" — seeds the builder at this position. */
  onBuildFrom?: (ucis: string[]) => void;
  /** Called after anything is written, so the screen behind can repaint. */
  onChanged?: () => void;
}

/** "After 1.e4 e6" — how the sheet refers to the branch it is acting on. */
function branchLabel(sans: string[]): string {
  if (sans.length === 0) return 'your whole repertoire';
  const parts: string[] = [];
  for (let i = 0; i < sans.length && i < 8; i++) {
    parts.push(i % 2 === 0 ? `${i / 2 + 1}.${sans[i]}` : sans[i]);
  }
  return parts.join(' ') + (sans.length > 8 ? '…' : '');
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The same sheet, opened for a LINE rather than for a node on the map.
 *
 * This is the entry the transposition join actually needs. The tree view merges
 * by position, so two roads to one position are drawn as a single node — which
 * is exactly the node you cannot use to say "this line continues as that one".
 * A line, on the other hand, has an unambiguous end, and that end is the origin
 * a join is stored on.
 *
 * It resolves the line's OWN branch (never the tail a join has already added),
 * so opening the sheet on a joined line still acts on the line itself.
 */
export async function openBranchSheetForLine(
  lineId: string,
  extras: Omit<BranchSheetOptions, 'repertoireId' | 'ucis' | 'sans'> = {},
): Promise<void> {
  const found = locateLine(await getAllRepertoires(), lineId);
  if (!found) return;
  await openBranchSheet({
    ...extras,
    repertoireId: found.repertoire.id,
    ucis: found.originPath.map(n => n.uci),
    sans: found.originPath.map(n => n.san),
  });
}

export async function openBranchSheet(opts: BranchSheetOptions): Promise<void> {
  const book = await getRepertoire(opts.repertoireId);
  if (!book) return;
  const node = nodeAtPath(book.tree, opts.ucis);
  // The root is the book itself; acting on "everything" through a branch sheet
  // would be a footgun wearing a branch's clothes.
  if (!node || node === book.tree) return;

  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet branch-sheet';
  overlay.appendChild(sheet);

  const close = (): void => { overlay.remove(); removeBack(); };
  const removeBack = pushBack(close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  // Everything is re-derived after each write, so the counts and states in the
  // sheet can never drift from what was just stored.
  const paint = (): void => {
    sheet.innerHTML = '';
    build(sheet, book, node, opts, close, paint);
  };
  paint();

  document.body.appendChild(overlay);
}

function build(
  sheet: HTMLElement,
  book: Repertoire,
  node: MoveNode,
  opts: BranchSheetOptions,
  close: () => void,
  repaint: () => void,
): void {
  const path = pathToNode(book.tree, node.id) ?? [];
  const above = path.slice(0, -1);
  const ends = endsUnder(node);
  // A leaf IS a line end, so it counts as the one line it is.
  const lineCount = Math.max(1, ends.length);
  const moves = moveCount(node) + 1;

  const save = async (): Promise<void> => {
    await saveRepertoire(book);
    opts.onChanged?.();
  };

  // ── Header ────────────────────────────────────────────────────────────────
  const title = document.createElement('h3');
  title.className = 'edit-sheet-title';
  title.textContent = `After ${branchLabel(opts.sans)}`;
  sheet.appendChild(title);

  const sub = document.createElement('p');
  sub.className = 'branch-sub';
  sub.textContent = lineCount === 1
    ? `1 line, ${plural(moves, 'move')} from here on.`
    : `${plural(lineCount, 'line')} run through here, ${plural(moves, 'move')} in all.`;
  sheet.appendChild(sub);

  // ── Training ──────────────────────────────────────────────────────────────
  const inheritedTraining = resolveTraining(above);
  const training = resolveTraining(path);

  const trainRow = document.createElement('button');
  trainRow.type = 'button';
  trainRow.className = `branch-row branch-toggle${training ? ' is-on' : ''}`;
  trainRow.setAttribute('role', 'switch');
  trainRow.setAttribute('aria-checked', String(training));
  trainRow.innerHTML =
    `<span class="branch-row-label">${training ? 'In training' : 'Paused'}</span>` +
    `<span class="branch-row-note">${
      training
        ? `Turning this off pauses ${lineCount === 1 ? 'this line' : `all ${lineCount} lines`}`
        : `Turning this on trains ${lineCount === 1 ? 'this line' : `all ${lineCount} lines`}`
    }</span>`;
  trainRow.addEventListener('click', () => {
    void (async () => {
      const next = !training;
      // Turning a branch ON is the one direction that can cross the free-tier
      // cap, and it can cross it by a dozen at once — so ask about the whole
      // branch rather than enrolling an arbitrary part of it.
      if (next) {
        const wanted = ends.filter(e => {
          const p = pathToNode(book.tree, e.id);
          return p ? !resolveTraining(p) : false;
        }).length;
        if (!(await requestTrainingSlots(wanted))) return;
      }
      setBranchTraining(node, next, inheritedTraining);
      await save();
      showToast(
        next
          ? `Training ${lineCount === 1 ? 'this line' : `${lineCount} lines`} ✓`
          : `Paused ${lineCount === 1 ? 'this line' : `${lineCount} lines`}`,
        { variant: next ? 'success' : undefined },
      );
      repaint();
    })();
  });
  sheet.appendChild(trainRow);

  // ── Priority ──────────────────────────────────────────────────────────────
  const prio = resolvePriority(path) ?? 'standard';
  const prioWrap = document.createElement('div');
  prioWrap.className = 'branch-field';
  const prioLabel = document.createElement('span');
  prioLabel.className = 'edit-label';
  prioLabel.textContent = 'How often it comes round';
  prioWrap.appendChild(prioLabel);

  const prioRow = document.createElement('div');
  prioRow.className = 'branch-seg';
  const PRIORITIES: { key: LinePriority; label: string }[] = [
    { key: 'high', label: 'More often' },
    { key: 'standard', label: 'Standard' },
    { key: 'low', label: 'Less often' },
  ];
  for (const p of PRIORITIES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `branch-seg-btn${p.key === prio ? ' active' : ''}`;
    btn.textContent = p.label;
    btn.addEventListener('click', () => {
      void (async () => {
        // Same rule as the training toggle: the branch's answer replaces
        // whatever the lines below it were each saying.
        setBranchValue(node, 'priority', p.key, resolvePriority(above) ?? 'standard');
        await save();
        repaint();
      })();
    });
    prioRow.appendChild(btn);
  }
  prioWrap.appendChild(prioRow);
  sheet.appendChild(prioWrap);

  // ── Name ──────────────────────────────────────────────────────────────────
  const nameWrap = document.createElement('div');
  nameWrap.className = 'branch-field';
  const nameLabel = document.createElement('label');
  nameLabel.className = 'edit-label';
  nameLabel.textContent = lineCount === 1 ? 'Name this line' : 'Name this branch';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'edit-input';
  nameInput.value = node.label ?? '';
  nameInput.placeholder = resolveLabel(above) ?? 'Named automatically';
  const commitName = (): void => {
    const value = nameInput.value.trim();
    if (value === (node.label ?? '')) return;
    // Names resolve deepest-first, so a name pinned on a line BELOW this branch
    // would out-vote the branch's. Clearing them is what makes "name this
    // branch" do what it says on a book whose lines were named one by one —
    // which, after a migration, is every book.
    setBranchValue(node, 'label', value || undefined, resolveLabel(above) ?? undefined);
    void save().then(() => {
      showToast(value
        ? (lineCount === 1 ? 'Line renamed ✓' : `${lineCount} lines renamed ✓`)
        : 'Back to the automatic name');
    });
  };
  nameInput.addEventListener('blur', commitName);
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') nameInput.blur(); });
  nameWrap.appendChild(nameLabel);
  nameWrap.appendChild(nameInput);
  if (lineCount > 1) {
    const hint = document.createElement('p');
    hint.className = 'branch-hint';
    hint.textContent = `Names all ${lineCount} lines below this move.`;
    nameWrap.appendChild(hint);
  }
  sheet.appendChild(nameWrap);

  // ── Tags ──────────────────────────────────────────────────────────────────
  const tagWrap = document.createElement('div');
  tagWrap.className = 'branch-field';
  const tagLabel = document.createElement('label');
  tagLabel.className = 'edit-label';
  tagLabel.textContent = 'Tags for this branch';
  const tagInput = document.createElement('input');
  tagInput.type = 'text';
  tagInput.className = 'edit-input';
  tagInput.value = (node.tags ?? []).join(', ');
  const inheritedTags = resolveTags(above);
  tagInput.placeholder = inheritedTags.length
    ? `Adds to: ${inheritedTags.join(', ')}`
    : 'e.g. sharp, vs Anna';
  const commitTags = (): void => {
    const tags = tagInput.value.split(',').map(t => t.trim()).filter(Boolean);
    if (tags.join('|') === (node.tags ?? []).join('|')) return;
    if (tags.length) node.tags = tags;
    else delete node.tags;
    void save();
  };
  tagInput.addEventListener('blur', commitTags);
  tagInput.addEventListener('keydown', e => { if (e.key === 'Enter') tagInput.blur(); });
  tagWrap.appendChild(tagLabel);
  tagWrap.appendChild(tagInput);
  sheet.appendChild(tagWrap);

  // ── Transposition join ────────────────────────────────────────────────────
  //
  // Only on a line END: a move with continuations already has them. This is the
  // opt-in half of transpositions (REPERTOIRE-REDESIGN.md §9.5) — the tree stays
  // a tree, and one line is told to carry on as another where the two meet.
  const isEnd = node.children.length === 0 || node.endpoint === true;
  if (isEnd) {
    const joined = joinContinuation(book.tree, path);
    const candidates = joinCandidates(book.tree, path);
    if (joined.length > 0 || candidates.length > 0) {
      const joinWrap = document.createElement('div');
      joinWrap.className = 'branch-field';
      const joinLabel = document.createElement('span');
      joinLabel.className = 'edit-label';
      joinLabel.textContent = 'Where this line goes next';
      joinWrap.appendChild(joinLabel);

      if (joined.length > 0) {
        const note = document.createElement('p');
        note.className = 'branch-hint';
        note.textContent =
          `Continues as another line from here — ${plural(joined.length, 'more move')}: `
          + joined.map(m => m.san).join(' ');
        joinWrap.appendChild(note);

        const stop = document.createElement('button');
        stop.type = 'button';
        stop.className = 'btn-secondary';
        stop.textContent = 'Stop continuing';
        stop.addEventListener('click', () => {
          void (async () => {
            delete node.joinTo;
            await save();
            showToast('This line ends here again');
            repaint();
          })();
        });
        joinWrap.appendChild(stop);
      } else {
        const why = document.createElement('p');
        why.className = 'branch-hint';
        why.textContent = candidates.length === 1
          ? 'Another line reaches this exact position by a different move order.'
          : `${candidates.length} of your lines reach this exact position by a different move order.`;
        joinWrap.appendChild(why);

        // Three at most: the offer is a shortcut, not a directory.
        for (const c of candidates.slice(0, 3)) {
          const name = projectLine(book, c.path).name;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn-secondary branch-join-btn';
          btn.textContent = `Continue as “${name}” (+${plural(c.moves, 'move')})`;
          btn.addEventListener('click', () => {
            void (async () => {
              node.joinTo = c.endId;
              await save();
              showToast(`This line now continues as “${name}” ✓`, { variant: 'success' });
              repaint();
            })();
          });
          joinWrap.appendChild(btn);
        }
      }
      sheet.appendChild(joinWrap);
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  const actions = document.createElement('div');
  actions.className = 'branch-actions';

  if (opts.onBuildFrom) {
    const build = document.createElement('button');
    build.type = 'button';
    build.className = 'btn-primary';
    build.textContent = 'Build from here';
    build.addEventListener('click', () => {
      commitName(); commitTags();
      close();
      opts.onBuildFrom?.(opts.ucis);
    });
    actions.appendChild(build);
  }

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn-danger branch-remove';
  remove.textContent = lineCount === 1 ? 'Remove this line' : `Remove all ${lineCount} lines`;
  remove.addEventListener('click', () => {
    showDialog({
      title: lineCount === 1 ? 'Remove this line?' : `Remove ${lineCount} lines?`,
      // The honest number, always: what goes is this move and everything after
      // it, and everything BEFORE it is shared and stays.
      body: `This removes ${plural(moves, 'move')} from “${book.name}”, along with their `
        + `review history. The moves leading up to here stay — they belong to your other `
        + `lines too. This can’t be undone.`,
      buttons: [
        {
          label: 'Remove', variant: 'danger', onClick: () => {
            void (async () => {
              removeSubtree(book.tree, node.id);
              await save();
              close();
              showToast(lineCount === 1 ? 'Line removed' : `${lineCount} lines removed`);
            })();
          },
        },
        { label: 'Cancel', variant: 'secondary' },
      ],
    });
  });
  actions.appendChild(remove);

  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'btn-secondary';
  done.textContent = 'Done';
  done.addEventListener('click', () => { commitName(); commitTags(); close(); });
  actions.appendChild(done);

  sheet.appendChild(actions);
}
