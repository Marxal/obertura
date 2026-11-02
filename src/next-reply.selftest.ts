// "Your next reply" and the rule it shares with Trim, the pure half.
//
// What matters here: the order (your games first), that a sideline or a paused
// branch is never offered, that a transposition isn't mistaken for a hole, and
// that missing data never counts as rare.

import { Chess } from 'chess.js';
import type { Line } from './types';
import type { MoveNode } from './tree';
import type { ImportedGame } from './import-core';
import {
  buildNextReplies, answerStats, usualReply, replyLabel, topMoves, gameWeight,
  MAX_CARDS, RECENT_ONCE_DAYS, type NextReplyCard,
} from './next-reply';
import type { GrowTarget } from './grow-line';
import { agoText, summariseFaced } from './reply-games';
import {
  isRareBranch, normaliseCastling, replyOdds, shareAt, type MoveStats, type StatsAt,
} from './rare-branch';

export interface TestResult { name: string; pass: boolean; detail?: string }

function pathTree(sans: string[]): { tree: MoveNode; fens: string[]; ucis: string[] } {
  const chess = new Chess();
  const root: MoveNode = { id: 'root', san: '', uci: '', fen: chess.fen(), children: [] } as MoveNode;
  let cursor = root;
  const fens = [chess.fen()];
  const ucis: string[] = [];
  sans.forEach((san, i) => {
    const m = chess.move(san);
    const uci = m.from + m.to;
    const node = { id: `n${i}`, san: m.san, uci, fen: chess.fen(), children: [] } as MoveNode;
    cursor.children.push(node);
    cursor = node;
    fens.push(chess.fen());
    ucis.push(uci);
  });
  return { tree: root, fens, ucis };
}

function line(id: string, colour: 'white' | 'black', sans: string[], inTraining = true): Line {
  return {
    id, name: id, tags: [], colour, openingName: null, confidence: 0,
    lastTrained: null, inTraining, tree: pathTree(sans).tree,
  };
}

function game(colour: 'white' | 'black', sans: string[], result: 'win' | 'loss' | 'draw', i: number): ImportedGame {
  return {
    id: `g${i}`, url: '', endTime: i, timeClass: 'blitz', timeControl: '', rated: true,
    colour, result, opponent: 'x', eco: null, opening: null,
    sans, ucis: pathTree(sans).ucis, plyCount: sans.length,
  } as unknown as ImportedGame;
}

function lineOf(sans: string[]): Line[] {
  return [line('l0', 'white', sans)];
}

function fenAfter(sans: string[]): string {
  const chess = new Chess();
  for (const s of sans) chess.move(s);
  return chess.fen();
}

// A database: { "e4 e5": { Nf3: 800, Nc3: 200 } } by move list, in SAN.
function db(table: Record<string, Record<string, number>>): StatsAt {
  const byFen = new Map<string, MoveStats>();
  for (const [path, moves] of Object.entries(table)) {
    const sans = path ? path.split(' ') : [];
    const chess = new Chess();
    for (const s of sans) chess.move(s);
    const fen = chess.fen();
    const stats: MoveStats = new Map();
    for (const [san, n] of Object.entries(moves)) {
      const probe = new Chess(fen);
      const m = probe.move(san);
      stats.set(m.from + m.to, { white: n / 2, draws: 0, black: n / 2 });
    }
    byFen.set(fen, stats);
  }
  return (fen: string) => byFen.get(fen) ?? null;
}

