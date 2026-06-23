// Pure aggregations for the Statistics screen — no DOM, so they're exercised by
// stats.selftest.ts. Two families of numbers:
//
//   • TRAINING — what my repertoire/training looks like right now (mastered
//     lines, the moves I fail most) plus the remembered-vs-failed day series.
//   • GAMES — per-opening win rate joined with my training, win rate over time,
//     and most-played / best-scoring lists, all from imported games.
//
// Everything game-derived comes straight from analysis.ts (analyseGames) or the
// stored per-game endTime+result — nothing is invented. Where a number isn't
// tracked at all (a "first trained this opening" date), the caller renders an
// honest empty state rather than guessing.

import type { Line } from './types';
import type { ImportedGame } from './chesscom';
import { mainlineNodes } from './scheduler';
import {
  openingFamily,
  UNKNOWN_FAMILY,
  MIN_GAMES_WEAK,
  type OpeningStat,
} from './analysis';
import type { DayOutcome } from './streak';
import type { PuzzleDay, PuzzleOpeningTally } from './puzzle-log';
import type { StatsRange } from './prefs';

// A line is "mastered" once its training confidence reaches the top of the 0–5
// scale — the same threshold the quick-stats box has always used.
export const MASTERY_CONFIDENCE = 5;

export function masteredLines(lines: Line[]): Line[] {
  return lines.filter(l => l.confidence >= MASTERY_CONFIDENCE);
}

// ── Needs-work moves ─────────────────────────────────────────────────────────
//
// Every trained user-move that's ever been missed, hardest (most-lapsed) first.
// One entry per move; the lineId lets a tap drill the line it lives in.

export interface NeedsWorkMove {
  lineId: string;
  lineName: string;
  openingName: string | null;
  colour: 'white' | 'black';
  san: string;
  moveNumber: number;   // 1-based full-move number
  lapses: number;       // lifetime misses on this move
}

export function needsWorkMoves(lines: Line[], limit = 24): NeedsWorkMove[] {
  const out: NeedsWorkMove[] = [];
  for (const line of lines) {
    const main = mainlineNodes(line.tree);
    main.forEach((node, i) => {
      const isUser = line.colour === 'white' ? i % 2 === 0 : i % 2 === 1;
      const lapses = node.review?.lapses ?? 0;
      if (!isUser || lapses <= 0) return;
      out.push({
        lineId: line.id,
        lineName: line.name || line.openingName || 'Untitled line',
        openingName: line.openingName,
        colour: line.colour,
        san: node.san,
        moveNumber: Math.floor(i / 2) + 1,
        lapses,
      });
    });
  }
  out.sort((a, b) => b.lapses - a.lapses || a.lineName.localeCompare(b.lineName));
  return out.slice(0, limit);
}

// ── Remembered-vs-failed day series ──────────────────────────────────────────

export interface DayBar {
  day: string;          // YYYY-MM-DD
  dom: number;          // day-of-month, for the axis label
  dow: string;          // single weekday letter
  remembered: number;
  failed: number;
  isToday: boolean;
}

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function localKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// The day-by-day remembered/failed bars for the selected range, oldest → newest.
// 'week' = 7 days, 'month' = 30; 'all' spans from the earliest logged day to
// today, clamped to [7, REVIEW_LOG_WINDOW]. Days with no training fill as zero
// so the axis stays continuous.
export const REVIEW_LOG_WINDOW = 120;

export function reviewBars(log: DayOutcome[], range: StatsRange, now: Date = new Date()): DayBar[] {
  const byDay = new Map(log.map(o => [o.day, o]));
  let n: number;
  if (range === 'week') n = 7;
  else if (range === 'month') n = 30;
  else if (log.length === 0) n = 7;
  else {
    const firstMs = new Date(`${log[0].day}T00:00:00`).getTime();
    const span = Math.floor((now.getTime() - firstMs) / 86_400_000) + 1;
    n = Math.min(REVIEW_LOG_WINDOW, Math.max(7, span));
  }
  const bars: DayBar[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = localKey(d);
    const o = byDay.get(key);
    bars.push({
      day: key,
      dom: d.getDate(),
      dow: DOW[d.getDay()],
      remembered: o?.remembered ?? 0,
      failed: o?.failed ?? 0,
      isToday: i === 0,
    });
  }
  return bars;
}

