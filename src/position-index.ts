// A map of the WHOLE repertoire by position, answering one question:
//
//   "which of my lines pass through this position, and what does each play there?"
//
// Everything else in this file is a shape of that answer — duplicate detection
// for the save button, transposition finding, and the sibling answers a drill
// needs to offer a divert. See TRANSPOSITIONS.md at the repo root for the
// decisions these helpers exist to serve.
//
// Pure by construction: buildPositionIndex() takes plain Lines and returns a
// self-contained object, so the whole thing is exercised under Node by
// position-index.selftest.ts with no DOM, no IndexedDB and no board. The cached,
// app-facing half (positionIndex / holdPositionIndex) sits at the bottom and is
// the only part that touches storage.

import type { Line } from './types';
import type { MoveNode } from './tree';
import { epdKey } from './openings';
import { getAllLines, onLinesChanged } from './storage';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// ── The position key ─────────────────────────────────────────────────────────
//
// The SAME key openings.ts already uses (openings-data.json is built on it), so
// there is exactly one position convention in this app: the first four FEN
// fields — board, side to move, castling rights, en passant — dropping the
// halfmove clock and fullmove number, which describe the journey rather than the
// position and would stop every genuine transposition matching.
//
// EN PASSANT, verified against chess.js 1.4.0 rather than assumed: it writes the
// en-passant square ONLY when an en-passant capture is actually legal there. It
// leaves the field as "-" after a double-step with no enemy pawn beside the
// arriving pawn, and also after one where the capture exists but is illegal (a
// rook pinning both pawns along the rank) — it even strips a bogus square out of
// a FEN handed to it. So the raw field is already the "is it really available?"
// answer and needs no normalisation, exactly as the comment in openings.ts says.
// This module reuses epdKey rather than copying it so the two cannot drift.
export const positionKey = epdKey;

// ── Entries ──────────────────────────────────────────────────────────────────

/**
 * One line's answer at one position. The key it is filed under is the position
 * the move is played FROM; `node` is the node the move arrives at, which is
 * where the review record lives.
 */
export interface PositionEntry {
  lineId: string;
  lineName: string;
  colour: 'white' | 'black';
  san: string;
  uci: string;
  inTraining: boolean;
  /** 1-based half-move number of this move within its line. */
  ply: number;
  /**
   * True when this is a move the USER plays (and therefore the only kind that
   * carries a review record). Same parity rule as scheduler.userMoveNodes:
   * white's moves are the even plies, black's the odd ones.
   */
  isUserMove: boolean;
  node: MoveNode;
}

/** What the index remembers about a line as a whole. */
export interface IndexedLine {
  id: string;
  name: string;
  colour: 'white' | 'black';
  inTraining: boolean;
  /** Mainline moves in order. */
  ucis: string[];
  /**
   * Position keys along the line, `ucis.length + 1` of them: keys[0] is the
   * start position, keys[i] is the position after the i-th move.
   */
  keys: string[];
}

/** How a line relates to another line that overlaps it. */
export type DuplicateRelation =
  | 'identical'          // same colour, same moves, start to finish
  | 'extension-longer'   // this line continues past the other one
  | 'extension-shorter'  // the other line continues past this one
  | 'divergent';         // shared opening moves, then they part

export interface DuplicateVerdict {
  relation: DuplicateRelation;
  otherLineId: string;
  otherLineName: string;
  /** How many opening half-moves the two lines share. */
  sharedPlies: number;
}

export interface Transposition {
  /** The shared position key. */
  key: string;
  /** Full FEN of the position as THIS line reaches it. */
  fen: string;
  /** Half-moves this line takes to get there (0 = the start position). */
  ply: number;
  otherLineId: string;
  otherLineName: string;
  /** Half-moves the other line takes to get to the same position. */
  otherPly: number;
  /** What the other line plays there. */
  san: string;
  uci: string;
  otherInTraining: boolean;
  /** True when the other line's move there is one its user plays. */
  otherIsUserMove: boolean;
}

// ── Building ─────────────────────────────────────────────────────────────────

// Training walks the mainline (the children[0] chain) and so does this — a saved
// line IS its mainline everywhere else in the app (see the note in tree.ts about
// hidden dead branches on old data).
function mainlineNodes(tree: MoveNode): MoveNode[] {
  const out: MoveNode[] = [];
  let node = tree.children[0];
  while (node) {
    out.push(node);
    node = node.children[0];
  }
  return out;
}

export class PositionIndex {
  /** positionKey → every line's move from that position, in build order. */
  readonly byPosition = new Map<string, PositionEntry[]>();
  /** lineId → its moves and the positions it passes through. */
  readonly lines = new Map<string, IndexedLine>();
  entryCount = 0;
  readonly builtAt = Date.now();

