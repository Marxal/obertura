/**
 * Build src/traps.json — curated "opening traps" shown in Explore → Lines to try
 * → Traps. A trap is just a famous line where the user plays the trapping side,
 * the opponent walks into a tempting losing move (the "bait"), and the line ends
 * on the user's punishing blow. The Traps tab renders each as a "build a line
 * from it" card (identical to a Recommended card), so a trap maps onto a normal
 * repertoire line with no special runtime.
 *
 * These are famous, well-trodden traps written out in SAN and VALIDATED with the
 * same chess.js the app uses, so the result ships offline with zero network or
 * rate-limit risk. We skip obvious beginner traps (Scholar's, Blackburne Shilling
 * …) — every trap here is Intermediate or Advanced.
 *
 * Three rules, all asserted below:
 *   • every move is legal (chess.js replays the whole line),
 *   • the line ends on the TRAPPING colour's own move (White = odd ply count,
 *     Black = even), so the line finishes with the user delivering the blow, and
 *   • every authored +/# glyph is real (a "#" is checkmate, a "+" a non-mating
 *     check, a plain move gives no check) — this catches mis-remembered traps.
 *
 * The committed JSON is the source of truth. A future breadth top-up from the
 * CC0 Lichess puzzle DB lives in scripts/build-traps-from-lichess.mjs and merges
 * hand-checked entries into the same shape (source: 'lichess'); it is run by hand
 * and is NOT part of `npm run build`.
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
        name: 'Fried Liver Attack',
        level: 'Intermediate',
        family: 'Italian Game',
        bait: '…Nxd5 (recapturing the pawn)',
        idea: 'Ng5 already hits f7. After 5…Nxd5, the knight sac 6.Nxf7! forks queen and rook and drags the Black king into the open for a raging attack.',
        sans: ['e4','e5','Nf3','Nc6','Bc4','Nf6','Ng5','d5','exd5','Nxd5','Nxf7'],
      },
      {
        name: 'Caro-Kann Smothered Mate (Qe2)',
        level: 'Advanced',
        family: 'Caro-Kann Defense',
        bait: '…Ngf6 (natural development)',
        idea: '5.Qe2 quietly pins the e-file. After …Ngf6, Nd6# is mate — …exd6 is illegal because the e7-pawn is pinned to the king.',
        sans: ['e4','c6','d4','d5','Nc3','dxe4','Nxe4','Nd7','Qe2','Ngf6','Nd6#'],
      },
      {
        name: 'Monticelli Trap',
        level: 'Advanced',
        family: 'Bogo-Indian Defense',
        bait: '…Nxc3 (snatching a knight)',
        idea: 'Ignore the knight: 10.Ng5! double-attacks h7 and the b7-bishop at once, and White comes out the exchange ahead with a winning bind.',
        sans: ['d4','Nf6','c4','e6','Nf3','b6','g3','Bb7','Bg2','Bb4+','Bd2','Bxd2+','Qxd2','O-O','Nc3','Ne4','Qc2','Nxc3','Ng5'],
      },
      {
        name: 'Tennison Gambit Trap',
        level: 'Advanced',
        family: 'Scandinavian Defense',
        bait: '…h6 (kicking the knight)',
        idea: 'The quiet 6.Nxf7! Kxf7 7.Bg6+!! Kxg6 8.Qxd8 nets the queen — the bishop check deflects the king clean off the d-file.',
        sans: ['e4','d5','Nf3','dxe4','Ng5','Nf6','d3','exd3','Bxd3','h6','Nxf7','Kxf7','Bg6+','Kxg6','Qxd8'],
      },
      {
        name: 'Danish Gambit Trap',
        level: 'Advanced',
        family: 'Danish Gambit',
        bait: '…Nf6 (developing a pawn up)',
        idea: 'Both bishops rake the kingside. After 6.Bxd5 Nf6??, 7.Bxf7+! Kxf7 8.Qxd8 snares the queen.',
        sans: ['e4','e5','d4','exd4','c3','dxc3','Bc4','cxb2','Bxb2','d5','Bxd5','Nf6','Bxf7+','Kxf7','Qxd8'],
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
        name: 'Englund Gambit Trap',
        level: 'Intermediate',
        family: 'Englund Gambit',
        bait: '6.Bc3?? (defending b2)',
        idea: 'After 6.Bc3 Bb4! the bishop is pinned; 7.Qd2 Bxc3 8.Qxc3 Qc1# is a back-rank smothered mate.',
        sans: ['d4','e5','dxe5','Nc6','Nf3','Qe7','Bf4','Qb4+','Bd2','Qxb2','Bc3','Bb4','Qd2','Bxc3','Qxc3','Qc1#'],
      },
      {
        name: 'Mortimer Trap (Ruy Lopez)',
        level: 'Intermediate',
        family: 'Ruy Lopez',
        bait: '5.Nxe5?? (grabbing the “free” pawn)',
        idea: 'The odd-looking 4…Ne7 invites 5.Nxe5?? c6! 6.Bc4 Qa5+! — a check that forks the king and the stranded e5-knight.',
        sans: ['e4','e5','Nf3','Nc6','Bb5','Nf6','d3','Ne7','Nxe5','c6','Bc4','Qa5+'],
      },
      {
        name: "From's Gambit Trap",
        level: 'Intermediate',
        family: 'Bird Opening',
        bait: '4.Nc3?? (natural development)',
        idea: 'Against From’s Gambit, 4.Nc3?? Qh4+ 5.g3 Qxg3+! 6.hxg3 Bxg3# is a classic smothered-style mate down the dark squares.',
        sans: ['f4','e5','fxe5','d6','exd6','Bxd6','Nc3','Qh4+','g3','Qxg3+','hxg3','Bxg3#'],
      },
      {
        name: 'Stafford Gambit Trap',
        level: 'Intermediate',
        family: 'Russian Game',
        bait: '6.Bg5?? (pinning the f6-knight)',
        idea: 'The Stafford bites back: 6.Bg5?? Nxe4! 7.Bxd8 Bxf2+ 8.Ke2 Bg4# — the greedy queen grab walks into mate.',
        sans: ['e4','e5','Nf3','Nf6','Nxe5','Nc6','Nxc6','dxc6','d3','Bc5','Bg5','Nxe4','Bxd8','Bxf2+','Ke2','Bg4#'],
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
      {
        name: 'Siberian Trap (Smith-Morra)',
        level: 'Advanced',
        family: 'Sicilian Defense',
        bait: '9.h3?? (kicking the knight)',
        idea: 'In the Smith-Morra, …Ng4 sets the trap: 9.h3?? Nd4! 10.Nxd4?? Qh2# — the queen swings to h2 with the g4-knight guarding it.',
        sans: ['e4','c5','d4','cxd4','c3','dxc3','Nxc3','Nc6','Nf3','e6','Bc4','Qc7','O-O','Nf6','Qe2','Ng4','h3','Nd4','Nxd4','Qh2#'],
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
    // Keep the authored check/mate glyphs honest: a "#" must be real checkmate, a
    // "+" a real (non-mating) check, and a plain move must give no check at all.
    // This catches mis-remembered traps that "look" like mates but aren't.
    const mate = chess.isCheckmate();
    const check = chess.inCheck();
    if (san.endsWith('#') && !mate) {
      throw new Error(`"${san}" in ${where} is marked mate but is not checkmate.`);
    }
    if (san.endsWith('+') && !(check && !mate)) {
      throw new Error(`"${san}" in ${where} is marked check but ${mate ? 'is mate' : 'gives no check'}.`);
    }
    if (!/[+#]$/.test(san) && check) {
      throw new Error(`"${san}" in ${where} gives check but is missing its + glyph.`);
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
