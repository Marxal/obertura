/**
 * Build the bundled opening-statistics database: real win/draw/loss counts for
 * the most common positions, crawled once from the Lichess opening explorer and
 * shipped with the app. This is the offline core behind the builder's Library
 * win/loss graphs (instant, no login, no CORS at runtime).
 *
 * Output: src/explorer-stats.json, keyed by EPD (first four FEN fields — the same
 * key openings.ts uses), per database:
 *   { "<epd>": { masters?: [{uci,white,draws,black}], lichess?: [...] } }
 *
 * Crawl: breadth-first from the start position, separately for each database. At
 * each position keep the top TOP_MOVES continuations and recurse into those whose
 * game count clears MIN_GAMES, up to MAX_PLIES and a POSITION_BUDGET cap.
 *
 * Lichess gates the explorer behind a login, so this needs a token. The token is
 * used ONLY here, at build time — it is never shipped.
 *
 * Setup before running:
 *   1. Create a free token (no scopes) at https://lichess.org/account/oauth/token
 *   2. export LICHESS_TOKEN=...    (and allowlist explorer.lichess.org egress)
 *   3. node scripts/build-explorer-stats.mjs
 *
 * Every crawl knob below can be overridden from the command line, so a short
 * sample run is possible without editing this file. A 200-position run takes a
 * couple of minutes and answers the two questions worth knowing before
 * committing several hours: does the token work, and how DEEP does the crawl
 * actually reach before the budget runs out?
 *
 *   POSITION_BUDGET=200 LICHESS_TOKEN=... node scripts/build-explorer-stats.mjs
 *
 * A sample run REPLACES what is already in the file for the databases it
 * crawls, so re-run the full crawl before shipping.
 *
 * ── ONE DATABASE AT A TIME ──────────────────────────────────────────────────
 * `DB=masters` (or `DB=lichess`) crawls just that one and MERGES the result
 * into whatever is already in the file, leaving the other database's entries
 * untouched. The two have very different costs — masters is small and cheap,
 * lichess is enormous — so running them on separate nights is usually better
 * than one long block that cannot be interrupted.
 */
import { Chess } from 'chess.js';
import { writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const TOKEN = process.env.LICHESS_TOKEN;
if (!TOKEN) {
  console.error('Set LICHESS_TOKEN (a free Lichess API token) before running.');
  process.exit(1);
}
// A placeholder copied out of a command someone wrote for you is a NON-EMPTY
// string, so the check above waves it through and every request then fails 401.
// That cost a full overnight run once. Real tokens are `lip_` plus twenty-odd
// characters, so a stand-in is caught here rather than six hours later.
if (/^(lip_)?(yours|your.?token|token|placeholder|test|fake|x+|\.+)$/i.test(TOKEN) || TOKEN.length < 12) {
  console.error(`LICHESS_TOKEN looks like a placeholder ("${TOKEN}"), not a real token.`);
  console.error('Create one (no scopes needed) at https://lichess.org/account/oauth/token');
  process.exit(1);
}

// ── Crawl shape knobs ────────────────────────────────────────────────────────
// Each one reads an environment variable of the same name and falls back to the
// default, so the shipped shape is what you get by typing nothing. A bad value
// (a typo, a word, a negative) falls back too rather than crawling something
// nonsensical for hours.
const num = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(`Ignoring ${name}="${raw}" — not a positive number. Using ${fallback}.`);
    return fallback;
  }
  return Math.floor(n);
};

// Which databases to crawl. One at a time merges; see the header.
const ALL_DBS = ['masters', 'lichess'];
const DBS = process.env.DB ? [process.env.DB] : ALL_DBS;
for (const db of DBS) {
  if (!ALL_DBS.includes(db)) {
    console.error(`DB="${db}" is not one of: ${ALL_DBS.join(', ')}`);
    process.exit(1);
  }
}

