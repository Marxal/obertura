/**
 * Build the bundled opening-name lookup from the openly-licensed
 * lichess-org/chess-openings dataset (CC0). It fetches the five ECO TSVs,
 * replays each line's PGN with the SAME chess.js the app uses, and keys every
 * resulting position by the first four fields of its FEN (board, side-to-move,
 * castling, en-passant). The app computes the identical key at runtime, so a
 * lookup is an instant, offline object access — no API, no token.
 *
 * Output: src/openings-data.json  ({ "<epd>": "<name>", ... })
 * Run with: node scripts/build-openings.mjs
 */
import { Chess } from 'chess.js';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master';
const FILES = ['a.tsv', 'b.tsv', 'c.tsv', 'd.tsv', 'e.tsv'];

// Position key shared with the app: first four FEN fields only (drop the
// halfmove/fullmove clocks, which never affect the opening name).
function epd(fen) {
  return fen.split(' ').slice(0, 4).join(' ');
}

const map = {};
let rows = 0;
let dupes = 0;

for (const file of FILES) {
  const res = await fetch(`${BASE}/${file}`);
  if (!res.ok) throw new Error(`Failed to fetch ${file}: HTTP ${res.status}`);
  const text = await res.text();

  for (const line of text.split('\n')) {
    if (!line || line.startsWith('eco\t')) continue; // header / blank
    const [, name, pgn] = line.split('\t');
    if (!name || !pgn) continue;

    const chess = new Chess();
    // PGN here is just numbered SAN moves ("1. e4 e5 2. Nf3"). Strip the move
    // numbers and play the SAN tokens — robust across chess.js versions.
    for (const tok of pgn.trim().split(/\s+/)) {
      if (/^\d+\.(\.\.)?$/.test(tok)) continue; // "1." or "1..."
      chess.move(tok);
    }

    const key = epd(chess.fen());
    if (key in map) dupes++;
    // Keep the first (shortest-PGN) name for a position; the dataset lists
    // shorter, more general lines before their deeper sub-variations.
    if (!(key in map)) map[key] = name;
    rows++;
  }
}

const outPath = join(root, 'src/openings-data.json');
const json = JSON.stringify(map);
writeFileSync(outPath, json);

const keys = Object.keys(map).length;
console.log(`Parsed ${rows} lines → ${keys} unique positions (${dupes} duplicates skipped).`);
console.log(`Wrote ${outPath} — ${(json.length / 1024).toFixed(1)} KB raw JSON.`);
