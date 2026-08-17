// GET /api/stripe/prices — what the unlock costs, per currency.
//
// The app used to carry a hard-coded '9€'. It still carries one as a fallback,
// but the number the price card SHOWS now comes from here, which means from
// Stripe, which means from the same object that will actually take the money.
// Two numbers for the same thing is the fastest way to lose a sale, and the one
// place that can never be out of step with the store is the store.
//
// ── WHAT IT RETURNS ─────────────────────────────────────────────────────────
//   { "prices": [ { "id": "price_…", "currency": "eur", "unitAmount": 900 },
//                 { "id": "price_…", "currency": "sek", "unitAmount": 9900 } ] }
//
// `unitAmount` is in the currency's smallest unit, exactly as Stripe stores it —
// 900 is €9.00, 9900 is 99.00 kr. The app formats it (src/pricing.ts); nothing
// here decides how a price is written.
//
// ONE PRICE OBJECT PER CURRENCY, created by hand in the Stripe dashboard with an
// explicit amount. Not a converted amount, and not Stripe's `currency_options`
// on a single price: a Swede should see a round 99 kr, chosen because it looks
// right in Swedish, rather than 103,47 kr chosen by yesterday's exchange rate.
// STRIPE-SETUP.md walks through creating both.
//
// ── WHY THIS IS CACHED TWICE ────────────────────────────────────────────────
// A price changes roughly never, and this endpoint sits in front of the paywall —
// the one screen where a spinner instead of a number costs real money. So the
// answer is held in module scope (a Worker isolate serves many requests, so this
// hits most of the time and costs nothing) AND handed out with a public
// max-age, so Cloudflare's edge answers most of what gets past that. Stripe sees
// a trickle. A price edited in the dashboard takes up to PRICE_TTL_MS to appear,
// which for a price that changes roughly never is the right trade.
//
// Failures are SOFT here, unlike the webhook: this endpoint has a user waiting
// on it, and the app has its own fallback price and its own localStorage copy.
// An empty list is a perfectly good answer — the paywall shows the built-in
// number and the buy button still works, because the button sends a price id
// the app already has. Being unable to quote a price must never mean being
// unable to sell.

import {
  type StripeEnv,
  json,
  problem,
  stripeClient,
} from './stripe-env';

// How long a fetched list is reused, in and out of the isolate. Ten minutes:
// long enough that a busy hour is a handful of Stripe calls, short enough that
// fixing a typo'd price doesn't need a redeploy.
const PRICE_TTL_MS = 10 * 60 * 1000;
const PRICE_TTL_SECONDS = PRICE_TTL_MS / 1000;

// Stripe's page size for the list call. An account selling one unlock has two or
// three prices; 100 means the pagination case cannot arise in practice, and if
// it somehow does, the extra pages are prices we aren't selling anyway.
const PAGE_SIZE = 100;

export interface PublicPrice {
  id: string;
  currency: string;
  unitAmount: number;
}

interface CachedPrices {
  prices: PublicPrice[];
  fetchedAt: number;
}

// Module scope, so it survives between requests on the same isolate.
let cache: CachedPrices | null = null;

export async function handleStripePrices(request: Request, env: StripeEnv): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return problem(405, 'method not allowed');
  }

  const secretKey = env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    // Not configured yet. An empty list rather than a 500: the app treats
    // "no prices" and "couldn't ask" identically (it falls back to its built-in
    // number), and a 500 here would only fill the logs during setup.
    console.error('stripe prices: STRIPE_SECRET_KEY is not set');
    return json({ prices: [] }, 200);
  }

  const fresh = cache && Date.now() - cache.fetchedAt < PRICE_TTL_MS;
  if (fresh && cache) return json({ prices: cache.prices }, 200, PRICE_TTL_SECONDS);

  try {
    const stripe = stripeClient(secretKey);
    const list = await stripe.prices.list({
      active: true,
      limit: PAGE_SIZE,
      // Only this product's prices, when the account has been told which one it
      // is. Stripe treats an omitted `product` as "all of them".
      ...(env.STRIPE_PRODUCT_ID ? { product: env.STRIPE_PRODUCT_ID } : {}),
    });

    const prices = list.data
      // One-time only. Bito Chess sells a single payment and says so in the app,
      // on the landing page and in the terms; a recurring price reaching the
      // paywall would contradict all three, so it is filtered out here rather
      // than trusted not to exist. (Set one up deliberately and this is the
      // first line to change.)
      .filter(p => p.active && p.type === 'one_time' && !p.recurring)
      // `unit_amount` is null for prices whose amount lives elsewhere (tiered
      // or metered billing). Nothing to show, so nothing to offer.
      .filter((p): p is typeof p & { unit_amount: number } => typeof p.unit_amount === 'number')
      .map<PublicPrice>(p => ({ id: p.id, currency: p.currency, unitAmount: p.unit_amount }))
      // Stable order, so the app's "first matching currency" is deterministic
      // and two identical requests never disagree.
      .sort((a, b) => a.currency.localeCompare(b.currency));

    cache = { prices, fetchedAt: Date.now() };
    return json({ prices }, 200, PRICE_TTL_SECONDS);
  } catch (err) {
    // Stripe unreachable, key rejected, account disabled. Serve a stale list if
    // we have one — a ten-minute-old price is right, and a missing price is not.
    console.error(`stripe prices: list failed (${describe(err)})`);
    if (cache) return json({ prices: cache.prices }, 200, PRICE_TTL_SECONDS);
    return json({ prices: [] }, 200);
  }
}

// Enough of an error to debug from `wrangler tail`, and never the request body
// or a key. Stripe's own error messages are safe to log — they describe the
// call, not the credential.
function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'unknown error';
}
