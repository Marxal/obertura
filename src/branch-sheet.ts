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
import type { Line, LinePriority } from './types';
import {
  getAllRepertoires, getRepertoire, saveRepertoire,
} from './storage';
import {
  nodeAtPath, pathToNode, resolveTraining, resolvePriority, resolveTags,
  resolveLabel, detachSubtree, reattachSubtree, moveCount,
  type DetachedSubtree, type Repertoire,
} from './repertoire';
import { describeRemoval, removalBody, removalDone, removalTitle } from './line-removal';
import {
  endsUnder, setBranchTraining, setBranchValue, projectLine, projectRepertoire, locateLine,
} from './lines-view';
import { openRepertoireMap } from './repertoire-map';
import { Icons } from './icons';
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
  /**
   * "See in My Lines" — offered when the sheet was opened from somewhere that
   * ISN'T My Lines (the builder). Omitted on My Lines itself, where it would
   * point at the screen you are already looking at.
   */
  onSeeInLines?: () => void;
  /** Opening a line from the map "Show on the tree" puts up. */
  onOpenLine?: (line: Line) => void;
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

  // The app's switch, not a filled card: this is a two-state setting and it
  // should look like every other two-state setting in the app. The note under it
  // stays, because unlike those it can move a dozen lines in one tap.
  const trainRow = document.createElement('button');
  trainRow.type = 'button';
  trainRow.className = `branch-row branch-train${training ? ' is-on' : ''}`;
  trainRow.setAttribute('role', 'switch');
  trainRow.setAttribute('aria-checked', String(training));
  trainRow.innerHTML =
    `<span class="branch-train-main">` +
      `<span class="dline-switch" aria-hidden="true"><span class="dline-switch-knob"></span></span>` +
      `<span class="branch-row-label">${training ? 'In training' : 'Paused'}</span>` +
    `</span>` +
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
  prioLabel.textContent = 'Training priority';
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

  // ── Name and tags, folded away ────────────────────────────────────────────
  //
  // Two text inputs are the loudest thing that can sit in a sheet, and they are
  // the least used thing in this one: most visits here are to pause a branch,
  // change how often it comes round, or take it out. So they fold behind one
  // quiet line that shows what they currently hold — open it when you actually
  // want to type.
  const more = document.createElement('details');
  more.className = 'branch-more';
  const moreSummary = document.createElement('summary');
  moreSummary.className = 'branch-more-summary';
  const moreLabel = document.createElement('span');
  moreLabel.textContent = 'Name & tags';
  moreSummary.appendChild(moreLabel);
  const current = [resolveLabel(path), (node.tags ?? []).join(', ')].filter(Boolean).join(' · ');
  if (current) {
    const now = document.createElement('span');
    now.className = 'branch-more-current';
    now.textContent = current;
    moreSummary.appendChild(now);
  }
  more.appendChild(moreSummary);

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
  more.appendChild(nameWrap);

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
  more.appendChild(tagWrap);
  sheet.appendChild(more);

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

  // ── Ways out ──────────────────────────────────────────────────────────────
  //
  // One primary (build from here), then a row of quiet links for the places
  // this branch also lives — My Lines, and the map. Links rather than buttons
  // because they only MOVE you: nothing on that row changes your repertoire, so
  // nothing on it should carry a button's weight.
  const links = document.createElement('div');
  links.className = 'branch-links';

  const addLink = (label: string, icon: SVGElement | null, onClick: () => void): void => {
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'branch-link';
    if (icon) link.appendChild(icon);
    link.appendChild(document.createTextNode(label));
    link.addEventListener('click', () => { commitName(); commitTags(); onClick(); });
    links.appendChild(link);
  };

  if (opts.onSeeInLines) {
    addLink('See in My Lines', null, () => { close(); opts.onSeeInLines?.(); });
  }

  // "Show on the tree": the same map My Lines draws, opened already centred on
  // this position (`initialPath`). Seeing where a branch sits among its
  // neighbours is most of what makes a removal decidable — it is the difference
  // between "2 lines" as a number and 2 lines you can point at.
  addLink('Show on the tree', Icons.tree(14), () => {
    close();
    openRepertoireMap(projectRepertoire(book), book.colour, l => opts.onOpenLine?.(l), {
      title: book.name,
      subtitle: `at ${branchLabel(opts.sans)}`,
      initialPath: opts.ucis,
    });
  });

  sheet.appendChild(links);

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

  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'btn-secondary';
  done.textContent = 'Done';
  done.addEventListener('click', () => { commitName(); commitTags(); close(); });
  actions.appendChild(done);

  sheet.appendChild(actions);

  // ── Remove ────────────────────────────────────────────────────────────────
  //
  // Below everything, under a rule, as quiet text. It used to be a filled red
  // button sitting in the same stack as Done — the loudest control in a sheet
  // whose everyday job is pausing a branch. Weight here should follow how often
  // something is wanted, not how serious it is; the seriousness is handled by
  // what happens after the tap (see line-removal.ts), not by the shouting.
  const impact = describeRemoval(book, node.id);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'branch-remove';
  remove.appendChild(Icons.trash(13));
  remove.appendChild(document.createTextNode(
    lineCount === 1 ? 'Remove this line' : `Remove all ${lineCount} lines`,
  ));
  remove.addEventListener('click', () => {
    if (!impact) return;
    // One line comes out on the tap, with an Undo; anything wider stops and
    // names what it is about to take. Same rule as the builder's own trash.
    if (impact.small) { void doRemove(); return; }
    showDialog({
      title: removalTitle(impact),
      body: removalBody(impact, book.name),
      buttons: [
        { label: 'Remove', variant: 'danger', onClick: () => { void doRemove(); } },
        { label: 'Cancel', variant: 'secondary' },
      ],
    });
  });
  sheet.appendChild(remove);

  // Removal is the one edit here that destroys work — the review history goes
  // with the moves, and re-playing them does not bring it back. So the cut is
  // kept whole and handed to the toast, which can put the very same moves back.
  async function doRemove(): Promise<void> {
    const cut = detachSubtree(book.tree, node.id);
    if (!cut) return;
    await save();
    close();
    showToast(removalDone(cut.moves), {
      action: { label: 'Undo', onClick: () => void undoRemove(cut) },
    });
  }

  async function undoRemove(cut: DetachedSubtree): Promise<void> {
    if (!reattachSubtree(book.tree, cut)) {
      showToast('Those moves can’t be put back now');
      return;
    }
    await save();
    showToast('Moves put back ✓', { variant: 'success' });
  }
}
