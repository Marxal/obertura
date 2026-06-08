// A runnable check of the Chess.com PGN parser — no network, no test framework,
// just like scheduler.selftest.ts. The import block in Settings has a "Run
// import parser self-test" link that calls this and shows pass/fail, so the
// parsing logic can be verified right on the phone, offline.

import { parseGame, summariseGames, OPENING_PLIES, type ImportedGame } from './chesscom';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const ME = 'marxal';

// A short Italian Game, our user playing White and winning. Clock comments are
// included on purpose — real chess.com PGNs carry them and the parser must cope.
const italianWhiteWin = {
  url: 'https://www.chess.com/game/live/1',
  uuid: 'game-1',
  time_control: '180+2',
  time_class: 'blitz' as const,
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
const sicilianBlackLoss = {
  url: 'https://www.chess.com/game/live/2',
  uuid: 'game-2',
  time_control: '60',
  time_class: 'bullet' as const,
  rated: true,
  rules: 'chess',
  end_time: 1_715_100_000,
  eco: 'https://www.chess.com/openings/Sicilian-Defense',
  white: { username: 'speedy', result: 'win' },
  black: { username: 'marxal', result: 'timeout' },
  pgn: '[White "speedy"]\n[Black "marxal"]\n[Result "1-0"]\n\n1. e4 c5 2. Nf3 d6 1-0',
};

// An agreed draw, user as White.
const drawGame = {
  url: 'https://www.chess.com/game/live/3',
  uuid: 'game-3',
  time_control: '600',
  time_class: 'rapid' as const,
  rated: false,
  rules: 'chess',
  end_time: 1_715_200_000,
  white: { username: 'marxal', result: 'agreed' },
  black: { username: 'peaceful', result: 'agreed' },
  pgn: '[White "marxal"]\n[Black "peaceful"]\n[Result "1/2-1/2"]\n\n1. d4 d5 2. c4 e6 1/2-1/2',
};

// A 960 variant — must be skipped.
const variantGame = {
  url: 'https://www.chess.com/game/live/4',
  uuid: 'game-4',
  time_control: '180',
  time_class: 'blitz' as const,
  rules: 'chess960',
  white: { username: 'marxal', result: 'win' },
  black: { username: 'x', result: 'resigned' },
  pgn: '[Variant "Chess960"]\n\n1. e4 e5 1-0',
};

export function runChesscomSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name, pass, detail });

  // 1. Parses an Italian win: colour, result, opening, ECO, and moves all land.
  const g1 = parseGame(italianWhiteWin, ME);
  check(
    'parses a White win with clock comments',
    !!g1 &&
      g1.colour === 'white' &&
      g1.result === 'win' &&
      g1.opening === 'Italian Game' &&
      g1.eco === 'C50' &&
      g1.sans.join(' ') === 'e4 e5 Nf3 Nc6 Bc4 Bc5' &&
      g1.ucis[0] === 'e2e4',
    g1 ? `${g1.colour}/${g1.result}, "${g1.opening}", ${g1.eco}, [${g1.sans.join(' ')}]` : 'returned null'
  );

  // 2. Username match is case-insensitive (PGN says "Marxal", we pass "marxal").
  check(
    'username match is case-insensitive',
    !!g1 && g1.opponent === 'opponent99',
    g1 ? `opponent ${g1.opponent}` : 'returned null'
  );

  // 3. Black timeout loss is classified from our side.
  const g2 = parseGame(sicilianBlackLoss, ME);
  check(
    'Black timeout is a loss for us',
    !!g2 && g2.colour === 'black' && g2.result === 'loss' && g2.timeClass === 'bullet',
    g2 ? `${g2.colour}/${g2.result}/${g2.timeClass}` : 'returned null'
  );

  // 4. An agreed result is a draw, not a loss.
  const g3 = parseGame(drawGame, ME);
  check(
    'agreed result is a draw',
    !!g3 && g3.result === 'draw',
    g3 ? `result ${g3.result}` : 'returned null'
  );

  // 5. Non-standard variants are skipped.
  check(
    'chess960 game is skipped',
    parseGame(variantGame, ME) === null,
    'expected null'
  );

  // 6. A game we didn't play in is skipped (defensive).
  check(
    'unrelated game is skipped',
    parseGame({ ...sicilianBlackLoss, white: { username: 'a', result: 'win' }, black: { username: 'b', result: 'resigned' } }, ME) === null,
    'expected null'
  );

  // 7. Opening moves are capped at OPENING_PLIES, but plyCount keeps the full length.
  const longMoves = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 11. Nbd2 Bb7 12. Bc2 Re8 13. Nf1 Bf8 14. Ng3 g6 *';
  const longGame = {
    url: 'u', uuid: 'long', time_control: '600', time_class: 'rapid' as const, rules: 'chess',
    white: { username: 'marxal', result: 'win' }, black: { username: 'z', result: 'resigned' },
    pgn: `[White "marxal"]\n[Black "z"]\n\n${longMoves}`,
  };
  const g4 = parseGame(longGame, ME);
  check(
    `moves capped at ${OPENING_PLIES} plies, full length retained`,
    !!g4 && g4.sans.length === OPENING_PLIES && g4.plyCount === 28,
    g4 ? `kept ${g4.sans.length} of ${g4.plyCount}` : 'returned null'
  );

  // 8. summariseGames tallies time classes, colours, and outcomes.
  const sample = [g1, g2, g3].filter(Boolean) as ImportedGame[];
  const s = summariseGames(sample);
  check(
    'summary tallies colours and outcomes',
    s.total === 3 &&
      s.white === 2 && s.black === 1 &&
      s.wins === 1 && s.losses === 1 && s.draws === 1 &&
      s.byTimeClass.blitz === 1 && s.byTimeClass.bullet === 1 && s.byTimeClass.rapid === 1,
    `W${s.white}/B${s.black}, ${s.wins}-${s.losses}-${s.draws}, ` +
      `blitz ${s.byTimeClass.blitz}/bullet ${s.byTimeClass.bullet}/rapid ${s.byTimeClass.rapid}`
  );

  return results;
}
