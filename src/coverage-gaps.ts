// Coverage gaps — the opponent replies your repertoire has no answer to.
//
// A GAP is one thing, precisely: a position in your saved lines where it is the
// OPPONENT's move, a reply exists that matters, and none of your lines answers
// it. Everything else in this file exists to keep that list SHORT and HONEST,
// which is the whole difficulty. Every repertoire has infinite gaps at
// sufficient depth; an unbounded list of them reads as failure and makes people
// feel worse about work they actually did. So a reply only becomes a gap once it
// clears a floor, and the list is capped several ways over.
//
// PURE BY CONSTRUCTION. Lines, games, scouted opponents and the explorer's
// numbers all come in as plain data — the explorer's as an ALREADY-FETCHED map,
// never as a fetch — so the whole thing runs under Node in
// coverage-gaps.selftest.ts with no DOM, no IndexedDB and no network. The
// fetching, its budget and its caching live in coverage-data.ts; this file only
// does the arithmetic. chess.js is the one import that does any work, and it is
// the same replay the scouting maps already do.
//
// NOTHING HERE IS STORED. It is derived from the lines, the games and the
// scouts, and it is recomputed. No new record, no field on Line, nothing in the
// synced payload.
//
// THE ORDER OF THE SOURCES IS THE APP'S ESTABLISHED ONE (explore-panel.ts): your
// games first, then the library, then the scouts. A move you have actually faced
// beats a move a database says is popular, every time.

import { Chess } from 'chess.js';
import type { Line } from './types';
import type { MoveNode } from './tree';
import type { ImportedGame } from './import-core';
import { positionKey } from './position-index';
import { openingFamily, UNKNOWN_FAMILY } from './analysis';
import { nameForFen } from './openings';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// ── The floors, and why each one is where it is ──────────────────────────────
//
// These numbers ARE the feature. Read them before changing anything else here.

/**
 * How deep a gap can be, in half-moves. Past six full moves you are preparing a
 * middlegame rather than a reply, and the count of opponent-to-move positions
 * (and therefore of explorer requests) grows with every ply allowed.
 */
export const MAX_GAP_PLIES = 12;

/**
 * Your own games: a reply must have been faced at least twice. Once is an
 * accident; twice is a thing that happens to you.
 */
export const MIN_FACED_GAMES = 2;

/**
 * The rating band: a reply must be played at least this share of the games at
 * the position. Eight percent clears noise while still catching a genuine
 * sideline — a real opening position has three to six live replies, so anything
 * meaningful sits well above this.
 */
export const MIN_BAND_SHARE_PCT = 8;

/**
 * …and the position needs this many games behind it before a share means
 * anything at all. Without this floor, one game out of three reads as "33% at
 * your level", which is a lie with a percentage sign on it. This is the more
 * important half of the rule.
 */
export const MIN_BAND_GAMES = 50;

/**
 * A scouted opponent must have played the reply at least twice, for the same
 * reason your own games need two: one is a fluke, two is a habit.
 */
export const MIN_SCOUT_GAMES = 2;

/**
 * At most this many gaps from any ONE position. A single fork where six replies
 * are unanswered would otherwise own the entire list, and the second-worst
 * position would never be seen.
 */
export const MAX_GAPS_PER_POSITION = 2;

/** How many gaps the list shows before it stops being a list and starts being
 * a backlog. Twelve fits a phone scroll and is well past what anyone closes in
 * one sitting. (There used to be a second, smaller cap for an inline copy of
 * this block in the builder; that copy is gone, and so is the cap.) */
export const MAX_GAPS = 12;

// ── Shapes ───────────────────────────────────────────────────────────────────

