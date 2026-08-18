// DOM-free checks of the projection: repertoires in, Lines out, and changes to
// a Line back onto the right node.
//
// This layer is why fifty-odd modules survived the redesign untouched, so the
// checks here are about the contract they rely on — a Line looks exactly as it
// always did — plus the two rules that are easy to get quietly wrong:
//
//   • writing a line back must not stamp explicit flags that kill inheritance;
//   • merging a line that is already in the book must add nothing.

import { Chess } from 'chess.js';
import type { MoveNode } from './tree';
import type { Line } from './types';
import {
  emptyTree, mergePath, makeIdFactory, linePaths, nodeAtPath, moveCount,
  resolveTraining, type MergeStep, type Repertoire,
} from './repertoire';
import {
  projectLines, projectRepertoire, makeLineId, parseLineId, locateLine,
  applyLineWrite, spineNodes, mergeLineIntoRepertoire, mergeRepertoireInto,
  setBranchTraining, setBranchValue, endsUnder, notationName, linePriorityOf,
  byNewestFirst, endNodeSequence,
} from './lines-view';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

function steps(sans: string): MergeStep[] {
  const chess = new Chess();
  return sans.split(/\s+/).filter(Boolean).map(san => {
    const m = chess.move(san);
    return { san: m.san, uci: m.from + m.to + (m.promotion ?? ''), fen: chess.fen() };
  });
}

function book(colour: 'white' | 'black', ...lines: string[]): Repertoire {
  const rep: Repertoire = {
    id: `rep-${colour}`,
    name: colour === 'white' ? 'My White lines' : 'My Black lines',
    colour,
    tree: emptyTree(),
    createdAt: 1000,
  };
  const nextId = makeIdFactory(rep.tree);
  for (const sans of lines) mergePath(rep.tree, steps(sans), nextId);
  return rep;
}

function at(rep: Repertoire, sans: string): MoveNode | null {
  return nodeAtPath(rep.tree, steps(sans).map(s => s.uci));
}

/** A line built standalone, the shape an importer or starter pack produces. */
function looseLine(id: string, colour: 'white' | 'black', sans: string): Line {
  const root = emptyTree();
  mergePath(root, steps(sans), makeIdFactory(root));
  return {
    id, name: id, tags: [], colour, openingName: null,
    confidence: 0, lastTrained: null, inTraining: true, tree: root,
  };
}

