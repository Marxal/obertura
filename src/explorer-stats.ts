// The bundled opening-statistics database: real win/draw/loss counts for the most
// common positions, generated offline by scripts/build-explorer-stats.mjs from the
// Lichess opening explorer and shipped with the app. This is the reliable core —
// instant, offline, no login, no CORS — behind the builder's Library win/loss
// graphs. "Connect to Lichess" later expands coverage to live, every-position data.
//
// Shape (explorer-stats.json), keyed by EPD (first four FEN fields, the same key
// openings.ts uses), per database:
//   { "<epd>": { masters?: Move[], lichess?: Move[] } }
//   Move = { uci, white, draws, black }
// The file is fetched on first use, so its weight never lands on the initial bundle.

import { epdKey } from './openings';
import type { ExplorerCounts, ExplorerDb } from './lichess-explorer';

interface BundledMove { uci: string; white: number; draws: number; black: number }
type BundledEntry = Partial<Record<ExplorerDb, BundledMove[]>>;
type BundledData = Record<string, BundledEntry>;

// A PLAIN FILE, NOT A MODULE. A browser remembers a failed import() for the whole
// session and never asks again, so one dropped connection emptied every screen that
// reads this until the app was restarted. A fetch can simply be tried again, and 8.6 MB
// is parsed far faster as JSON than as JavaScript.
const DATA_URL = new URL('./explorer-stats.json', import.meta.url).href;

let dataPromise: Promise<BundledData> | null = null;
function load(): Promise<BundledData> {
  if (!dataPromise) {
    dataPromise = fetch(DATA_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`explorer-stats: HTTP ${res.status}`);
        return res.json() as Promise<BundledData>;
      })
      .catch((err) => {
        dataPromise = null;
        throw err;
      });
  }
  return dataPromise;
}

// The bundled continuations for a position in the chosen database, as the same
// uci→counts map shape the live explorer returns, or null if we have no bundled
// data for this position.
export async function bundledStats(
  fen: string,
  db: ExplorerDb,
): Promise<Map<string, ExplorerCounts> | null> {
  const data = await load().catch((): BundledData => ({}));
  const entry = data[epdKey(fen)];
  const moves = entry?.[db];
  if (!moves || moves.length === 0) return null;
  const map = new Map<string, ExplorerCounts>();
  for (const m of moves) map.set(m.uci, { white: m.white, draws: m.draws, black: m.black });
  return map;
}

// The same data as a synchronous lookup, for code that asks about many positions
// in one pass and shouldn't await each one. Resolves once the file has loaded, and
// rejects if it can't, so the caller can tell "no data here" from "no data yet".
export async function bundledStatsLookup(
  db: ExplorerDb,
): Promise<(fen: string) => Map<string, ExplorerCounts> | null> {
  const data = await load();
  return (fen: string) => {
    const moves = data[epdKey(fen)]?.[db];
    if (!moves || moves.length === 0) return null;
    return new Map(moves.map(m => [m.uci, { white: m.white, draws: m.draws, black: m.black }]));
  };
}
