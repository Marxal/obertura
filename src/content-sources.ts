// Learning-content sources for the Learn tab: pure link/query builders for
// YouTube, Lichess studies and Lichess opening pages, plus the one live client
// — Wikibooks' "Chess Opening Theory" (the same book Lichess shows beside its
// analysis board; CC BY-SA, so we always link and credit the page we quote).
// Everything networked fails soft to null: content is a bonus layer, so the
// panel simply hides a section it has no data for — no toasts, no retries.

// ── Wikibooks page titles ─────────────────────────────────────────────────────
// The wikibook keeps one page per move sequence, one path segment per half-move:
//   Chess Opening Theory/1. e4/1...c5/2. Nf3/2...d6
// (URLs show the spaces as underscores: /1._e4/1...c5/…) White's moves are
// "N. san", Black's are "N...san"; checks and mates keep their +/# marks.

function moveSegment(san: string, ply: number): string {
  const num = Math.floor(ply / 2) + 1;
  return ply % 2 === 0 ? `${num}. ${san}` : `${num}...${san}`;
}

export function wikibooksTitle(sans: string[]): string {
  return ['Chess Opening Theory', ...sans.map((san, i) => moveSegment(san, i))].join('/');
}

export function wikibooksUrl(sans: string[]): string {
  const segs = ['Chess Opening Theory', ...sans.map((san, i) => moveSegment(san, i))]
    .map(seg => encodeURIComponent(seg.replace(/ /g, '_')));
  return `https://en.wikibooks.org/wiki/${segs.join('/')}`;
}

// ── Lichess deep links ────────────────────────────────────────────────────────

// lichess.org/opening/{slug} — their opening reference page (description, stats,
// example games). Slug = the name with punctuation dropped and spaces
// underscored, truncated at the first comma: the pre-comma page reliably
// exists, deep sub-variation slugs often don't. Diacritics are flattened
// (Grünfeld → Grunfeld). Null when nothing safe is left.
export function lichessOpeningUrl(name: string): string | null {
  const base = name.split(',')[0]
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 -]/g, '')
    .trim().replace(/\s+/g, '_');
  if (!base) return null;
  return `https://lichess.org/opening/${base}`;
}

// The analysis board at an exact position — works for ANY FEN, named or not.
export function lichessAnalysisUrl(fen: string): string {
  return `https://lichess.org/analysis/${fen.replace(/ /g, '_')}`;
}

export function lichessStudySearchUrl(query: string): string {
  return `https://lichess.org/study/search?q=${encodeURIComponent(query)}`;
}

export function youtubeSearchUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

// ── Search queries ────────────────────────────────────────────────────────────

// The opening name flattened for a search box: "Sicilian Defense: Najdorf
// Variation, English Attack" → "Sicilian Defense Najdorf Variation English Attack".
export function openingQuery(name: string): string {
  return name.replace(/[:,]/g, ' ').replace(/\s+/g, ' ').trim();
}

// A query for THIS position: the opening name plus the numbered moves, capped so
// the string stays a plausible search ("Sicilian Defense 1. e4 c5 2. Nf3 d6").
const EXACT_QUERY_MAX_PLIES = 12;

export function exactQuery(sans: string[], openingName?: string | null): string {
  const capped = sans.slice(0, EXACT_QUERY_MAX_PLIES);
  const moves: string[] = [];
  for (let i = 0; i < capped.length; i++) {
    if (i % 2 === 0) moves.push(`${i / 2 + 1}.`);
    moves.push(capped[i]);
  }
  const line = moves.join(' ');
  return openingName ? `${openingQuery(openingName)} ${line}` : line;
}

// ── Wikibooks live extract ────────────────────────────────────────────────────
// One request asks for the page of the CURRENT move path plus its ancestors
// (MediaWiki answers up to 20 titles at once) and we keep the deepest page that
// actually has text — so a position past the book's reach still shows the
// deepest theory that exists, which is exactly the panel's fallback rule.
// redirects=1 lets the wiki's transposition redirects resolve for free.

export interface TheoryExtract {
  title: string;   // the page title that answered (may be shallower than the board)
  text: string;    // plain-text intro, trimmed to MAX_TEXT_CHARS
  url: string;     // deep link to that page
  plies: number;   // how many half-moves that page covers
}

// The book effectively stops past this depth — asking deeper is wasted titles.
const MAX_THEORY_PLIES = 30;
// TextExtracts answers at most 20 pages per request.
const MAX_TITLES = 20;
// Cap what the panel shows; intros run short anyway.
const MAX_TEXT_CHARS = 1200;
const FETCH_TIMEOUT_MS = 6000;

// Wikimedia asks API clients to identify themselves; browsers can't set
// User-Agent, so the documented header for web apps is Api-User-Agent.
const API_USER_AGENT = 'Obertura (https://marxal.github.io/obertura/)';
const API_URL = 'https://en.wikibooks.org/w/api.php';

// Answers per move path, session-lived. null is cached only for a definitive
// "the API answered and no page exists" — network errors are never cached, so
// coming back online retries naturally.
const theoryCache = new Map<string, TheoryExtract | null>();
let inflight: AbortController | null = null;

