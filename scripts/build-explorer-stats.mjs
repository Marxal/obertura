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
 */
import { Chess } from 'chess.js';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const TOKEN = process.env.LICHESS_TOKEN;
if (!TOKEN) {
  console.error('Set LICHESS_TOKEN (a free Lichess API token) before running.');
  process.exit(1);
}

// ── Crawl shape knobs ────────────────────────────────────────────────────────
const DBS = ['masters', 'lichess'];
const TOP_MOVES = 6;        // continuations kept per position
const MIN_GAMES = 2000;     // only recurse into branches at least this popular
const MAX_PLIES = 14;       // how deep to crawl
const POSITION_BUDGET = 12000; // hard cap on positions per database
const THROTTLE_MS = 700;    // be gentle; the explorer is heavily rate-limited

const ENDPOINTS = {
  lichess: 'https://explorer.lichess.org/lichess',
  masters: 'https://explorer.lichess.org/masters',
};
const ALL_SPEEDS = 'ultraBullet,bullet,blitz,rapid,classical,correspondence';
const ALL_RATINGS = '0,1000,1200,1400,1600,1800,2000,2200,2500';

const epd = (fen) => fen.split(' ').slice(0, 4).join(' ');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function query(db, fen) {
  let url = `${ENDPOINTS[db]}?topGames=0&moves=${TOP_MOVES}&fen=${encodeURIComponent(fen)}`;
  if (db === 'lichess') url += `&variant=standard&recentGames=0&speeds=${ALL_SPEEDS}&ratings=${ALL_RATINGS}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (res.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`${db} ${res.status} ${await res.text()}`);
    const data = await res.json();
    return (data.moves ?? []).map((m) => ({
      uci: m.uci, white: m.white, draws: m.draws, black: m.black,
    }));
  }
  throw new Error(`${db}: gave up after repeated 429s`);
}

async function crawlDb(db, out) {
  const start = new Chess();
  const queue = [{ fen: start.fen(), ply: 0 }];
  const seen = new Set();
  let count = 0;
  while (queue.length && count < POSITION_BUDGET) {
    const { fen, ply } = queue.shift();
    const key = epd(fen);
    if (seen.has(key)) continue;
    seen.add(key);

    let moves;
    try { moves = await query(db, fen); }
    catch (e) { console.warn(`  skip (${e.message})`); continue; }
    await sleep(THROTTLE_MS);
    if (!moves.length) continue;

    (out[key] ??= {})[db] = moves;
    count++;
    if (count % 100 === 0) console.log(`  ${db}: ${count} positions…`);

    if (ply + 1 >= MAX_PLIES) continue;
    for (const m of moves) {
      const games = m.white + m.draws + m.black;
      if (games < MIN_GAMES) continue;
      const chess = new Chess(fen);
      try {
        const played = chess.move({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci.slice(4) || undefined });
        if (played) queue.push({ fen: chess.fen(), ply: ply + 1 });
      } catch { /* illegal — skip */ }
    }
  }
  console.log(`  ${db}: done, ${count} positions.`);
}

const out = {};
for (const db of DBS) {
  console.log(`Crawling ${db}…`);
  await crawlDb(db, out);
}

const path = join(root, 'src', 'explorer-stats.json');
writeFileSync(path, JSON.stringify(out));
console.log(`Wrote ${Object.keys(out).length} positions → ${path}`);
