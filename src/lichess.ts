// Lichess source for the shared import core (see import-core.ts).
//
// The free games-export API needs no token for PUBLIC games:
//   GET https://lichess.org/api/games/user/{username}
//   Accept: application/x-ndjson
//   ?since={ms}&max={n}&moves=true&pgnInJson=true&opening=true
// It streams newline-delimited JSON, one game per line, newest first. We pass
// `since` for the chosen RANGE and `max` for the cap, map each line to the
// platform-neutral NormalisedGame, and hand batches to the core — which parses,
// caps, tallies and reports exactly as it does for Chess.com.
//
// VERIFICATION NOTE: the build container's network allowlist blocks lichess.org
// (as it blocks api.chess.com), so the live call can't be exercised from CI —
// only from the phone. The endpoint + params are confirmed against the current
// public API docs; the parser below is covered offline by the import self-test.

import {
  runImport,
  parseNormalised,
  HARD_CAP,
  type NormalisedGame,
  type ImportedGame,
  type TimeClass,
  type Range,
  type SourceFetch,
  type ImportOptions,
  type ImportResult,
} from './import-core';

const API_BASE = 'https://lichess.org/api/games/user';
const USERNAME_KEY = 'obertura.lichessUser';

// ── Username storage (device-local, mirrors chesscom.ts) ───────────────────────