/** The cached answer for this path, if we already have one (undefined = ask). */
export function peekWikibooksTheory(sans: string[]): TheoryExtract | null | undefined {
  return theoryCache.get(sans.join(' '));
}

// The plies whose pages we ask for: every prefix when the path is short, else
// the deepest MAX_TITLES ones — with the named-opening ply (`anchorPly`) always
// kept in the batch so a long off-book tail can't push all real theory out.
function candidatePlies(len: number, anchorPly?: number): number[] {
  const top = Math.min(len, MAX_THEORY_PLIES);
  const plies: number[] = [];
  for (let p = top; p >= 1 && plies.length < MAX_TITLES; p--) plies.push(p);
  if (anchorPly && anchorPly >= 1 && anchorPly <= len && !plies.includes(anchorPly)) {
    plies[plies.length - 1] = anchorPly; // swap out the shallowest candidate
  }
  return plies; // deepest first
}

interface WikiPage { title: string; missing?: boolean; extract?: string }
interface WikiRename { from: string; to: string }

export async function fetchWikibooksTheory(
  sans: string[], anchorPly?: number,
): Promise<TheoryExtract | null> {
  if (!sans.length) return null;
  const key = sans.join(' ');
  const cached = theoryCache.get(key);
  if (cached !== undefined) return cached;

  inflight?.abort();
  const ctrl = new AbortController();
  inflight = ctrl;
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  try {
    const plies = candidatePlies(sans.length, anchorPly);
    const titles = plies.map(p => wikibooksTitle(sans.slice(0, p)));
    const query = await apiQuery(titles, false, ctrl.signal);

    // Follow the API's title renames (underscore normalisation, transposition
    // redirects) so each candidate finds its answering page.
    const follow = renameFollower(query);
    const byTitle = new Map<string, WikiPage>((query.pages ?? []).map(p => [p.title, p]));

    let deepestExisting: { ply: number; title: string } | null = null;
    for (let i = 0; i < plies.length; i++) {           // deepest first
      const page = byTitle.get(follow(titles[i]));
      if (!page || page.missing) continue;
      deepestExisting ??= { ply: plies[i], title: titles[i] };
      const text = cleanExtract(page.extract);
      if (text) {
        const result = extractResult(sans, plies[i], text);
        theoryCache.set(key, result);
        return result;
      }
    }

    // A page exists but its intro came back empty (some pages lead with the
    // position template). One follow-up fetch of the whole page text.
    if (deepestExisting) {
      const full = await apiQuery([deepestExisting.title], true, ctrl.signal);
      const page = (full.pages ?? [])[0];
      const text = cleanExtract(page && !page.missing ? page.extract : undefined);
      const result = text ? extractResult(sans, deepestExisting.ply, text) : null;
      theoryCache.set(key, result);
      return result;
    }

    theoryCache.set(key, null); // definitive: the API answered, no pages
    return null;
  } catch {
    return null; // abort / offline / blocked — not cached, retried next time
  } finally {
    clearTimeout(timer);
    if (inflight === ctrl) inflight = null;
  }
}

interface WikiQuery { pages?: WikiPage[]; normalized?: WikiRename[]; redirects?: WikiRename[] }

async function apiQuery(
  titles: string[], wholePage: boolean, signal: AbortSignal,
): Promise<WikiQuery> {
  const params = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', origin: '*',
    prop: 'extracts', explaintext: '1', redirects: '1',
    titles: titles.join('|'),
  });
  // exintro is what makes a multi-title extracts query legal; the single-title
  // follow-up drops it (whole page) and caps by characters instead.
  if (wholePage) params.set('exchars', String(MAX_TEXT_CHARS));
  else { params.set('exintro', '1'); params.set('exlimit', 'max'); }

  const res = await fetch(`${API_URL}?${params}`, {
    signal,
    headers: { 'Api-User-Agent': API_USER_AGENT },
  });
  if (!res.ok) throw new Error(`wikibooks http ${res.status}`);
  const data = await res.json() as { query?: WikiQuery };
  if (!data.query || typeof data.query !== 'object') throw new Error('wikibooks: no query');
  return data.query;
}

function renameFollower(
  query: { normalized?: WikiRename[]; redirects?: WikiRename[] },
): (title: string) => string {
  const norm = new Map((query.normalized ?? []).map(r => [r.from, r.to]));
  const redir = new Map((query.redirects ?? []).map(r => [r.from, r.to]));
  return (title: string): string => {
    let cur = norm.get(title) ?? title;
    for (let hops = 0; hops < 4; hops++) {
      const next = redir.get(cur);
      if (!next) break;
      cur = next;
    }
    return cur;
  };
}

function extractResult(sans: string[], ply: number, text: string): TheoryExtract {
  const covered = sans.slice(0, ply);
  return { title: wikibooksTitle(covered), text, url: wikibooksUrl(covered), plies: ply };
}

// Trim, drop stub-y leftovers, cap at a word boundary.
function cleanExtract(raw: string | undefined): string {
  const text = (raw ?? '').trim();
  if (text.length < 40) return ''; // a bare heading or "…" is worse than nothing
  if (text.length <= MAX_TEXT_CHARS) return text;
  const cut = text.slice(0, MAX_TEXT_CHARS);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), MAX_TEXT_CHARS - 80))}…`;
}
