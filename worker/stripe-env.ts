// Everything the three Stripe endpoints share: the secrets they read, the two
// clients they build, and the handful of response shapes they answer with.
//
// ── WHY THE STRIPE SDK WORKS HERE AT ALL ────────────────────────────────────
// `stripe` is a Node library, and a Worker is not Node. It ships a separate
// build for exactly this, selected by an export condition in its package.json:
// wrangler resolves `workerd`, which lands on `stripe.esm.worker.js`. That build
// initialises the SDK with WebPlatformFunctions, whose defaults are
// `createFetchHttpClient()` (fetch instead of node:http) and
// `createSubtleCryptoProvider()` (WebCrypto instead of node:crypto). So there is
// nothing to configure — but there IS one thing to remember:
//
//   webhook signatures MUST be verified with `constructEventAsync()`, not
//   `constructEvent()`. WebCrypto is async, and the synchronous call throws a
//   deliberate error telling you so. See stripe-webhook.ts.
//
// TypeScript resolves the types through the package's `default` condition
// (esm/stripe.esm.node.d.ts) because export conditions carry no `types` for
// `workerd`. The type surface is identical; only the runtime build differs.
//
// ── WHY THE SECRETS ARE NOT `VITE_` ─────────────────────────────────────────
// Vite inlines anything prefixed `VITE_` into the JavaScript the browser
// downloads. For STRIPE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY that is not a
// mistake, it is a breach: either one lets its holder do anything the account
// can. These are Worker secrets, set in the Cloudflare dashboard or by
// `npx wrangler secret put`. See STRIPE-SETUP.md.
//
// Nothing in these files logs, echoes, or puts a secret in a response body,
// which is why the failure messages are all so terse.

import Stripe from 'stripe';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// The secrets, declared in exactly one place — next to the code that reads them.
// Every field is optional because a Worker with a half-finished dashboard is a
// real state, and each endpoint answers it with a loud 500 rather than throwing.
export interface StripeEnv {
  // Stripe → Developers → API keys. `sk_live_…` (or `sk_test_…` while testing).
  STRIPE_SECRET_KEY?: string;
  // Stripe → Developers → Webhooks → the endpoint's signing secret, `whsec_…`.
  STRIPE_WEBHOOK_SECRET?: string;
  // Optional, and worth setting: with it, /api/stripe/prices only lists prices
  // belonging to this one product, and /api/stripe/checkout refuses a price
  // that belongs to anything else. Without it, any active one-time price in the
  // account is sellable — which is fine for an account with one product and a
  // hole worth closing the day there are two.
  STRIPE_PRODUCT_ID?: string;

  // ── Supabase ──────────────────────────────────────────────────────────────
  // Both URL and anon key fall back to the `VITE_`-prefixed names, because the
  // Cloudflare project already sets those for the browser build and they are the
  // same strings. A Worker can read any plain variable whatever its name.
  // Without the fallback, a project that has only the VITE_ ones answers
  // `500 not configured` on every request while the dashboard looks perfectly
  // set up — which is exactly the state this project was once in.
  SUPABASE_URL?: string;
  VITE_SUPABASE_URL?: string;
  // The public key. Used only to VERIFY a user's access token — it can do
  // nothing else, and row-level security is what makes shipping it safe.
  SUPABASE_ANON_KEY?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  // The secret one. Bypasses every row-level security rule in the project, and
  // is the only key that can write `entitled` at all — the SQL in
  // SUPABASE-SYNC.md revokes UPDATE on that column from anon and authenticated.
  // Read by the webhook and nothing else.
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

// Supabase ids are auth.users UUIDs. Checked before the value reaches Postgres,
// so a malformed or injected id fails in front of the database rather than in it.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Stripe ids are opaque, but their shapes are documented and stable. Validating
// the shape before spending a round trip on a lookup keeps obvious junk out of
// the Stripe API and out of the logs.
export const PRICE_ID_RE = /^price_[A-Za-z0-9]+$/;

export function stripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    // `apiVersion` is deliberately NOT set. Each release of the SDK pins the one
    // API version its TypeScript types were generated against (v22.5.0 pins
    // 2026-07-29.dahlia) and sends it by default. Naming a version here would
    // let the two drift apart: the types would keep describing one payload shape
    // while Stripe sent another, and TypeScript would cheerfully agree with the
    // wrong one. Upgrading the package moves both together, which is the whole
    // point. Check the changelog when you do.
    //
    // Two attempts, not the SDK's default of none. A Worker request that dies on
    // a transient Stripe hiccup is a customer staring at a button that did
    // nothing; a retry costs milliseconds. Stripe's own idempotency handling
    // makes this safe for the GET, and session creation is cheap to repeat.
    maxNetworkRetries: 2,
    // Named in Stripe's request logs, so a support question can be answered
    // without guessing which integration made the call.
    appInfo: { name: 'Bito Chess', url: 'https://bitochess.com' },
  });
}

