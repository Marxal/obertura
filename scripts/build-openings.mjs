/**
 * Build the bundled opening data from the openly-licensed hayatbiralem/eco.json
 * dataset (MIT) — an aggregated ECO set (~12k openings) that merges Lichess's
 * authoritative eco_tsv with SCID, Wikipedia, chess-graph and others. It fetches
 * the five ECO JSON files, replays each line's SAN with the SAME chess.js the app
 * uses, and produces TWO files:
 *
 *   1. src/openings-data.json     — the position→name lookup that powers naming
 *      everywhere. Keyed by the first four fields of each FEN (board,
 *      side-to-move, castling, en-passant). The app computes the identical key
 *      at runtime, so a lookup is an instant, offline object access.
 *      ({ "<epd>": "<name>", ... })
 *
 *   2. src/openings-library.json  — a browsable reference for the Explore
 *      Library: one entry per named opening, with its ECO code, name, and SAN
 *      move sequence. Lazy-loaded only when the Library is first opened.
 *      ([ { eco, name, moves: ["e4","e5",…] }, … ])
 *
 * Auto-generated "interpolated" filler entries (src === 'interpolated', names
 * suffixed " (i)") are skipped — we keep only real, named openings.
 *
 * Run with: node scripts/build-openings.mjs
 */
import { Chess } from 'chess.js';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = 'https://raw.githubusercontent.com/hayatbiralem/eco.json/master';
const FILES = ['ecoA.json', 'ecoB.json', 'ecoC.json', 'ecoD.json', 'ecoE.json'];

// Position key shared with the app: first four FEN fields only (drop the
// halfmove/fullmove clocks, which never affect the opening name).
function epd(fen) {
  return fen.split(' ').slice(0, 4).join(' ');
}

// Every real (non-interpolated) opening, parsed once: { eco, name, moves[], epd }.
const all = [];
let skippedInterp = 0;
let skippedBad = 0;

for (const file of FILES) {
  const res = await fetch(`${BASE}/${file}`);
  if (!res.ok) throw new Error(`Failed to fetch ${file}: HTTP ${res.status}`);
  const data = await res.json();

  // Each file is an object keyed by FEN → { src, eco, moves, name, ... }.
  for (const entry of Object.values(data)) {
    const { eco, name, moves: pgn, src } = entry;
    if (!name || !pgn) continue;
    if (src === 'interpolated' || / \(i\)$/.test(name)) { skippedInterp++; continue; }

    const chess = new Chess();
    const moves = [];
    try {
      // moves is numbered SAN ("1. e4 e5 2. Nf3"). Strip the move numbers and
      // play the SAN tokens — robust across chess.js versions.
      for (const tok of pgn.trim().split(/\s+/)) {
        if (/^\d+\.(\.\.)?$/.test(tok)) continue; // "1." or "1..."
        const m = chess.move(tok);
        moves.push(m.san); // chess.js's canonical SAN (matches runtime)
      }
    } catch {
      // A handful of merged-source lines may use SAN chess.js can't parse — skip
      // them rather than abort the whole build.
      skippedBad++;
      continue;
    }
    if (!moves.length) continue;

    all.push({ eco, name, moves, epd: epd(chess.fen()) });
  }
}

// Names map: prefer the SHORTEST line's name for each position, so a transposed
// position reads as the more general opening rather than a deep sub-variation.
const map = {};
let dupes = 0;
for (const { name, epd: key } of [...all].sort((a, b) => a.moves.length - b.moves.length)) {
  if (key in map) { dupes++; continue; }
  map[key] = name;
}

// Library: keep EVERY named row — distinct variations sharing a position still
// each earn their own browsable entry.
const library = all.map(({ eco, name, moves }) => ({ eco, name, moves }));

const namesPath = join(root, 'src/openings-data.json');
const namesJson = JSON.stringify(map);
writeFileSync(namesPath, namesJson);

const libPath = join(root, 'src/openings-library.json');
const libJson = JSON.stringify(library);
writeFileSync(libPath, libJson);

const keys = Object.keys(map).length;
console.log(`Parsed ${all.length} openings → ${keys} unique positions (${dupes} transpositions, ${skippedInterp} interpolated + ${skippedBad} unparseable skipped).`);
console.log(`Wrote ${namesPath} — ${(namesJson.length / 1024).toFixed(1)} KB raw JSON (names lookup).`);
console.log(`Wrote ${libPath} — ${(libJson.length / 1024).toFixed(1)} KB raw JSON, ${library.length} entries (library).`);
