// POST /api/stripe/webhook — the only thing in this project that can grant
// full access.
//
// Stripe calls it after someone pays. It checks the call is really from Stripe,
// digs the Supabase user id out of the session's metadata, and flips that user's
// `profiles.entitled` to true. The app reads that flag (src/entitlement.ts) and
// never writes it — it can't: the SQL in SUPABASE-SYNC.md revokes UPDATE on that
// column from every key the browser has. Only the service_role key used here can
// write it, which is what makes the flag worth trusting.
//
// ── THIS FILE DELIBERATELY FAILS LOUDLY ─────────────────────────────────────
// Everywhere else in this app the rule is fail-soft: a failed request leaves the
// previous answer standing and the user never sees an error. THIS FILE IS THE
// EXCEPTION, and the exception is the whole point. A webhook has no user watching
// it — if we swallow an error and return 200, Stripe marks the delivery as
// succeeded, stops retrying, and a customer who really did pay is silently left
// on the free tier. So every verification failure and every processing error
// returns a NON-200, which is Stripe's signal to retry (and to show the endpoint
// as failing in the dashboard, where it can actually be noticed). Stripe retries
// with backoff for up to three days, so a Supabase outage or a missing secret
// resolves itself once fixed. DO NOT "fix" this to fail soft.
//
// The one thing that DOES return 200 is a properly signed event we simply don't
// act on. Those are not failures, and retrying them forever would achieve
// nothing.
//
// ── SIGNATURE VERIFICATION ──────────────────────────────────────────────────
// Every delivery carries a `Stripe-Signature` header: a timestamp plus an
// HMAC-SHA256 of `timestamp.rawBody`, keyed by the endpoint's signing secret.
// RAW body means the exact bytes as sent — parse the JSON and re-serialise it and
// the hash will not match, which is why the body is read as text here and only
// turned into an event by Stripe's own verifier.
//
// It MUST be `constructEventAsync`, not `constructEvent`. On Workers the SDK
// verifies with WebCrypto, which is asynchronous; the synchronous call throws an
// error that says exactly this. The verifier also enforces a timestamp tolerance,
// which is what stops a captured delivery being replayed later.
//
// ── ON REPLAYS AND DOUBLE DELIVERY ──────────────────────────────────────────
// There is no event-id ledger here, on purpose. Every write below is idempotent —
// an upsert of the same flags to the same row — so processing one event twice
// produces exactly the state processing it once does. Stripe retries and
// occasionally delivers twice; both are harmless.

import type Stripe from 'stripe';
import {
  type StripeEnv,
  UUID_RE,
  problem,
  stripeClient,
  supabaseServiceClient,
  supabaseUrl,
} from './stripe-env';

const SIGNATURE_HEADER = 'stripe-signature';
const TABLE = 'profiles';

// The checkout must be created with this key in its metadata — see
// stripe-checkout.ts, which is the only thing that creates one. If it is ever
// missing, somebody paid and we cannot tell who, and that lands here as a loud
// 422 so it shows up red in the Stripe dashboard rather than vanishing.
const USER_ID_KEY = 'user_id';

export async function handleStripeWebhook(request: Request, env: StripeEnv): Promise<Response> {
  if (request.method !== 'POST') return problem(405, 'method not allowed');

  const secretKey = env.STRIPE_SECRET_KEY;
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  const url = supabaseUrl(env);
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  // Missing configuration is a deployment mistake, not a bad request. 500 so
  // Stripe retries — the deliveries that arrive before the secrets are set then
  // land on their own once they are.
  if (!secretKey || !webhookSecret || !url || !serviceRoleKey) {
    console.error('stripe webhook: missing configuration');
    return problem(500, 'not configured');
  }

  // Raw bytes, before any parsing — see the signature note above.
  const rawBody = await request.text();
  const signature = request.headers.get(SIGNATURE_HEADER) ?? '';

  let event: Stripe.Event;
  try {
    const stripe = stripeClient(secretKey);
    // Async, because WebCrypto is. Throws on a bad signature, a missing header,
    // or a timestamp outside the tolerance window.
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch (err) {
    // Never log the body or the signature; the message describes which check
    // failed, which is all that's useful anyway.
    console.error(`stripe webhook: signature rejected (${describe(err)})`);
    return problem(401, 'bad signature');
  }

  // Everything from here on is known to have come from Stripe.
  const supabase = supabaseServiceClient(url, serviceRoleKey);

  switch (event.type) {
    // The ordinary path: card or wallet, paid on the spot.
    case 'checkout.session.completed':
    // The delayed path. Some methods (a bank debit, for instance) complete the
    // session first and confirm the money days later. The session above arrives
    // `unpaid` and is ignored; THIS is the event that means it cleared. Without
    // this case such a customer would pay and never be entitled.
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object as Stripe.Checkout.Session;

      // A completed session is not necessarily a paid one.
      if (session.payment_status === 'unpaid') {
        console.log(`stripe webhook: session ${session.id} not paid yet (awaiting settlement)`);
        return ok('pending');
      }

      const userId = readUserId(session.metadata, session.client_reference_id);
      if (!userId) {
        console.error(`stripe webhook: session ${session.id} carried no usable ${USER_ID_KEY}`);
        return problem(422, 'no user id');
      }

      return grant(supabase, userId, session);
    }

    // A refund. The terms promise that a refunded account returns to the free
    // tier, so this makes that true rather than leaving it to be remembered by
    // hand. FULL refunds only — a partial refund (a goodwill gesture, a currency
    // correction) must not take away what somebody still mostly paid for.
    //
    // The charge has no session, which is why stripe-checkout.ts puts the id on
    // the payment intent as well: a charge inherits its intent's metadata, so
    // this is the same id the grant used.
    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      if (!charge.refunded) {
        console.log(`stripe webhook: charge ${charge.id} only partially refunded — access kept`);
        return ok('partial refund');
      }

      const userId = readUserId(charge.metadata, null);
      if (!userId) {
        // Loud: a refund we cannot apply is a person who should be back on the
        // free tier and isn't. Fix it by unticking `entitled` by hand.
        console.error(`stripe webhook: refunded charge ${charge.id} carried no usable ${USER_ID_KEY}`);
        return problem(422, 'no user id');
      }

      return revoke(supabase, userId, charge.id);
    }

    // Registered in the dashboard per the original migration spec, and genuinely
    // unreachable: this account sells a one-time payment, so no subscription
    // exists to update or cancel. Answered explicitly rather than falling into
    // the default so that the day a subscription IS introduced, the log says
    // where the work goes instead of the event disappearing into "ignoring".
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      console.log(
        `stripe webhook: ${event.type} received, but Bito Chess sells a one-time `
        + 'unlock — no subscription state to sync',
      );
      return ok('not a subscription product');

    default:
      // Signed, genuine, and not something we act on. 200: nothing is wrong, and
      // a retry would only bring the same event back.
      console.log(`stripe webhook: ignoring ${event.type}`);
      return ok('ignored');
  }
}

