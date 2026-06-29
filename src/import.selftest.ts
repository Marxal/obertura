// A runnable check of the shared import core — no network, no test framework,
// just like scheduler.selftest.ts. The import block in Settings has a "Run
// import parser self-test" link that calls this and shows pass/fail, so the
// parsing logic for BOTH platforms can be verified right on the phone, offline.
//
// Coverage: the Chess.com RawGame parser, the Lichess game parser, that both
// produce the SAME normalised ImportedGame shape, plus the tally and the
// time-control filter the new core adds.

import { parseGame, type RawGame } from './chesscom';
import { parseLichessGame, type LichessGame } from './lichess';
import {
  summariseGames,
  tallyTimeClasses,
  filterByTimeClasses,
  takeNewest,
  type ImportedGame,
} from './import-core';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const ME = 'marxal';

// ── Chess.com fixtures ──────────────────────────────────────────────────────────

// A short Italian Game, our user playing White and winning. Clock comments are
// included on purpose — real chess.com PGNs carry them and the parser must cope.
const italianWhiteWin: RawGame = {
  url: 'https://www.chess.com/game/live/1',
  uuid: 'game-1',
  time_control: '180+2',
  time_class: 'blitz',
  rated: true,
  rules: 'chess',
  end_time: 1_715_000_000,
  eco: 'https://www.chess.com/openings/Italian-Game',
  white: { username: 'Marxal', result: 'win' },
  black: { username: 'opponent99', result: 'checkmated' },
  pgn: [
    '[Event "Live Chess"]',
    '[Site "Chess.com"]',
    '[White "Marxal"]',
    '[Black "opponent99"]',
    '[Result "1-0"]',
    '[ECO "C50"]',
    '',
    '1. e4 {[%clk 0:03:00]} 1... e5 {[%clk 0:03:00]} 2. Nf3 {[%clk 0:02:58]}',
    '2... Nc6 {[%clk 0:02:59]} 3. Bc4 {[%clk 0:02:55]} 3... Bc5 {[%clk 0:02:57]} 1-0',
  ].join('\n'),
};

// Our user playing Black and losing on time.
const sicilianBlackLoss: RawGame = {
  url: 'https://www.chess.com/game/live/2',
  uuid: 'game-2',
  time_control: '60',
  time_class: 'bullet',
  rated: true,
  rules: 'chess',
  end_time: 1_715_100_000,
  eco: 'https://www.chess.com/openings/Sicilian-Defense',
  white: { username: 'speedy', result: 'win' },
  black: { username: 'marxal', result: 'timeout' },
  pgn: '[White "speedy"]\n[Black "marxal"]\n[Result "1-0"]\n\n1. e4 c5 2. Nf3 d6 1-0',
};

// An agreed draw, user as White.
const drawGame: RawGame = {
  url: 'https://www.chess.com/game/live/3',
  uuid: 'game-3',
  time_control: '600',
  time_class: 'rapid',
  rated: false,
  rules: 'chess',
  end_time: 1_715_200_000,
  white: { username: 'marxal', result: 'agreed' },
  black: { username: 'peaceful', result: 'agreed' },
  pgn: '[White "marxal"]\n[Black "peaceful"]\n[Result "1/2-1/2"]\n\n1. d4 d5 2. c4 e6 1/2-1/2',
};

// A 960 variant — must be skipped.
const variantGame: RawGame = {
  url: 'https://www.chess.com/game/live/4',
  uuid: 'game-4',
  time_control: '180',
  time_class: 'blitz',
  rules: 'chess960',
  white: { username: 'marxal', result: 'win' },
  black: { username: 'x', result: 'resigned' },
  pgn: '[Variant "Chess960"]\n\n1. e4 e5 1-0',
};

// ── Lichess fixtures ────────────────────────────────────────────────────────────

// Our user as White, winning an Italian — pgnInJson form, with opening + clock.
const liItalianWhiteWin: LichessGame = {
  id: 'abcd1234',
  rated: true,
  variant: 'standard',
  speed: 'blitz',
  createdAt: 1_716_000_000_000,
  lastMoveAt: 1_716_000_300_000,
  winner: 'white',
  players: {
    white: { user: { name: 'Marxal' } },
    black: { user: { name: 'rival42' } },
  },
  opening: { eco: 'C50', name: 'Italian Game', ply: 5 },
  clock: { initial: 180, increment: 2, totalTime: 300 },
  pgn: [
    '[Event "Rated Blitz game"]',
    '[White "Marxal"]',
    '[Black "rival42"]',
    '[Result "1-0"]',
    '[ECO "C50"]',
    '[Opening "Italian Game"]',
    '',
    '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 1-0',
  ].join('\n'),
};

// Our user as Black, losing — bare `moves` field only (no pgnInJson), classical
// speed so it folds into the "daily" bucket.
const liFrenchBlackLoss: LichessGame = {
  id: 'wxyz9876',
  rated: true,
  variant: 'standard',
  speed: 'classical',
  createdAt: 1_716_100_000_000,
  lastMoveAt: 1_716_100_900_000,
  winner: 'white',
  players: {
    white: { user: { name: 'slowplay' } },
    black: { user: { name: 'marxal' } },
  },
  opening: { eco: 'C00', name: 'French Defense', ply: 2 },
  clock: { initial: 1800, increment: 0, totalTime: 1800 },
  moves: 'e4 e6 d4 d5 Nc3 Nf6',
};

