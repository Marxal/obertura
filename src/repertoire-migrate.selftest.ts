// DOM-free checks of the one-way migration from the old flat line list to
// trees.
//
// This runs once on every existing user's device, so the bar is "nothing a user
// would notice is lost": every move, every name, every tag, every training
// record and every line survives — while the duplicated moves that motivated the
// whole redesign do not.

import { Chess } from 'chess.js';
import type { Line } from './types';
import type { MoveNode } from './tree';
import { emptyTree, moveCount, linePaths, nodeAtPath, resolveTraining } from './repertoire';
import { projectRepertoire } from './lines-view';
import { migrateLines, migrationSummary } from './repertoire-migrate';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

let seq = 0;

/** A stored line in the OLD shape: one record, one single-path tree. */
function oldLine(sans: string, over: Partial<Line> = {}): Line {
  const chess = new Chess();
  const root = emptyTree();
  let cursor = root;
  for (const san of sans.split(/\s+/).filter(Boolean)) {
    const m = chess.move(san);
    const node: MoveNode = {
      id: `old${++seq}`,
      san: m.san,
      uci: m.from + m.to + (m.promotion ?? ''),
      fen: chess.fen(),
      children: [],
    };
    cursor.children = [node];
    cursor = node;
  }
  return {
    id: `line${++seq}`,
    name: sans,
    tags: [],
    colour: 'white',
    openingName: null,
    confidence: 0,
    lastTrained: null,
    inTraining: true,
    tree: root,
    ...over,
  };
}

/** The last node of an old line's path, so a test can decorate it. */
function tip(line: Line): MoveNode {
  let node = line.tree.children[0];
  while (node.children[0]) node = node.children[0];
  return node;
}

function ucisOf(sans: string): string[] {
  const chess = new Chess();
  return sans.split(/\s+/).filter(Boolean).map(san => {
    const m = chess.move(san);
    return m.from + m.to + (m.promotion ?? '');
  });
}