/** A position in your tree where it is the opponent's move. */
export interface OpponentSpot {
  /** The shared position key — two lines that transpose make ONE spot. */
  key: string;
  fen: string;
  /** The moves that reach this position, from the start. */
  ucis: string[];
  sans: string[];
  /** Half-moves deep (= ucis.length). */
  ply: number;
  /** Opponent replies your lines already answer, by uci. */
  prepared: Set<string>;
  /** Which of your lines pass through here. */
  lineIds: Set<string>;
  /** Best opening name known for this position, for the family roll-up. */
  opening: string | null;
}

/** The explorer's answer for one position, already fetched. */
export interface ExplorerReplies {
  /** uci → how many games at this position continued with it. */
  games: Map<string, number>;
  /** Total games across every listed reply — the denominator of a share. */
  total: number;
  /**
   * What those numbers ACTUALLY describe, straight from explorer-resolve.ts. A
   * row may only claim "at your level" when this says 'band'; a bundled
   * fallback is all-ratings and says so. Never inferred from the preference.
   */
  coverage: 'band' | 'all';
}

/** A scouted opponent, as this module needs them. */
export interface ScoutedOpponent {
  name: string;
  games: ImportedGame[];
}

/** Everything the ranking knows that isn't in the saved lines. */
export interface GapEvidence {
  /** Your imported games. Filtered to the colour in question internally. */
  games?: ImportedGame[];
  /** Scouted opponents, with their games stored from THEIR perspective. */
  opponents?: ScoutedOpponent[];
  /** positionKey → the explorer's replies there, for the positions we asked. */
  explorer?: Map<string, ExplorerReplies>;
}

/** Which source put a reply on the list — the app's established priority. */
export type GapSource = 'games' | 'library' | 'scout';

export interface Gap {
  /** Stable identity: the position and the move. */
  id: string;
  key: string;
  fen: string;
  /** The moves reaching the position (the reply itself is `uci`). */
  ucis: string[];
  sans: string[];
  uci: string;
  san: string;
  ply: number;
  colour: 'white' | 'black';   // the colour whose repertoire has the hole
  family: string;
  /** The source that ranked it, and the one short line that explains it. */
  source: GapSource;
  reason: string;
  /** The magnitude behind the reason: games faced, share %, or their games. */
  weight: number;
  /** Present only on a scout row — the Prepare tag to stamp. */
  opponentName?: string;
  /** How many of your lines pass through the position it sits at. */
  lineCount: number;
}

/** One opening family, as a positive figure. */
export interface FamilyCoverage {
  family: string;
  /** Replies at this family's positions that clear a floor. */
  notable: number;
  /** …of which you have an answer. */
  answered: number;
  /** notable ? answered/notable : 100 — nothing to answer means nothing owed. */
  pct: number;
  gaps: number;
}

export interface CoverageReport {
  colour: 'white' | 'black';
  gaps: Gap[];
  /** How many cleared the floors before the list cap trimmed it. */
  totalGaps: number;
  families: FamilyCoverage[];
  /** Opponent-to-move positions examined (after the depth cap). */
  positions: number;
  /** Overall: answered / notable across every family. */
  answered: number;
  notable: number;
  pct: number;
}

// ── Pass 1: where is it the opponent's move? ─────────────────────────────────

/**
 * Every position in these lines where it is the OPPONENT's move, deduped by
 * position key — so two lines that transpose meet on one spot and their
 * prepared answers merge. A reply answered in either line counts as answered.
 *
 * Walks the WHOLE tree (every child, not only the mainline): a saved line may
 * legitimately branch, and a branch is prep, not decoration.
 *
 * Positions with NOTHING prepared are dropped. A line that simply ENDS is a
 * stopping point you chose, not a hole — counting its every continuation would
 * add three to five "gaps" per line ending and turn the list into the wall of
 * failure this feature exists to avoid. A gap is where you started answering
 * and missed one.
 */
