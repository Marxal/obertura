// Remote deep analysis via chess-api.com — a free public Stockfish service with
// CORS enabled, so the app can call it straight from the browser. Unlike the
// Lichess cloud (a cache that only knows book positions), this computes any
// position on demand at depth 18 — deeper than the on-device fallback (12) and
// much faster than a phone can search, which is exactly what a game review
// wants once a game leaves theory.
//
// Strictly opt-in (Settings → "Deeper reviews online", default OFF): every
// request sends the position to a third-party service, and the service's
// availability isn't ours to promise. Callers treat it as a middle tier —
// Lichess cloud first, this when enabled, on-device Stockfish as the floor —
// and any failure here just falls through to the next tier.

import { Chess } from 'chess.js';
import type { MoveEval } from './engine';
import { resolveUci } from './engine';
import { getUseRemoteEngine } from './prefs';

const API_URL = 'https://chess-api.com/v1';
// The service caps depth at 18 and per-request thinking time at 100 ms.
const REMOTE_DEPTH = 18;
const REMOTE_VARIANTS = 3;
const REMOTE_THINK_MS = 100;
// The server thinks ≤100 ms; the rest is network + queueing. A miss costs the
// whole timeout before the local fallback starts, so don't let it linger.
const FETCH_TIMEOUT_MS = 5000;

// Circuit breaker, same shape as the Lichess one in engine.ts: after repeated
// failures stop asking for a cooldown so a batch review degrades to the local
// engine once, instead of burning a timeout on every remaining position.
const FAIL_STREAK = 3;
const COOLDOWN_MS = 60_000;
const LIMITED_COOLDOWN_MS = 90_000;
let failStreak = 0;
let blockedUntil = 0;

function remoteOpen(): boolean {
  return Date.now() >= blockedUntil;
}

function noteFailure(status?: number): void {
  if (status === 429) {
    blockedUntil = Date.now() + LIMITED_COOLDOWN_MS;
    failStreak = 0;
    return;
  }
  failStreak++;
  if (failStreak >= FAIL_STREAK) {
    blockedUntil = Date.now() + COOLDOWN_MS;
    failStreak = 0;
  }
}

// The Settings toggle, read at call time. try/catch so headless self-tests
// (node, no localStorage) that import a caller of this module never crash —
// they just see the feature off.
export function remoteEngineEnabled(): boolean {
  try {
    return getUseRemoteEngine();
  } catch {
    return false;
  }
}

// One variant in a chess-api.com response. Field notes (from their docs):
//   eval        — pawns, WHITE-perspective (negative = Black better)
//   centipawns  — same value in centipawns (string)
//   mate        — moves to mate, WHITE-perspective (negative = Black mates);
//                 null when no forced mate
//   move        — the move as UCI; san — the same move as SAN
//   continuationArr — the following moves of the line, as SAN
interface ApiVariant {
  eval?: number;
  centipawns?: string | number;
  mate?: number | null;
  move?: string;
  san?: string;
  continuationArr?: string[];
  depth?: number;
}

// Validate a SAN continuation by replaying it, so a malformed line from the
// service can't put nonsense in the move list. Display-only, capped like the
// other engines' PVs.
const PV_DISPLAY_PLIES = 8;

function checkedSanLine(fen: string, first: string, cont: string[]): string[] {
  const out = [first];
  try {
    const ch = new Chess(fen);
    ch.move(first);
    for (const san of cont) {
      if (out.length >= PV_DISPLAY_PLIES) break;
      ch.move(san); // throws on the first move that doesn't apply
      out.push(san);
    }
  } catch {
    /* keep what replayed */
  }
  return out;
}

function toMoveEval(fen: string, v: ApiVariant): MoveEval | null {
  if (typeof v.move !== 'string' || !v.move) return null;
  const r = resolveUci(fen, v.move);
  if (!r) return null; // a move that isn't legal here — don't trust the entry

  const mate = typeof v.mate === 'number' && v.mate !== 0 ? v.mate : undefined;
  let cp: number | undefined;
  const cpRaw =
    typeof v.centipawns === 'string' ? parseInt(v.centipawns, 10) :
    typeof v.centipawns === 'number' ? v.centipawns : NaN;
  if (Number.isFinite(cpRaw)) cp = Math.round(cpRaw);
  else if (typeof v.eval === 'number' && Number.isFinite(v.eval)) cp = Math.round(v.eval * 100);
  if (cp === undefined && mate === undefined) return null;

  const cont = Array.isArray(v.continuationArr)
    ? v.continuationArr.filter((s): s is string => typeof s === 'string')
    : [];
  return {
    uci: r.uci,
    san: r.san,
    cp: mate !== undefined ? undefined : cp,
    mate,
    sanLine: checkedSanLine(fen, r.san, cont),
  };
}

// Order variants best-first for the side to move (a mate beats any cp; a nearer
// mate beats a farther one). The service should already send them ordered, but
// callers treat index 0 as "the best move", so don't leave that to trust.
function moverScore(fen: string, m: MoveEval): number {
  const white = fen.split(' ')[1] === 'w';
  const s = m.mate !== undefined
    ? (m.mate > 0 ? 100000 - m.mate : -100000 - m.mate)
    : (m.cp ?? 0);
  return white ? s : -s;
}

// Top lines for a position as WHITE-perspective MoveEval[] — the same contract
// as engine.ts's cloudTopLines, so callers can slot it into the same fallback
// chain. Null on any failure, a breaker-held request, or the toggle being off.
export async function remoteTopLines(fen: string): Promise<MoveEval[] | null> {
  if (!remoteEngineEnabled() || !remoteOpen()) return null;
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fen,
        variants: REMOTE_VARIANTS,
        depth: REMOTE_DEPTH,
        maxThinkingTime: REMOTE_THINK_MS,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      noteFailure(res.status);
      return null;
    }
    const raw: unknown = await res.json();
    failStreak = 0;

    // The REST endpoint answers a single object for the best line; be ready for
    // an array (or a wrapped array) in case multiple variants come back that way.
    const variants: ApiVariant[] = Array.isArray(raw)
      ? raw as ApiVariant[]
      : raw && typeof raw === 'object' && Array.isArray((raw as { variants?: unknown }).variants)
        ? (raw as { variants: ApiVariant[] }).variants
        : raw && typeof raw === 'object'
          ? [raw as ApiVariant]
          : [];

    const moves = variants
      .flatMap(v => {
        const m = toMoveEval(fen, v);
        return m ? [m] : [];
      })
      .sort((a, b) => moverScore(fen, b) - moverScore(fen, a));
    // Answered but unusable is the service's honest "no" — not a failure.
    return moves.length ? moves : null;
  } catch {
    noteFailure(); // network error or timeout
    return null;
  }
}
