// "Delete my account" — the app half.
//
// Two things have to happen and they are genuinely different things, which is
// why this module exists rather than a button calling one function:
//
//   1. THE ACCOUNT. A row in `auth.users` plus the synced copy in `profiles`.
//      Only the Worker can remove it (worker/account-delete.ts) — the browser
//      has no key that may touch `auth.users`, and giving it one would be far
//      worse than the inconvenience.
//   2. THE PHONE. Everything in IndexedDB and localStorage. That is the user's
//      own data on the user's own device; deleting the account does not delete
//      it, and quietly wiping a phone because someone closed an online account
//      would be a nasty surprise. So it's a separate, clearly-labelled choice on
//      the same dialog.
//
// The order matters. The account goes first: if that fails there is nothing to
// clean up and nothing has been lost. Wiping the phone first and then failing to
// delete the account would leave someone with no data AND an account they asked
// to be rid of.

import { supabase, isSupabaseConfigured } from './supabase';
import { getAuthUser, signOut } from './auth';

const ENDPOINT = '/api/account/delete';

// Long enough for a cold Worker plus two Supabase round trips, short enough that
// nobody is left staring at a spinner wondering whether it worked.
const TIMEOUT_MS = 20_000;

/**
 * Delete the signed-in account on the server. Throws with a readable message on
 * failure — unlike most things in this app, the user is watching this one and
 * has to know whether it happened.
 *
 * Does NOT touch local data and does NOT sign out; the caller decides both,
 * because "delete my account" and "wipe this phone" are separate answers.
 */
export async function deleteAccountOnServer(): Promise<void> {
  if (!isSupabaseConfigured) throw new Error('Accounts aren’t available in this build.');
  if (!getAuthUser()) throw new Error('You’re not signed in.');

  // The Worker verifies this token with Supabase rather than trusting anything
  // in the body, so a stale one has to be refused here rather than sent.
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new Error('Your session has expired — sign in again first.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
  } catch {
    throw new Error('Couldn’t reach the server — check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }

  if (response.ok) return;
  if (response.status === 401) throw new Error('Your session has expired — sign in again first.');
  if (response.status === 404) {
    // The GitHub Pages mirror has no Worker at all, and a Cloudflare deploy that
    // predates this endpoint answers the same way. Worth naming, because "try
    // again" is exactly the wrong advice for it.
    throw new Error('This build has no delete endpoint — deploy the Worker first.');
  }
  throw new Error('The server couldn’t delete the account. Try again in a moment.');
}

/** Sign out after a deletion. The account is gone, so failure is harmless. */
export async function signOutAfterDelete(): Promise<void> {
  try {
    await signOut();
  } catch {
    /* the account no longer exists; the stored session is inert either way */
  }
}