export function runRepertoireMigrateSelfTest(): TestResult[] {
  const out: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    out.push({ name, pass, detail });
  };

  // ── Grouping ───────────────────────────────────────────────────────────────

  {
    const { repertoires, report } = migrateLines([
      oldLine('e4 e5'),
      oldLine('e4 c5', { colour: 'black' }),
    ]);
    check(
      'each colour becomes one book',
      repertoires.length === 2 && repertoires.some(r => r.colour === 'white')
        && repertoires.some(r => r.colour === 'black'),
      repertoires.map(r => `${r.colour}:${r.name}`).join(' + '),
    );
    check(
      'the books are named the way the app names them',
      repertoires.find(r => r.colour === 'white')?.name === 'My White lines',
      repertoires.find(r => r.colour === 'white')?.name ?? '(none)',
    );
    check('and the report counts them', report.repertoires === 2, `${report.repertoires}`);
  }

  {
    const { repertoires, report } = migrateLines([]);
    check(
      'nothing in, nothing out — a fresh install gets no empty books',
      repertoires.length === 0 && report.linesOut === 0,
      `${repertoires.length} books`,
    );
  }

  {
    const empty = oldLine('');
    const { repertoires } = migrateLines([empty]);
    check(
      'a line with no moves was never a line and creates no book',
      repertoires.length === 0,
      `${repertoires.length} books`,
    );
  }

  // ── The collapse: the whole point ──────────────────────────────────────────

  {
    const { repertoires, report } = migrateLines([
      oldLine('d4 d5 c4 c5'),
      oldLine('d4 d5 c4 c5 e4 e5'),
    ]);
    const white = repertoires[0];
    check(
      'a line and its longer version stop storing the same moves twice',
      moveCount(white.tree) === 6,
      `${moveCount(white.tree)} moves stored (the two records held 10)`,
    );
    check(
      'the report says how much duplication went',
      report.movesBefore === 10 && report.movesStored === 6,
      `${report.movesBefore} → ${report.movesStored}`,
    );
    check(
      'both lines still exist afterwards — nothing silently vanished',
      projectRepertoire(white).length === 2,
      `${projectRepertoire(white).length} lines`,
    );
    check(
      'the shorter one survives by being marked as a line end in its own right',
      nodeAtPath(white.tree, ucisOf('d4 d5 c4 c5'))?.endpoint === true &&
      report.containedLines === 1,
      `${report.containedLines} contained line(s)`,
    );
  }

  {
    const { repertoires } = migrateLines([
      oldLine('e4 e5 Nf3 Nc6 Bb5'),
      oldLine('e4 e5 Nf3 Nc6 Bc4'),
      oldLine('e4 e5 Nf3 Nf6'),
    ]);
    const white = repertoires[0];
    check(
      'three lines through one opening share it instead of copying it',
      moveCount(white.tree) === 7,
      `${moveCount(white.tree)} moves (the records held 14)`,
    );
    check(
      'and all three are still lines',
      linePaths(white.tree).length === 3,
      `${linePaths(white.tree).length} lines`,
    );
  }

  {
    const a = oldLine('e4 e5');
    const b = oldLine('e4 e5', { name: 'Open Game', tags: ['main'] });
    const { repertoires, report } = migrateLines([a, b]);
    check(
      'two records of the SAME line become one line',
      linePaths(repertoires[0].tree).length === 1 && report.linesOut === 2,
      `${linePaths(repertoires[0].tree).length} line from ${report.linesOut} records`,
    );
  }

  // ── Nothing a user would notice is lost ────────────────────────────────────

  {
    const line = oldLine('d4 Nf6 c4 e6', { name: 'Nimzo prep', tags: ['vs Anna', 'sharp'] });
    const { repertoires } = migrateLines([line]);
    const [projected] = projectRepertoire(repertoires[0]);
    check(
      'a name the app would not have guessed is kept',
      projected.name === 'Nimzo prep',
      projected.name,
    );
    check(
      'tags are kept',
      projected.tags.join(',') === 'vs Anna,sharp',
      projected.tags.join(','),
    );
  }

  {
    // The builder auto-named this one, so pinning the name would be noise.
    const line = oldLine('e4 e5 Nf3 Nc6 Bb5', { name: 'Ruy Lopez' });
    const { repertoires } = migrateLines([line]);
    const end = nodeAtPath(repertoires[0].tree, ucisOf('e4 e5 Nf3 Nc6 Bb5'));
    check(
      'a name the app would have produced anyway is not pinned',
      end?.label === undefined && projectRepertoire(repertoires[0])[0].name === 'Ruy Lopez',
      `label ${end?.label ?? '(none)'}`,
    );
  }

  {
    const paused = oldLine('e4 e5', { inTraining: false });
    const { repertoires } = migrateLines([paused]);
    check(
      'a paused line stays paused',
      projectRepertoire(repertoires[0])[0].inTraining === false,
      'paused',
    );
    const active = oldLine('d4 d5', { inTraining: true });
    const both = migrateLines([paused, active]).repertoires[0];
    check(
      'and an active one stays active',
      projectRepertoire(both).find(l => l.name === 'd4 d5')?.inTraining === true,
      'active',
    );
  }

  {
    const line = oldLine('e4 e5', { priority: 'high', timesTrained: 7, lastTrained: '2026-01-02' });
    const [projected] = projectRepertoire(migrateLines([line]).repertoires[0]);
    check(
      'priority, run count and last-trained all survive',
      projected.priority === 'high' && projected.timesTrained === 7
      && projected.lastTrained === '2026-01-02',
      `${projected.priority}, ${projected.timesTrained} runs, ${projected.lastTrained}`,
    );
  }

  {
    const a = oldLine('e4 e5 Nf3');
    tip(a).note = 'develop with tempo';
    tip(a).annotation = '!';
    const { repertoires } = migrateLines([a]);
    const node = nodeAtPath(repertoires[0].tree, ucisOf('e4 e5 Nf3'));
    check(
      'notes and annotations travel with their move',
      node?.note === 'develop with tempo' && node?.annotation === '!',
      `${node?.note ?? '(no note)'} ${node?.annotation ?? ''}`,
    );
  }

  // ── Training records, and what happens when two lines disagree ─────────────

  {
    const a = oldLine('e4 e5 Nf3 Nc6 Bb5');
    const b = oldLine('e4 e5 Nf3 Nc6 Bc4');
    // The same shared move, drilled to different depths in the two records.
    a.tree.children[0].review = { ease: 2.5, interval: 3, reps: 1, lapses: 2, due: new Date(1) };
    b.tree.children[0].review = { ease: 2.6, interval: 30, reps: 5, lapses: 0, due: new Date(2) };
    const { repertoires, report } = migrateLines([a, b]);
    const e4 = nodeAtPath(repertoires[0].tree, ucisOf('e4'));
    check(
      'where two records disagree about a shared move, the better record wins',
      e4?.review?.interval === 30 && e4?.review?.reps === 5,
      `interval ${e4?.review?.interval}, reps ${e4?.review?.reps}`,
    );
    check(
      'and the disagreement is counted rather than hidden',
      report.reviewConflicts === 1,
      `${report.reviewConflicts} conflict(s)`,
    );
  }

  {
    const a = oldLine('d4 d5');
    const b = oldLine('d4 Nf6');
    b.tree.children[0].review = { ease: 2.5, interval: 12, reps: 3, lapses: 0, due: new Date(3) };
    const { repertoires, report } = migrateLines([a, b]);
    const d4 = nodeAtPath(repertoires[0].tree, ucisOf('d4'));
    check(
      'a record only one line had is simply taken, not treated as a conflict',
      d4?.review?.interval === 12 && report.reviewConflicts === 0,
      `interval ${d4?.review?.interval}, ${report.reviewConflicts} conflicts`,
    );
  }

  {
    // The older line's note must not be overwritten by a later line's.
    const older = oldLine('e4 e5 Nf3 Nc6', { createdAt: 1000 });
    const newer = oldLine('e4 e5 Nf3 Nf6', { createdAt: 2000 });
    older.tree.children[0].note = 'the original thought';
    newer.tree.children[0].note = 'a later thought';
    const { repertoires } = migrateLines([newer, older]); // deliberately out of order
    check(
      'lines merge oldest-first, so the note the user has lived with survives',
      nodeAtPath(repertoires[0].tree, ucisOf('e4'))?.note === 'the original thought',
      nodeAtPath(repertoires[0].tree, ucisOf('e4'))?.note ?? '(none)',
    );
  }

  // ── Inheritance is left clean ──────────────────────────────────────────────

  {
    const { repertoires } = migrateLines([oldLine('e4 e5'), oldLine('d4 d5')]);
    const white = repertoires[0];
    check(
      'migrated lines carry no explicit training flags, so branch toggles work',
      linePaths(white.tree).every(p => p.every(n => n.training === undefined)),
      'no stamped flags',
    );
    check(
      '…and still read as in training, because that is the default',
      linePaths(white.tree).every(p => resolveTraining(p)),
      'all in training',
    );
  }

  // ── The summary the user is shown ──────────────────────────────────────────

  {
    const { report } = migrateLines([oldLine('d4 d5 c4'), oldLine('d4 d5 c4 e6')]);
    check(
      'the summary leads with the number that justifies the change',
      migrationSummary(report).includes('3 duplicated moves merged away'),
      migrationSummary(report),
    );
    const { report: clean } = migrateLines([oldLine('e4 e5')]);
    check(
      'and says nothing about duplication when there was none',
      !migrationSummary(clean).includes('merged away'),
      migrationSummary(clean),
    );
  }

  return out;
}
