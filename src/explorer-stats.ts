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
// The file is lazily imported so its weight never lands on the initial bundle.

import { epdKey } from './openings';
import type { ExplorerCounts, ExplorerDb } from './lichess-explorer';

interface BundledMove { uci: string; white: number; draws: number; black: number }
type BundledEntry = Partial<Record<ExplorerDb, BundledMove[]>>;
type BundledData = Record<string, BundledEntry>;

let dataPromise: Promise<BundledData> | null = null;
function load(): Promise<BundledData> {
  if (!dataPromise) {
    dataPromise = import('./explorer-stats.json')
      .then(mod => (mod.default ?? mod) as BundledData)
      .catch(() => ({}));
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
  const data = await load();
  const entry = data[epdKey(fen)];
  const moves = entry?.[db];
  if (!moves || moves.length === 0) return null;
  const map = new Map<string, ExplorerCounts>();
  for (const m of moves) map.set(m.uci, { white: m.white, draws: m.draws, black: m.black });
  return map;
}