const TOP_MOVES = num('TOP_MOVES', 6);            // continuations STORED per position
const MAX_PLIES = num('MAX_PLIES', 14);           // how deep to crawl
const POSITION_BUDGET = num('POSITION_BUDGET', 12000); // hard cap on positions per database
// ── PACING, AND WHY IT SELF-CORRECTS ────────────────────────────────────────
// The explorer is rate-limited far harder than the rest of the Lichess API, and
// they deliberately publish no threshold. 700ms tripped it within a hundred
// positions, so the starting pace is slower — but the number that matters is
// the one the crawl SETTLES on, not the one it starts at.
//
// So a 429 does two things. It waits out the penalty (below), and it
// permanently slows the crawl by THROTTLE_STEP_MS. A run that keeps getting
// limited keeps easing off until it stops being limited, and then holds there.
// That is worth more than any guess made up front: an eight-hour crawl cannot
// be babysat, and the alternative — a fixed pace that turns out to be slightly
// too fast — spends the whole run in penalty.
//
// The settled pace is printed at the end. Use it to plan the next run.
const THROTTLE_MS = num('THROTTLE_MS', 1500);        // starting pace
const THROTTLE_STEP_MS = num('THROTTLE_STEP_MS', 250); // added per rate limit
const THROTTLE_MAX_MS = num('THROTTLE_MAX_MS', 6000);  // never crawl slower than this

// Lichess's own instruction for a 429 is "wait a full minute before resuming
// API usage". The first version of this waited 2, then 4, then 6 seconds — well
// inside the penalty window, so every retry was spent being refused again and
// probably extended it. Waiting the minute they ask for is both correct and, in
// practice, faster.
const RETRY_WAIT_MS = num('RETRY_WAIT_MS', 60000);
const RETRY_ATTEMPTS = num('RETRY_ATTEMPTS', 4);

let throttle = THROTTLE_MS;

// ── WHAT GETS STORED vs WHAT GETS FOLLOWED ──────────────────────────────────
// These are two different things, and conflating them is what made the first
// crawl useless. TOP_MOVES above is what the app SHOWS: six win/draw/loss bars
// at every position the crawl reaches. The three knobs below decide only which
// of those six the crawl WALKS INTO — so tightening them never thins the
// library at any position it covers, it just spends the budget on real theory
// instead of on dead ends.
//
// The first crawl followed any move with 2,000+ games. In the lichess database
// — hundreds of millions of games — 2,000 is a rounding error, so it branched
// four to six ways at every ply and burned the whole budget by move 4.
//
// So the rule is now relative, not absolute:
//
//   • The TOP move is ALWAYS followed. That guarantees one unbroken spine down
//     every branch: main lines reach the depth cap instead of being cut off
//     part-way through a ply when the budget runs out.
//   • Any OTHER move is followed only if it is played in at least MIN_SHARE of
//     games from that position AND clears the absolute floor. That is what
//     "main line" actually means, and it adapts to both databases by itself.
//   • MAX_FOLLOW caps the branching regardless.
//
// Branching is the whole ballgame. The budget is spent on roughly b^depth
// positions, so an average of 2 reaches move 7 on 12,000 positions, 3 reaches
// about move 5, and 4 gets you back to move 4. Always following the top move
// and rarely following a fourth is what holds the average near 2.
const MIN_SHARE = Number(process.env.MIN_SHARE ?? 0.10); // share of games at that position
const MAX_FOLLOW = num('MAX_FOLLOW', 4);                 // hard cap on children followed

// The absolute floor, which has to differ per database because they differ in
// size by two orders of magnitude. A single MIN_GAMES on the command line
// overrides both for that run.
const DEFAULT_MIN_GAMES = { masters: 200, lichess: 20000 };
const minGamesFor = (db) => num('MIN_GAMES', DEFAULT_MIN_GAMES[db]);

