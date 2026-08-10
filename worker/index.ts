// The Worker entry point — the only server-side code in the project.
//
// ── WHY THERE IS NO `functions/` FOLDER ─────────────────────────────────────
// The obvious place to put a webhook on Cloudflare is `functions/api/foo.ts`,
// which is automatically served at `/api/foo`. That is a Cloudflare PAGES
// feature, and this project is not a Pages project — it is a Worker. The
// giveaway is wrangler.jsonc plus a deploy command of `npx wrangler deploy`
// (Pages would be `wrangler pages deploy`). Cloudflare's own migration guide
// is blunt about it: a `functions/` folder has to be compiled into a single
// Worker script before a Worker can use it, because Workers have no built-in
// file-based routing. A `functions/` folder here would simply never run.
//
// So routing is done the Workers way: by hand, in this file. It is about six
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
// Adding a second endpoint later means adding a branch here, nothing more.

import { handleLemonSqueezyWebhook, type WebhookEnv } from './lemonsqueezy-webhook';

// The static-asset binding, declared as `assets.binding` in wrangler.jsonc.
// Typed by hand rather than pulling in @cloudflare/workers-types: this is the
// only Workers type the project needs, and a dependency (plus a lockfile
// change that the GitHub Pages build would also have to install) is a poor
// trade for four lines.
interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

// WebhookEnv brings the three secrets with it, so they are declared in exactly
// one place — next to the code that reads them.
export interface Env extends WebhookEnv {
  ASSETS: AssetFetcher;
}

// Where Lemon Squeezy is pointed. Changing this means changing the URL in the
// Lemon Squeezy dashboard too (LEMONSQUEEZY-SETUP.md).
const LEMONSQUEEZY_WEBHOOK_PATH = '/api/lemonsqueezy/webhook';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === LEMONSQUEEZY_WEBHOOK_PATH) {
      return handleLemonSqueezyWebhook(request, env);
    }

    // An /api/ path we don't serve. Answered here rather than falling through
    // to the assets, so a typo'd webhook URL gets a plain 404 instead of the
    // landing page's HTML with a 200 attached — which would look to Lemon
    // Squeezy like a delivery that succeeded.
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
