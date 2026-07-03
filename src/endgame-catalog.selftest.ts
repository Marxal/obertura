import { Chess } from 'chess.js';
import {
  allEndgames,
  endgamesByCategory,
  getEndgame,
  CATEGORY_ORDER,
  LEVEL_META,
  type EndgameCategory,
  type EndgameLevel,
} from './endgame-catalog';
import { pieceCount, TABLEBASE_MAX_PIECES } from './lichess-tablebase';

// Validates the bundled endgame catalogue: every position must be a legal FEN with
// the side to move matching `youPlay`, at most 7 pieces (so the tablebase can judge
// it), unique ids, and sane metadata. Pure — runs headless with the other suites.

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const CATEGORIES = new Set<EndgameCategory>(CATEGORY_ORDER);
const LEVELS = new Set<EndgameLevel>(Object.keys(LEVEL_META) as EndgameLevel[]);

export function runEndgameCatalogSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    results.push({ name, pass, detail });
  };

  const endgames = allEndgames();
  check('catalogue is non-empty', endgames.length > 0, `count ${endgames.length}`);

  // Unique ids.
  const ids = new Set<string>();
  let dupes = 0;
  for (const e of endgames) {
    if (ids.has(e.id)) dupes++;
    ids.add(e.id);
  }
  check('ids are unique', dupes === 0, `${dupes} duplicate(s)`);

  for (const e of endgames) {
    // Legal FEN?
    let chess: Chess | null = null;
    try {
      chess = new Chess(e.fen);
    } catch (err) {
      chess = null;
      check(`${e.id}: legal FEN`, false, String(err));
    }
    if (!chess) continue;
    check(`${e.id}: legal FEN`, true);

    // Side to move matches the side you play.
    const turn = chess.turn() === 'w' ? 'white' : 'black';
    check(`${e.id}: side to move === youPlay`, turn === e.youPlay, `turn ${turn}, youPlay ${e.youPlay}`);

    // Within tablebase range so it can be judged as ground truth.
    const pieces = pieceCount(e.fen);
    check(`${e.id}: ≤${TABLEBASE_MAX_PIECES} pieces`, pieces <= TABLEBASE_MAX_PIECES, `${pieces} pieces`);

    // Both kings present (a legal FEN guarantees this, but be explicit).
    const board = e.fen.split(' ')[0];
    check(`${e.id}: has both kings`, board.includes('K') && board.includes('k'));

    // Metadata sanity.
    check(`${e.id}: valid category`, CATEGORIES.has(e.category), e.category);
    check(`${e.id}: valid level`, LEVELS.has(e.level), e.level);
    check(`${e.id}: valid goal`, e.goal === 'win' || e.goal === 'draw', e.goal);
    check(`${e.id}: has a name`, e.name.trim().length > 0);
    check(`${e.id}: has an idea`, e.idea.trim().length > 10);
    check(`${e.id}: lookup by id round-trips`, getEndgame(e.id)?.id === e.id);
  }

  // Grouping: every position lands in exactly one group, order follows CATEGORY_ORDER.
  const groups = endgamesByCategory();
  const grouped = groups.reduce((n, g) => n + g.items.length, 0);
  check('grouping keeps every position', grouped === endgames.length, `${grouped} of ${endgames.length}`);
  const orderOk = groups.every((g, i, arr) =>
    i === 0 || CATEGORY_ORDER.indexOf(arr[i - 1].category) < CATEGORY_ORDER.indexOf(g.category));
  check('groups follow CATEGORY_ORDER', orderOk);

  return results;
}
