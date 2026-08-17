// Checks of the coverage-gaps arithmetic: which positions count as
// opponent-to-move, which replies clear which floor, what the caps do, and how
// the positive coverage figure is arrived at.
//
// Everything here is plain data — no DOM, no IndexedDB, no network — so the
// whole suite runs under `npm run selftest`.

import { Chess } from 'chess.js';
import type { Line } from './types';
import type { MoveNode } from './tree';
import type { ImportedGame } from './import-core';
import {
  opponentSpots, buildCoverageReport, gameReplyIndex,
  MIN_FACED_GAMES, MIN_BAND_GAMES, MAX_GAPS_PER_POSITION,
  type ExplorerReplies, type GapEvidence,
} from './coverage-gaps';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

let nodeSeq = 0;

// A line from SAN text. "e4 e5 Nf3" is one path; call addBranch to fork it.
function line(id: string, colour: 'white' | 'black', sans: string, name = id): Line {
  const chess = new Chess();
  const root: MoveNode = { id: `${id}-root`, san: '', uci: '', fen: START_FEN, children: [] };
  let cursor = root;
  for (const san of sans.split(/\s+/).filter(Boolean)) {
    const m = chess.move(san);
    const node: MoveNode = {
      id: `n${++nodeSeq}`, san: m.san, uci: m.from + m.to + (m.promotion ?? ''),
      fen: chess.fen(), children: [],
    };
    cursor.children.push(node);
    cursor = node;
  }
  return {
    id, name, tags: [], colour,
    openingName: null, confidence: 0, lastTrained: null, inTraining: true, tree: root,
  };
}

// Add a sibling branch to the node reached by `prefix` SANs.
function addBranch(l: Line, prefix: string, san: string): Line {
  const chess = new Chess();
  let node = l.tree;
  for (const s of prefix.split(/\s+/).filter(Boolean)) {
    const m = chess.move(s);
    node = node.children.find(c => c.uci === m.from + m.to + (m.promotion ?? ''))!;
  }
  const m = chess.move(san);
  node.children.push({
    id: `n${++nodeSeq}`, san: m.san, uci: m.from + m.to + (m.promotion ?? ''),
    fen: chess.fen(), children: [],
  });
  return l;
}

function uciOf(sans: string): string {
  const chess = new Chess();
  let uci = '';
  for (const s of sans.split(/\s+/).filter(Boolean)) {
    const m = chess.move(s);
    uci = m.from + m.to + (m.promotion ?? '');
  }
  return uci;
}

function game(colour: 'white' | 'black', sans: string, id = `g${++nodeSeq}`): ImportedGame {
  const chess = new Chess();
  const list = sans.split(/\s+/).filter(Boolean);
  const ucis: string[] = [];
  const out: string[] = [];
  for (const s of list) {
    const m = chess.move(s);
    ucis.push(m.from + m.to + (m.promotion ?? ''));
    out.push(m.san);
  }
  return {
    id, url: '', endTime: 0, timeClass: 'blitz', timeControl: '180+0', rated: true,
    colour, result: 'draw', opponent: 'someone', eco: null, opening: null,
    sans: out, ucis, plyCount: ucis.length,
  };
}

// An explorer answer keyed by the position after `sans`, as counts per reply.
function explorerAt(
  sans: string, replies: Record<string, number>, coverage: 'band' | 'all' = 'band',
): Map<string, ExplorerReplies> {
  const chess = new Chess();
  for (const s of sans.split(/\s+/).filter(Boolean)) chess.move(s);
  const key = chess.fen().split(' ').slice(0, 4).join(' ');
  const games = new Map<string, number>();
  let total = 0;
  for (const [replySan, n] of Object.entries(replies)) {
    const board = new Chess(chess.fen());
    const m = board.move(replySan);
    games.set(m.from + m.to + (m.promotion ?? ''), n);
    total += n;
  }
  return new Map([[key, { games, total, coverage }]]);
}

function check(name: string, pass: boolean, detail = ''): TestResult {
  return { name, pass, detail };
}

