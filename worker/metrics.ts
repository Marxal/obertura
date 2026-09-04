// POST /api/event — the whole of Bito Chess's analytics.
//
// ── WHAT THIS COUNTS, AND WHAT IT CANNOT ────────────────────────────────────
// One thing: "a named event on the allowlist below happened once today". The
// row it writes is `(name, day, hits)` and there is no third column, because
// there is nowhere for a third column's worth of information to come from.
//
// The endpoint deliberately does not read — and therefore cannot log, store or
// correlate — the client IP, the user agent, the Referer, any cookie, any
// Authorization header, or any user id. It does not set a cookie and it hands
// back no body, so it cannot plant an identifier either. `readName` accepts an
// object with EXACTLY the key `name` and rejects anything else, so a future
// caller cannot quietly start smuggling a field alongside it: adding one means
// changing this file, on purpose, where the change is visible.
//
// The consequence, which is the point: two visits cannot be told apart. Nothing
// here can answer "how many people", "was that the same person as yesterday",
// or "where did they come from" — only "how many times". That is the trade, and
// it was made deliberately (see docs/privacy.html).
//
// ── THIS FILE FAILS SOFT. DELIBERATELY. ─────────────────────────────────────
// worker/stripe-webhook.ts carries a banner saying the exact opposite — every
// error there returns a non-200 so Stripe retries, because a swallowed error
// means somebody paid and never got what they paid for. NONE of that reasoning
// applies here. A dropped count is a dropped count: there is no user waiting,
// nothing to reconcile, and no way to be wrong in a direction that costs anyone
// anything. So a Supabase outage, a missing secret and a cold database all
// produce the same 204 an accepted event does, and the caller never learns the
// difference. Do NOT "make this consistent" with the webhook.
//
// The one thing that is NOT swallowed is a bad request. An unknown name is a
// 400, loudly, because the only thing that can produce one is a bug in
// src/metrics.ts or somebody poking at the endpoint — and both are worth
// finding out about.

import { problem, supabaseServiceClient, supabaseUrl, type StripeEnv } from './stripe-env';

// The Workers execution context, hand-typed for the same reason `AssetFetcher`
// is in worker/index.ts: tsconfig.worker.json uses `lib: ["WebWorker"]` and
// pulls in no @cloudflare/workers-types, and this is the only member used.
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

// The security-definer function in Supabase. It takes a name and nothing else —
// the day comes from `current_date` INSIDE the function, so it is the database's
// clock (UTC) and never something a caller can choose. A client-supplied day
// would be both a free-text write and a way to backdate rows.
const RPC = 'bump_metric';

// ── THE ALLOWLIST ───────────────────────────────────────────────────────────
// The only strings that can ever become a row. It is a literal list, not a
// pattern, and that is the design: a pattern would let anyone who finds this
// endpoint write unbounded distinct rows into a table with no rate limit.
//
// Every name here also has to satisfy the `metrics_name_shape` check constraint
// on the table (`^[a-z0-9_]{1,40}$`), which is the same rule enforced a second
// time one layer down.
//
// Adding a name means editing BOTH this list and the MetricName union in
// src/metrics.ts. They are deliberately not shared: the app and the Worker are
// separate builds with separate typechecks, and a list short enough to read in
// one glance is cheaper than a shared module that has to be bundled twice.
const ALLOWED: ReadonlySet<string> = new Set([
  // Reach. `install` is the first launch on a browser profile; `app_open` is
  // one cold launch (see src/metrics.ts on why that is not quite "a session").
  'install',
  'app_open',
  // Retention, as a lagged ratio against `install`. NOT cohorts: nothing that
  // could pin a return to a particular install week ever leaves the device.
  'return_after_d2',
  'return_after_d7',
  'return_after_d30',
  // Did the first run work?
  'onboarding_complete',
  'starter_pack_added',
  // Is the app being used for what it is for?
  'line_saved',
  'drill_completed',
  'puzzle_session',
  'daily_completed',
  'endgame_solved',
  'games_imported',
  // Accounts and money.
  'signed_in',
  'signed_up_email',
  'purchase_confirmed',
]);

// A body big enough for `{"name":"return_after_d30"}` many times over and small
// enough that nothing interesting fits. Checked before parsing, so a large POST
// is dropped without being read into a structure.
const MAX_BODY = 200;

export async function handleMetricEvent(
  request: Request,
  env: StripeEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== 'POST') return problem(405, 'method not allowed');

  const name = await readName(request);
  if (!name) return problem(400, 'bad event');

  const url = supabaseUrl(env);
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && serviceRoleKey) {
    // waitUntil, not await: the response goes back now and the round trip to
    // Supabase finishes on its own time. Without it the Worker could be torn
    // down mid-flight and the count lost — a plain floating promise is not
    // enough on Workers.
    ctx.waitUntil(bump(url, serviceRoleKey, name));
  } else {
    // A deployment mistake, and worth saying so in the log — but not worth
    // telling the caller about, and certainly not worth an error the app would
    // have to handle. See the fail-soft note at the top.
    console.error('metrics: missing configuration');
  }

  // 204, with no body at all. `json()` is not used here on purpose: it always
  // writes one, and a 204 that carries a body is malformed.
  return new Response(null, { status: 204 });
}

// Pull the event name out of the body, or null for anything we won't accept.
//
// The single-key check is the load-bearing line. `{"name":"app_open"}` passes;
// `{"name":"app_open","uid":"…"}` is a 400. That is what keeps the endpoint's
// promise enforceable rather than merely intended.
async function readName(request: Request): Promise<string | null> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return null;
  }
  if (raw.length > MAX_BODY) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const keys = Object.keys(parsed as Record<string, unknown>);
  if (keys.length !== 1 || keys[0] !== 'name') return null;

  const name = (parsed as { name: unknown }).name;
  if (typeof name !== 'string' || !ALLOWED.has(name)) return null;
  return name;
}

// The write. Never throws — the caller has already answered.
//
// Logging the name is safe and deliberate: it came off the allowlist above, so
// it is one of sixteen fixed strings and says nothing about who sent it.
async function bump(url: string, serviceRoleKey: string, name: string): Promise<void> {
  try {
    const supabase = supabaseServiceClient(url, serviceRoleKey);
    const { error } = await supabase.rpc(RPC, { metric_name: name });
    if (error) console.error(`metrics: bump failed for ${name} (${error.message})`);
  } catch (err) {
    console.error(`metrics: bump threw for ${name} (${(err as Error)?.message ?? 'unknown'})`);
  }
}
