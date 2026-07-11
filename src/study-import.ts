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
  // The author's comment on the chapter's STARTING position (the text before
  // move one — usually what the chapter is about). Shown above the move list
  // when importing, and folded into the first move's note on save.
  intro?: string;
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

// Two Lichess-export quirks break chess.js's PGN reader on real studies:
//   1. ADJACENT comment blocks on one move — "{ prose } { [%csl Gc6] }" —
//      where the grammar allows only one comment per position.
//   2. Multi-paragraph prose with BLANK LINES inside the braces (a blank line
//      inside a comment could also fool the game-splitter below).
// Merge adjacent blocks and flatten newlines inside every {…}. Costs nothing:
// cleanComment() collapses whitespace for display anyway, and PGN comments
// can't nest braces, so [^}]* spans them safely.
function flattenComments(pgn: string): string {
  return pgn
    .replace(/\}\s*\{/g, ' ')
    .replace(/\{[^}]*\}/g, m => m.replace(/\s*\n\s*/g, ' '));
}

// Chapters export as consecutive games: split on the blank line(s) before each
// [Event …] header. The first chunk has no preceding blank line, so a plain
// lookahead split covers every game including the first.
export function splitPgnGames(pgn: string): string[] {
  return flattenComments(pgn)
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
  // flattenComments is idempotent — a chapter arriving via splitPgnGames is
  // already flat, but a directly-pasted single game needs it here.
  try { ch.loadPgn(flattenComments(pgn), { strict: false }); } catch { return null; }
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

  // A comment BEFORE move one attaches to the starting position's FEN — that's
  // the chapter's introduction (what this chapter covers), not a move note.
  const intro = byFen.get(verbose[0].before);

  // Lichess study exports carry an explicit ChapterName header; older/plain
  // PGNs title chapters as "Study name: Chapter name" in Event — keep the
  // chapter part. A plain PGN keeps its whole Event (or a fallback).
  const headers = ch.header();
  const event = (headers['Event'] ?? '').trim();
  const chapterName = (headers['ChapterName'] ?? '').trim();
  const name = chapterName || (event.includes(': ')
    ? event.slice(event.lastIndexOf(': ') + 2).trim() || event
    : event || 'Imported line');

  return { name, sans, ucis, notes, ...(intro ? { intro } : {}) };
}

// Every chapter of a study PGN as parsed lines (unreadable chapters skipped).
export function parseStudyPgn(pgn: string): StudyChapter[] {
  return splitPgnGames(pgn)
    .map(parseAnnotatedPgn)
    .filter((c): c is StudyChapter => c !== null && c.ucis.length > 0);
}

// The study's own title, for tagging its chapters as one group. Lichess exports
// carry it in a StudyName header; older exports only encode it as the Event's
// "Study name: Chapter name" prefix.
export function studyNameFromPgn(pgn: string): string | null {
  const named = pgn.match(/^\[StudyName\s+"([^"]*)"\]/m)?.[1]?.trim();
  if (named) return named;
  const event = pgn.match(/^\[Event\s+"([^"]*)"\]/m)?.[1]?.trim() ?? '';
  if (event.includes(': ')) {
    const head = event.slice(0, event.indexOf(': ')).trim();
    if (head) return head;
  }
  return null;
}

// A short, stable tag from a study title, so every chapter of a study groups
// under one chip without flooding the tag row. Decorative wrapping (emoji,
// pipes, brackets…) is trimmed off the ends; long titles are cut at a word
// boundary. Same title in → same tag out, so re-imports keep grouping.
const STUDY_TAG_MAX = 28;

export function shortStudyTag(title: string): string {
  let t = title.replace(/\s+/g, ' ').trim();
  t = t
    .replace(/^[^\p{L}\p{N}"'(]+/u, '')
    .replace(/[^\p{L}\p{N})"'!?.]+$/u, '')
    .trim();
  if (!t) return 'Lichess study';
  if (t.length <= STUDY_TAG_MAX) return t;
  const cut = t.slice(0, STUDY_TAG_MAX + 1);
  const at = cut.lastIndexOf(' ');
  return (at >= 12 ? cut.slice(0, at) : t.slice(0, STUDY_TAG_MAX)).replace(/[\s,;:—-]+$/u, '') + '…';
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
  if (res.status === 403) throw new Error('This study doesn’t allow export — its author has locked it.');
  if (res.status === 429) throw new Error('Lichess is rate-limiting — try again in a minute.');
  if (!res.ok) throw new Error(`Lichess returned an error (${res.status}) — try again later.`);
  return res.text();
}