export function runLinesViewSelfTest(): TestResult[] {
  const out: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    out.push({ name, pass, detail });
  };

  // ── The projection ─────────────────────────────────────────────────────────

  {
    const rep = book('white', 'd4 d5 c4 c5', 'd4 d5 c4 e6');
    const lines = projectRepertoire(rep);
    check('one line comes out per line end', lines.length === 2, `${lines.length} lines`);
    check(
      'each projected line carries its own moves as a single path',
      lines.every(l => spineNodes(l.tree).length === 4),
      lines.map(l => spineNodes(l.tree).length).join(', '),
    );
    check(
      'the projected spine really is a single path (no stray branches)',
      lines.every(l => spineNodes(l.tree).every(n => n.children.length <= 1)),
      'every node has at most one child',
    );
    check(
      'a line takes its colour from the book it lives in',
      lines.every(l => l.colour === 'white'),
      'all white',
    );
    check(
      'ids are repertoire + end node, and parse back',
      lines.every(l => parseLineId(l.id)?.repertoireId === rep.id),
      lines[0].id,
    );
  }

  {
    const rep = book('white', 'e4 e5 Nf3 Nc6 Bb5');
    const [line] = projectRepertoire(rep);
    check(
      'a known opening names the line without anyone typing anything',
      line.name === 'Ruy Lopez' && line.openingName === 'Ruy Lopez',
      line.name,
    );
    at(rep, 'e4 e5')!.label = 'My e4 stuff';
    check(
      'a pinned label on a branch overrides the automatic name',
      projectRepertoire(rep)[0].name === 'My e4 stuff',
      projectRepertoire(rep)[0].name,
    );
    check(
      '…but the detected opening is still reported alongside it',
      projectRepertoire(rep)[0].openingName === 'Ruy Lopez',
      projectRepertoire(rep)[0].openingName ?? '(none)',
    );
  }

  {
    // The bundled table names every legal first move, so a real line always
    // resolves to an opening. The notation fallback is the safety net for a path
    // it has no answer for — exercised directly, since no real line reaches it.
    const rep = book('white', 'a3 b6 h3 g6 a4');
    const [line] = projectRepertoire(rep);
    check(
      'every line gets a name without anyone typing one',
      !!line.name && line.name === line.openingName,
      line.name,
    );
    const path = linePaths(rep.tree)[0];
    check(
      'the fallback name is readable notation, never "Untitled"',
      notationName(path).startsWith('1.a3') && notationName(path).includes('2.h3'),
      notationName(path),
    );
  }

  {
    const rep = book('white', 'e4 e5 Nf3 Nc6');
    const e4 = at(rep, 'e4')!;
    const nf3 = at(rep, 'e4 e5 Nf3')!;
    e4.review = { ease: 2.5, interval: 10, reps: 4, lapses: 0, due: new Date(0) };
    nf3.review = { ease: 2.5, interval: 10, reps: 2, lapses: 0, due: new Date(0) };
    check(
      'confidence averages the user moves’ clean reps, as it always did',
      projectRepertoire(rep)[0].confidence === 3,
      `confidence ${projectRepertoire(rep)[0].confidence} (want (4+2)/2 = 3)`,
    );
  }

  {
    const rep = book('black', 'e4 e6 d4 d5');
    const e6 = at(rep, 'e4 e6')!;
    e6.training = false;
    e6.tags = ['French'];
    e6.priority = 'low';
    const [line] = projectRepertoire(rep);
    check(
      'branch training, tags and priority all reach the projected line',
      line.inTraining === false && line.tags[0] === 'French' && line.priority === 'low',
      `training ${line.inTraining}, tags [${line.tags}], priority ${line.priority}`,
    );
    check(
      'linePriorityOf fills in the default for an untouched line',
      linePriorityOf({ ...line, priority: undefined }) === 'standard',
      'standard',
    );
  }

  {
    const rep = book('white', 'e4 e5');
    rep.archived = true;
    check(
      'an archived book is out of training whatever its nodes say',
      projectRepertoire(rep).every(l => !l.inTraining),
      'archived → not in training',
    );
  }

  {
    const white = book('white', 'e4 e5');
    const black = book('black', 'e4 c5');
    check(
      'projecting several books returns all their lines',
      projectLines([white, black]).length === 2,
      `${projectLines([white, black]).length} lines`,
    );
    check(
      'an empty book contributes nothing (not one blank line)',
      projectLines([book('white')]).length === 0,
      'zero',
    );
  }

  {
    const rep = book('white', 'e4 e5');
    const [line] = projectRepertoire(rep);
    const e4 = at(rep, 'e4')!;
    spineNodes(line.tree)[0].note = 'scribbled on the copy';
    check(
      'the projection hands out detached copies, so a scratch edit can’t leak',
      e4.note === undefined,
      `stored note: ${e4.note ?? '(none)'}`,
    );
  }

  // ── Locating a line again ──────────────────────────────────────────────────

  {
    const rep = book('white', 'd4 d5');
    const [line] = projectRepertoire(rep);
    const found = locateLine([rep], line.id);
    check(
      'a line id finds its live nodes again',
      found?.path.map(n => n.san).join(' ') === 'd4 d5',
      found?.path.map(n => n.san).join(' ') ?? '(not found)',
    );
    check(
      'a stale or malformed id is a miss, not a crash',
      locateLine([rep], 'nonsense') === null &&
      locateLine([rep], makeLineId(rep.id, 'n999')) === null,
      'both null',
    );
  }

  // ── Write-back ─────────────────────────────────────────────────────────────

  {
    const rep = book('white', 'e4 e5 Nf3');
    const [line] = projectRepertoire(rep);
    const nodes = spineNodes(line.tree);
    nodes[0].review = { ease: 2.4, interval: 6, reps: 2, lapses: 1, due: new Date(5) };
    nodes[0].note = 'grab the centre';
    check('a graded line writes back', applyLineWrite([rep], line), 'applied');
    check(
      'the review record lands on the repertoire’s own node',
      at(rep, 'e4')!.review?.interval === 6 && at(rep, 'e4')!.note === 'grab the centre',
      `interval ${at(rep, 'e4')!.review?.interval}`,
    );
    check(
      'a line that no longer exists reports the miss instead of corrupting the tree',
      applyLineWrite([rep], { ...line, id: makeLineId(rep.id, 'n999') }) === false,
      'returned false',
    );
  }

  {
    // THE INHERITANCE RULE. A branch is paused; a line under it is written back
    // (as every drill does). The leaf must not gain an explicit flag, or the
    // next branch toggle would be out-voted by stale leaves.
    const rep = book('black', 'e4 e6 d4 d5', 'e4 e6 d4 Nf6');
    at(rep, 'e4 e6')!.training = false;
    const lines = projectRepertoire(rep);
    for (const line of lines) applyLineWrite([rep], line);
    const leaves = [at(rep, 'e4 e6 d4 d5')!, at(rep, 'e4 e6 d4 Nf6')!];
    check(
      'writing a line back does not stamp its inherited training onto the leaf',
      leaves.every(n => n.training === undefined),
      leaves.map(n => String(n.training)).join(', '),
    );
    at(rep, 'e4 e6')!.training = true;
    check(
      '…so re-enabling the branch afterwards still reaches every line',
      linePaths(rep.tree).every(p => resolveTraining(p)),
      'all back in training',
    );
  }

  {
    const rep = book('white', 'd4 d5', 'd4 Nf6');
    const lines = projectRepertoire(rep);
    const one = { ...lines[0], inTraining: false };
    applyLineWrite([rep], one);
    check(
      'pausing ONE line does write an explicit flag, because it differs',
      spineNodes(one.tree).length > 0 &&
      projectRepertoire(rep).filter(l => !l.inTraining).length === 1,
      `${projectRepertoire(rep).filter(l => !l.inTraining).length} paused`,
    );
  }

  {
    const rep = book('white', 'e4 e5 Nf3 Nc6 Bb5');
    const [line] = projectRepertoire(rep);
    applyLineWrite([rep], { ...line, name: 'Ruy Lopez' });
    check(
      'a name that matches the automatic one is not pinned',
      at(rep, 'e4 e5 Nf3 Nc6 Bb5')!.label === undefined,
      'no label written',
    );
    applyLineWrite([rep], { ...line, name: 'My Spanish' });
    check(
      'a name that differs IS pinned',
      at(rep, 'e4 e5 Nf3 Nc6 Bb5')!.label === 'My Spanish',
      at(rep, 'e4 e5 Nf3 Nc6 Bb5')!.label ?? '(none)',
    );
  }

  {
    const rep = book('white', 'd4 d5 c4');
    at(rep, 'd4')!.tags = ['White'];
    const [line] = projectRepertoire(rep);
    applyLineWrite([rep], { ...line, tags: ['White', 'vs Anna'] });
    check(
      'a tag already carried by an ancestor is not copied onto the leaf',
      JSON.stringify(at(rep, 'd4 d5 c4')!.tags) === JSON.stringify(['vs Anna']),
      JSON.stringify(at(rep, 'd4 d5 c4')!.tags),
    );
    check(
      'and both still show on the projected line',
      projectRepertoire(rep)[0].tags.join(',') === 'White,vs Anna',
      projectRepertoire(rep)[0].tags.join(','),
    );
  }

  {
    const rep = book('white', 'e4 e5');
    const [line] = projectRepertoire(rep);
    applyLineWrite([rep], { ...line, timesTrained: 3, lastTrained: '2026-08-01' });
    const projected = projectRepertoire(rep)[0];
    check(
      'run counts and training dates round-trip',
      projected.timesTrained === 3 && projected.lastTrained === '2026-08-01',
      `${projected.timesTrained} runs, last ${projected.lastTrained}`,
    );
  }

  // ── Merging a line into a book ─────────────────────────────────────────────

  {
    const rep = book('white', 'd4 d5 c4 c5');
    const before = moveCount(rep.tree);
    const merged = mergeLineIntoRepertoire(rep, looseLine('x', 'white', 'd4 d5 c4 c5'));
    check(
      'importing a line you already have adds no moves at all',
      moveCount(rep.tree) === before,
      `${before} → ${moveCount(rep.tree)}`,
    );
    check(
      'and hands back the line that was already there',
      merged !== null && projectRepertoire(rep).length === 1,
      `${projectRepertoire(rep).length} line(s)`,
    );
  }

  {
    const rep = book('white', 'd4 d5 c4 c5');
    mergeLineIntoRepertoire(rep, looseLine('x', 'white', 'd4 d5 c4 c5 e4 e5'));
    check(
      'importing a longer version of a line extends it rather than copying it',
      moveCount(rep.tree) === 6 && projectRepertoire(rep).length === 1,
      `${moveCount(rep.tree)} moves, ${projectRepertoire(rep).length} line(s)`,
    );
  }

  {
    const rep = book('white', 'd4 d5 c4 c5 e4');
    mergeLineIntoRepertoire(rep, looseLine('x', 'white', 'd4 d5 c4'));
    check(
      'importing a line that ends inside a longer one keeps it as a line of its own',
      projectRepertoire(rep).length === 2 && at(rep, 'd4 d5 c4')!.endpoint === true,
      `${projectRepertoire(rep).length} line(s)`,
    );
    check(
      '…without storing the moves twice',
      moveCount(rep.tree) === 5,
      `${moveCount(rep.tree)} moves`,
    );
  }

  {
    const rep = book('white');
    const line = looseLine('x', 'white', 'e4 e5');
    spineNodes(line.tree)[0].review = { ease: 2.5, interval: 9, reps: 3, lapses: 0, due: new Date(1) };
    mergeLineIntoRepertoire(rep, line);
    check(
      'a merged line brings its training history with it',
      at(rep, 'e4')!.review?.interval === 9,
      `interval ${at(rep, 'e4')!.review?.interval ?? 0}`,
    );
    check(
      'a line with no moves is refused rather than stored as nothing',
      mergeLineIntoRepertoire(rep, looseLine('y', 'white', '')) === null,
      'null',
    );
  }

  {
    const into = book('white', 'e4 e5');
    const from = book('white', 'e4 e5 Nf3', 'd4 d5');
    mergeRepertoireInto(into, from);
    check(
      'folding one book into another merges by move, keeping both sets',
      moveCount(into.tree) === 5 && projectRepertoire(into).length === 2,
      `${moveCount(into.tree)} moves, ${projectRepertoire(into).length} lines`,
    );
  }

  // ── Branch toggles ─────────────────────────────────────────────────────────

  {
    const rep = book('black', 'e4 e6 d4 d5 Nc3', 'e4 e6 d4 d5 Nd2', 'e4 c5 Nf3');
    const french = at(rep, 'e4 e6')!;
    check(
      'a branch knows how many lines it is about to move',
      endsUnder(french).length === 2,
      `${endsUnder(french).length} lines under 1.e4 e6`,
    );

    // An individually-paused line inside the branch must not out-vote the branch.
    at(rep, 'e4 e6 d4 d5 Nc3')!.training = false;
    setBranchTraining(french, true, true);
    check(
      'turning a branch on clears the stale per-line flags underneath it',
      projectRepertoire(rep).every(l => l.inTraining),
      `${projectRepertoire(rep).filter(l => !l.inTraining).length} still paused`,
    );

    setBranchTraining(french, false, true);
    const paused = projectRepertoire(rep).filter(l => !l.inTraining);
    check(
      'turning it off pauses exactly the lines under it, and no others',
      paused.length === 2,
      `${paused.length} paused of ${projectRepertoire(rep).length}`,
    );
    check(
      'the flag is written once, on the branch, not on every leaf',
      french.training === false && endsUnder(french).every(n => n.training === undefined),
      'one flag',
    );
  }

  {
    // Priority follows the same branch rule as training: one value on the
    // branch, and whatever the lines below were each saying is replaced.
    const rep = book('white', 'd4 d5 c4 c5', 'd4 d5 c4 e6', 'e4 e5');
    const c4 = at(rep, 'd4 d5 c4')!;
    at(rep, 'd4 d5 c4 c5')!.priority = 'high';   // set individually, long ago
    setBranchValue(c4, 'priority', 'low', undefined);
    const under = projectRepertoire(rep).filter(l => l.name !== undefined
      && spineNodes(l.tree)[0].san === 'd4');
    check(
      'a branch priority replaces the per-line ones underneath it',
      under.every(l => l.priority === 'low'),
      under.map(l => String(l.priority)).join(', '),
    );
    check(
      'and leaves the rest of the book alone',
      projectRepertoire(rep).find(l => spineNodes(l.tree)[0].san === 'e4')?.priority === undefined,
      'the e4 line is untouched',
    );
    check(
      'the value lives on the branch, not on every leaf',
      c4.priority === 'low' && endsUnder(c4).every(n => n.priority === undefined),
      'one value',
    );
    setBranchValue(c4, 'priority', 'standard', 'standard');
    check(
      'a branch that merely agrees with what it inherits stores nothing',
      c4.priority === undefined,
      'cleared',
    );
  }

  {
    // Naming a branch has to REPLACE the names pinned on the lines below it —
    // names resolve deepest-first, so leaving them would make the rename look
    // like it did nothing. After a migration every line carries a pinned name,
    // so this is the common case rather than the corner one.
    const rep = book('black', 'e4 e6 d4 d5 Nc3', 'e4 e6 d4 d5 Nd2', 'e4 c5');
    at(rep, 'e4 e6 d4 d5 Nc3')!.label = 'Winawer-ish';
    at(rep, 'e4 e6 d4 d5 Nd2')!.label = 'Tarrasch-ish';
    const french = at(rep, 'e4 e6')!;
    setBranchValue(french, 'label', 'My French', undefined);
    const named = projectRepertoire(rep).filter(l => spineNodes(l.tree)[1]?.san === 'e6');
    check(
      'naming a branch names every line under it',
      named.length === 2 && named.every(l => l.name === 'My French'),
      named.map(l => l.name).join(', '),
    );
    check(
      'and leaves the lines outside it alone',
      projectRepertoire(rep).find(l => spineNodes(l.tree)[1]?.san === 'c5')?.name !== 'My French',
      'the Sicilian keeps its own name',
    );
    setBranchValue(french, 'label', undefined, undefined);
    check(
      'clearing a branch name hands its lines back to the automatic one',
      projectRepertoire(rep).filter(l => spineNodes(l.tree)[1]?.san === 'e6')
        .every(l => l.name === l.openingName),
      'back to the detected openings',
    );
  }

  {
    // Node ids are unique WITHIN a book, not across books — two repertoires both
    // number their nodes from n1. Anything addressing a node therefore has to
    // carry the repertoire too, which is exactly what a line id does.
    const white = book('white', 'e4 e5');
    const black = book('black', 'd4 d5');
    const whiteLine = projectRepertoire(white)[0];
    const blackLine = projectRepertoire(black)[0];
    check(
      'a line id names its book, so two books cannot be confused',
      locateLine([white, black], whiteLine.id)?.repertoire === white &&
      locateLine([white, black], blackLine.id)?.repertoire === black,
      'each resolved to its own book',
    );
  }

  // ── "Latest" ───────────────────────────────────────────────────────────────
  //
  // A line's date is the newest move on its own branch, so extending a line
  // moves it to the top of My Lines. Undated moves — a book built before nodes
  // carried a date at all — fall back to the order the nodes were handed out in,
  // which is the only honest record of "added later" that data has.
  {
    const rep = book('white', 'e4 e5 Nf3');
    const nodes = [at(rep, 'e4')!, at(rep, 'e4 e5')!, at(rep, 'e4 e5 Nf3')!];
    nodes[0].createdAt = 100;
    nodes[1].createdAt = 200;
    nodes[2].createdAt = 300;
    check(
      'a line is dated by its newest move',
      projectRepertoire(rep)[0].createdAt === 300,
      `createdAt ${projectRepertoire(rep)[0].createdAt}`,
    );

    // The move that ended it loses its stamp (old data); the line still dates
    // from the newest move it does know about rather than becoming undated.
    delete nodes[2].createdAt;
    check(
      'a gap in the stamps falls back to the newest move that has one',
      projectRepertoire(rep)[0].createdAt === 200,
      `createdAt ${projectRepertoire(rep)[0].createdAt}`,
    );
  }

  {
    const rep = book('white', 'e4 e5', 'd4 d5');
    const [first, second] = projectRepertoire(rep);
    check(
      'a line id yields the sequence its end node was created in',
      endNodeSequence(second) > endNodeSequence(first),
      `${first.id} → ${endNodeSequence(first)}, ${second.id} → ${endNodeSequence(second)}`,
    );

    // Every node undated — a book built in the builder before moves were
    // stamped. Newest-first must still put the later-added line on top instead
    // of collapsing the whole book into one indistinguishable heap.
    const undated = [first, second].map(l => ({ ...l, createdAt: undefined }));
    check(
      'an undated book still orders by when its moves were added',
      [...undated].sort(byNewestFirst)[0].id === second.id,
      `first after sorting: ${[...undated].sort(byNewestFirst)[0].id}`,
    );

    // A dated line beats an undated one: the stamp only exists on moves added
    // after stamping began, so anything without one is genuinely older.
    check(
      'a dated line outranks an undated one',
      [{ ...first, createdAt: 5000 }, { ...second, createdAt: undefined }]
        .sort(byNewestFirst)[0].id === first.id,
      'dated line came first',
    );
  }

  return out;
}