export function opponentSpots(
  lines: Line[],
  colour: 'white' | 'black',
  maxPlies: number = MAX_GAP_PLIES,
): OpponentSpot[] {
  const byKey = new Map<string, OpponentSpot>();

  const walk = (line: Line, node: MoveNode, fen: string, ucis: string[], sans: string[]): void => {
    const ply = ucis.length;
    // Whose move is it here? White's moves are the even plies, black's the odd
    // — the same parity rule position-index.ts uses for isUserMove.
    const userToMove = colour === 'white' ? ply % 2 === 0 : ply % 2 === 1;
    if (!userToMove && ply <= maxPlies && node.children.length > 0) {
      const key = positionKey(fen);
      let spot = byKey.get(key);
      if (!spot) {
        spot = {
          key,
          fen,
          ucis: [...ucis],
          sans: [...sans],
          ply,
          prepared: new Set<string>(),
          lineIds: new Set<string>(),
          opening: nameForFen(fen) ?? line.openingName,
        };
        byKey.set(key, spot);
      }
      for (const child of node.children) spot.prepared.add(child.uci);
      spot.lineIds.add(line.id);
    }
    if (ply >= maxPlies) return;
    for (const child of node.children) {
      ucis.push(child.uci);
      sans.push(child.san);
      walk(line, child, child.fen, ucis, sans);
      ucis.pop();
      sans.pop();
    }
  };

  for (const line of lines) {
    if (line.colour !== colour) continue;
    // A root node carries the start position (tree.ts), which is where a Black
    // repertoire's first opponent move sits. Old data may have left it blank.
    walk(line, line.tree, line.tree.fen || START_FEN, [], []);
  }

  return [...byKey.values()].sort((a, b) => a.ply - b.ply || a.key.localeCompare(b.key));
}

// ── Pass 2: what could they play here? ───────────────────────────────────────

interface Candidate {
  uci: string;
  faced: number;                // your games
  sharePct: number;             // the explorer, at whatever coverage it has
  bandTotal: number;
  coverage: 'band' | 'all';
  scouts: Array<{ name: string; games: number }>;
}

/**
 * Every reply the three sources know about at one spot, whether or not it is
 * already prepared. The caller subtracts the prepared ones; the coverage figure
 * needs both halves, which is why this doesn't subtract them itself.
 */
export function repliesAt(
  spot: OpponentSpot,
  evidence: GapEvidence,
  gameIndex?: PositionReplyIndex,
  scoutIndex?: ScoutIndex,
): Map<string, Candidate> {
  const out = new Map<string, Candidate>();
  const get = (uci: string): Candidate => {
    let c = out.get(uci);
    if (!c) {
      c = { uci, faced: 0, sharePct: 0, bandTotal: 0, coverage: 'all', scouts: [] };
      out.set(uci, c);
    }
    return c;
  };

  // 1. Your games — what you have actually faced from here.
  for (const [uci, games] of gameIndex?.get(spot.key) ?? []) get(uci).faced = games;

  // 2. The explorer, at your band wherever we managed to ask.
  const exp = evidence.explorer?.get(spot.key);
  if (exp && exp.total > 0) {
    for (const [uci, games] of exp.games) {
      const c = get(uci);
      c.sharePct = Math.round((100 * games) / exp.total);
      c.bandTotal = exp.total;
      c.coverage = exp.coverage;
    }
  }

  // 3. The scouts — a named opponent you chose to prepare against.
  for (const scout of scoutIndex?.get(spot.key) ?? []) {
    get(scout.uci).scouts.push({ name: scout.name, games: scout.games });
  }

  return out;
}

// Does this candidate clear ANY floor? Each source has its own, and they are
// deliberately not blended into a score — a floor you can explain in one line is
// the whole point, and "it scored 0.61 overall" explains nothing.
function clearsFloor(c: Candidate): boolean {
  if (c.faced >= MIN_FACED_GAMES) return true;
  if (c.bandTotal >= MIN_BAND_GAMES && c.sharePct >= MIN_BAND_SHARE_PCT) return true;
  return c.scouts.some(s => s.games >= MIN_SCOUT_GAMES);
}

interface Reason {
  source: GapSource;
  reason: string;
  weight: number;
  opponentName?: string;
}

