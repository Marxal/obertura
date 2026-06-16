/**
 * Build src/starter-packs.json — a small set of curated "starter repertoire"
 * packs used by the onboarding flow (the empty Train screen) so a brand-new user
 * can adopt their first lines in a tap instead of building each by hand.
 *
 * Each pack is a coherent mini-repertoire for one colour, grouped by a mix of
 * first move / level / style. The lines below are standard, well-trodden
 * mainlines (≈10–14 plies) — the same moves the Lichess explorer surfaces as the
 * popular continuations, written out here and VALIDATED with the same chess.js
 * the app uses, so the result ships offline with zero network or rate-limit risk.
 * (If we ever want to refresh them straight from explorer.lichess.org popularity,
 * this is the file to extend — the output shape stays the same.)
 *
 * Output ([ { id, title, colour, level, style, blurb,
 *             lines: [ { name, sans:[…], ucis:[…] } ] } ]) is committed to git
 * and lazy-loaded by src/onboarding-starter.ts.
 *
 * Run with: node scripts/build-starter-packs.mjs
 */
import { Chess } from 'chess.js';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// ── Curated packs (SAN). Keep lines coherent: one main reply per opponent setup,
// with a couple of extra branches for the most common defences. ────────────────
const PACKS = [
  {
    id: 'white-e4-beginner',
    title: '1.e4 — Beginner',
    colour: 'white',
    level: 'Beginner',
    style: 'Universal',
    blurb: 'Classic king-pawn openings with simple, safe replies to every Black defence. The friendliest place to start.',
    lines: [
      { name: 'Italian Game (Giuoco Piano)', sans: ['e4','e5','Nf3','Nc6','Bc4','Bc5','c3','Nf6','d3','d6','O-O','O-O'] },
      { name: 'Italian vs ...Nf6 (Two Knights)', sans: ['e4','e5','Nf3','Nc6','Bc4','Nf6','d3','Be7','O-O','O-O'] },
      { name: 'vs Sicilian — Alapin (2...d5)', sans: ['e4','c5','c3','d5','exd5','Qxd5','d4','Nf6','Nf3','Bg4','Be2','e6'] },
      { name: 'vs Sicilian — Alapin (2...Nf6)', sans: ['e4','c5','c3','Nf6','e5','Nd5','Nf3','Nc6','d4','cxd4','cxd4','d6'] },
      { name: 'vs French — Exchange', sans: ['e4','e6','d4','d5','exd5','exd5','Nf3','Nf6','Bd3','Bd6','O-O','O-O'] },
      { name: 'vs Caro-Kann — Exchange', sans: ['e4','c6','d4','d5','exd5','cxd5','Bd3','Nc6','c3','Nf6','Bf4'] },
      { name: 'vs Scandinavian', sans: ['e4','d5','exd5','Qxd5','Nc3','Qa5','d4','Nf6','Nf3','c6','Bc4','Bf5'] },
      { name: 'vs Pirc / Modern — Classical', sans: ['e4','d6','d4','Nf6','Nc3','g6','Nf3','Bg7','Be2','O-O','O-O'] },
    ],
  },
  {
    id: 'white-d4-london',
    title: '1.d4 — London System',
    colour: 'white',
    level: 'Easy to learn',
    style: 'Solid',
    blurb: 'One setup against almost everything: Bf4, e3, Nf3, Bd3, c3. Low theory, very sturdy.',
    lines: [
      { name: 'London vs ...d5 (classical)', sans: ['d4','d5','Bf4','Nf6','e3','e6','Nf3','Bd6','Bg3','O-O','Bd3'] },
      { name: 'London vs ...c5', sans: ['d4','d5','Bf4','c5','e3','Nc6','Nf3','Nf6','c3','e6','Nbd2'] },
      { name: 'London vs King’s Indian (...g6)', sans: ['d4','Nf6','Bf4','g6','Nf3','Bg7','e3','O-O','Be2','d6','O-O'] },
      { name: 'London vs ...e6', sans: ['d4','Nf6','Bf4','e6','Nf3','c5','e3','Nc6','c3','d5','Nbd2'] },
      { name: 'London vs ...c6 (Slav-like)', sans: ['d4','d5','Bf4','Nf6','e3','c6','Nf3','Bf5','Bd3','Bxd3','Qxd3'] },
      { name: 'London vs ...Qb6', sans: ['d4','d5','Bf4','Nf6','e3','e6','Nf3','c5','c3','Qb6','Qc1'] },
      { name: 'London vs ...d6 (Modern)', sans: ['d4','d6','Bf4','Nf6','Nf3','g6','e3','Bg7','Be2','O-O','O-O'] },
    ],
  },
  {
    id: 'black-vs-e4-carokann',
    title: 'vs 1.e4 — Caro-Kann',
    colour: 'black',
    level: 'Intermediate',
    style: 'Solid',
    blurb: 'A rock-solid answer to 1.e4: a good pawn structure and an easy bishop, with little to memorise.',
    lines: [
      { name: 'Advance Variation', sans: ['e4','c6','d4','d5','e5','Bf5','Nf3','e6','Be2','Nd7','O-O','Ne7'] },
      { name: 'Exchange Variation', sans: ['e4','c6','d4','d5','exd5','cxd5','Bd3','Nc6','c3','Nf6','h3','e6'] },
      { name: 'Classical (Main line)', sans: ['e4','c6','d4','d5','Nc3','dxe4','Nxe4','Bf5','Ng3','Bg6','h4','h6'] },
      { name: 'Two Knights', sans: ['e4','c6','Nf3','d5','Nc3','Bg4','h3','Bxf3','Qxf3','e6'] },
      { name: 'Panov Attack', sans: ['e4','c6','d4','d5','exd5','cxd5','c4','Nf6','Nc3','e6','Nf3','Be7'] },
      { name: 'Fantasy Variation', sans: ['e4','c6','d4','d5','f3','dxe4','fxe4','e5','Nf3','Bg4'] },
      { name: 'vs King’s Indian Attack', sans: ['e4','c6','d3','d5','Nd2','e5','Ngf3','Bd6','g3','Nf6','Bg2','O-O'] },
    ],
  },
  {
    id: 'black-vs-d4-solid',
    title: 'vs 1.d4 — Slav / QGD',
    colour: 'black',
    level: 'Intermediate',
    style: 'Solid',
    blurb: 'Classical, dependable answers to 1.d4 — hold the centre with ...d5 and develop naturally.',
    lines: [
      { name: 'Slav Defense (Main line)', sans: ['d4','d5','c4','c6','Nf3','Nf6','Nc3','dxc4','a4','Bf5','e3','e6'] },
      { name: 'Slav — Exchange', sans: ['d4','d5','c4','c6','cxd5','cxd5','Nc3','Nf6','Nf3','Nc6','Bf4','Bf5'] },
      { name: 'Queen’s Gambit Declined', sans: ['d4','d5','c4','e6','Nc3','Nf6','Bg5','Be7','e3','O-O','Nf3','h6'] },
      { name: 'QGD — Exchange', sans: ['d4','d5','c4','e6','cxd5','exd5','Nc3','Nf6','Bg5','Be7','e3','c6'] },
      { name: 'vs London System', sans: ['d4','d5','Bf4','Nf6','e3','e6','Nf3','Bd6','Bg3','O-O','Bd3','c5'] },
      { name: 'vs Catalan', sans: ['d4','Nf6','c4','e6','g3','d5','Bg2','Be7','Nf3','O-O','O-O','dxc4'] },
      { name: 'vs Colle / Torre', sans: ['d4','Nf6','Nf3','e6','e3','d5','Bd3','c5','c3','Nc6','Nbd2','Bd6'] },
    ],
  },
];