  /**
   * Every line's move from this position. `fen` may be a full FEN or a bare
   * position key — both are reduced the same way.
   */
  entriesAt(fen: string): PositionEntry[] {
    return this.byPosition.get(positionKey(fen)) ?? [];
  }

  /**
   * How this line overlaps the closest other line, or null when it stands
   * alone. Identity is MOVES PLUS COLOUR: the name and tags are deliberately
   * not part of it, so re-saving the same moves under a new name is still a
   * duplicate (that is what makes "add the tag to the existing line" possible —
   * see TRANSPOSITIONS.md).
   *
   * Works on an unsaved line too: matching is by id, so a line not yet in the
   * index simply never matches itself.
   *
   * Verdicts rank identical > extension > divergent; among equals the longer
   * shared prefix wins, then the lowest line id, so the answer is stable.
   */
  duplicatesOf(line: Line): DuplicateVerdict | null {
    const ucis = mainlineNodes(line.tree).map(n => n.uci);
    if (ucis.length === 0) return null;

    // Any overlap at all has to start at move one, so the lines that open with
    // the same move are the only candidates — that is a single lookup rather
    // than a scan of the repertoire.
    const candidates = new Set<string>();
    for (const e of this.entriesAt(START_FEN)) {
      if (e.uci === ucis[0] && e.colour === line.colour && e.lineId !== line.id) {
        candidates.add(e.lineId);
      }
    }

    let best: DuplicateVerdict | null = null;
    for (const id of candidates) {
      const other = this.lines.get(id);
      if (!other) continue;
      const verdict = compare(ucis, other);
      if (verdict && (!best || betterVerdict(verdict, best))) best = verdict;
    }
    return best;
  }