const ENDPOINTS = {
  lichess: 'https://explorer.lichess.org/lichess',
  masters: 'https://explorer.lichess.org/masters',
};
const ALL_SPEEDS = 'ultraBullet,bullet,blitz,rapid,classical,correspondence';
const ALL_RATINGS = '0,1000,1200,1400,1600,1800,2000,2200,2500';

const epd = (fen) => fen.split(' ').slice(0, 4).join(' ');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retries are counted so a slow crawl can be diagnosed afterwards: rate
// limiting and a slow server look identical from the outside, and they call for
// opposite fixes (back off further vs. nothing to be done).
let rateLimited = 0;

async function query(db, fen) {
  let url = `${ENDPOINTS[db]}?topGames=0&moves=${TOP_MOVES}&fen=${encodeURIComponent(fen)}`;
  if (db === 'lichess') url += `&variant=standard&recentGames=0&speeds=${ALL_SPEEDS}&ratings=${ALL_RATINGS}`;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (res.status === 429) {
      rateLimited++;
      // Ease off permanently as well as waiting out this one — see the pacing
      // note above. Capped, so a bad patch can't crawl to a standstill.
      throttle = Math.min(THROTTLE_MAX_MS, throttle + THROTTLE_STEP_MS);
      console.warn(
        `  (rate limited ×${rateLimited} — waiting ${RETRY_WAIT_MS / 1000}s, ` +
        `pace now ${throttle}ms)`,
      );
      await sleep(RETRY_WAIT_MS);
      continue;
    }
    // 401 is not a transient failure — the token is wrong, expired or revoked,
    // and every remaining request will fail the same way. The caller's catch
    // would otherwise turn that into thousands of "skip" lines and an empty
    // crawl that still takes all night to not happen.
    if (res.status === 401) {
      console.error(`\n${db}: Lichess rejected the token (401).`);
      console.error('It is wrong, expired, or was revoked. Create a new one');
      console.error('(no scopes needed) at https://lichess.org/account/oauth/token');
      console.error('Nothing was written; the existing file is untouched.');
      process.exit(1);
    }
    if (!res.ok) throw new Error(`${db} ${res.status} ${await res.text()}`);
    const data = await res.json();
    return (data.moves ?? []).map((m) => ({
      uci: m.uci, white: m.white, draws: m.draws, black: m.black,
    }));
  }
  throw new Error(`${db}: gave up after repeated 429s`);
}

async function crawlDb(db, out, byPly) {
  const minGames = minGamesFor(db);
  let reused = 0;
  const start = new Chess();
  const queue = [{ fen: start.fen(), ply: 0 }];
  const seen = new Set();
  let count = 0;
  while (queue.length && count < POSITION_BUDGET) {
    const { fen, ply } = queue.shift();
    const key = epd(fen);
    if (seen.has(key)) continue;
    seen.add(key);

    // Already crawled for this database on an earlier pass (KEEP=1): reuse it
    // and walk THROUGH it, rather than spending three seconds re-asking. This is
    // what lets a deep pass start where a shallow one stopped instead of
    // re-crawling everything above it.
    const held = out[key]?.[db];
    if (held?.length) {
      byPly[ply] = (byPly[ply] ?? 0) + 1;
      reused++;
      if (ply + 1 < MAX_PLIES) enqueueChildren(fen, ply, held, minGames);
      continue;
    }

    let moves;
    try { moves = await query(db, fen); }
    catch (e) { console.warn(`  skip (${e.message})`); continue; }
    await sleep(throttle);
    if (!moves.length) continue;

    (out[key] ??= {})[db] = moves;
    byPly[ply] = (byPly[ply] ?? 0) + 1;
    count++;
    if (count % 100 === 0) console.log(`  ${db}: ${count} positions…`);

    if (ply + 1 >= MAX_PLIES) continue;
    enqueueChildren(fen, ply, moves, minGames);
  }

  // Rank by games played, then follow the top move plus whatever else is
  // genuinely popular here — see the note on the knobs above.
  function enqueueChildren(fen, ply, moves, minGames) {
    const ranked = moves
      .map((m) => ({ m, games: m.white + m.draws + m.black }))
      .sort((a, b) => b.games - a.games);
    const total = ranked.reduce((sum, e) => sum + e.games, 0);
    const follow = ranked
      .filter((e, i) => i === 0 || (e.games >= minGames && e.games >= total * MIN_SHARE))
      .slice(0, MAX_FOLLOW);
    for (const { m } of follow) {
      const chess = new Chess(fen);
      try {
        const played = chess.move({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci.slice(4) || undefined });
        if (played) queue.push({ fen: chess.fen(), ply: ply + 1 });
      } catch { /* illegal — skip */ }
    }
  }
  console.log(`  ${db}: done, ${count} new positions${reused ? ` (+${reused} reused from an earlier pass)` : ''}.`);
}

