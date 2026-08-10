// The Lemon Squeezy purchase webhook — the server half of the buy flow.
//
// Lemon Squeezy calls this after someone pays. It checks the call is really
// from Lemon Squeezy, digs the Supabase user id out of the checkout's custom
// data, and flips that user's `profiles.entitled` to true. The app already
// reads that flag (src/entitlement.ts); this is the only thing that writes it.
//
// ── THIS FILE DELIBERATELY FAILS LOUDLY ─────────────────────────────────────
// Everywhere else in this app the rule is fail-soft: a failed request leaves
// the previous answer standing and the user never sees an error. THIS FILE IS
// THE EXCEPTION, and the exception is the whole point. A webhook has no user
// watching it — if we swallow an error and return 200, Lemon Squeezy marks the
// delivery as successful, never retries, and a customer who really did pay is
// silently left on the free tier. So every verification failure and every
// processing error returns a NON-200 status, which is Lemon Squeezy's signal
// to retry the delivery (and to show it as failed in the store's webhook log,
// where it can actually be noticed). Do not "fix" this to fail soft.
//
// The one thing that DOES return 200 is a properly signed event we simply
// don't act on — a refund, a subscription ping, an order that isn't paid yet.
// Those are not failures, and retrying them forever would achieve nothing.
//
// ── SECRETS ─────────────────────────────────────────────────────────────────
// Three values come from the Cloudflare environment and none of them are ever
// sent to the browser. They are Worker secrets, NOT Vite `VITE_` variables:
// Vite inlines those into the bundle, which for either of these keys would be
// a catastrophe. Nothing here logs them, echoes them, or puts them in a
// response body — the failure messages below are deliberately terse for that
// reason. See LEMONSQUEEZY-SETUP.md for how to set them.
//
//   LEMONSQUEEZY_WEBHOOK_SECRET  the signing secret from the webhook's setup
//   SUPABASE_SERVICE_ROLE_KEY    bypasses row-level security — the only key
//                                that can write `entitled` at all, since the
//                                SQL in SUPABASE-SYNC.md revokes UPDATE on
//                                that column from anon and authenticated
//   SUPABASE_URL                 not secret, but it lives here too because the
//                                Worker can't read the app's build-time vars
//
// ── HOW THE SIGNATURE WORKS (verified against Lemon Squeezy's docs) ─────────
// Every delivery carries an `X-Signature` header: an HMAC-SHA256 of the RAW
// request body, keyed by the signing secret, hex-encoded. Raw means the exact
// bytes as sent — parse the JSON first and re-serialise it and the hash will
// not match, which is why the body is read as text here and only parsed after
// the check passes. The comparison uses crypto.subtle.verify rather than a
// string ===, so it doesn't leak the expected signature one byte at a time.

import { createClient } from '@supabase/supabase-js';

