/**
 * Build src/traps.json — curated "opening traps" used by the Explore → Opening
 * traps screen. A trap is just a Line where the user plays the trapping side, the
 * opponent walks into a tempting losing move (the "bait"), and the line ends on
 * the user's punishing move — so the existing drill engine (startDrill) and the
 * positions engine (startPositionsDrill) can practise and quiz them as-is.
 *
 * These are famous, well-trodden traps written out in SAN and VALIDATED with the
 * same chess.js the app uses, so the result ships offline with zero network or
 * rate-limit risk. We skip obvious beginner traps (Scholar's, Blackburne Shilling
 * …) — every trap here is Intermediate or Advanced.
 *
 * Two rules, both asserted below:
 *   • every move is legal (chess.js replays the whole line), and
 *   • the line ends on the TRAPPING colour's own move (White = odd ply count,
 *     Black = even), so the drill/puzzle finishes with the user delivering the
 *     blow.
 *
 * The committed JSON is the source of truth. The breadth top-up from the CC0
 * Lichess puzzle DB lives in scripts/build-traps-from-lichess.mjs and merges
 * hand-checked entries into the same shape (source: 'lichess').
 *
 * Output ([ { id, title, colour, blurb,
 *             traps: [ { name, level, family, bait, idea, source,
 *                        sans:[…], ucis:[…] } ] } ]) is committed to git and
 * lazy-loaded by src/traps-screen.ts.
 *
 * Run with: node scripts/build-traps.mjs
 */
import { Chess } from 'chess.js';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// ── Curated traps (SAN). Each trap belongs to a colour pack; `family` is keyed to
// match openingFamily() in src/analysis.ts so the screen can surface a trap
// against the openings you (or a scouted opponent) actually play. Each line ends
// on the pack colour's move. ────────────────────────────────────────────────────
const PACKS = [
  {
    id: 'white-traps',
    title: 'White — opening traps',
    colour: 'white',
    blurb: 'Tempting-looking replies that lose on the spot. You spring these as White.',
    traps: [
      {
        name: "Légal's Mate",
        level: 'Intermediate',
        family: 'Italian Game',
        bait: '…Bxd1 (grabbing the queen)',
        idea: 'Sacrifice the queen with Nxe5; if Black takes it, Bxf7+ and Nd5 is a model mate.',
        sans: ['e4','e5','Nf3','Nc6','Bc4','d6','Nc3','Bg4','h3','Bh5','Nxe5','Bxd1','Bxf7+','Ke7','Nd5#'],
      },
      {
        name: 'Caro-Kann Smothered Mate (Qe2)',
        level: 'Advanced',
        family: 'Caro-Kann Defense',
        bait: '…Ngf6 (natural development)',
        idea: '5.Qe2 quietly pins the e-file. After …Ngf6, Nd6# is mate — …exd6 is illegal because the e7-pawn is pinned to the king.',
        sans: ['e4','c6','d4','d5','Nc3','dxe4','Nxe4','Nd7','Qe2','Ngf6','Nd6#'],
      },
    ],
  },
  {
    id: 'black-traps',
    title: 'Black — opening traps',
    colour: 'black',
    blurb: 'Gambits and counter-traps where a greedy or natural White move loses. You spring these as Black.',
    traps: [
      {
        name: 'Kieninger Trap (Budapest)',
        level: 'Intermediate',
        family: 'Budapest Gambit',
        bait: '8.axb4 (winning the bishop)',
        idea: 'The early …Qe7 pins White’s e-pawn. When White grabs the bishop, …Nd3 is a smothered mate — exd3 is illegal.',
        sans: ['d4','Nf6','c4','e5','dxe5','Ng4','Bf4','Nc6','Nf3','Bb4+','Nbd2','Qe7','a3','Ngxe5','axb4','Nd3#'],
      },
      {
        name: 'Lasker Trap (Albin Countergambit)',
        level: 'Intermediate',
        family: 'Albin Countergambit',
        bait: '4.e3 (the natural break)',
        idea: 'The Albin’s advanced d-pawn enables an underpromotion: …exf2+ then …fxg1=N+! wins, since after the knight is taken …Bg4+ skewers the queen.',
        sans: ['d4','d5','c4','e5','dxe5','d4','e3','Bb4+','Bd2','dxe3','Bxb4','exf2+','Ke2','fxg1=N+'],
      },
      {
        name: "Noah's Ark Trap (Ruy Lopez)",
        level: 'Advanced',
        family: 'Ruy Lopez',
        bait: '8.Qxd4 (recapturing in the centre)',
        idea: 'The …c5–c4 pawn roll boxes in the b3-bishop: with a-, c- and own pawns covering its squares, it has nowhere to go and is lost.',
        sans: ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','d6','d4','b5','Bb3','Nxd4','Nxd4','exd4','Qxd4','c5','Qd5','Be6','Qc6+','Bd7','Qd5','c4'],
      },
      {
        name: 'Elephant Trap (Queen’s Gambit Declined)',
        level: 'Advanced',
        family: "Queen's Gambit",
        bait: '6.Nxd5 (snatching the pawn)',
        idea: 'If White grabs on d5, …Nxd5! works: after Bxd8, …Bb4+ wins the bishop back with interest and Black ends a clean piece up.',
        sans: ['d4','d5','c4','e6','Nc3','Nf6','Bg5','Nbd7','cxd5','exd5','Nxd5','Nxd5','Bxd8','Bb4+','Qd2','Bxd2+','Kxd2','Kxd8'],
      },
    ],
  },
];

// ── Replay each line with chess.js to validate legality, derive UCI, and assert
// it ends on the trapping (pack) colour's own move. We strip check/mate glyphs
// before feeding chess.js (it derives those itself) but keep the authored SAN —
// including +/# — for display. ──────────────────────────────────────────────────
function ucisFor(sans, colour, where) {
  const chess = new Chess();
  const ucis = [];
  for (const san of sans) {
    const clean = san.replace(/[+#]$/, '');
    let move;
    try {
      move = chess.move(clean);
    } catch {
      move = null;
    }
    if (!move) {
      throw new Error(`Illegal move "${san}" in ${where} — after ${ucis.join(' ') || '(start)'}`);
    }
    ucis.push(move.from + move.to + (move.promotion ?? ''));
  }
  // Last ply must be the pack colour's own move (White = odd length, Black = even).
  const lastIsWhite = ucis.length % 2 === 1;
  if (lastIsWhite !== (colour === 'white')) {
    throw new Error(`Trap "${where}" ends on the opponent's move (length ${ucis.length}); it must end on ${colour}'s move.`);
  }
  return ucis;
}

const out = PACKS.map(pack => ({
  id: pack.id,
  title: pack.title,
  colour: pack.colour,
  blurb: pack.blurb,
  traps: pack.traps.map(t => ({
    name: t.name,
    level: t.level,
    family: t.family,
    bait: t.bait,
    idea: t.idea,
    source: 'curated',
    sans: t.sans,
    ucis: ucisFor(t.sans, pack.colour, `${pack.id} / ${t.name}`),
  })),
}));

const outPath = join(root, 'src/traps.json');
const json = JSON.stringify(out);
writeFileSync(outPath, json);

const trapCount = out.reduce((n, p) => n + p.traps.length, 0);
const avgPlies = (out.reduce((n, p) => n + p.traps.reduce((m, t) => m + t.ucis.length, 0), 0) / trapCount).toFixed(1);
console.log(`Wrote ${outPath} — ${(json.length / 1024).toFixed(1)} KB, ${out.length} packs, ${trapCount} traps (avg ${avgPlies} plies).`);
