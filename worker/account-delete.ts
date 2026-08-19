// POST /api/account/delete — the only way an account can be removed, and the
// only endpoint besides the Stripe webhook that touches the service-role key.
//
// ── WHY THIS NEEDS A SERVER AT ALL ──────────────────────────────────────────
// Deleting a row in `profiles` is not deleting an account: the account is a row
// in `auth.users`, which no browser key can touch — and shouldn't be able to.
// Supabase's admin API is the only thing that can, and it demands the
// service-role key, which bypasses row-level security entirely and must
// therefore never leave the Worker. So the app asks, the Worker verifies who is
// asking, and only then does the deleting.
//
// ── WHO IS ASKING ───────────────────────────────────────────────────────────
// The same model as /api/stripe/checkout, and for a much sharper reason. The id
// comes from an `Authorization: Bearer <supabase access token>` header that
// Supabase itself validates (verifyUser in stripe-env.ts), never from the
// request body. A body-supplied id here would be a hole big enough to delete a
// stranger's account by typing their uuid — the worst possible bug in the worst
// possible place.
//
// ── WHAT GOES ──────────────────────────────────────────────────────────────
// Everything. `profiles.id` is declared `references auth.users (id) on delete
// cascade` (SUPABASE-SYNC.md), so removing the auth user removes the synced copy
// with it, in one statement, with no second call to get half-done. What this
// endpoint does NOT touch is the phone: the local IndexedDB is the user's own
// data on their own device, and the app clears it separately, after this
// succeeds, having offered a backup first.
//
// A Stripe purchase is deliberately left alone. Deleting the account does not
// refund anything and does not pretend to; the terms say what a refund is, and
// a refund is a different request to a different place.

import {
  type StripeEnv,
  problem,
  json,
  supabasePublicConfig,
  supabaseServiceClient,
  verifyUser,
} from './stripe-env';

export async function handleAccountDelete(request: Request, env: StripeEnv): Promise<Response> {
  if (request.method !== 'POST') return problem(405, 'method not allowed');

  const config = supabasePublicConfig(env);
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  // A missing variable is a deployment mistake, not a bad request.
  if (!config || !serviceRoleKey) {
    console.error('account delete: missing configuration');
    return problem(500, 'not configured');
  }

  const user = await verifyUser(request, config);
  if (!user) return problem(401, 'not signed in');

  const supabase = supabaseServiceClient(config.url, serviceRoleKey);

  // The row would go on its own through the cascade, but deleting it first
  // means a failure halfway through leaves an account with no synced copy
  // rather than a deleted user whose data somehow survived. Of the two
  // half-states, that is the one the user asked for.
  const { error: rowError } = await supabase.from('profiles').delete().eq('id', user.id);
  if (rowError) {
    console.error(`account delete: row delete failed for ${user.id}: ${rowError.message}`);
    return problem(500, 'delete failed');
  }

  const { error } = await supabase.auth.admin.deleteUser(user.id);
  if (error) {
    console.error(`account delete: auth delete failed for ${user.id}: ${error.message}`);
    return problem(500, 'delete failed');
  }

  console.log(`account delete: removed ${user.id}`);
  return json({ ok: true });
}