// Only what this handler is allowed to see. The Worker's full Env (which also
// holds the static-asset binding) extends this in index.ts, so nothing here
// can reach for anything beyond these three.
export interface WebhookEnv {
  LEMONSQUEEZY_WEBHOOK_SECRET?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

const SIGNATURE_HEADER = 'x-signature';
const TABLE = 'profiles';

// The event that means "someone completed a one-time purchase". Bito Chess
// sells a single €10 unlock, not a subscription, so this is the only event
// that grants access. `status` is checked as well because an order can exist
// before it is actually paid (`pending`, and later `refunded`).
const PURCHASE_EVENT = 'order_created';
const PAID_STATUS = 'paid';

// The checkout must be created with this key in its custom data — Lemon
// Squeezy passes it straight through to `meta.custom_data`. See
// LEMONSQUEEZY-SETUP.md; if the checkout link forgets it, there is no way to
// tell which account paid, and that lands here as a loud 422.
const USER_ID_KEY = 'user_id';

// Supabase ids are auth.users UUIDs. Checked before the value is used so a
// malformed or injected id fails here rather than in Postgres.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleLemonSqueezyWebhook(
  request: Request,
  env: WebhookEnv,
): Promise<Response> {
  if (request.method !== 'POST') return problem(405, 'method not allowed');

  const secret = env.LEMONSQUEEZY_WEBHOOK_SECRET;
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  // Missing configuration is a deployment mistake, not a bad request. 500 so
  // Lemon Squeezy retries — the deliveries that arrive before the secrets are
  // set will then land on their own once they are.
  if (!secret || !supabaseUrl || !serviceRoleKey) {
    console.error('lemonsqueezy webhook: missing configuration');
    return problem(500, 'not configured');
  }

  // Raw bytes, before any parsing — see the signature note in the header.
  const rawBody = await request.text();
  const signature = request.headers.get(SIGNATURE_HEADER) ?? '';
  if (!(await signatureMatches(secret, rawBody, signature))) {
    console.error('lemonsqueezy webhook: signature rejected');
    return problem(401, 'bad signature');
  }

  // Everything from here on is known to have come from Lemon Squeezy.
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    console.error('lemonsqueezy webhook: body was not JSON');
    return problem(400, 'bad payload');
  }

  const event = payload?.meta?.event_name;
  const status = payload?.data?.attributes?.status;
  const orderId = payload?.data?.id ?? 'unknown';

  // Signed, genuine, and not a purchase we act on. 200: nothing is wrong, and
  // a retry would only bring the same event back.
  if (event !== PURCHASE_EVENT || status !== PAID_STATUS) {
    console.log(`lemonsqueezy webhook: ignoring ${event ?? 'unnamed'} (status ${status ?? 'none'})`);
    return new Response('ignored', { status: 200 });
  }

  // Test-mode orders are honoured. They can only be produced from inside this
  // store, the signature proves they came from Lemon Squeezy, and being able
  // to exercise the whole path without spending €10 is worth more than the
  // theoretical tidiness of rejecting them. Flip this to a 200 "ignored" if a
  // test purchase ever needs to stop granting access.
  if (payload?.meta?.test_mode) {
    console.log(`lemonsqueezy webhook: order ${orderId} is TEST MODE — entitling anyway`);
  }

  const userId = payload?.meta?.custom_data?.[USER_ID_KEY];
  if (typeof userId !== 'string' || !UUID_RE.test(userId)) {
    // Somebody paid and we cannot tell who. Loud on purpose: this shows up as
    // a failed delivery in the Lemon Squeezy dashboard, which is the only way
    // it gets noticed and fixed by hand.
    console.error(`lemonsqueezy webhook: order ${orderId} carried no usable ${USER_ID_KEY}`);
    return problem(422, 'no user id');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      // A Worker is stateless and this key is not a user session — none of
      // supabase-js's session machinery should run, and there is no storage
      // for it to run against.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  // Upsert rather than update: a user can pay before their first sync has
  // created their profile row, and an update would then quietly match zero
  // rows. On an existing row Postgres only overwrites the two columns named
  // here, so a repertoire already in that row is untouched.
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(
      { id: userId, entitled: true, entitled_at: new Date().toISOString() },
      { onConflict: 'id' },
    )
    .select('id');

  if (error) {
    // error.message is Postgres/PostgREST text — it never contains the key.
    console.error(`lemonsqueezy webhook: supabase write failed for order ${orderId}: ${error.message}`);
    return problem(500, 'write failed');
  }

  if (!data || data.length === 0) {
    console.error(`lemonsqueezy webhook: order ${orderId} matched no profile row`);
    return problem(500, 'no row written');
  }

  console.log(`lemonsqueezy webhook: entitled ${userId} from order ${orderId}`);
  return new Response('ok', { status: 200 });
}

// ── Signature checking ───────────────────────────────────────────────────────

async function signatureMatches(
  secret: string,
  rawBody: string,
  signatureHex: string,
): Promise<boolean> {
  const signature = hexToBuffer(signatureHex);
  if (!signature) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  // verify() compares in constant time and simply returns false on a
  // wrong-length signature, so there is no manual comparison to get wrong.
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(rawBody));
}

// Strict hex decode — anything that isn't an even-length run of hex digits is
// rejected outright rather than silently decoding to NaN bytes.
//
// Returns the ArrayBuffer rather than the Uint8Array view over it purely to
// keep TypeScript happy across versions: from 5.7 on, typed arrays carry their
// buffer type as a generic, and a bare `new Uint8Array(n)` widens to
// `ArrayBufferLike`, which no longer satisfies `BufferSource`. The buffer
// itself always has. Same bytes either way.
function hexToBuffer(hex: string): ArrayBuffer | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) return null;
  const buffer = new ArrayBuffer(hex.length / 2);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return buffer;
}

// ── Odds and ends ────────────────────────────────────────────────────────────

// Every non-200 goes through here, so the bodies stay short and say nothing
// about the configuration. Lemon Squeezy reads the status code, not the text.
function problem(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

// Only the parts of the payload this handler actually reads. Lemon Squeezy
// sends a great deal more; typing all of it would be a maintenance burden for
// no gain, and everything here is treated as untrusted and checked anyway.
interface WebhookPayload {
  meta?: {
    event_name?: string;
    test_mode?: boolean;
    // Custom data set on the checkout. Lemon Squeezy returns these values as
    // strings regardless of what was put in, hence the typeof check above.
    custom_data?: Record<string, unknown>;
  };
  data?: {
    id?: string;
    attributes?: { status?: string };
  };
}