// The reason a row is on the list, and the tier that ranks it. The order — your
// games, then the library, then the scouts — is explore-panel.ts's, and rests on
// the same principle: what you actually faced beats what a database says is
// popular.
function reasonFor(c: Candidate): Reason | null {
  if (c.faced >= MIN_FACED_GAMES) {
    return { source: 'games', reason: `faced ${c.faced} times`, weight: c.faced };
  }
  if (c.bandTotal >= MIN_BAND_GAMES && c.sharePct >= MIN_BAND_SHARE_PCT) {
    // `coverage` decides the wording, never the preference: numbers that fell
    // back to the bundled set are all-ratings and have to say so.
    const reason = c.coverage === 'band'
      ? `played ${c.sharePct}% at your level`
      : `played ${c.sharePct}% of the time here`;
    return { source: 'library', reason, weight: c.sharePct };
  }
  const scout = [...c.scouts].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name))[0];
  if (scout && scout.games >= MIN_SCOUT_GAMES) {
    return {
      source: 'scout',
      reason: `${scout.name} plays this`,
      weight: scout.games,
      opponentName: scout.name,
    };
  }
  return null;
}

// ── Pass 3: the report ───────────────────────────────────────────────────────

const SOURCE_RANK: Record<GapSource, number> = { games: 0, library: 1, scout: 2 };

/** The whole thing: spots, candidates, floors, caps, families. */
export function buildCoverageReport(
  lines: Line[],
  colour: 'white' | 'black',
  evidence: GapEvidence = {},
  opts: { maxPlies?: number; limit?: number } = {},
): CoverageReport {
  const maxPlies = opts.maxPlies ?? MAX_GAP_PLIES;
  const limit = opts.limit ?? MAX_GAPS;
  const spots = opponentSpots(lines, colour, maxPlies);
  const gameIndex = evidence.games
    ? gameReplyIndex(evidence.games.filter(g => g.colour === colour), maxPlies)
    : undefined;
  const scoutIndex = evidence.opponents ? scoutReplyIndex(evidence.opponents, colour, maxPlies) : undefined;

  const all: Gap[] = [];
  const families = new Map<string, FamilyCoverage>();

  for (const spot of spots) {
    const family = openingFamily(spot.opening);
    let fam = families.get(family);
    if (!fam) {
      fam = { family, notable: 0, answered: 0, pct: 100, gaps: 0 };
      families.set(family, fam);
    }

    const candidates = repliesAt(spot, evidence, gameIndex, scoutIndex);
    const here: Gap[] = [];
    for (const c of candidates.values()) {
      if (!clearsFloor(c)) continue;
      fam.notable++;
      if (spot.prepared.has(c.uci)) { fam.answered++; continue; }
      const why = reasonFor(c);
      if (!why) continue;
      const san = sanAt(spot.fen, c.uci);
      if (!san) continue;   // not legal here — stale data, dropped silently
      here.push({
        id: `${spot.key}|${c.uci}`,
        key: spot.key,
        fen: spot.fen,
        ucis: [...spot.ucis],
        sans: [...spot.sans],
        uci: c.uci,
        san,
        ply: spot.ply,
        colour,
        family,
        source: why.source,
        reason: why.reason,
        weight: why.weight,
        ...(why.opponentName ? { opponentName: why.opponentName } : {}),
        lineCount: spot.lineIds.size,
      });
    }

    // One position may not own the list.
    here.sort(compareGaps);
    const kept = here.slice(0, MAX_GAPS_PER_POSITION);
    fam.gaps += kept.length;
    all.push(...kept);
  }

  all.sort(compareGaps);

  let answered = 0;
  let notable = 0;
  for (const fam of families.values()) {
    fam.pct = fam.notable === 0 ? 100 : Math.round((100 * fam.answered) / fam.notable);
    answered += fam.answered;
    notable += fam.notable;
  }

  const familyList = [...families.values()]
    // A family with nothing notable in it has nothing to say.
    .filter(f => f.notable > 0)
    // Most work first, then least covered — the families with real prep behind
    // them lead, which is what makes the block read as progress.
    .sort((a, b) => b.notable - a.notable || a.pct - b.pct || a.family.localeCompare(b.family));

  return {
    colour,
    gaps: all.slice(0, limit),
    totalGaps: all.length,
    families: familyList,
    positions: spots.length,
    answered,
    notable,
    pct: notable === 0 ? 100 : Math.round((100 * answered) / notable),
  };
}