// A drawn game with no `winner` field — must read as a draw.
const liDraw: LichessGame = {
  id: 'draw0001',
  rated: false,
  variant: 'standard',
  speed: 'rapid',
  createdAt: 1_716_200_000_000,
  lastMoveAt: 1_716_200_600_000,
  players: {
    white: { user: { name: 'marxal' } },
    black: { user: { name: 'amicable' } },
  },
  opening: { eco: 'D30', name: 'Queen\'s Gambit Declined', ply: 4 },
  clock: { initial: 600, increment: 0, totalTime: 600 },
  moves: 'd4 d5 c4 e6',
};

// A Crazyhouse variant — must be skipped.
const liVariant: LichessGame = {
  id: 'zh000001',
  variant: 'crazyhouse',
  speed: 'blitz',
  players: { white: { user: { name: 'marxal' } }, black: { user: { name: 'z' } } },
  moves: 'e4 e5',
};

export function runImportSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name, pass, detail });

  // ── Chess.com parser ──

  // 1. Parses an Italian win: colour, result, opening, ECO, and moves all land.
  const g1 = parseGame(italianWhiteWin, ME);
  check(
    'chesscom: parses a White win with clock comments',
    !!g1 &&
      g1.colour === 'white' &&
      g1.result === 'win' &&
      g1.opening === 'Italian Game' &&
      g1.eco === 'C50' &&
      g1.sans.join(' ') === 'e4 e5 Nf3 Nc6 Bc4 Bc5' &&
      g1.ucis[0] === 'e2e4',
    g1 ? `${g1.colour}/${g1.result}, "${g1.opening}", ${g1.eco}, [${g1.sans.join(' ')}]` : 'returned null',
  );

  // 2. Username match is case-insensitive (PGN says "Marxal", we pass "marxal").
  check(
    'chesscom: username match is case-insensitive',
    !!g1 && g1.opponent === 'opponent99',
    g1 ? `opponent ${g1.opponent}` : 'returned null',
  );

  // 3. Black timeout loss is classified from our side.
  const g2 = parseGame(sicilianBlackLoss, ME);
  check(
    'chesscom: Black timeout is a loss for us',
    !!g2 && g2.colour === 'black' && g2.result === 'loss' && g2.timeClass === 'bullet',
    g2 ? `${g2.colour}/${g2.result}/${g2.timeClass}` : 'returned null',
  );

  // 4. An agreed result is a draw, not a loss.
  const g3 = parseGame(drawGame, ME);
  check(
    'chesscom: agreed result is a draw',
    !!g3 && g3.result === 'draw',
    g3 ? `result ${g3.result}` : 'returned null',
  );

  // 5. Non-standard variants are skipped.
  check(
    'chesscom: chess960 game is skipped',
    parseGame(variantGame, ME) === null,
    'expected null',
  );

  // 6. A game we didn't play in is skipped (defensive).
  check(
    'chesscom: unrelated game is skipped',
    parseGame({ ...sicilianBlackLoss, white: { username: 'a', result: 'win' }, black: { username: 'b', result: 'resigned' } }, ME) === null,
    'expected null',
  );

  // 7. The FULL game is stored now (the analyser needs every move), not just the
  // opening. A reversible knight shuffle gives a long, legal 68-ply game.
  const longMoves = 'Nf3 Nf6 Ng1 Ng8 '.repeat(17).trim(); // 68 plies, bare SAN
  const longGame: RawGame = {
    url: 'u', uuid: 'long', time_control: '600', time_class: 'rapid', rules: 'chess',
    white: { username: 'marxal', result: 'win' }, black: { username: 'z', result: 'resigned' },
    pgn: `[White "marxal"]\n[Black "z"]\n\n${longMoves}`,
  };
  const g4 = parseGame(longGame, ME);
  check(
    'chesscom: full game stored (all plies, not just the opening)',
    !!g4 && g4.sans.length === 68 && g4.plyCount === 68,
    g4 ? `kept ${g4.sans.length} of ${g4.plyCount}` : 'returned null',
  );

  // ── Lichess parser ──

  // 8. Parses an Italian win from pgnInJson: colour, result, opening, ECO, moves.
  const l1 = parseLichessGame(liItalianWhiteWin, ME);
  check(
    'lichess: parses a White win from pgnInJson',
    !!l1 &&
      l1.colour === 'white' &&
      l1.result === 'win' &&
      l1.opening === 'Italian Game' &&
      l1.eco === 'C50' &&
      l1.timeClass === 'blitz' &&
      l1.timeControl === '180+2' &&
      l1.opponent === 'rival42' &&
      l1.sans.join(' ') === 'e4 e5 Nf3 Nc6 Bc4 Bc5' &&
      l1.ucis[0] === 'e2e4',
    l1 ? `${l1.colour}/${l1.result}, "${l1.opening}", ${l1.eco}, ${l1.timeControl}, [${l1.sans.join(' ')}]` : 'returned null',
  );

  // 9. Parses a Black loss from the bare `moves` field; classical → "daily".
  const l2 = parseLichessGame(liFrenchBlackLoss, ME);
  check(
    'lichess: parses bare moves, classical folds to daily',
    !!l2 && l2.colour === 'black' && l2.result === 'loss' &&
      l2.timeClass === 'daily' && l2.opening === 'French Defense' &&
      l2.sans.join(' ') === 'e4 e6 d4 d5 Nc3 Nf6',
    l2 ? `${l2.colour}/${l2.result}/${l2.timeClass}, "${l2.opening}"` : 'returned null',
  );

  // 10. A game with no winner reads as a draw.
  const l3 = parseLichessGame(liDraw, ME);
  check(
    'lichess: missing winner reads as a draw',
    !!l3 && l3.result === 'draw' && l3.colour === 'white',
    l3 ? `${l3.colour}/${l3.result}` : 'returned null',
  );

  // 11. Variants are skipped.
  check(
    'lichess: crazyhouse game is skipped',
    parseLichessGame(liVariant, ME) === null,
    'expected null',
  );

  // 12. A game we didn't play in is skipped.
  check(
    'lichess: unrelated game is skipped',
    parseLichessGame({ ...liDraw, players: { white: { user: { name: 'x' } }, black: { user: { name: 'y' } } } }, ME) === null,
    'expected null',
  );

  // ── Both platforms agree on the shape ──

  // 13. The two Italian wins (one per platform) parse to the same ImportedGame
  //     fields that matter downstream — proof the normalised shape is shared.
  check(
    'both platforms produce the same normalised shape',
    !!g1 && !!l1 &&
      g1.colour === l1.colour && g1.result === l1.result &&
      g1.opening === l1.opening && g1.eco === l1.eco &&
      g1.timeClass === l1.timeClass &&
      g1.sans.join(' ') === l1.sans.join(' '),
    g1 && l1 ? `cc[${g1.colour}/${g1.result}/${g1.eco}] vs li[${l1.colour}/${l1.result}/${l1.eco}]` : 'a parse returned null',
  );

  // ── Tally + filter + summary ──

  const mixed = [g1, g2, g3, l1, l2, l3].filter(Boolean) as ImportedGame[];

  // 14. The tally counts per time control over the fetched set, plus total.
  const t = tallyTimeClasses(mixed);
  check(
    'tally counts per time control with a total',
    t.total === 6 &&
      t.byTimeClass.blitz === 2 &&   // g1 + l1
      t.byTimeClass.bullet === 1 &&  // g2
      t.byTimeClass.rapid === 2 &&   // g3 + l3
      t.byTimeClass.daily === 1,     // l2 (classical)
    `total ${t.total}; blitz ${t.byTimeClass.blitz}/bullet ${t.byTimeClass.bullet}/rapid ${t.byTimeClass.rapid}/daily ${t.byTimeClass.daily}`,
  );

  // 15. Filtering by chosen time controls drops the rest (bullet excluded here).
  const kept = filterByTimeClasses(mixed, ['blitz', 'rapid', 'daily']);
  check(
    'filter keeps only chosen time controls',
    kept.length === 5 && kept.every(g => g.timeClass !== 'bullet'),
    `kept ${kept.length}/${mixed.length}, no bullet: ${kept.every(g => g.timeClass !== 'bullet')}`,
  );

  // 16. summariseGames tallies colours and outcomes across both platforms.
  const s = summariseGames(mixed);
  check(
    'summary tallies colours and outcomes',
    s.total === 6 && s.white === 4 && s.black === 2 &&
      s.wins === 2 && s.losses === 2 && s.draws === 2,
    `W${s.white}/B${s.black}, ${s.wins}-${s.losses}-${s.draws}`,
  );

  // ── How-many count chooser (takeNewest) ───────────────────────────────────

  // The scan hands games back newest-first, so takeNewest just heads-slices.
  // Build a numbered stand-in (1 = newest … 250 = oldest) to check the cut.
  const newestFirst = Array.from({ length: 250 }, (_, i) => i + 1);

  // 17. "Last 100" keeps the most recent 100 — the first 100, in order.
  const last100 = takeNewest(newestFirst, 100);
  check(
    'count: Last 100 keeps the most recent 100',
    last100.length === 100 && last100[0] === 1 && last100[99] === 100,
    `kept ${last100.length}, [${last100[0]}..${last100[last100.length - 1]}]`,
  );

  // 18. "All" keeps everything the scan held (a copy, not the same array).
  const all = takeNewest(newestFirst, 'all');
  check(
    'count: All keeps every scanned game',
    all.length === 250 && all !== newestFirst && all[0] === 1 && all[249] === 250,
    `kept ${all.length}`,
  );

  // 19. A slice larger than the set just returns the whole set (no padding).
  const last500 = takeNewest(newestFirst, 500);
  check(
    'count: a slice bigger than the set returns it all',
    last500.length === 250,
    `kept ${last500.length} of 250`,
  );

  return results;
}