// Say out loud what is about to run, so a sample run and the real one are never
// confused after the fact — the numbers below are the whole difference.
console.log(
  `Crawling: ${DBS.join(', ')}\n` +
  `Settings: TOP_MOVES=${TOP_MOVES} MIN_SHARE=${MIN_SHARE} MAX_FOLLOW=${MAX_FOLLOW} ` +
  `MAX_PLIES=${MAX_PLIES} POSITION_BUDGET=${POSITION_BUDGET} THROTTLE_MS=${THROTTLE_MS}\n` +
  `          MIN_GAMES: ${DBS.map((db) => `${db}=${minGamesFor(db)}`).join(' ')}`,
);

const path = join(root, 'src', 'explorer-stats.json');

// Start from whatever is already on disk, so crawling one database keeps the
// other's entries. The databases being crawled NOW are cleared first, so a
// re-run replaces its own results rather than layering a new crawl on top of a
// stale one — the shape that would quietly mix two different settings in one
// file.
// KEEP=1 adds to what this database already has instead of replacing it, which
// is what makes a WIDE pass and a DEEP pass combine into one file.
//
// ── WHY TWO PASSES BEAT ONE ─────────────────────────────────────────────────
// The tree branches about 2.3x per ply, so depth is exponential and breadth is
// what pays for it: at MIN_SHARE=0.10 the frontier is already ~1,600 positions
// wide by move 5, and ten more plies of that is six figures — weeks of crawling,
// not hours. Crawl narrow enough to go deep (MIN_SHARE=0.30) and you reach move
// 12 in an evening, but you cover far fewer openings.
//
// You do not have to choose. The file is keyed by POSITION, so a wide-shallow
// pass and a narrow-deep pass merge into their union: broad coverage near the
// opening, main lines running deep. Two evenings, and neither one has to be the
// compromise.
//
// Without KEEP the second pass would silently delete the first, which is why
// replacing is still the default — a re-run with changed settings must not
// quietly blend two different crawl shapes it can no longer tell apart.
const KEEP = process.env.KEEP === '1';

let out = {};
try {
  out = JSON.parse(readFileSync(path, 'utf-8')) || {};
  if (!KEEP) {
    for (const key of Object.keys(out)) {
      for (const db of DBS) delete out[key][db];
      if (!Object.keys(out[key]).length) delete out[key];
    }
  }
  const kept = Object.keys(out).length;
  if (kept) {
    console.log(
      KEEP
        ? `Adding to ${kept} positions already in the file (KEEP=1).`
        : `Merging into ${kept} positions already in the file.`,
    );
  }
} catch {
  out = {}; // no file yet, or unreadable — start clean
}
// How much this file already holds, per database, BEFORE anything is crawled.
// The safety check at the bottom compares against it.
const before = {};
for (const db of ALL_DBS) before[db] = 0;
try {
  const existing = JSON.parse(readFileSync(path, 'utf-8')) || {};
  for (const key of Object.keys(existing)) {
    for (const db of ALL_DBS) if (existing[key][db]) before[db]++;
  }
} catch { /* no file yet */ }