// Tier first (games → library → scout), then the magnitude behind the reason,
// then shallower (a gap at move three matters more than one at move six), then
// the move letters so the order is stable.
function compareGaps(a: Gap, b: Gap): number {
  return SOURCE_RANK[a.source] - SOURCE_RANK[b.source]
    || b.weight - a.weight
    || a.ply - b.ply
    || a.san.localeCompare(b.san);
}

// ── Games, indexed by POSITION ───────────────────────────────────────────────

/** positionKey → (uci → how many games continued that way from here). */
export type PositionReplyIndex = Map<string, Map<string, number>>;

/** positionKey → each scouted opponent's replies there. */
export type ScoutIndex = Map<string, Array<{ name: string; uci: string; games: number }>>;

/**
 * Replay each game's opening and file every move under the POSITION it was
 * played from — not under its path. That is what lets a game that transposes
 * into one of your repertoire positions still count there, which is the same
 * reason the position index exists at all.
 *
 * Bounded by maxPlies (12), so this is a twelfth of the replay the scouting maps
 * already do over the same games at 60 plies.
 */
export function gameReplyIndex(games: ImportedGame[], maxPlies: number = MAX_GAP_PLIES): PositionReplyIndex {
  const out: PositionReplyIndex = new Map();
  for (const g of games) {
    const chess = new Chess();
    const plies = Math.min(g.ucis.length, maxPlies + 1);
    for (let i = 0; i < plies; i++) {
      const key = positionKey(chess.fen());
      let bucket = out.get(key);
      if (!bucket) { bucket = new Map(); out.set(key, bucket); }
      const uci = g.ucis[i];
      bucket.set(uci, (bucket.get(uci) ?? 0) + 1);
      try {
        const moved = chess.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: (uci[4] as 'q' | 'r' | 'b' | 'n') || 'q',
        });
        if (!moved) break;
      } catch {
        break;   // a malformed move ends this game's contribution early
      }
    }
  }
  return out;
}

/**
 * The same, per scouted opponent, over the games they played as the colour that
 * faces you — their games are stored from THEIR perspective (they were "me" at
 * import), so their side is the opposite of yours.
 */
export function scoutReplyIndex(
  opponents: ScoutedOpponent[],
  colour: 'white' | 'black',
  maxPlies: number = MAX_GAP_PLIES,
): ScoutIndex {
  const theirColour: 'white' | 'black' = colour === 'white' ? 'black' : 'white';
  const out: ScoutIndex = new Map();
  for (const opp of opponents) {
    const index = gameReplyIndex(opp.games.filter(g => g.colour === theirColour), maxPlies);
    for (const [key, replies] of index) {
      let bucket = out.get(key);
      if (!bucket) { bucket = []; out.set(key, bucket); }
      for (const [uci, games] of replies) bucket.push({ name: opp.name, uci, games });
    }
  }
  return out;
}

// The SAN for a uci at a position, or null when it isn't legal there. One board
// per call — a gap list is a dozen rows, not a hot loop.
export function sanAt(fen: string, uci: string): string | null {
  try {
    const chess = new Chess(fen);
    const m = chess.move({
      from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined,
    });
    return m ? m.san : null;
  } catch {
    return null;
  }
}

/** The family label for an unnamed position — exported so the UI matches. */
export const UNKNOWN_OPENING = UNKNOWN_FAMILY;