// ── Puzzles ──────────────────────────────────────────────────────────────────
//
// Aggregations over the device-local puzzle log (puzzle-log.ts). These work with
// no Lichess connection; the connected dashboard (puzzles.ts) is layered on top
// in the screen, not here.

export interface PuzzleTotals {
  solved: number;
  failed: number;
  attempts: number;
  accuracyPct: number; // solved / attempts, 0 when nothing attempted
}

// Solved/failed totals over the selected range. 'week' = last 7 days, 'month' =
// last 30, 'all' = everything logged.
export function puzzleTotals(days: PuzzleDay[], range: StatsRange, now: Date = new Date()): PuzzleTotals {
  let cutoff = -Infinity;
  if (range === 'week' || range === 'month') {
    const back = range === 'week' ? 6 : 29; // inclusive of today
    const d = new Date(now);
    d.setDate(d.getDate() - back);
    cutoff = new Date(`${localKey(d)}T00:00:00`).getTime();
  }
  let solved = 0;
  let failed = 0;
  for (const day of days) {
    if (new Date(`${day.day}T00:00:00`).getTime() < cutoff) continue;
    solved += day.solved;
    failed += day.failed;
  }
  const attempts = solved + failed;
  return { solved, failed, attempts, accuracyPct: attempts === 0 ? 0 : Math.round((solved / attempts) * 100) };
}

export interface PuzzleOpeningRow {
  angle: string;
  family: string;     // readable name, e.g. "Sicilian Defense"
  solved: number;
  failed: number;
  attempts: number;
  accuracyPct: number;
}

// Turn a Lichess angle key into a readable opening name ("Caro-Kann_Defense" →
// "Caro-Kann Defense").
export function angleToName(angle: string): string {
  return angle.replace(/_/g, ' ');
}

// Per-opening puzzle accuracy, most-attempted first — the trained openings you're
// sharp or shaky in tactically. Openings with fewer than `min` attempts are
// dropped so a single lucky/unlucky puzzle doesn't dominate.
export function puzzleAccuracyByOpening(byOpening: PuzzleOpeningTally[], min = 1): PuzzleOpeningRow[] {
  return byOpening
    .map(o => {
      const attempts = o.solved + o.failed;
      return {
        angle: o.angle,
        family: angleToName(o.angle),
        solved: o.solved,
        failed: o.failed,
        attempts,
        accuracyPct: attempts === 0 ? 0 : Math.round((o.solved / attempts) * 100),
      };
    })
    .filter(r => r.attempts >= min)
    .sort((a, b) => b.attempts - a.attempts || a.family.localeCompare(b.family));
}

// ── Win rate by opening × training ───────────────────────────────────────────
//
// Joins the real per-opening win rate (from the games analysis) with how that
// opening is doing in training. Join key is opening family + colour, the same
// key the analysis uses; a saved line with no detected opening name can't join
// and simply isn't counted on the training side.

export interface OpeningTrainingRow {
  family: string;
  colour: 'white' | 'black';
  games: number;
  wins: number;
  draws: number;
  losses: number;
  scorePct: number;          // real win rate from games
  repUcis: string[];         // a representative game line, for the build fallback
  lineCount: number;         // my saved lines in this opening
  masteredCount: number;     // of those, how many are mastered
  avgConfidence: number;     // 0–5 mean confidence across them (0 if none)
}

