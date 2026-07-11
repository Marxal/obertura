/**
 * Builds the bundled Lichess-study index (src/study-index.json) that powers the
 * Packs tab's "Lichess studies" browser: offline search + "recommended for your
 * repertoire". This is a BUILD-MACHINE tool run by hand (npm run
 * build-study-index), NOT part of `npm run build` — the output JSON is
 * committed like starter-packs.json and traps.json.
 *
 * Why bundled: Lichess's study search (lichess.org/study/search) answers JSON
 * to an Accept header, but it is a WEBSITE route with no CORS headers — the
 * app, served from github.io, cannot call it from the browser. Only /api/*
 * routes are CORS-enabled, and none of them searches studies. So the index is
 * assembled here (Node has no CORS) and shipped offline, the same pattern as
 * the openings table and explorer stats. Importing a study's PGN stays live in
 * the app — /api/study/{id}.pgn IS CORS-enabled.
 *
 * For each curated opening family we query the study search, keep the most
 * liked public studies, and record which family (or families) surfaced each
 * one, plus normalised match keys aligned with analysis.ts's familyKey() so
 * the app can join the index against saved lines and imported games from any
 * platform's naming (chess.com slugs drop apostrophes, "Defence" vs
 * "Defense", Petrov vs Russian Game…).
 */
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(root, 'src/study-index.json');

const SEARCH = 'https://lichess.org/study/search';
const DELAY_MS = 3000;      // stay under the anonymous rate limit
const RETRY_429_MS = 65000; // Lichess asks for a full minute after a 429
const PER_QUERY_KEEP = 8;   // most-liked studies kept per query
const MIN_LIKES = 20;       // popular ordering → a real quality floor
const MIN_CHAPTERS = 2;     // repertoire studies, not single-game posts

