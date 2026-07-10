/**
 * Build src/starter-packs.json — curated "starter repertoire" packs used by the
 * onboarding flow, the pack picker and the Explore → Packs tab.
 *
 * The pack CONTENT lives in scripts/starter-packs/*.mjs, one module per pack.
 * Each line there is authored as { name, plan, moves } where `moves` is a list
 * of SAN strings, or [san, note] tuples to attach an explanation to that move.
 * This script compiles that into the runtime shape:
 *
 *   [ { id, title, colour, level, style, blurb,
 *       lines: [ { name, sans:[…], ucis:[…], notes?:{plyIndex:note}, plan } ] } ]
 *
 * …validating every move with the same chess.js the app uses, so the packs
 * ship offline with zero network risk. Checks enforced here:
 *   • every SAN is legal from its position (hard fail)
 *   • every line ends on the USER's own move (hard fail) — the learn/drill run
 *     must finish with the user playing
 *   • no line is a whole-ply prefix of another in the same pack (hard fail) —
 *     the picker's added-state matching treats prefixes as the same line
 *   • every line has a plan (hard fail)
 *   • depth outside 14–24 plies, notes > 260 chars, plans > 400 chars (warn)
 *
 * Run with: node scripts/build-starter-packs.mjs
 */
import { Chess } from 'chess.js';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import whiteE4Beginner from './starter-packs/white-e4-beginner.mjs';
import whiteD4London from './starter-packs/white-d4-london.mjs';
import whiteE4Attacking from './starter-packs/white-e4-attacking.mjs';
import blackVsE4Carokann from './starter-packs/black-vs-e4-carokann.mjs';
import blackVsE4OpenGames from './starter-packs/black-vs-e4-open-games.mjs';
import blackVsD4Solid from './starter-packs/black-vs-d4-solid.mjs';

const PACKS = [
  whiteE4Beginner,
  whiteD4London,
  whiteE4Attacking,
  blackVsE4Carokann,
  blackVsE4OpenGames,
  blackVsD4Solid,
];

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const warnings = [];

// Compile one authored line: split [san, note] tuples into parallel data,
// replay with chess.js to validate legality and derive UCI.
function compileLine(line, colour, where) {
  if (!line.plan || typeof line.plan !== 'string' || !line.plan.trim()) {
    throw new Error(`Line "${where}" has no plan — every pack line needs one.`);
  }
  if (line.plan.length > 400) {
    warnings.push(`${where}: plan is long (${line.plan.length} chars)`);
  }

  const sans = [];
  const notes = {};
  line.moves.forEach((m, i) => {
    if (Array.isArray(m)) {
      const [san, note] = m;
      sans.push(san);
      if (typeof note !== 'string' || !note.trim()) {
        throw new Error(`Line "${where}" ply ${i}: tuple without a note text.`);
      }
      if (note.length > 260) warnings.push(`${where} ply ${i} (${san}): note is long (${note.length} chars)`);
      notes[i] = note;
    } else {
      sans.push(m);
    }
  });

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
      throw new Error(`Illegal move "${san}" in ${where} — after ${sans.slice(0, ucis.length).join(' ') || '(start)'}`);
    }
    ucis.push(move.from + move.to + (move.promotion ?? ''));
  }

  // Last ply must be the pack colour's own move (White = odd length, Black = even).
  const lastIsWhite = ucis.length % 2 === 1;
  if (lastIsWhite !== (colour === 'white')) {
    throw new Error(`Line "${where}" ends on the opponent's move (length ${ucis.length}); it must end on ${colour}'s move.`);
  }
  if (ucis.length < 14 || ucis.length > 24) {
    warnings.push(`${where}: ${ucis.length} plies (target is 14–24)`);
  }

  const out = { name: line.name, sans, ucis, plan: line.plan };
  if (Object.keys(notes).length > 0) out.notes = notes;
  return out;
}

function compilePack(pack) {
  const lines = pack.lines.map(l => compileLine(l, pack.colour, `${pack.id} / ${l.name}`));

  // No line may be a whole-ply prefix of another in the same pack — the app's
  // added-state matching (isLineAdded) would then mark both as one.
  for (let a = 0; a < lines.length; a++) {
    for (let b = a + 1; b < lines.length; b++) {
      const sa = lines[a].ucis.join(' ');
      const sb = lines[b].ucis.join(' ');
      if (sa === sb || sa.startsWith(sb + ' ') || sb.startsWith(sa + ' ')) {
        throw new Error(`Pack ${pack.id}: "${lines[a].name}" and "${lines[b].name}" are prefix-duplicates.`);
      }
    }
  }

  return {
    id: pack.id,
    title: pack.title,
    colour: pack.colour,
    level: pack.level,
    style: pack.style,
    blurb: pack.blurb,
    lines,
  };
}

const out = PACKS.map(compilePack);

const outPath = join(root, 'src/starter-packs.json');
const json = JSON.stringify(out);
writeFileSync(outPath, json);

for (const w of warnings) console.warn(`⚠ ${w}`);
for (const p of out) {
  const plies = p.lines.map(l => l.ucis.length);
  const noteCount = p.lines.reduce((n, l) => n + Object.keys(l.notes ?? {}).length, 0);
  const avg = (plies.reduce((a, b) => a + b, 0) / plies.length).toFixed(1);
  console.log(`  ${p.id}: ${p.lines.length} lines, ${Math.min(...plies)}–${Math.max(...plies)} plies (avg ${avg}), ${noteCount} notes`);
}
const lineCount = out.reduce((n, p) => n + p.lines.length, 0);
console.log(`Wrote ${outPath} — ${(json.length / 1024).toFixed(1)} KB, ${out.length} packs, ${lineCount} lines.`);
