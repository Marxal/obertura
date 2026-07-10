// Lichess study import — pure helpers (no DOM). A public study exports as PGN
// via the free, CORS-enabled endpoint
//   https://lichess.org/api/study/{studyId}.pgn
// (or /api/study/{studyId}/{chapterId}.pgn for one chapter). Chapters arrive as
// consecutive PGN games; each becomes one line, with the author's comments
// attached as per-ply notes.
//
// Known v1 limit: side variations inside a chapter are dropped — we request
// `variations=false` so only the mainline reaches the parser. Studies laid out
// one-line-per-chapter (the common convention) import fully.

import { Chess } from 'chess.js';

export interface StudyRef {
  studyId: string;
  chapterId?: string;
}

export interface StudyChapter {
  name: string;
  sans: string[];
  ucis: string[];
  notes: Record<number, string>; // 0-based ply index → cleaned comment
}

// Accepts a lichess.org study URL (with or without a chapter id, extra path
// segments like /black, query strings…) or a bare 8-char study id.
export function parseStudyUrl(input: string): StudyRef | null {
  const s = input.trim();
  if (!s) return null;
  const m = s.match(/lichess\.org\/study\/([a-zA-Z0-9]{8})(?:\/([a-zA-Z0-9]{8}))?/);
  if (m) return { studyId: m[1], chapterId: m[2] };
  if (/^[a-zA-Z0-9]{8}$/.test(s)) return { studyId: s };
  return null;
}

// Chapters export as consecutive games: split on the blank line(s) before each
// [Event …] header. The first chunk has no preceding blank line, so a plain
// lookahead split covers every game including the first.
export function splitPgnGames(pgn: string): string[] {
  return pgn
    .split(/\n\s*\n(?=\[Event )/)
    .map(g => g.trim())
    .filter(g => g.length > 0);
}

// Lichess embeds display commands in comments — arrows/circles/clocks like
// [%cal Ge2e4,Rd1h5], [%csl Gd4], [%clk 0:03:00]. Strip them; keep the prose.
function cleanComment(comment: string): string {
  return comment.replace(/\[%[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
}

// Parse one PGN game (a study chapter) into a line: mainline moves plus the
// author's comments mapped onto plies. Returns null when the PGN can't be read
// or holds no moves. Comments are keyed by position (FEN) in chess.js, so a
// repeated position would show the same note at each occurrence — harmless in
// opening lines.
export function parseAnnotatedPgn(pgn: string): StudyChapter | null {
  if (!pgn.trim()) return null;
  const ch = new Chess();
  try { ch.loadPgn(pgn, { strict: false }); } catch { return null; }
  const verbose = ch.history({ verbose: true });
  if (!verbose.length) return null;

  const byFen = new Map<string, string>();
  for (const { fen, comment } of ch.getComments()) {
    const text = cleanComment(comment);
    if (text) byFen.set(fen, text);
  }

  const notes: Record<number, string> = {};
  const sans: string[] = [];
  const ucis: string[] = [];
  verbose.forEach((m, i) => {
    sans.push(m.san);
    ucis.push(m.lan);
    const note = byFen.get(m.after);
    if (note) notes[i] = note;
  });

  // Lichess titles chapters as "Study name: Chapter name" in the Event header —
  // keep the chapter part. A plain PGN keeps its whole Event (or a fallback).
  const event = (ch.header()['Event'] ?? '').trim();
  const name = event.includes(': ')
    ? event.slice(event.lastIndexOf(': ') + 2).trim() || event
    : event || 'Imported line';

  return { name, sans, ucis, notes };
}

// Every chapter of a study PGN as parsed lines (unreadable chapters skipped).
export function parseStudyPgn(pgn: string): StudyChapter[] {
  return splitPgnGames(pgn)
    .map(parseAnnotatedPgn)
    .filter((c): c is StudyChapter => c !== null && c.ucis.length > 0);
}

// Fetch a public study's PGN. Throws an Error whose message is ready to show
// in a toast.
export async function fetchStudyPgn(ref: StudyRef): Promise<string> {
  const base = ref.chapterId
    ? `https://lichess.org/api/study/${ref.studyId}/${ref.chapterId}.pgn`
    : `https://lichess.org/api/study/${ref.studyId}.pgn`;
  const url = `${base}?comments=true&clocks=false&variations=false&source=false&orientation=false`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new Error('Couldn’t reach Lichess — check your connection.');
  }
  if (res.status === 404) throw new Error('Study not found or private — only public studies can be imported.');
  if (res.status === 429) throw new Error('Lichess is rate-limiting — try again in a minute.');
  if (!res.ok) throw new Error(`Lichess returned an error (${res.status}) — try again later.`);
  return res.text();
}