// Mirror of normalizeFamilyText() in src/analysis.ts (plain Node can't import
// the TS): lowercase, apostrophes dropped, defence → defense. Keep in step.
const norm = (s) => s.toLowerCase().replace(/['’]/g, '').replace(/defence/g, 'defense');

// query      — what we ask the search for.
// family     — display name, dataset style (matches openingFamily() output for
//              lines named from the bundled table). null = general corpus only.
// extraKeys  — additional match keys where sources name the family differently.
const QUERIES = [
  { query: 'sicilian defense', family: 'Sicilian Defense' },
  { query: 'french defense', family: 'French Defense' },
  { query: 'caro-kann', family: 'Caro-Kann Defense' },
  { query: 'italian game', family: 'Italian Game' },
  { query: 'ruy lopez', family: 'Ruy Lopez', extraKeys: ['spanish game', 'spanish opening'] },
  { query: 'scotch game', family: 'Scotch Game' },
  { query: 'vienna game', family: 'Vienna Game' },
  { query: 'kings gambit', family: "King's Gambit" },
  { query: 'petrov defense', family: 'Russian Game', extraKeys: ['petrovs defense', 'petrov defense', 'petroff defense'] },
  { query: 'philidor defense', family: 'Philidor Defense' },
  { query: 'pirc defense', family: 'Pirc Defense' },
  { query: 'modern defense', family: 'Modern Defense' },
  { query: 'alekhine defense', family: 'Alekhine Defense', extraKeys: ['alekhines defense'] },
  { query: 'scandinavian defense', family: 'Scandinavian Defense' },
  { query: 'queens gambit', family: "Queen's Gambit" },
  { query: 'slav defense', family: 'Slav Defense' },
  { query: 'semi-slav', family: 'Semi-Slav Defense' },
  { query: 'kings indian defense', family: "King's Indian Defense" },
  { query: 'nimzo-indian', family: 'Nimzo-Indian Defense' },
  { query: 'queens indian defense', family: "Queen's Indian Defense" },
  { query: 'grunfeld defense', family: 'Grünfeld Defense', extraKeys: ['grunfeld defense'] },
  { query: 'benoni defense', family: 'Benoni Defense' },
  { query: 'benko gambit', family: 'Benko Gambit' },
  { query: 'dutch defense', family: 'Dutch Defense' },
  { query: 'catalan opening', family: 'Catalan Opening' },
  { query: 'london system', family: 'London System' },
  { query: 'trompowsky attack', family: 'Trompowsky Attack' },
  { query: 'torre attack', family: 'Torre Attack' },
  { query: 'colle system', family: 'Colle System' },
  { query: 'english opening', family: 'English Opening' },
  { query: 'reti opening', family: 'Réti Opening', extraKeys: ['reti opening'] },
  { query: 'kings indian attack', family: "King's Indian Attack" },
  { query: 'birds opening', family: "Bird's Opening" },
  { query: 'nimzo-larsen attack', family: 'Nimzo-Larsen Attack', extraKeys: ['nimzowitsch-larsen attack'] },
  { query: 'budapest defense', family: 'Budapest Defense', extraKeys: ['budapest gambit'] },
  { query: 'bogo-indian', family: 'Bogo-Indian Defense' },
  { query: 'tarrasch defense', family: 'Tarrasch Defense' },
  { query: 'four knights game', family: 'Four Knights Game' },
  { query: 'evans gambit', family: 'Italian Game' },
  { query: 'najdorf', family: 'Sicilian Defense' },
  { query: 'kings pawn opening', family: "King's Pawn Game" },
  { query: 'queens pawn opening', family: "Queen's Pawn Game" },
  // General corpus — searchable, but tied to no family for recommendations.
  { query: 'opening repertoire', family: null },
  { query: 'opening traps', family: null },
  { query: 'gambit repertoire', family: null },
  { query: 'beginner chess openings', family: null },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function searchStudies(q) {
  // Most-liked first — the default relevance ordering surfaces mostly fresh
  // low-like studies, which defeats the quality floor.
  const url = `${SEARCH}?q=${encodeURIComponent(q)}&order=popular`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.status === 429 && attempt === 0) {
      console.log(`  429 on "${q}" — waiting ${RETRY_429_MS / 1000}s…`);
      await sleep(RETRY_429_MS);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} for "${q}"`);
    const data = await res.json();
    return data?.paginator?.currentPageResults ?? [];
  }
}

const byId = new Map();

for (const { query, family, extraKeys = [] } of QUERIES) {
  let results;
  try {
    results = await searchStudies(query);
  } catch (e) {
    console.error(`  search failed: ${e.message}`);
    await sleep(DELAY_MS * 4);
    continue;
  }

  const kept = results
    .filter((s) => (s.likes ?? 0) >= MIN_LIKES && (s.chapters?.length ?? 0) >= MIN_CHAPTERS)
    .sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
    .slice(0, PER_QUERY_KEEP);

  for (const s of kept) {
    const entry = byId.get(s.id) ?? {
      id: s.id,
      name: s.name,
      by: s.owner?.name ?? '?',
      likes: s.likes ?? 0,
      chapters: s.chapters?.length ?? 0,
      families: [],
      keys: [],
    };
    if (family) {
      if (!entry.families.includes(family)) entry.families.push(family);
      for (const k of [norm(family), ...extraKeys.map(norm)]) {
        if (!entry.keys.includes(k)) entry.keys.push(k);
      }
    }
    byId.set(s.id, entry);
  }
  console.log(`"${query}": ${results.length} found, ${kept.length} kept`);
  await sleep(DELAY_MS);
}

// Verify each survivor actually EXPORTS: a study can show up in search yet
// refuse /api/study/{id}.pgn (author-locked export / gone private) — shipping
// one of those gives the user a dead "Import" button on a top pick. Probe the
// endpoint and drop refusals; the body is cancelled after the status line so
// the probe stays cheap.
const candidates = [...byId.values()].sort((a, b) => b.likes - a.likes);
console.log(`\nVerifying PGN export on ${candidates.length} studies…`);
const studies = [];
for (const s of candidates) {
  let ok = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://lichess.org/api/study/${s.id}.pgn?comments=false&clocks=false&variations=false`);
      if (res.status === 429) {
        console.log(`  429 probing ${s.id} — waiting ${RETRY_429_MS / 1000}s…`);
        await res.body?.cancel();
        await sleep(RETRY_429_MS);
        continue;
      }
      ok = res.ok;
      await res.body?.cancel();
    } catch { /* network hiccup → drop the study; the next rebuild rechecks */ }
    break;
  }
  if (ok) studies.push(s);
  else console.log(`  dropped (no export): ${s.id} "${s.name}"`);
  await sleep(1500);
}

writeFileSync(OUT, JSON.stringify({ builtAt: new Date().toISOString().slice(0, 10), studies }, null, 1) + '\n');
console.log(`\n${studies.length} studies (of ${candidates.length} found) → ${OUT}`);