export function getUsername(): string {
  try {
    return localStorage.getItem(USERNAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setUsername(name: string): void {
  try {
    const n = name.trim().toLowerCase();
    if (n) localStorage.setItem(USERNAME_KEY, n);
    else localStorage.removeItem(USERNAME_KEY);
  } catch {
    /* private mode / storage disabled */
  }
}

// ── Raw API shape (only the fields we read) ────────────────────────────────────

interface LichessClock {
  initial?: number;     // base seconds
  increment?: number;   // increment seconds
  totalTime?: number;
}

export interface LichessGame {
  id: string;
  rated?: boolean;
  variant?: string;     // "standard", "chess960", "crazyhouse", …
  speed?: string;       // "ultraBullet" | "bullet" | "blitz" | "rapid" | "classical" | "correspondence"
  createdAt?: number;   // ms
  lastMoveAt?: number;  // ms
  winner?: 'white' | 'black';
  players?: {
    white?: { user?: { name?: string } };
    black?: { user?: { name?: string } };
  };
  opening?: { eco?: string; name?: string; ply?: number };
  moves?: string;       // SAN, space-separated (no move numbers)
  pgn?: string;         // full PGN when pgnInJson=true
  clock?: LichessClock;
}

// Lichess "speed" → our four buckets. ultraBullet folds into bullet; classical
// and correspondence fold into the slow "daily" bucket (see import-core.ts).
function lichessTimeClass(speed: string | undefined): TimeClass {
  switch (speed) {
    case 'ultraBullet':
    case 'bullet':
      return 'bullet';
    case 'blitz':
      return 'blitz';
    case 'rapid':
      return 'rapid';
    case 'classical':
    case 'correspondence':
      return 'daily';
    default:
      return 'blitz';
  }
}

// A readable raw time control, "180+2"-style, to match chess.com's field.
function lichessTimeControl(clock: LichessClock | undefined, speed: string | undefined): string {
  if (clock && typeof clock.initial === 'number') {
    return `${clock.initial}+${clock.increment ?? 0}`;
  }
  return speed === 'correspondence' ? 'correspondence' : '-';
}

// ── LichessGame → NormalisedGame ────────────────────────────────────────────────

export function normaliseLichess(g: LichessGame): NormalisedGame | null {
  if (g.variant && g.variant !== 'standard') return null; // variants don't belong in a repertoire
  // pgnInJson gives a full PGN; fall back to the bare SAN movetext, which
  // chess.js parses fine in non-strict mode.
  const pgn = g.pgn ?? g.moves ?? '';
  if (!pgn) return null;

  const white = g.players?.white?.user?.name ?? 'Anonymous';
  const black = g.players?.black?.user?.name ?? 'Anonymous';

  return {
    id: g.id,
    url: `https://lichess.org/${g.id}`,
    endTime: Math.floor((g.lastMoveAt ?? g.createdAt ?? 0) / 1000),
    timeClass: lichessTimeClass(g.speed),
    timeControl: lichessTimeControl(g.clock, g.speed),
    rated: !!g.rated,
    white,
    black,
    winner: g.winner ?? null,
    pgn,
    eco: g.opening?.eco ?? null,
    opening: g.opening?.name ?? null,
  };
}

// Back-compat-style helper mirroring chesscom.parseGame, for the self-test.
export function parseLichessGame(g: LichessGame, username: string): ImportedGame | null {
  const norm = normaliseLichess(g);
  if (!norm) return null;
  return parseNormalised(norm, username);
}

// ── Fetch ───────────────────────────────────────────────────────────────────────

// Epoch-ms timestamp `months` calendar months before now — the `since` cursor.
function sinceMs(months: Range): number {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.getTime();
}

// The shared core's Lichess fetcher. One streamed request, newest first. We ask
// for one more than the hard cap (max+1): if the server can fill it, the core's
// cap logic trips on game #1001 and correctly reports truncation; otherwise the
// whole window fits and nothing is dropped.
//
// The response can be large and slow to arrive, so we read it progressively off
// the response body stream (rather than buffering the whole thing with
// `res.text()` first) and emit a batch every 50 lines AS THEY ARRIVE. That keeps
// `gamesSoFar` — and so the scan's progress bar — climbing in real time through
// the whole download instead of sitting still and then jumping all at once once
// the full body has landed.
export const fetchLichess: SourceFetch = async (username, months, emit) => {
  const user = username.trim();
  if (!user) throw new Error('Enter your Lichess username first.');

  const url = new URL(`${API_BASE}/${encodeURIComponent(user)}`);
  url.searchParams.set('since', String(sinceMs(months)));
  url.searchParams.set('max', String(HARD_CAP + 1));
  url.searchParams.set('moves', 'true');
  url.searchParams.set('pgnInJson', 'true');
  url.searchParams.set('opening', 'true');

  const res = await fetch(url.toString(), { headers: { Accept: 'application/x-ndjson' } });
  if (res.status === 404) throw new Error('Player not found — check the username.');
  if (res.status === 429) throw new Error('Lichess rate limit hit — wait a moment and try again.');
  if (!res.ok) throw new Error(`Lichess API error ${res.status} ${res.statusText}`);

  const CHUNK = 50;
  let batch: NormalisedGame[] = [];
  let linesSinceFlush = 0;
  let totalDone = 0;
  let cancelled = false;

  // One NDJSON line in: parse, normalise, fold into the pending batch, and flush
  // every CHUNK lines (blank lines don't count, matching the old whole-body split).
  async function handleLine(line: string): Promise<void> {
    if (cancelled) return;
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const norm = normaliseLichess(JSON.parse(trimmed) as LichessGame);
      if (norm) batch.push(norm);
    } catch {
      // one malformed line shouldn't sink the stream
    }
    totalDone++;
    linesSinceFlush++;
    if (linesSinceFlush >= CHUNK) {
      const keepGoing = await emit(batch, { monthsTotal: 1, monthsDone: totalDone, label: 'Lichess' });
      batch = [];
      linesSinceFlush = 0;
      if (!keepGoing) cancelled = true;
    }
  }

  if (res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!cancelled) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        await handleLine(line);
        if (cancelled) break;
      }
    }
    if (!cancelled && buffer) await handleLine(buffer);
    if (cancelled) await reader.cancel().catch(() => {});
  } else {
    // No streamable body (older runtime) — fall back to a whole-body read,
    // processed the same way so the cap/cancel logic stays identical.
    const text = await res.text();
    for (const line of text.split('\n')) {
      await handleLine(line);
      if (cancelled) break;
    }
  }

  if (batch.length) await emit(batch, { monthsTotal: 1, monthsDone: totalDone, label: 'Lichess' });

  return 1; // one streamed window
};

// ── "My games" / scouting entry ──────────────────────────────────────────────────

// Unified-style entry, kept symmetric with chesscom.importRecentGames so the
// next task can wire either platform through the same shape.
export function importLichessGames(username: string, opts: ImportOptions = {}): Promise<ImportResult> {
  return runImport('lichess', fetchLichess, username, opts);
}