// ── Replay each line with chess.js to validate legality and derive UCI. ─────────
function ucisFor(sans, where) {
  const chess = new Chess();
  const ucis = [];
  for (const san of sans) {
    let move;
    try {
      move = chess.move(san);
    } catch {
      move = null;
    }
    if (!move) {
      throw new Error(`Illegal move "${san}" in ${where} — after ${ucis.join(' ') || '(start)'}`);
    }
    ucis.push(move.from + move.to + (move.promotion ?? ''));
  }
  return ucis;
}

const out = PACKS.map(pack => ({
  id: pack.id,
  title: pack.title,
  colour: pack.colour,
  level: pack.level,
  style: pack.style,
  blurb: pack.blurb,
  lines: pack.lines.map(l => ({
    name: l.name,
    sans: l.sans,
    ucis: ucisFor(l.sans, `${pack.id} / ${l.name}`),
  })),
}));

const outPath = join(root, 'src/starter-packs.json');
const json = JSON.stringify(out);
writeFileSync(outPath, json);

const lineCount = out.reduce((n, p) => n + p.lines.length, 0);
const avgPlies = (out.reduce((n, p) => n + p.lines.reduce((m, l) => m + l.ucis.length, 0), 0) / lineCount).toFixed(1);
console.log(`Wrote ${outPath} — ${(json.length / 1024).toFixed(1)} KB, ${out.length} packs, ${lineCount} lines (avg ${avgPlies} plies).`);
