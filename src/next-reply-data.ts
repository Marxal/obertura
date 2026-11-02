// The impure half of "Your next reply": reading the device, and saving an answer.
//
// THIS NEVER ASKS THE NETWORK. Coverage may spend live explorer requests because
// you opened it to look; Home is the screen everybody lands on. It uses your games,
// your scouts and the bundled statistics, which are all-ratings and say so.
//
// THE WEIGHT. The statistics file is 8.6 MB (1.5 MB compressed), loaded once a session,
// and the answer is remembered until the lines or games change. Replaying your games is
// what used to take the time; see fast-replay.ts.
//
// SUPABASE. A saved line is ordinary moves in the existing repertoire blob, through the
// existing 30-second push, under the existing 500-line cap. No new table, row or synced
// key. Skips stay on the device (next-reply-log.ts).

import {
  getAllRepertoires, getAllLines, getAllGames, getAllOpponents, getRepertoire, saveRepertoire,
  onLinesChanged, onGamesChanged,
} from './storage';
import { detachFromBook, makeIdFactory, mergePath, nodeAtPath } from './repertoire';
import { bundledStatsLookup } from './explorer-stats';
import { scoutReplyIndex, type ScoutIndex } from './coverage-gaps';
import { GROW_MAX_PLIES } from './grow-line';
import { buildFacedIndex, type FacedIndex } from './reply-games';
import { coveragePct } from './reply-coverage';
import { freeTrainingSlots, requestLineSaveRoom } from './entitlement';
import { opponentTag } from './scout';
import type { Line } from './types';
import type { GrowTarget } from './grow-line';
import type { StatsAt } from './rare-branch';
import { answeredPositions, buildNextReplies, type NextReplyCard } from './next-reply';
import { restedPositions } from './next-reply-log';

export interface NextReplyLoad {
  /** Holes in your lines: "Add a missing reply". */
  cards: NextReplyCard[];
  /** The ends of mastered lines: "Extend a line you know". */
  extend: NextReplyCard[];
  statsAt: StatsAt;
  /** The games where you faced a reply, by colour. */
  faced: Record<'white' | 'black', FacedIndex>;
  /** What your scouted opponents play, by colour. */
  scouts: Record<'white' | 'black', ScoutIndex>;
  /** Positions you already answer somewhere, by colour: a line joining one can stop. */
  answered: Record<'white' | 'black', Set<string>>;
  /** Your lines: how you build is what decides when auto-reply pauses. */
  lines: Line[];
  /** The statistics couldn't be read. Worth trying again. */
  degraded: boolean;
}

let memo: Promise<NextReplyLoad> | null = null;
let subscribed = false;

function subscribe(): void {
  if (subscribed) return;
  subscribed = true;
  onLinesChanged(() => { memo = null; });
  onGamesChanged(() => { memo = null; });
}

/** The queue, minus anything resting right now. */
export async function loadNextReplies(
  growTargets: () => Promise<GrowTarget[]>,
): Promise<NextReplyLoad> {
  subscribe();
  if (!memo) memo = compute(growTargets).catch((err) => { memo = null; throw err; });
  const load = await memo;
  // Only what really finished is worth remembering.
  if (load.degraded) memo = null;
  return { ...load, cards: restedLast(load.cards), extend: restedLast(load.extend) };
}

/**
 * Resting positions go to the back, soonest back first. A rest is never a removal: with
 * three mastered lines, three swipes mustn't leave the box empty for a month.
 */
function restedLast(cards: NextReplyCard[]): NextReplyCard[] {
  const rested = restedPositions();
  const now = Date.now();
  const until = (c: NextReplyCard): number => rested[c.id] ?? 0;
  return [
    ...cards.filter(c => until(c) <= now),
    ...cards.filter(c => until(c) > now).sort((a, b) => until(a) - until(b)),
  ];
}