export function runCoverageGapsSelfTest(): TestResult[] {
  const out: TestResult[] = [];

  // ── Pass 1: which positions are opponent-to-move ──────────────────────────

  {
    // White's opponent-to-move positions are the odd plies. The start position
    // is not one of them — that's White's own move — and the last one (after
    // 3.Nf3, where the line stops) isn't either, since nothing is prepared
    // there.
    const l = line('a', 'white', 'e4 e5 Nf3 Nc6 Bb5');
    const spots = opponentSpots([l], 'white');
    const plies = spots.map(s => s.ply).sort((x, y) => x - y);
    out.push(check('white: opponent-to-move plies are the odd ones',
      plies.join(',') === '1,3', `got ${plies.join(',')}`));
  }

  {
    // For Black, the start position IS an opponent-to-move position.
    const l = line('b', 'black', 'e4 e5 Nf3 Nc6');
    const spots = opponentSpots([l], 'black');
    const plies = spots.map(s => s.ply).sort((x, y) => x - y);
    out.push(check('black: the start position counts',
      plies.join(',') === '0,2', `got ${plies.join(',')}`));
  }

  {
    // A line that simply ENDS on the user's move contributes no spot there —
    // nothing is prepared, so it's a stopping point, not a hole.
    const l = line('c', 'white', 'e4 e5 Nf3');
    const spots = opponentSpots([l], 'white');
    const deepest = Math.max(...spots.map(s => s.ply));
    out.push(check('a line ending on your move adds no spot after it',
      deepest === 1 && spots.every(s => s.prepared.size > 0), `deepest ply ${deepest}`));
  }

  {
    // Two lines transposing into the same position make ONE spot, and their
    // prepared answers merge.
    const l1 = line('t1', 'white', 'd4 Nf6 c4 e6 Nf3 d5');
    const l2 = line('t2', 'white', 'Nf3 Nf6 d4 e6 c4 d5');
    const spots = opponentSpots([l1, l2], 'white');
    const shared = spots.filter(s => s.lineIds.size > 1);
    out.push(check('transposing lines share one spot', shared.length === 1,
      `${shared.length} shared spots among ${spots.length}`));
  }

  {
    // A branching tree: both opponent replies answered at a fork are seen, so
    // neither can be reported as a gap.
    const l = addBranch(line('f', 'white', 'e4 e5 Nf3'), 'e4', 'c5');
    const spot = opponentSpots([l], 'white').find(s => s.ply === 1);
    out.push(check('a branch counts as prepared', spot?.prepared.size === 2,
      `prepared ${spot?.prepared.size}`));
  }

  {
    const l = line('deep', 'white', 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6');
    const spots = opponentSpots([l], 'white', 6);
    out.push(check('the depth cap holds', spots.every(s => s.ply <= 6),
      `deepest ${Math.max(...spots.map(s => s.ply))}`));
  }

  // ── Floors ────────────────────────────────────────────────────────────────

  {
    // Faced once: not a gap. Faced twice: a gap.
    const l = line('g1', 'white', 'e4 e5 Nf3');
    const once: GapEvidence = { games: [game('white', 'e4 c5')] };
    const twice: GapEvidence = { games: [game('white', 'e4 c5'), game('white', 'e4 c5 Nf3')] };
    const a = buildCoverageReport([l], 'white', once);
    const b = buildCoverageReport([l], 'white', twice);
    out.push(check(`your games: ${MIN_FACED_GAMES} is the floor`,
      a.gaps.length === 0 && b.gaps.some(g => g.san === 'c5'),
      `once → ${a.gaps.length}, twice → ${b.gaps.map(g => g.san).join(',')}`));
    const gap = b.gaps.find(g => g.san === 'c5');
    out.push(check('a faced gap explains itself in one line',
      gap?.reason === 'faced 2 times' && gap?.source === 'games', gap?.reason ?? 'none'));
  }

  {
    // A 33% share of three games is not evidence; the sample floor stops it.
    const l = line('g2', 'white', 'e4 e5 Nf3');
    const small = buildCoverageReport([l], 'white', { explorer: explorerAt('e4', { e5: 1, c5: 1, c6: 1 }) });
    const big = buildCoverageReport([l], 'white', {
      explorer: explorerAt('e4', { e5: 600, c5: 300, c6: 100 }),
    });
    out.push(check(`the band needs ${MIN_BAND_GAMES} games behind a share`,
      small.gaps.length === 0, `got ${small.gaps.length} from 3 games`));
    const c5 = big.gaps.find(g => g.san === 'c5');
    out.push(check('a share gap explains itself at the user\'s level',
      c5?.reason === 'played 30% at your level' && c5.source === 'library', c5?.reason ?? 'none'));
    out.push(check('the prepared reply is never a gap',
      !big.gaps.some(g => g.san === 'e5'), big.gaps.map(g => g.san).join(',')));
  }

  {
    // Bundled (all-ratings) numbers must not claim to be at your level.
    const l = line('g3', 'white', 'e4 e5 Nf3');
    const rep = buildCoverageReport([l], 'white', {
      explorer: explorerAt('e4', { e5: 600, c5: 300 }, 'all'),
    });
    const c5 = rep.gaps.find(g => g.san === 'c5');
    out.push(check('all-ratings numbers never say "at your level"',
      !!c5 && !c5.reason.includes('your level'), c5?.reason ?? 'none'));
  }

  {
    // A scouted opponent: one game is a fluke, two is a habit — and the row
    // carries the name so Prepare can tag the line.
    const l = line('g4', 'white', 'e4 e5 Nf3');
    const one = buildCoverageReport([l], 'white', {
      opponents: [{ name: 'Erik', games: [game('black', 'e4 c5')] }],
    });
    const two = buildCoverageReport([l], 'white', {
      opponents: [{ name: 'Erik', games: [game('black', 'e4 c5'), game('black', 'e4 c5 Nf3 d6')] }],
    });
    const gap = two.gaps.find(g => g.san === 'c5');
    out.push(check('a scout needs two games too', one.gaps.length === 0, `got ${one.gaps.length}`));
    out.push(check('a scout row names them',
      gap?.reason === 'Erik plays this' && gap.opponentName === 'Erik', gap?.reason ?? 'none'));
  }

  // ── Ranking and caps ──────────────────────────────────────────────────────

  {
    // Your games outrank the library, which outranks the scouts — the app's
    // established order (explore-panel.ts). The three sources sit at three
    // different depths here, deepest first, so depth can't be what sorts them.
    const l = line('r1', 'white', 'e4 e5 Nf3 Nc6 Bb5 a6');
    const evidence: GapEvidence = {
      games: [
        game('white', 'e4 e5 Nf3 Nc6 Bb5 Bc5'),
        game('white', 'e4 e5 Nf3 Nc6 Bb5 Bc5 O-O'),
      ],
      explorer: explorerAt('e4 e5 Nf3', { Nc6: 600, d6: 300 }),
      opponents: [{ name: 'Erik', games: [game('black', 'e4 c5'), game('black', 'e4 c5 Nf3')] }],
    };
    const rep = buildCoverageReport([l], 'white', evidence, { limit: 20 });
    const order = rep.gaps.map(g => g.source);
    const first = order.indexOf('games');
    const lib = order.indexOf('library');
    const scout = order.indexOf('scout');
    out.push(check('games, then the library, then the scouts',
      first === 0 && lib > first && scout > lib, order.join(',')));
  }

  {
    // One fork does not own the list.
    const l = line('r2', 'white', 'e4 e5 Nf3');
    const rep = buildCoverageReport([l], 'white', {
      explorer: explorerAt('e4', { e5: 400, c5: 200, c6: 150, d5: 120, e6: 100, d6: 90 }),
    }, { limit: 20 });
    out.push(check(`at most ${MAX_GAPS_PER_POSITION} gaps from one position`,
      rep.gaps.length <= MAX_GAPS_PER_POSITION, `got ${rep.gaps.length}`));
  }

  {
    const l = line('r3', 'white', 'e4 e5 Nf3');
    const rep = buildCoverageReport([l], 'white', {
      explorer: explorerAt('e4', { e5: 400, c5: 200, c6: 150 }),
    }, { limit: 1 });
    out.push(check('the list cap holds and the true total is kept',
      rep.gaps.length === 1 && rep.totalGaps === 2, `${rep.gaps.length} of ${rep.totalGaps}`));
  }

  // ── Coverage as a positive figure ─────────────────────────────────────────

  {
    const l = line('c1', 'white', 'e4 e5 Nf3');
    const rep = buildCoverageReport([l], 'white', {
      explorer: explorerAt('e4', { e5: 600, c5: 300, c6: 100 }),
    });
    // Three notable replies to 1.e4, one of them answered.
    out.push(check('coverage counts answered over notable',
      rep.notable === 3 && rep.answered === 1 && rep.pct === 33,
      `${rep.answered}/${rep.notable} = ${rep.pct}%`));
    out.push(check('the family roll-up matches the whole',
      rep.families.reduce((n, f) => n + f.notable, 0) === rep.notable,
      rep.families.map(f => `${f.family} ${f.answered}/${f.notable}`).join(' · ')));
  }

  {
    // Answering the gap moves the figure up and empties the list.
    const l = addBranch(line('c2', 'white', 'e4 e5 Nf3'), 'e4', 'c5');
    const rep = buildCoverageReport([l], 'white', {
      explorer: explorerAt('e4', { e5: 600, c5: 300 }),
    });
    out.push(check('answering a reply closes the gap and lifts coverage',
      rep.gaps.length === 0 && rep.pct === 100, `${rep.gaps.length} gaps, ${rep.pct}%`));
  }

  // ── Games indexed by position ─────────────────────────────────────────────

  {
    // A game that TRANSPOSES into a repertoire position still counts there —
    // the index is keyed by position, not by path.
    const l = line('x1', 'white', 'd4 Nf6 c4 e6 Nf3 d5');
    const transposed = [
      game('white', 'Nf3 Nf6 d4 e6 c4 Bb4+'),
      game('white', 'Nf3 Nf6 d4 e6 c4 Bb4+ Bd2'),
    ];
    const rep = buildCoverageReport([l], 'white', { games: transposed });
    out.push(check('a transposed game counts at the position it reaches',
      rep.gaps.some(g => g.san === 'Bb4+'), rep.gaps.map(g => g.san).join(',') || 'none'));
  }

  {
    const index = gameReplyIndex([game('white', 'e4 e5')]);
    const startKey = START_FEN.split(' ').slice(0, 4).join(' ');
    out.push(check('the game index files a move under the position it was played from',
      index.get(startKey)?.get(uciOf('e4')) === 1,
      `${index.get(startKey)?.size ?? 0} replies at the start`));
  }

  // ── Nothing is stored ─────────────────────────────────────────────────────

  {
    const l = line('s1', 'white', 'e4 e5 Nf3');
    const before = JSON.stringify(l);
    buildCoverageReport([l], 'white', {
      games: [game('white', 'e4 c5'), game('white', 'e4 c5 Nf3')],
    });
    out.push(check('the report never mutates the lines it reads',
      JSON.stringify(l) === before, 'a line changed'));
  }

  return out;
}
