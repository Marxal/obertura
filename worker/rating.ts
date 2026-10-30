// GET /api/rating — Marçal's current Chess.com blitz rating, for the landing
// page's "Why I made Bito Chess" card.
//
//   { "rating": 1921, "best": 2089 }
//
// WHY THROUGH THE WORKER. The privacy policy promises the landing page makes no
// third-party requests, so the visitor's browser never talks to Chess.com. This
// Worker does, once every few hours, and the page asks this origin instead.
//
// ONE ACCOUNT, FIXED HERE. The username is not a parameter on purpose: an
// endpoint that fetched any player would be an open proxy onto Chess.com's API
// with this site's name on every request.
//
// Chess.com's public API (https://www.chess.com/news/view/published-data-api)
// needs no key and asks for a descriptive User-Agent. Its stats object carries
// `chess_blitz.last.rating` and `chess_blitz.best.rating`. Cached for six hours
// in the isolate and at the edge: a rating moves a few points a day, and the
// card says "today", not "this minute". Failures are soft — the card simply
// doesn't show a live number.

import { json, problem } from './stripe-env';

const PLAYER = 'marxal_bitochess';
const TTL_MS = 6 * 60 * 60 * 1000;
let cached: { rating: number; best: number | null; at: number } | null = null;

export async function handleRating(request: Request): Promise<Response> {
  if (request.method !== 'GET') return problem(405, 'method not allowed');
  if (cached && Date.now() - cached.at < TTL_MS) {
    return json({ rating: cached.rating, best: cached.best }, 200, TTL_MS / 1000);
  }
  try {
    const res = await fetch(`https://api.chess.com/pub/player/${PLAYER}/stats`, {
      headers: { accept: 'application/json', 'user-agent': 'bitochess.com landing page (creative@marxal.net)' },
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json() as { chess_blitz?: { last?: { rating?: number }; best?: { rating?: number } } };
    const rating = data.chess_blitz?.last?.rating;
    if (typeof rating !== 'number') throw new Error('no blitz rating');
    const best = data.chess_blitz?.best?.rating;
    cached = { rating, best: typeof best === 'number' ? best : null, at: Date.now() };
    return json({ rating: cached.rating, best: cached.best }, 200, TTL_MS / 1000);
  } catch (err) {
    console.error(`rating fetch failed (${err instanceof Error ? err.message : String(err)})`);
    return json({}, 200, 300);
  }
}