async function compute(growTargets: () => Promise<GrowTarget[]>): Promise<NextReplyLoad> {
  let degraded = false;
  const noStats: StatsAt = () => null;
  const [lines, games, opponents, statsAt, grow] = await Promise.all([
    getAllLines(),
    getAllGames().catch(() => []),
    getAllOpponents().catch(() => []),
    bundledStatsLookup('lichess').catch((): StatsAt => { degraded = true; return noStats; }),
    growTargets().catch(() => []),
  ]);
  // Let the screen breathe between loading a big file and replaying the games.
  await new Promise(resolve => setTimeout(resolve));
  const scouted = opponents.map(o => ({ name: o.name, games: o.games }));
  const faced = { white: buildFacedIndex(games, 'white'), black: buildFacedIndex(games, 'black') };
  await new Promise(resolve => setTimeout(resolve));
  const cards = buildNextReplies({
    lines,
    games,
    opponents: scouted,
    statsAt,
    grow,
    faced,
    rested: {},   // restedLast does this, each time it's asked
  });
  await new Promise(resolve => setTimeout(resolve));
  return {
    cards: cards.filter(c => !c.extend),
    extend: cards.filter(c => c.extend),
    statsAt,
    faced,
    scouts: {
      white: scoutReplyIndex(scouted, 'white', GROW_MAX_PLIES),
      black: scoutReplyIndex(scouted, 'black', GROW_MAX_PLIES),
    },
    answered: {
      white: answeredPositions(lines, 'white'),
      black: answeredPositions(lines, 'black'),
    },
    lines,
    degraded,
  };
}

/** How covered each colour is, right now. Quick enough to ask again after a save. */
export async function currentCoverage(statsAt: StatsAt): Promise<Record<'white' | 'black', number | null>> {
  const reps = (await getAllRepertoires()).filter(r => !r.archived);
  const pct = (colour: 'white' | 'black'): number | null => coveragePct(
    reps.filter(r => r.colour === colour).map(r => r.tree), colour, statsAt,
  );
  return { white: pct('white'), black: pct('black') };
}

export interface Ply { uci: string; san: string; fen: string }

export interface SavedReply {
  repertoireId: string;
  /** The first new move. Undo cuts here, which takes the answer with it. */
  firstNewId: string;
  /** Saved outside training, because the free training slots are all in use. */
  paused: boolean;
}

export type SaveOutcome =
  | { status: 'saved'; saved: SavedReply | null }
  | { status: 'no-room' }      // the free line cap: its dialog has already shown
  | { status: 'gone' };        // the position is no longer in any book

/**
 * Put a line into the book the position lives in: the card's last move and everything
 * played after it, up to your last move.
 *
 * Through mergePath, like every other write of moves, so nothing is stored twice and a
 * move already there keeps its history. A reply at a position that already has answers
 * is a new line; going past the end of a line only makes that line longer, which is
 * why growing costs a free account nothing.
 */
export async function saveReply(card: NextReplyCard, played: Ply[]): Promise<SaveOutcome> {
  const parentPath = card.ucis.slice(0, -1);
  const last = card.ucis[card.ucis.length - 1];
  const reps = await getAllRepertoires();
  const rep = reps.find(r =>
    r.colour === card.colour && !r.archived && nodeAtPath(r.tree, parentPath) !== null);
  const parent = rep ? nodeAtPath(rep.tree, parentPath) : null;
  if (!rep || !parent) return { status: 'gone' };

  const existing = parent.children.find(c => c.uci === last);
  const newLine = !existing && parent.children.length > 0;
  if (!(await requestLineSaveRoom(newLine ? 1 : 0))) return { status: 'no-room' };
  const paused = newLine && (await freeTrainingSlots()) <= 0;

  const { added } = mergePath(parent, [
    { san: card.sans[card.sans.length - 1], uci: last, fen: existing?.fen ?? card.fen },
    ...played.map(p => ({ san: p.san, uci: p.uci, fen: p.fen })),
  ], makeIdFactory(rep.tree));
  const first = added[0];
  if (!first) return { status: 'saved', saved: null };   // already there

  // Where a mastered line stopped isn't an end any more, or the stub stays a line of its own.
  if (card.extend || card.pastEnd) {
    delete parent.endpoint;
    if (existing) delete existing.endpoint;
  }
  if (paused) first.training = false;
  if (card.opponentName) first.tags = [opponentTag(card.opponentName)];
  await saveRepertoire(rep);
  return { status: 'saved', saved: { repertoireId: rep.id, firstNewId: first.id, paused } };
}

/** Take a saved answer back out. Through the book, so sync respects the removal. */
export async function undoReply(saved: SavedReply): Promise<void> {
  const rep = await getRepertoire(saved.repertoireId);
  if (!rep) return;
  if (detachFromBook(rep, saved.firstNewId)) await saveRepertoire(rep);
}
