// GET /api/founding — how many founding places have been taken.
//
//   { "sold": 23, "limit": 100 }
//
// Full Access is sold at a founding price to the first FOUNDING_LIMIT accounts;
// after that it moves to a yearly subscription (a later, separate change). The
// landing page's price card reads this to show "N of 100 founding places left" —
// but only once FOUNDING_SHOW_FROM places are gone (docs/index.html, section 8),
// because "99 of 100 left" after one sale reads as "nobody is buying".
//
// "Sold" is the number of entitled profiles: the same `profiles.entitled` flag
// the webhook sets on a paid checkout and clears on a full refund
// (stripe-webhook.ts), so a refund gives a place back without any bookkeeping
// here. An account entitled by hand (a gift, a tester) counts too, which errs on
// the side of the counter running down slightly early, never late.
//
// Counted with a HEAD request and `Prefer: count=exact`: Postgres counts, no
// rows come back. Cached like the prices are — in the isolate and at the edge —
// for ten minutes, so a busy page is a handful of database calls an hour.
//
// Failures are soft: no number is a perfectly good answer, and the card then
// simply doesn't show a counter.

import { type StripeEnv, json, problem, supabaseUrl } from './stripe-env';

export const FOUNDING_LIMIT = 100;

const TTL_MS = 10 * 60 * 1000;
let cached: { sold: number; at: number } | null = null;

export async function handleFounding(request: Request, env: StripeEnv): Promise<Response> {
  if (request.method !== 'GET') return problem(405, 'method not allowed');

  if (cached && Date.now() - cached.at < TTL_MS) {
    return json({ sold: cached.sold, limit: FOUNDING_LIMIT }, 200, TTL_MS / 1000);
  }

  const url = supabaseUrl(env);
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return json({ limit: FOUNDING_LIMIT }, 200, 60);

  try {
    const res = await fetch(`${url}/rest/v1/profiles?select=id&entitled=eq.true`, {
      method: 'HEAD',
      headers: { apikey: key, authorization: `Bearer ${key}`, prefer: 'count=exact' },
    });
    // Content-Range: 0-22/23 (or */0 when there are none) — the total is after the slash.
    const total = Number((res.headers.get('content-range') ?? '').split('/')[1]);
    if (!res.ok || !Number.isFinite(total)) throw new Error(`status ${res.status}`);
    cached = { sold: total, at: Date.now() };
    return json({ sold: total, limit: FOUNDING_LIMIT }, 200, TTL_MS / 1000);
  } catch (err) {
    console.error(`founding count failed (${err instanceof Error ? err.message : String(err)})`);
    return json({ limit: FOUNDING_LIMIT }, 200, 60);
  }
}