// ── The two writes ───────────────────────────────────────────────────────────

// Upsert rather than update: a user can pay before their first sync has created
// their profile row, and an update would then quietly match zero rows. On an
// existing row Postgres only overwrites the columns named here, so a repertoire
// already in that row is untouched.
async function grant(
  supabase: ReturnType<typeof supabaseServiceClient>,
  userId: string,
  session: Stripe.Checkout.Session,
): Promise<Response> {
  const row: Record<string, unknown> = {
    id: userId,
    entitled: true,
    entitled_at: new Date().toISOString(),
  };

  // Both are for the humans, not the app: nothing reads them, and they exist so
  // a row can answer "which Stripe payment was this?" without searching the
  // dashboard by email. Only written when present, so a re-delivery of an older
  // event can't blank a value a newer one set.
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  if (customerId) row.stripe_customer_id = customerId;
  const intentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id;
  if (intentId) row.stripe_payment_intent_id = intentId;

  const { data, error } = await supabase
    .from(TABLE)
    .upsert(row, { onConflict: 'id' })
    .select('id');

  if (error) {
    // error.message is Postgres/PostgREST text — it never contains the key.
    console.error(`stripe webhook: write failed for session ${session.id}: ${error.message}`);
    return problem(500, 'write failed');
  }
  if (!data || data.length === 0) {
    console.error(`stripe webhook: session ${session.id} matched no profile row`);
    return problem(500, 'no row written');
  }

  console.log(`stripe webhook: entitled ${userId} from session ${session.id}`);
  return ok('ok');
}

// A refund. `update`, not `upsert`: if there is no row there is nothing to take
// away, and inserting one to record an absence would be odd. Zero rows matched is
// therefore fine here, unlike in grant().
//
// `entitled_at` is deliberately left alone — it records when access was granted,
// and a refund doesn't unhappen that. The timestamp plus a false flag is a more
// useful history than a blank.
async function revoke(
  supabase: ReturnType<typeof supabaseServiceClient>,
  userId: string,
  chargeId: string,
): Promise<Response> {
  const { error } = await supabase
    .from(TABLE)
    .update({ entitled: false })
    .eq('id', userId);

  if (error) {
    console.error(`stripe webhook: revoke failed for charge ${chargeId}: ${error.message}`);
    return problem(500, 'write failed');
  }

  console.log(`stripe webhook: revoked ${userId} after refund on charge ${chargeId}`);
  return ok('revoked');
}

// ── Odds and ends ────────────────────────────────────────────────────────────

// The account id, from metadata or (for a session) the client reference that
// carries the same value. Validated as a UUID before it is allowed near
// Postgres — Stripe metadata is a free-text store, so this is untrusted input
// even though the signature proves who sent it.
function readUserId(
  metadata: Stripe.Metadata | null | undefined,
  clientReferenceId: string | null,
): string | null {
  const candidates = [metadata?.[USER_ID_KEY], clientReferenceId];
  for (const value of candidates) {
    if (typeof value === 'string' && UUID_RE.test(value)) return value;
  }
  return null;
}

// Stripe reads the status code, not the text, so the bodies are for whoever is
// reading `wrangler tail`.
function ok(message: string): Response {
  return new Response(message, {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'unknown error';
}