  /**
   * Positions this line shares with another line that gets there BY A DIFFERENT
   * MOVE ORDER. A shared opening prefix is not a transposition — the two lines
   * have simply not parted yet — so a match only counts when the move sequences
   * arriving at the position differ.
   *
   * Walks every position the line passes through, its final one included, so
   * "my line ends where another line is still going" is reported. The mirror
   * case (their end meets my middle) is found by asking from their side; the
   * relation is symmetric, the reporting is not.
   *
   * Same colour only. The two repertoires are separate books — a position that
   * turns up in both is not a transposition anyone can act on, since the move
   * recorded there belongs to the opponent in one of them.
   *
   * Pure with respect to the argument: the line's own path is computed from its
   * tree, so this answers for an unsaved line as well.
   */
  transpositionsFor(line: Line): Transposition[] {
    const nodes = mainlineNodes(line.tree);
    const ucis = nodes.map(n => n.uci);
    const fens = [START_FEN, ...nodes.map(n => n.fen)];

    const out: Transposition[] = [];
    const seen = new Set<string>();

    for (let ply = 0; ply < fens.length; ply++) {
      const key = positionKey(fens[ply]);
      for (const e of this.byPosition.get(key) ?? []) {
        if (e.lineId === line.id || e.colour !== line.colour) continue;
        const other = this.lines.get(e.lineId);
        if (!other) continue;
        // The entry sits at the position BEFORE its move, so the other line
        // took ply e.ply - 1 half-moves to arrive here.
        const otherPly = e.ply - 1;
        if (sameSequence(ucis, ply, other.ucis, otherPly)) continue; // same road
        const dedupe = `${e.lineId}:${key}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        out.push({
          key,
          fen: fens[ply],
          ply,
          otherLineId: other.id,
          otherLineName: other.name,
          otherPly,
          san: e.san,
          uci: e.uci,
          otherInTraining: e.inTraining,
          otherIsUserMove: e.isUserMove,
        });
      }
    }
    return out;
  }

  /**
   * What OTHER lines play from this position — the answers a drill can offer as
   * a divert, and the moves a write-through credits alongside the one just
   * drilled.
   *
   * User moves only. An opponent move carries no review record, so it is
   * neither an answer the user could give nor something training can credit.
   * In-training lines sort first, since only they can be diverted into.
   */
  siblingAnswers(fen: string, excludeLineId: string): PositionEntry[] {
    return this.entriesAt(fen)
      .filter(e => e.lineId !== excludeLineId && e.isUserMove)
      .sort((a, b) => Number(b.inTraining) - Number(a.inTraining));
  }
}

/**
 * Walk every line once and file each of its moves under the position it is
 * played from. O(total moves); nothing is copied — entries hold a reference to
 * the live MoveNode, which is what lets a caller credit a review record through
 * the index.
 */
export function buildPositionIndex(lines: Line[]): PositionIndex {
  const index = new PositionIndex();

  for (const line of lines) {
    const nodes = mainlineNodes(line.tree);
    const ucis: string[] = [];
    const keys: string[] = [positionKey(START_FEN)];

    let fromFen = START_FEN;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const key = positionKey(fromFen);
      const entry: PositionEntry = {
        lineId: line.id,
        lineName: line.name,
        colour: line.colour,
        san: node.san,
        uci: node.uci,
        inTraining: line.inTraining,
        ply: i + 1,
        isUserMove: line.colour === 'white' ? i % 2 === 0 : i % 2 === 1,
        node,
      };
      const bucket = index.byPosition.get(key);
      if (bucket) bucket.push(entry);
      else index.byPosition.set(key, [entry]);
      index.entryCount++;

      ucis.push(node.uci);
      keys.push(positionKey(node.fen));
      fromFen = node.fen;
    }

    index.lines.set(line.id, {
      id: line.id,
      name: line.name,
      colour: line.colour,
      inTraining: line.inTraining,
      ucis,
      keys,
    });
  }

  return index;
}

// ── Comparison helpers ───────────────────────────────────────────────────────

// Do two lines reach a position by the same road? True when the half-move
// counts match AND every move along the way matches.
function sameSequence(a: string[], aPly: number, b: string[], bPly: number): boolean {
  if (aPly !== bPly) return false;
  for (let i = 0; i < aPly; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sharedPrefix(a: string[], b: string[]): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

// Relate one move sequence to an indexed line. Colour is checked by the caller.
function compare(ucis: string[], other: IndexedLine): DuplicateVerdict | null {
  const shared = sharedPrefix(ucis, other.ucis);
  if (shared === 0) return null;
  const base = { otherLineId: other.id, otherLineName: other.name, sharedPlies: shared };
  if (shared === ucis.length && shared === other.ucis.length) {
    return { relation: 'identical', ...base };
  }
  if (shared === other.ucis.length) return { relation: 'extension-longer', ...base };
  if (shared === ucis.length) return { relation: 'extension-shorter', ...base };
  return { relation: 'divergent', ...base };
}

const RELATION_RANK: Record<DuplicateRelation, number> = {
  identical: 0,
  'extension-longer': 1,
  'extension-shorter': 1,
  divergent: 2,
};

function betterVerdict(a: DuplicateVerdict, b: DuplicateVerdict): boolean {
  const ra = RELATION_RANK[a.relation];
  const rb = RELATION_RANK[b.relation];
  if (ra !== rb) return ra < rb;
  if (a.sharedPlies !== b.sharedPlies) return a.sharedPlies > b.sharedPlies;
  return a.otherLineId < b.otherLineId;
}

// ── The cached, app-facing index ─────────────────────────────────────────────
//
// Lazy on purpose. onLinesChanged only marks the index stale; the rebuild
// happens on the next read, so a burst of saves (a restore, a starter pack, an
// account sync) costs one rebuild rather than one per line, and a session that
// never asks a position question never pays for one at all.

let cached: PositionIndex | null = null;
let stale = true;
let holds = 0;
let subscribed = false;

function subscribe(): void {
  if (subscribed) return;
  subscribed = true;
  onLinesChanged(() => { stale = true; });
}

/**
 * The current index, rebuilt from storage if the repertoire changed since the
 * last read. Cheap when nothing changed — it hands back the same object.
 */
export async function positionIndex(): Promise<PositionIndex> {
  subscribe();
  // A hold freezes the snapshot (see holdPositionIndex), but it can't conjure
  // one: if nothing is built yet we still have to build.
  if (cached && (!stale || holds > 0)) return cached;
  cached = buildPositionIndex(await getAllLines());
  stale = false;
  return cached;
}

/**
 * Freeze the index for the duration of a drill, returning the release function:
 *
 *   const release = holdPositionIndex();
 *   try { ...drill... } finally { release(); }
 *
 * NOTHING CALLS THIS. It was built for a drill that held live index nodes and
 * wrote review records back through them, where rebuilding underneath would
 * swap those nodes out mid-session. TRANSPOSITIONS.md §8 abandoned that design:
 * write-through re-reads each line from storage, so no drill needs a hold, and
 * a stale entry is skipped rather than overwritten.
 *
 * Kept because it is correct and costs nothing while unused. Read §8 before
 * reaching for it — the reason it isn't needed is probably still the reason.
 * Writes during a hold still mark the index stale, so the first read after the
 * last hold is released rebuilds.
 */
export function holdPositionIndex(): () => void {
  holds++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds--;
  };
}

/** True while a drill (or anything else) is holding the index frozen. */
export function positionIndexHeld(): boolean {
  return holds > 0;
}

/** Drop the cached index. Currently uncalled — see the note on holdPositionIndex. */
export function resetPositionIndex(): void {
  cached = null;
  stale = true;
}