// Preflight: one request against the start position before any crawling. A
// rejected token, a blocked host or a typo'd endpoint surfaces here in about a
// second, rather than part-way through an unattended overnight run.
console.log('Checking the token…');
await query(DBS[0], new Chess().fen());
console.log('Token accepted.\n');

const depths = {};
for (const db of DBS) {
  console.log(`Crawling ${db}…`);
  depths[db] = [];
  await crawlDb(db, out, depths[db]);
}

// ── NEVER TRADE A GOOD CRAWL FOR A FAILED ONE ───────────────────────────────
// Every write here replaces hours of somebody's machine time, and a crawl that
// fails wholesale (a dead token, no network, a bad edit) produces an EMPTY
// result that is otherwise written out exactly like a good one. That happened:
// a run with no usable token cleared 6,609 crawled positions and wrote `{}`.
//
// So a write that would leave a database with a small fraction of what it had is
// refused. This cannot fire on an honest crawl — a re-run gathers roughly what
// the last one did, and a deliberately narrower pass keeps its own data via
// KEEP=1. FORCE=1 is the way out for the one real case: genuinely wanting to
// throw a database's entries away.
const after = {};
for (const db of ALL_DBS) after[db] = 0;
for (const key of Object.keys(out)) {
  for (const db of ALL_DBS) if (out[key][db]) after[db]++;
}
const lost = ALL_DBS.filter((db) => before[db] > 20 && after[db] < before[db] * 0.5);
if (lost.length && process.env.FORCE !== '1') {
  console.error('\nRefusing to write — this would throw away crawled data:');
  for (const db of lost) console.error(`  ${db}: ${before[db]} positions → ${after[db]}`);
  console.error('\nThe file on disk is unchanged. If the crawl failed, fix that and re-run.');
  console.error('If you really do mean to discard it, re-run with FORCE=1.');
  process.exit(1);
}

const json = JSON.stringify(out);
writeFileSync(path, json);

// ── HOW DEEP DID IT ACTUALLY GET? ───────────────────────────────────────────
// The crawl is breadth-first under a position budget, so the depth cap is
// rarely what stops it — the budget usually runs out first, part-way through a
// ply. That means "how deep does the library go" cannot be read off MAX_PLIES;
// it has to be measured. This is that measurement, and it is the reason to do a
// short sample run before committing to a long one.
//
// Ply is half-moves: ply 0 is the starting position, so ply 13 is Black to move
// on move 7. A ply that is COMPLETE (the crawl moved past it) is fully covered;
// the last ply listed is usually partial — that is where the budget ran out.
for (const db of DBS) {
  const rows = depths[db];
  if (!rows.length) continue;
  const total = rows.reduce((a, b) => a + (b ?? 0), 0);
  const deepest = rows.length - 1;
  console.log(`\n${db}: ${total} positions, deepest ply ${deepest} (move ${Math.floor(deepest / 2) + 1}).`);
  for (let ply = 0; ply < rows.length; ply++) {
    if (!rows[ply]) continue;
    console.log(`  ply ${String(ply).padStart(2)} (move ${String(Math.floor(ply / 2) + 1).padStart(2)}, ${ply % 2 ? 'Black' : 'White'} to move): ${rows[ply]}`);
  }
}

if (rateLimited) {
  console.log(
    `\nRate limited ${rateLimited} times; settled at ${throttle}ms between requests.\n` +
    `Start the next run with THROTTLE_MS=${throttle} to skip the penalties entirely.`,
  );
} else {
  console.log(`\nNever rate limited at ${throttle}ms. A lower THROTTLE_MS would crawl faster.`);
}

console.log(`\nWrote ${Object.keys(out).length} positions, ${(json.length / 1e6).toFixed(1)} MB → ${path}`);
