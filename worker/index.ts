// The Worker entry point — the only server-side code in the project.
//
// ── WHY THERE IS NO `functions/` FOLDER ─────────────────────────────────────
// The obvious place to put an endpoint on Cloudflare is `functions/api/foo.ts`,
// which is automatically served at `/api/foo`. That is a Cloudflare PAGES
// feature, and this project is not a Pages project — it is a Worker. The
// giveaway is wrangler.jsonc plus a deploy command of `npx wrangler deploy`
// (Pages would be `wrangler pages deploy`). Cloudflare's own migration guide
// is blunt about it: a `functions/` folder has to be compiled into a single
// Worker script before a Worker can use it, because Workers have no built-in
// file-based routing. A `functions/` folder here would simply never run.
//
// The same answer applies to Supabase Edge Functions, which the Stripe migration
// was originally sketched against: this repo has no `supabase/` directory, no
// Supabase CLI and no migration history, and its server already lives here. Three
// endpoints are not worth a second deploy target, a second secret store and a
// second thing to remember to ship.
//
// So routing is done the Workers way: by hand, in this file. It is about ten
// lines, and it is the entire cost of not being a Pages project.
//
// ── HOW A REQUEST FLOWS ─────────────────────────────────────────────────────
// wrangler.jsonc sets `run_worker_first: ["/api/*"]`, so:
//   • /api/*      → this Worker runs first and answers (see below)
//   • everything else → served straight from the static assets in dist/,
//     exactly as it was before this file existed. The landing page at the root
//     and the trainer under /app/ are untouched; this Worker never sees those
//     requests unless the asset is missing, in which case it hands them back
//     to the asset server via the ASSETS binding for its normal 404.
//
// ── THE THREE STRIPE ENDPOINTS ──────────────────────────────────────────────
//   GET  /api/stripe/prices    what the unlock costs, per currency (stripe-prices.ts)
//   POST /api/stripe/checkout  → a Stripe Checkout URL (stripe-checkout.ts)
//   POST /api/stripe/webhook   Stripe → profiles.entitled (stripe-webhook.ts)
//
// No CORS headers anywhere, deliberately. All three are called from pages served
// by this same Worker's assets — the landing page at the root and the trainer at
// /app/ — so every call is same-origin and CORS never enters the picture. The
// GitHub Pages mirror is a different origin and has no Worker at all; it is also
// built without Supabase credentials, so it is fully entitled and has nothing to
// buy (see src/entitlement.ts). Adding permissive CORS here would only make the
// checkout endpoint callable from places that have no business calling it.
//
// Adding a fourth endpoint later means adding a branch here, nothing more.

import { handleStripePrices } from './stripe-prices';
import { handleStripeCheckout } from './stripe-checkout';
import { handleStripeWebhook } from './stripe-webhook';
import type { StripeEnv } from './stripe-env';

// The static-asset binding, declared as `assets.binding` in wrangler.jsonc.
// Typed by hand rather than pulling in @cloudflare/workers-types: this is the
// only Workers type the project needs, and a dependency (plus a lockfile
// change that the GitHub Pages build would also have to install) is a poor
// trade for four lines.
interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

// StripeEnv brings the secrets with it, so they are declared in exactly one
// place — next to the code that reads them (worker/stripe-env.ts).
export interface Env extends StripeEnv {
  ASSETS: AssetFetcher;
}

// Where Stripe is pointed. Changing the webhook path means changing the endpoint
// URL in the Stripe dashboard too (STRIPE-SETUP.md).
const PRICES_PATH = '/api/stripe/prices';
const CHECKOUT_PATH = '/api/stripe/checkout';
const WEBHOOK_PATH = '/api/stripe/webhook';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === PRICES_PATH) return handleStripePrices(request, env);
    if (pathname === CHECKOUT_PATH) return handleStripeCheckout(request, env);
    if (pathname === WEBHOOK_PATH) return handleStripeWebhook(request, env);

    // An /api/ path we don't serve. Answered here rather than falling through
    // to the assets, so a typo'd webhook URL gets a plain 404 instead of the
    // landing page's HTML with a 200 attached — which would look to Stripe like
    // a delivery that succeeded.
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return new Response('not found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    // Anything else: the static site. Only reachable on an asset miss, since
    // run_worker_first scopes this Worker to /api/*.
    return env.ASSETS.fetch(request);
  },
};