// The public client, used for one job only: turning a user's access token into a
// verified id and email. Nothing else in these files trusts anything the browser
// says about who it is.
export function supabaseAnonClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, { auth: STATELESS_AUTH });
}

// The privileged client. Only stripe-webhook.ts builds one.
export function supabaseServiceClient(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, { auth: STATELESS_AUTH });
}

// A Worker is stateless and neither key is a browser session, so none of
// supabase-js's session machinery should run — there is no storage for it to run
// against, and `detectSessionInUrl` would be reading a URL that isn't a page.
const STATELESS_AUTH = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const;

// ── Resolving the configuration ──────────────────────────────────────────────

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

// The URL and anon key, or null when either is missing. Callers turn null into a
// 500: a missing variable is a deployment mistake, not a bad request.
export function supabasePublicConfig(env: StripeEnv): SupabaseConfig | null {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  return url && anonKey ? { url, anonKey } : null;
}

export function supabaseUrl(env: StripeEnv): string | undefined {
  return env.SUPABASE_URL || env.VITE_SUPABASE_URL;
}

// ── Who is asking ────────────────────────────────────────────────────────────

export interface VerifiedUser {
  id: string;
  // Supabase allows an account with no email (a phone or anonymous sign-in).
  // None of the current sign-in routes produce one, but the type is honest about
  // it and the checkout simply skips pre-filling in that case.
  email?: string;
}

// Verify an `Authorization: Bearer <supabase access token>` header and return
// who it belongs to. Returns null for a missing, malformed, expired or forged
// token.
//
// THIS IS THE WHOLE SECURITY MODEL of /api/stripe/checkout, so it is worth
// being explicit about the alternative: taking a `user_id` from the request body
// would let anyone POST anyone else's id and, on paying, entitle a stranger's
// account — or, far more likely, let a bug quietly attach purchases to the wrong
// row. The id has to come from something the caller cannot forge, and a signed
// JWT that Supabase itself validates is exactly that.
export async function verifyUser(
  request: Request,
  config: SupabaseConfig,
): Promise<VerifiedUser | null> {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1].trim();
  if (!token) return null;

  try {
    const supabase = supabaseAnonClient(config.url, config.anonKey);
    // getUser(jwt) asks Supabase to validate the token rather than decoding it
    // here. A locally-decoded JWT would need the project's signing secret to be
    // trustworthy, and a Worker that holds that secret is a Worker that can mint
    // sessions. One round trip is the better trade.
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;
    const { id, email } = data.user;
    if (typeof id !== 'string' || !UUID_RE.test(id)) return null;
    return { id, email: typeof email === 'string' && email ? email : undefined };
  } catch {
    // Network trouble reaching Supabase. Indistinguishable from a bad token
    // from here, and the caller's 401 tells the app to try again — which is the
    // right outcome either way.
    return null;
  }
}

// ── Responses ────────────────────────────────────────────────────────────────

export function json(body: unknown, status = 200, cacheSeconds = 0): Response {
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
  };
  headers['cache-control'] = cacheSeconds > 0
    ? `public, max-age=${cacheSeconds}`
    // The default for everything that touches a user or takes money. Without
    // it an intermediary is within its rights to hand a second person the first
    // person's checkout URL.
    : 'no-store';
  return new Response(JSON.stringify(body), { status, headers });
}

// Every failure goes through here, so the bodies stay short and say nothing
// about the configuration. The status code is the part that matters: Stripe
// reads it to decide whether to retry a webhook, and the app reads it to decide
// what to tell the user.
export function problem(status: number, message: string): Response {
  return json({ error: message }, status);
}