export function runNextReplySelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail?: string): void => {
    results.push({ name, pass, detail: pass ? undefined : detail });
  };
  const noStats: StatsAt = () => null;
  const base = { games: [], opponents: [], statsAt: noStats, grow: [], rested: {}, now: 1000 };

  // ── The rule ───────────────────────────────────────────────────────────────
  const rarePath = db({
    '': { e4: 40, d4: 60 },
    'e4 c5': { Nf3: 960, Na3: 40 },
    e4: { c5: 100, e5: 1000 },
  });
  const sideline = pathTree(['e4', 'c5', 'Na3']).ucis;
  check('your own move does not count against a line',
    Math.abs(replyOdds(sideline.slice(0, 2), 'white', rarePath).reach - 100 / 1100) < 1e-9);

  const asBlack = replyOdds(pathTree(['e4', 'c5', 'Na3']).ucis, 'black', rarePath);
  check('a small share that is also rarely reached is rare',
    asBlack.share === 0.04 && asBlack.reach < 0.02 && isRareBranch(asBlack),
    JSON.stringify(asBlack));

  const defence = db({ e4: { c6: 8, e5: 92 } });
  const caro = replyOdds(pathTree(['e4', 'c6']).ucis, 'white', defence);
  check('a small share that is often reached is not rare: the Caro-Kann stays',
    caro.share === 0.08 && !isRareBranch(caro), JSON.stringify(caro));

  const unlisted = replyOdds(pathTree(['e4', 'd6']).ucis, 'white', defence);
  check('a reply missing from the data is unknown, not rare',
    unlisted.share === null && !isRareBranch(unlisted), JSON.stringify(unlisted));
  check('no data at all is unknown too', shareAt(fenAfter(['e4']), 'c7c6', noStats) === null);

  const thin = db({ e4: { c6: 1, e5: 9 } });
  check('too few games means no percentage', shareAt(fenAfter(['e4']), 'c7c6', thin) === null);

  const castled = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1').fen();
  check('Lichess castling becomes the king’s move', normaliseCastling(castled, 'e1h1') === 'e1g1');
  const rookOnE1 = '4k3/8/8/8/8/8/8/4R2K w - - 0 1';
  check('a rook going e1-h1 is left alone', normaliseCastling(rookOnE1, 'e1h1') === 'e1h1');

  // ── The cards ──────────────────────────────────────────────────────────────
  const lines = [line('main', 'white', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'])];
  const stats = db({
    e4: { e5: 500, c5: 300, e6: 200 },
    'e4 e5 Nf3': { Nc6: 700, Nf6: 300 },
  });

  const cards = buildNextReplies({ ...base, lines, statsAt: stats });
  check('a common reply with no answer becomes a card', cards.some(c => c.sans.join(' ') === 'e4 c5'),
    cards.map(c => c.sans.join(' ')).join(' | '));
  const c5 = cards.find(c => c.sans.join(' ') === 'e4 c5')!;
  check('the card ends on the reply, with you to move',
    c5.ucis.length === 2 && c5.fen === fenAfter(['e4', 'c5']) && c5.source === 'library');
  check('it names the move', replyLabel(c5) === '1...c5', replyLabel(c5));
  check('more often reached comes first',
    cards.findIndex(c => c.sans.join(' ') === 'e4 c5')
      < cards.findIndex(c => c.sans.join(' ') === 'e4 e5 Nf3 Nf6'),
    cards.map(c => c.sans.join(' ')).join(' | '));
  check('a reply you have answered is not offered', !cards.some(c => c.sans.join(' ') === 'e4 e5'));

  check('a resting position stays away',
    !buildNextReplies({ ...base, lines, statsAt: stats, rested: { [c5.id]: 2000 } })
      .some(c => c.id === c5.id));
  check('and comes back when its rest is over',
    buildNextReplies({ ...base, lines, statsAt: stats, rested: { [c5.id]: 500 } })
      .some(c => c.id === c5.id));

  const paused = [line('main', 'white', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], false)];
  check('a paused branch offers nothing',
    buildNextReplies({ ...base, lines: paused, statsAt: stats }).length === 0);

  const pausedAnswer = [
    ...lines,
    line('sicilian', 'white', ['e4', 'c5', 'Nf3'], false),
  ];
  check('a reply answered only in a paused line is still answered',
    !buildNextReplies({ ...base, lines: pausedAnswer, statsAt: stats })
      .some(c => c.sans.join(' ') === 'e4 c5'));

  // 1.d4 d5 2.c4 e6 3.Nc3 is answered. From 1.d4 e6 2.c4, the reply 2...d5 reaches
  // that same position by another move order, so there's nothing to prepare.
  const transposing = [
    line('qgd', 'white', ['d4', 'd5', 'c4', 'e6', 'Nc3']),
    line('other', 'white', ['d4', 'e6', 'c4', 'Nf6', 'Nc3']),
  ];
  const tStats = db({ 'd4 e6 c4': { d5: 700, Nf6: 200, f5: 100 } });
  const tCards = buildNextReplies({ ...base, lines: transposing, statsAt: tStats });
  check('a reply that transposes into a position you answer is not a hole',
    !tCards.some(c => c.sans.join(' ') === 'd4 e6 c4 d5'),
    tCards.map(c => c.sans.join(' ')).join(' | '));
  check('a real hole at the same position still is',
    tCards.some(c => c.sans.join(' ') === 'd4 e6 c4 f5'),
    tCards.map(c => c.sans.join(' ')).join(' | '));

  // Bd6 has 12% of a position only reached 9% × … of the time: rare. a6-side Nf6
  // has 12% of a position everyone reaches: offered.
  const rareStats = db({
    e4: { e5: 900, c5: 100 },
    'e4 e5 Nf3': { Nc6: 880, Nf6: 120 },
    'e4 c5 Nf3': { d6: 880, a6: 120 },
  });
  const rareLines = [
    line('ruy', 'white', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']),
    line('sic', 'white', ['e4', 'c5', 'Nf3', 'd6', 'd4']),
  ];
  const rareCards = buildNextReplies({ ...base, lines: rareLines, statsAt: rareStats })
    .map(c => c.sans.join(' '));
  check('a sideline Trim would flag is not offered from the database',
    !rareCards.includes('e4 c5 Nf3 a6'), rareCards.join(' | '));
  check('the same share on a common path is offered',
    rareCards.includes('e4 e5 Nf3 Nf6'), rareCards.join(' | '));
  check('but your games overrule the database on a sideline',
    buildNextReplies({
      ...base, lines: rareLines, statsAt: rareStats,
      games: [0, 1].map(i => game('white', ['e4', 'c5', 'Nf3', 'a6'], 'loss', i)),
    }).some(c => c.source === 'games' && c.sans.join(' ') === 'e4 c5 Nf3 a6'));

  // ── Your games ─────────────────────────────────────────────────────────────
  const sicilianGames = [0, 1, 2, 3, 4].map(i =>
    game('white', ['e4', 'c5', 'Nf3', 'd6'], i === 0 ? 'win' : 'loss', i));
  const withGames = buildNextReplies({ ...base, lines, statsAt: stats, games: sicilianGames });
  const faced = withGames[0];
  check('what you have faced comes before anything popular',
    faced?.source === 'games' && faced.sans.join(' ') === 'e4 c5',
    withGames.map(c => `${c.source}:${c.sans.join(' ')}`).join(' | '));
  check('and it knows how it has been going',
    faced?.score?.points === 1 && faced?.score?.games === 5, JSON.stringify(faced?.score));

  const fineGames = [0, 1, 2].map(i => game('white', ['e4', 'c5', 'Nf3'], 'win', i));
  const fine = buildNextReplies({ ...base, lines, statsAt: stats, games: fineGames })[0];
  check('a good score is still your own games', fine?.source === 'games' && fine?.score?.points === 3,
    JSON.stringify(fine?.score));

  const halves = [
    game('white', ['e4', 'c5', 'Nf3'], 'draw', 1),
    game('white', ['e4', 'c5', 'Nf3'], 'loss', 2),
    game('white', ['e4', 'c5', 'Nf3'], 'loss', 3),
  ];
  const half = buildNextReplies({ ...base, lines, statsAt: stats, games: halves })[0];
  check('half points count as a half', half?.score?.points === 0.5, JSON.stringify(half?.score));

  // ── Your answer's numbers ──────────────────────────────────────────────────
  const counts: StatsAt = () => new Map([
    ['g1f3', { white: 60, draws: 20, black: 20 }],
    ['b1c3', { white: 50, draws: 25, black: 25 }],
  ]);
  const white = answerStats('any', 'g1f3', 'white', counts);
  check('an answer’s numbers are from your side',
    white?.playedPct === 50 && white?.scorePct === 70, JSON.stringify(white));
  const black = answerStats('any', 'g1f3', 'black', counts);
  check('and the same move scores differently for Black', black?.scorePct === 30, JSON.stringify(black));
  check('a move not in the data has no numbers', answerStats('any', 'a2a3', 'white', counts) === null);
  check('and the wins are yours', black?.wins === 20 && black?.losses === 60, JSON.stringify(black));
  check('your own games keep their wins, draws and losses',
    half?.score?.wins === 0 && half?.score?.draws === 1 && half?.score?.losses === 2,
    JSON.stringify(half?.score));

  // ── Suggest moves ──────────────────────────────────────────────────────────
  const openFen = fenAfter(['e4', 'c5']);
  const usual = db({ 'e4 c5': { Nf3: 700, Nc3: 200, c3: 60, d3: 40 } });
  const top = topMoves(openFen, 'white', usual);
  check('suggestions are the three most played, in order',
    top.map(m => m.san).join(' ') === 'Nf3 Nc3 c3', top.map(m => m.san).join(' '));
  check('with their share', top[0]?.playedPct === 70, JSON.stringify(top[0]));
  check('no data, no suggestions', topMoves(openFen, 'white', noStats).length === 0);

  const castleFen = 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1';
  const lichessCastle: StatsAt = () => new Map([['e1h1', { white: 60, draws: 20, black: 20 }]]);
  const castled2 = topMoves(castleFen, 'white', lichessCastle)[0];
  check('a suggested castling move is the king’s real move',
    castled2?.uci === 'e1g1' && castled2?.san === 'O-O', JSON.stringify(castled2));

  // ── The board replies while a line is built ───────────────────────────────
  const afterNf3 = fenAfter(['e4', 'c5', 'Nf3']);
  const follows = db({ 'e4 c5 Nf3': { d6: 600, Nc6: 300, e6: 100 } });
  const nothingFaced = (): undefined => undefined;
  check('the usual reply comes from the database',
    usualReply(afterNf3, 'white', { statsAt: follows, facedAt: nothingFaced })?.san === 'd6');
  check('and says so',
    usualReply(afterNf3, 'white', { statsAt: follows, facedAt: nothingFaced })?.basis === 'database');
  const twiceE6 = (): Map<string, number> => new Map([['e7e6', 2]]);
  const playedE6 = usualReply(afterNf3, 'white', { statsAt: follows, facedAt: twiceE6 });
  check('what you have faced comes before the database',
    playedE6?.san === 'e6' && playedE6.basis === 'games', JSON.stringify(playedE6));
  const onceE6 = (): Map<string, number> => new Map([['e7e6', 1]]);
  check('one game isn’t enough to beat the database',
    usualReply(afterNf3, 'white', { statsAt: follows, facedAt: onceE6 })?.san === 'd6');
  check('but one game beats knowing nothing',
    usualReply(afterNf3, 'white', { statsAt: noStats, facedAt: onceE6 })?.san === 'e6');
  check('nobody knowing is the engine’s cue',
    usualReply(afterNf3, 'white', { statsAt: noStats, facedAt: nothingFaced }) === null);
  const scoutPlaysNc6 = usualReply(afterNf3, 'white', {
    statsAt: follows, facedAt: nothingFaced, scoutAt: () => [{ uci: 'b8c6', games: 3 }],
  });
  check('the opponent you’re preparing for comes before the database',
    scoutPlaysNc6?.san === 'Nc6' && scoutPlaysNc6.basis === 'scout', JSON.stringify(scoutPlaysNc6));
  check('a stale move in your games is ignored',
    usualReply(afterNf3, 'white', {
      statsAt: follows, facedAt: () => new Map([['a1a8', 9]]),
    })?.san === 'd6');

  // ── Mastered lines have their own board ────────────────────────────────────
  const growTarget: GrowTarget = {
    spot: {
      line: lines[0], fen: fenAfter(['e4']), key: 'k', ucis: pathTree(['e4']).ucis, sans: ['e4'], ply: 1,
    },
    moves: [{ uci: 'c7c5', san: 'c5', source: 'library', weight: 5 }],
  } as unknown as GrowTarget;
  const manyHoles: NextReplyCard[] = buildNextReplies({
    ...base, lines, statsAt: stats, grow: [growTarget], rested: {},
  });
  check('a mastered line is marked for its own board',
    manyHoles.filter(c => c.extend).length === 1, manyHoles.map(c => c.id).join(' | '));
  check('the holes can’t push it out of the queue',
    manyHoles.filter(c => !c.extend).length <= MAX_CARDS);

  // A mastered line past every source still gets a card: this used to be silently dropped.
  const pastTheBook: GrowTarget = { ...growTarget, moves: [] };
  const fromDb = buildNextReplies({
    ...base, lines: [], statsAt: db({ e4: { c5: 600, e5: 400 } }), grow: [pastTheBook], rested: {},
  });
  check('with no book, the database supplies the reply',
    fromDb[0]?.extend === true && fromDb[0]?.sans.join(' ') === 'e4 c5' && !fromDb[0]?.awaitingReply,
    JSON.stringify(fromDb[0]?.sans));
  const noneAtAll = buildNextReplies({
    ...base, lines: [], statsAt: noStats, grow: [pastTheBook], rested: {},
  });
  check('with nothing at all, the card waits for the engine',
    noneAtAll[0]?.extend === true && noneAtAll[0]?.awaitingReply === true
      && noneAtAll[0]?.sans.join(' ') === 'e4',
    JSON.stringify(noneAtAll[0]));

  check('an Extend card knows its line, for the figures',
    fromDb[0]?.line === lines[0] && noneAtAll[0]?.line === lines[0]);

  // ── The order: often, and lately ──────────────────────────────────────────
  const DAY = 86_400_000;
  const TODAY = Date.UTC(2026, 10, 3, 12);
  const ago = (days: number): number => Math.floor((TODAY - days * DAY) / 1000);
  const dated = (sans: string[], days: number, id: number, result: 'win' | 'loss' = 'win'): ImportedGame =>
    ({ ...game('white', sans, result, id), endTime: ago(days) });
  const faceAll = (played: ImportedGame[]): NextReplyCard[] =>
    buildNextReplies({ ...base, lines, statsAt: stats, games: played, now: TODAY });
  const order = (cards: NextReplyCard[]): string =>
    cards.filter(c => c.source === 'games').map(c => c.sans[c.sans.length - 1]).join(' ');

  check('a game today counts in full', Math.abs(gameWeight(ago(0), TODAY) - 1) < 0.001);
  check('a game fades with age', gameWeight(ago(30), TODAY) < gameWeight(ago(7), TODAY));
  check('but never to nothing', gameWeight(ago(2000), TODAY) > 0.24);

  const often = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => dated(['e4', 'c5'], 365, i));
  const recent2 = [10, 11].map(i => dated(['e4', 'e6'], 7, i));
  check('ten old games still beat two from last week',
    order(faceAll([...often, ...recent2])) === 'c5 e6', order(faceAll([...often, ...recent2])));
  const recent4 = [10, 11, 12, 13].map(i => dated(['e4', 'e6'], 3, i));
  check('four from this week beat ten old ones',
    order(faceAll([...often, ...recent4])) === 'e6 c5', order(faceAll([...often, ...recent4])));
  const sameCount = [
    dated(['e4', 'c5'], 200, 20), dated(['e4', 'c5'], 200, 21), dated(['e4', 'c5'], 200, 22),
    dated(['e4', 'e6'], 2, 23), dated(['e4', 'e6'], 2, 24), dated(['e4', 'e6'], 2, 25),
  ];
  check('the same number of games: the recent ones first',
    order(faceAll(sameCount)) === 'e6 c5', order(faceAll(sameCount)));

  const yesterday = faceAll([dated(['e4', 'd5'], 1, 30)]);
  check('a reply faced once, yesterday, makes the list',
    order(yesterday) === 'd5', order(yesterday));
  const lastYear = faceAll([dated(['e4', 'd5'], RECENT_ONCE_DAYS + 1, 31)]);
  check('faced once, a while ago, it doesn’t', order(lastYear) === '', order(lastYear));
  const onceVsOldTwo = faceAll([
    dated(['e4', 'd5'], 1, 32), dated(['e4', 'c5'], 400, 33), dated(['e4', 'c5'], 400, 34),
  ]);
  check('yesterday’s one game beats two ancient ones',
    order(onceVsOldTwo) === 'd5 c5', order(onceVsOldTwo));
  const going = faceAll([
    ...[40, 41, 42].map(i => dated(['e4', 'c5'], 30, i, 'loss')),
    ...[43, 44, 45].map(i => dated(['e4', 'e6'], 30, i)),
  ]);
  check('with the same games, the reply going badly comes first',
    order(going) === 'c5 e6', order(going));

  // ── Past the end of a line ─────────────────────────────────────────────────
  const atEnd = buildNextReplies({
    ...base, lines: lineOf(['e4', 'e5', 'Nf3']), statsAt: noStats, now: TODAY,
    games: [dated(['e4', 'e5', 'Nf3', 'Nc6'], 30, 50), dated(['e4', 'e5', 'Nf3', 'Nc6'], 40, 51)],
  });
  const past = atEnd.find(c => c.sans.join(' ') === 'e4 e5 Nf3 Nc6');
  check('a reply you keep meeting past a line’s end is a card',
    past?.source === 'games' && past?.pastEnd === true && past?.faced === 2,
    atEnd.map(c => c.sans.join(' ')).join(' | '));
  const onceOnly = buildNextReplies({
    ...base, lines: lineOf(['e4', 'e5', 'Nf3']), statsAt: noStats, now: TODAY,
    games: [dated(['e4', 'e5', 'Nf3', 'Nc6'], 300, 52)],
  });
  check('met once, a line’s end stays a stopping point',
    !onceOnly.some(c => c.pastEnd), onceOnly.map(c => c.sans.join(' ')).join(' | '));

  // ── How long ago ───────────────────────────────────────────────────────────
  // A game's endTime is in seconds. Read as milliseconds, everything was "56 years ago".
  const NOW = Date.UTC(2026, 10, 3, 12);
  const daysAgo = (d: number): number => Math.floor((NOW - d * 86_400_000) / 1000);
  check('today', agoText(daysAgo(0), NOW) === 'today', agoText(daysAgo(0), NOW));
  check('yesterday', agoText(daysAgo(1), NOW) === 'yesterday');
  check('days', agoText(daysAgo(9), NOW) === '9 days ago', agoText(daysAgo(9), NOW));
  check('weeks', agoText(daysAgo(21), NOW) === '3 weeks ago', agoText(daysAgo(21), NOW));
  check('months', agoText(daysAgo(150), NOW) === '5 months ago', agoText(daysAgo(150), NOW));
  check('years', agoText(daysAgo(800), NOW) === '2 years ago', agoText(daysAgo(800), NOW));
  check('a game with no date says nothing', agoText(0, NOW) === '');
  const faced2 = summariseFaced([
    { ...game('white', ['e4'], 'win', 1), endTime: 100 },
    { ...game('white', ['e4'], 'draw', 2), endTime: 300 },
    { ...game('white', ['e4'], 'loss', 3), endTime: 200 },
  ]);
  check('the last game faced is the newest',
    faced2.last === 300 && faced2.points === 1.5 && faced2.games === 3, JSON.stringify(faced2));

  return results;
}
