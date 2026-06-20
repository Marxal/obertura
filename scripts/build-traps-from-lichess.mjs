/**
 * Breadth top-up for the opening-traps feature, from the CC0 Lichess puzzle
 * database (https://database.lichess.org/#puzzles). This is a BUILD-MACHINE tool,
 * not part of `npm run build`: it filters the (very large) puzzle dump down to a
 * small, opening-tagged, non-beginner shortlist and writes it to a REVIEW file —
 *
 *     scripts/out/traps-lichess-candidates.json   (git-ignored)
 *
 * — which a human then hand-checks before any of it is promoted into the curated
 * src/traps.json. Nothing here ships automatically: Lichess puzzles are
 * auto-generated mid-game positions (FEN + solution moves), not famous named
 * traps written from move 1, so the tag can be coarse and the "trap" framing is
 * ours to apply. Treating it as a candidate list keeps the shipped data honest
 * and tiny while still giving us a breadth pipeline.
 *
 * The raw dump is ~600MB+ (zstd-compressed) and is NEVER committed or shipped —
 * only the capped, reviewed shortlist ever makes it into the app.
 *
 * Usage:
 *   1. Download lichess_db_puzzle.csv.zst from the link above.
 *   2. Decompress:  zstd -d lichess_db_puzzle.csv.zst
 *   3. node scripts/build-traps-from-lichess.mjs path/to/lichess_db_puzzle.csv
 *
 * CSV columns: PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,
 *              Themes,GameUrl,OpeningTags
 */
import { createReadStream, mkdirSync, writeFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// Opening families we want breadth in, mapped to the Lichess openingTags prefix
// (tags look like "Italian_Game", "Caro-Kann_Defense_Advance_Variation", …). Keep
// these aligned with the curated families in build-traps.mjs / openingFamily().
const FAMILY_TAGS = {
  'Italian Game': 'Italian_Game',
  'Caro-Kann Defense': 'Caro-Kann_Defense',
  'Ruy Lopez': 'Ruy_Lopez',
  "Queen's Gambit": 'Queens_Gambit',
  'Budapest Gambit': 'Budapest_Defense',
  'Albin Countergambit': 'Albin_Countergambit',
  'Sicilian Defense': 'Sicilian_Defense',
  'French Defense': 'French_Defense',
  'Scandinavian Defense': 'Scandinavian_Defense',
  'English Opening': 'English_Opening',
};

// Quality gate — skip beginner-obvious material, keep the sharp stuff.
const MIN_RATING = 1600;        // below this is too easy / obvious
const MAX_RATING = 2400;        // above this is engine-fodder, not a learnable trap
const MIN_POPULARITY = 80;      // Lichess up/down score; well-liked puzzles only
const PER_FAMILY_CAP = 20;      // keep the shortlist small and reviewable

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: node scripts/build-traps-from-lichess.mjs path/to/lichess_db_puzzle.csv');
  console.error('See the header of this file for how to obtain the CSV.');
  process.exit(1);
}
if (!existsSync(csvPath)) {
  console.error(`No such file: ${csvPath}`);
  console.error('Download + decompress the Lichess puzzle dump first (see the file header).');
  process.exit(1);
}

// family → matching prefix (longest tag wins so "Caro-Kann_Defense_Advance" maps
// to Caro-Kann, etc.).
function familyForTags(openingTags) {
  if (!openingTags) return null;
  const tags = openingTags.split(' ');
  for (const tag of tags) {
    for (const [family, prefix] of Object.entries(FAMILY_TAGS)) {
      if (tag === prefix || tag.startsWith(prefix + '_')) return family;
    }
  }
  return null;
}

const byFamily = new Map(Object.keys(FAMILY_TAGS).map(f => [f, []]));
let scanned = 0;
let kept = 0;

const rl = createInterface({ input: createReadStream(csvPath), crlfDelay: Infinity });
let header = true;

rl.on('line', (line) => {
  if (header) { header = false; return; } // skip the column header row
  scanned++;
  // Naive CSV split is safe here: none of the columns we read contain commas.
  const [puzzleId, fen, moves, rating, , popularity, , themes, gameUrl, openingTags] = line.split(',');
  const family = familyForTags(openingTags);
  if (!family) return;
  const r = Number(rating);
  const pop = Number(popularity);
  if (!(r >= MIN_RATING && r <= MAX_RATING)) return;
  if (!(pop >= MIN_POPULARITY)) return;
  // Prefer tactical, finishing themes — the "trap pays off" puzzles.
  const themeList = (themes || '').split(' ');
  const tactical = themeList.some(t =>
    ['mate', 'mateIn1', 'mateIn2', 'mateIn3', 'fork', 'pin', 'skewer',
     'trappedPiece', 'discoveredAttack', 'sacrifice'].includes(t));
  if (!tactical) return;

  const bucket = byFamily.get(family);
  if (bucket.length >= PER_FAMILY_CAP) return;
  bucket.push({
    source: 'lichess',
    puzzleId,
    family,
    fen,                       // position the solver is handed
    solution: moves.split(' '), // UCI: [0] is the opponent's move INTO the puzzle
    rating: r,
    popularity: pop,
    themes: themeList,
    gameUrl,
    openingTags,
  });
  kept++;
});

rl.on('close', () => {
  const out = [...byFamily.entries()]
    .filter(([, list]) => list.length > 0)
    .map(([family, candidates]) => ({ family, candidates }));

  const outDir = join(root, 'scripts/out');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'traps-lichess-candidates.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2));

  console.log(`Scanned ${scanned.toLocaleString()} puzzles; kept ${kept} candidates across ${out.length} families.`);
  console.log(`Wrote ${outPath}`);
  console.log('Review these by hand, then transcribe the keepers into scripts/build-traps.mjs as full named traps.');
});