export function winRateByOpening(stats: OpeningStat[], lines: Line[], max = 8): OpeningTrainingRow[] {
  interface Agg { count: number; mastered: number; confSum: number; }
  const training = new Map<string, Agg>();
  for (const line of lines) {
    const fam = openingFamily(line.openingName);
    if (fam === UNKNOWN_FAMILY) continue;
    const key = `${fam}|${line.colour}`;
    const a = training.get(key) ?? { count: 0, mastered: 0, confSum: 0 };
    a.count++;
    a.confSum += line.confidence;
    if (line.confidence >= MASTERY_CONFIDENCE) a.mastered++;
    training.set(key, a);
  }

  const rows: OpeningTrainingRow[] = stats
    .filter(s => s.family !== UNKNOWN_FAMILY)
    .map(s => {
      const t = training.get(`${s.family}|${s.colour}`);
      return {
        family: s.family,
        colour: s.colour,
        games: s.games,
        wins: s.wins,
        draws: s.draws,
        losses: s.losses,
        scorePct: s.scorePct,
        repUcis: s.repUcis,
        lineCount: t?.count ?? 0,
        masteredCount: t?.mastered ?? 0,
        avgConfidence: t && t.count > 0 ? Math.round(t.confSum / t.count) : 0,
      };
    });

  rows.sort((a, b) => b.games - a.games || a.family.localeCompare(b.family));
  return rows.slice(0, max);
}

// ── Win rate over time ───────────────────────────────────────────────────────

export interface TrendPoint {
  label: string;      // "Mar"
  startMs: number;    // first ms of that month, for ordering / the detail year
  games: number;
  wins: number;
  draws: number;
  losses: number;
  scorePct: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Monthly win-rate series from imported games (oldest → newest). Months with no
// games are skipped — no fabricated zeroes across a gap. endTime is unix seconds.
// Callers pre-filter the game list (by colour / opening) before calling.
export function winRateOverTime(games: ImportedGame[], maxMonths = 12): TrendPoint[] {
  interface Bucket { y: number; m: number; games: number; wins: number; draws: number; losses: number; }
  const buckets = new Map<string, Bucket>();
  for (const g of games) {
    if (!g.endTime) continue;
    const d = new Date(g.endTime * 1000);
    const y = d.getFullYear();
    const m = d.getMonth();
    const key = `${y}-${m}`;
    const b = buckets.get(key) ?? { y, m, games: 0, wins: 0, draws: 0, losses: 0 };
    b.games++;
    if (g.result === 'win') b.wins++;
    else if (g.result === 'draw') b.draws++;
    else b.losses++;
    buckets.set(key, b);
  }
  const points = [...buckets.values()]
    .sort((a, b) => a.y - b.y || a.m - b.m)
    .map(b => ({
      label: MONTHS[b.m],
      startMs: new Date(b.y, b.m, 1).getTime(),
      games: b.games,
      wins: b.wins,
      draws: b.draws,
      losses: b.losses,
      scorePct: b.games === 0 ? 0 : Math.round(((b.wins + b.draws / 2) / b.games) * 100),
    }));
  return points.slice(Math.max(0, points.length - maxMonths));
}

// ── Most played / best scoring ───────────────────────────────────────────────

// Most-played recognised openings. `stats` arrives already sorted by games desc.
export function mostPlayedOpenings(stats: OpeningStat[], n = 5): OpeningStat[] {
  return stats.filter(s => s.family !== UNKNOWN_FAMILY).slice(0, n);
}

// Best-scoring openings, with enough games behind them to mean something.
export function bestScoringOpenings(stats: OpeningStat[], n = 5): OpeningStat[] {
  return stats
    .filter(s => s.family !== UNKNOWN_FAMILY && s.games >= MIN_GAMES_WEAK)
    .sort((a, b) => b.scorePct - a.scorePct || b.games - a.games)
    .slice(0, n);
}

// Worst-scoring openings — the mirror of bestScoring, weakest first.
export function worstScoringOpenings(stats: OpeningStat[], n = 5): OpeningStat[] {
  return stats
    .filter(s => s.family !== UNKNOWN_FAMILY && s.games >= MIN_GAMES_WEAK)
    .sort((a, b) => a.scorePct - b.scorePct || b.games - a.games)
    .slice(0, n);
}
