// Sign-up / sign-in / sign-out / password reset — the only module that talks to
// `supabase.auth`. Everything else (account-ui.ts, main.ts) goes through these
// functions, so the rest of the app never has to know about sessions, tokens or
// redirects.
//
// THIS WHOLE MODULE IS INERT WHEN SUPABASE ISN'T CONFIGURED. The internal
// GitHub Pages build ships without the env vars, so `isSupabaseConfigured` is
// false there, every function below returns early, and no Account UI is ever
// built (see settings-screen.ts). That build keeps behaving exactly as it does
// today, beta-code gate and all — gate.ts is untouched by any of this.
//
// Auth is ADDITIVE for now: it sits alongside the beta gate rather than
// replacing it. Whether the gate eventually retires on the public build is a
// separate decision, made later.

import { supabase, isSupabaseConfigured } from './supabase';
import { showToast } from './toast';
import { track, trackOnce } from './metrics';
import type { AuthError, User, EmailOtpType } from '@supabase/supabase-js';

// ENTITLEMENT LIVES IN entitlement.ts, not here. There is exactly one answer to
// "is this user entitled?" and it comes from the `profiles.entitled` column.
// auth.ts's job is the session and nothing else.

// ── Which sign-in buttons this build shows ───────────────────────────────────
//
// A provider button that isn't enabled in the Supabase dashboard doesn't fail
// politely — it sends the user to Supabase and bounces back with "Unsupported
// provider", which reads like the app is broken. So the buttons are driven by
// one build-time variable rather than by hope:
//
//   VITE_AUTH_PROVIDERS=google,facebook,apple
//
// Unset means `google` alone, which is exactly what shipped before this existed.
// Turning one on is two steps and they must both happen: enable it in Supabase
// (Authentication → Providers, with that provider's own client id/secret), then
// add its name here and rebuild. See SUPABASE-SYNC.md for what each provider
// costs to set up — Apple in particular needs a paid Apple Developer account.
export type OAuthProvider = 'google' | 'facebook' | 'apple';

const KNOWN_PROVIDERS: OAuthProvider[] = ['google', 'facebook', 'apple'];

export const OAUTH_PROVIDER_LABELS: Record<OAuthProvider, string> = {
  google: 'Google',
  facebook: 'Facebook',
  apple: 'Apple',
};

const configuredProviders: OAuthProvider[] = (() => {
  const raw = (import.meta.env.VITE_AUTH_PROVIDERS ?? '').trim();
  if (!raw) return ['google'];
  const wanted = raw.toLowerCase().split(',').map((name: string) => name.trim());
  const picked = KNOWN_PROVIDERS.filter((p) => wanted.includes(p));
  // An empty or entirely misspelled list would silently remove every sign-in
  // button, which is worse than ignoring it.
  return picked.length > 0 ? picked : ['google'];
})();

export function enabledOAuthProviders(): OAuthProvider[] {
  return isSupabaseConfigured ? [...configuredProviders] : [];
}

// ── The return leg ───────────────────────────────────────────────────────────
//
// FOUR different journeys come back to this same URL, and telling them apart is
// most of this section:
//
//   1. an OAuth sign-in (Google/Facebook/Apple) → `?code=…`
//   2. confirming an email address              → `?token_hash=…&type=signup`
//   3. a password-reset link                    → `?token_hash=…&type=recovery`
//   4. a passwordless sign-in link              → `?token_hash=…&type=magiclink`
//   5. "Connect to Lichess" (lichess-auth.ts)   → `?code=…&state=…`
//
// (2), (3) and (4) are ONE mechanism, not three: the same `token_hash` branch
// hands whatever `type` the URL carries straight to `verifyOtp`. Adding magic
// link needed no new plumbing here — only a different sentence in the toast,
// because "Email confirmed" is the wrong thing to say to somebody who just
// signed in.
//
// PKCE is requested explicitly in supabase.ts: supabase-js still defaults to the
// *implicit* flow, which comes back as a `#access_token=…` fragment instead — a
// shape nothing below reads.
//
// If we let supabase-js pick codes out of the URL by itself
// (`detectSessionInUrl: true`) it would swallow Lichess's code and strip it from
// the URL before that library ever saw it, quietly breaking "Connect to
// Lichess". So the client keeps `detectSessionInUrl: false` and we claim the
// return ourselves, using the one marker that separates (4) from the rest:
// **Lichess always sends `state`, and Supabase never does.**
//
// That test used to be paired with a localStorage flag set immediately before
// the redirect to Google, and both had to agree. The flag has gone, and its
// going is a bug fix rather than a simplification: an email-confirmation link is
// opened from a mail app, often minutes or hours later and sometimes in a
// different browser, so no flag this app set could possibly still be standing.
// With the flag required, every confirmation link landed on an app that ignored
// it — you clicked "confirm", the address bar tidied itself, and nothing
// happened. `state` alone is a complete test, so `state` alone is the test.
//
// ── WHY EMAIL LINKS PREFER `token_hash` ─────────────────────────────────────
// A `?code=` can only be redeemed by the browser that started the flow, because
// only that browser holds the PKCE verifier. That is right for a sign-in button
// and wrong for an email: mail gets opened wherever mail gets opened. Supabase's
// `verifyOtp({ token_hash, type })` has no such requirement, which makes it the
// shape an email link should arrive in — so the email templates are changed
// once, in the dashboard, to send `token_hash` instead (SUPABASE-SYNC.md spells
// out the exact edit). Both shapes are handled below, because a project whose
// templates haven't been changed yet must still work on the device that asked.

interface AuthReturn {
  code?: string;
  tokenHash?: string;
  otpType?: EmailOtpType;
  // Supabase files each PKCE attempt's code-verifier under a per-flow id, and
  // exchangeCodeForSession() finds it again by reading `sb_flow_id` off the LIVE
  // url. We clean the url before calling it, so the id would be gone by then —
  // hence carrying it across here and passing it explicitly.
  flowId?: string;
  errorDescription?: string;
}

// Which `type` values on an email link we're prepared to verify. Anything else
// is ignored rather than passed through to Supabase as-is.
const OTP_TYPES: EmailOtpType[] = ['signup', 'recovery', 'invite', 'magiclink', 'email_change', 'email'];

function readOtpType(raw: string | null): EmailOtpType | undefined {
  return OTP_TYPES.find((t) => t === raw);
}

// Pull our auth result off the URL and tidy the address bar. Returns null when
// this load isn't the return leg of anything of ours.
function captureAuthReturn(): AuthReturn | null {
  if (!isSupabaseConfigured) return null;

  const params = new URLSearchParams(location.search);
  const hasSomething = params.has('code')
    || params.has('token_hash')
    || params.has('error')
    || params.has('error_description');
  if (!hasSomething) return null;
  // `state` means the Lichess library owns this callback, not us. Leave the URL
  // completely alone.
  if (params.has('state')) return null;

  // Read everything we need BEFORE the URL is tidied below — `sb_flow_id`
  // especially, since stripping it is exactly what would otherwise lose it.
  const result: AuthReturn = {
    code: params.get('code') ?? undefined,
    tokenHash: params.get('token_hash') ?? undefined,
    otpType: readOtpType(params.get('type')),
    flowId: params.get('sb_flow_id') ?? undefined,
    errorDescription: params.get('error_description') ?? params.get('error') ?? undefined,
  };

  for (const key of ['code', 'token_hash', 'type', 'error', 'error_description', 'error_code', 'sb_flow_id']) {
    params.delete(key);
  }
  const query = params.toString();
  history.replaceState(null, '', location.pathname + (query ? `?${query}` : '') + location.hash);

  return result;
}

// Runs on import — before boot has a chance to read the URL.
const authReturn = captureAuthReturn();

// ── Current user ─────────────────────────────────────────────────────────────
// A synchronous snapshot, because the UI is built synchronously. It's filled by
// initAuth() at boot and kept current by supabase's own auth listener.

let currentUser: User | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function getAuthUser(): User | null {
  return currentUser;
}

export function isSignedIn(): boolean {
  return currentUser !== null;
}

// Subscribe to sign-in / sign-out. Returns an unsubscribe function.
export function onAuthChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ── Password recovery, mid-flight ────────────────────────────────────────────
//
// Following a reset link signs you in — with a session Supabase marks as a
// recovery session — and then leaves you looking at the app, apparently already
// signed in, with no idea you were supposed to type a new password. So the
// arrival is remembered here and announced, and the UI puts the "choose a new
// password" sheet in front of it.

export const PASSWORD_RECOVERY_EVENT = 'obertura:passwordrecovery';

let recoveryPending = false;

export function isPasswordRecovery(): boolean {
  return recoveryPending;
}

export function clearPasswordRecovery(): void {
  recoveryPending = false;
}

function beginPasswordRecovery(): void {
  recoveryPending = true;
  window.dispatchEvent(new Event(PASSWORD_RECOVERY_EVENT));
}

// ── Boot ─────────────────────────────────────────────────────────────────────

// Call once at boot, and ONLY when Supabase is configured (main.ts checks).
// Completes whichever return leg we're on, then reads any stored session so the
// Account card can render signed-in on the first paint. Never throws — a failure
// here just leaves the app signed out.
export async function initAuth(): Promise<void> {
  if (!isSupabaseConfigured) return;

  // Keep the snapshot in step with everything supabase-js does on its own
  // (token refreshes, sign-out in another tab, the initial session).
  //
  // NOTHING AWAITS INSIDE THIS CALLBACK. supabase-js holds an internal lock
  // while it broadcasts, and a `supabase.*` call made from in here waits on a
  // lock the broadcast is holding. Listeners that need to talk to Supabase hop
  // to the next task first (see repertoire-sync.ts's `deferred`).
  supabase.auth.onAuthStateChange((event, session) => {
    currentUser = session?.user ?? null;
    // Supabase raises this itself when a recovery link is redeemed, which covers
    // the case where the link arrived in a shape we didn't have to decode.
    if (event === 'PASSWORD_RECOVERY') beginPasswordRecovery();
    notify();
  });

  if (authReturn?.errorDescription) {
    showToast(`Sign-in link failed — ${authReturn.errorDescription}`);
  } else if (authReturn?.tokenHash && authReturn.otpType) {
    // An email link: confirmation, recovery, or an address change. Works in any
    // browser, which is the whole reason to prefer this shape.
    try {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: authReturn.tokenHash,
        type: authReturn.otpType,
      });
      if (error) {
        showToast(friendlyAuthError(error));
      } else if (authReturn.otpType === 'recovery') {
        beginPasswordRecovery();
      } else if (authReturn.otpType === 'magiclink' || authReturn.otpType === 'email') {
        // A sign-in link, not a confirmation — there was no address to confirm.
        track('signed_in');
        showToast('Signed in', { variant: 'success' });
      } else {
        track('signed_in');
        showToast('Email confirmed — you’re signed in', { variant: 'success' });
      }
    } catch (err) {
      showToast(friendlyAuthError(err));
    }
  } else if (authReturn?.code) {
    try {
      const { error } = await supabase.auth.exchangeCodeForSession(
        authReturn.code,
        authReturn.flowId ? { flowId: authReturn.flowId } : undefined,
      );
      if (error) showToast(friendlyAuthError(error));
      else if (authReturn.otpType === 'recovery') beginPasswordRecovery();
      else { track('signed_in'); showToast('Signed in', { variant: 'success' }); }
    } catch (err) {
      showToast(friendlyAuthError(err));
    }
  }

  try {
    const { data } = await supabase.auth.getSession();
    currentUser = data.session?.user ?? null;
  } catch {
    currentUser = null; // offline or storage blocked — treat as signed out
  }
  notify();
}

// ── Actions ──────────────────────────────────────────────────────────────────
// Each returns a small result the UI can act on, and never throws.

export interface AuthResult {
  ok: boolean;
  // Set when a sign-up succeeded but Supabase is waiting on the confirmation
  // link before it will hand out a session.
  needsEmailConfirmation?: boolean;
  // Set when a magic-link request was refused because that address has no
  // account. The UI answers it by offering the Registration tab rather than
  // just reporting a failure.
  noSuchAccount?: boolean;
  // A plain-language message, ready to drop straight into a toast.
  message?: string;
}

// Where Supabase (and the OAuth providers) send the browser back to. Built from
// the app's own base path rather than the current URL, so it's the same string
// on every screen — which matters, because it has to match the allow-list
// exactly.
export function authRedirectUrl(): string {
  return location.origin + import.meta.env.BASE_URL;
}

export async function signUpWithPassword(email: string, password: string): Promise<AuthResult> {
  if (!isSupabaseConfigured) return { ok: false, message: 'Accounts aren’t available in this build.' };
  try {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: authRedirectUrl() },
    });
    if (error) return { ok: false, message: friendlyAuthError(error) };
    // ONCE ever on this device, not once per call. Re-registering is the normal
    // response to a confirmation email that never arrived (see account-ui.ts's
    // "Send it again" dialog), and counting each attempt would inflate the one
    // number a registration figure is for.
    trackOnce('signed_up_email');
    // No session back means Supabase wants the email confirmed first.
    if (!data.session) return { ok: true, needsEmailConfirmation: true };
    // A project with confirmation switched off signs the new account straight
    // in, and that is a sign-in like any other.
    track('signed_in');
    return { ok: true };
  } catch (err) {
    return { ok: false, message: friendlyAuthError(err) };
  }
}

export async function signInWithPassword(email: string, password: string): Promise<AuthResult> {
  if (!isSupabaseConfigured) return { ok: false, message: 'Accounts aren’t available in this build.' };
  try {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return { ok: false, message: friendlyAuthError(error) };
    track('signed_in');
    return { ok: true };
  } catch (err) {
    return { ok: false, message: friendlyAuthError(err) };
  }
}

// Leaves the app: the provider takes over the tab and sends the browser back to
// authRedirectUrl() with a `?code=`, which captureAuthReturn() picks up on the
// next load. Only returns (with an error) if the redirect couldn't be started.
export async function signInWithProvider(provider: OAuthProvider): Promise<AuthResult> {
  if (!isSupabaseConfigured) return { ok: false, message: 'Accounts aren’t available in this build.' };
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: authRedirectUrl(),
        // Apple and Facebook both need to be told to hand back an email; Google
        // sends one anyway. Asking for the smallest useful scope in each case
        // keeps the consent screen honest — the app wants an identity, not a
        // friends list.
        ...(provider === 'apple' ? { scopes: 'name email' } : {}),
        ...(provider === 'facebook' ? { scopes: 'email' } : {}),
      },
    });
    if (error) return { ok: false, message: friendlyAuthError(error) };
    return { ok: true };
  } catch (err) {
    return { ok: false, message: friendlyAuthError(err) };
  }
}

/**
 * Named shortcuts for the two providers the sign-in screen leads with. They are
 * one line each on purpose: `signInWithProvider` already does the work for every
 * provider generically, and a second implementation of it per provider is
 * exactly the kind of duplication that drifts. These exist so the UI reads as
 * what it is, and so adding Facebook meant adding a button, not plumbing.
 */
export function signInWithGoogle(): Promise<AuthResult> {
  return signInWithProvider('google');
}

export function signInWithFacebook(): Promise<AuthResult> {
  return signInWithProvider('facebook');
}

/**
 * Passwordless sign-in: email a one-tap link instead of asking for a password.
 *
 * `shouldCreateUser: false` IS THE POINT, not a detail. With it true (the
 * default) this call quietly becomes a second, parallel way to create an
 * account — one that skips the consent checkbox and the Terms the Registration
 * tab makes people agree to. Sign-up has exactly one door, and it is that tab.
 *
 * The cost of saying no is that Supabase then answers an unknown address with
 * `otp_disabled` — meaning "signups are off", which reads like the feature is
 * broken. `noSuchAccount` marks that one case so the UI can point at
 * registration instead. That does tell a stranger whether an address is
 * registered here, which the password-reset sheet deliberately doesn't; the
 * trade is accepted here because the alternative is a dead end that looks like
 * a bug ("we sent a link" for a link that will never arrive).
 */
export async function signInWithMagicLink(email: string): Promise<AuthResult> {
  if (!isSupabaseConfigured) return { ok: false, message: 'Accounts aren’t available in this build.' };
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: authRedirectUrl(),
        shouldCreateUser: false,
      },
    });
    if (error) {
      return { ok: false, message: friendlyAuthError(error), noSuchAccount: isNoAccountError(error) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: friendlyAuthError(err) };
  }
}

// "There's no account here" wearing Supabase's clothes. `otp_disabled` is what
// comes back when signInWithOtp is told not to create users and the address is
// unknown; older projects word it as a message instead of a code.
function isNoAccountError(err: unknown): boolean {
  const error = err as { code?: unknown; message?: unknown };
  if (error?.code === 'otp_disabled') return true;
  return typeof error?.message === 'string'
    && /signups not allowed for otp|signup.*disabled/i.test(error.message);
}

/**
 * Send the "forgot your password" email. Deliberately answers the SAME way
 * whether or not the address has an account: telling a stranger which emails are
 * registered here is an account-enumeration hole, and Supabase's own API returns
 * success either way for that reason.
 */
export async function sendPasswordReset(email: string): Promise<AuthResult> {
  if (!isSupabaseConfigured) return { ok: false, message: 'Accounts aren’t available in this build.' };
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: authRedirectUrl(),
    });
    if (error) return { ok: false, message: friendlyAuthError(error) };
    return { ok: true };
  } catch (err) {
    return { ok: false, message: friendlyAuthError(err) };
  }
}

/** Set a new password on the session a recovery link just created. */
export async function updatePassword(password: string): Promise<AuthResult> {
  if (!isSupabaseConfigured) return { ok: false, message: 'Accounts aren’t available in this build.' };
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { ok: false, message: friendlyAuthError(error) };
    clearPasswordRecovery();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: friendlyAuthError(err) };
  }
}

/** Send the confirmation email again, for the one that never arrived. */
export async function resendConfirmation(email: string): Promise<AuthResult> {
  if (!isSupabaseConfigured) return { ok: false, message: 'Accounts aren’t available in this build.' };
  try {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: { emailRedirectTo: authRedirectUrl() },
    });
    if (error) return { ok: false, message: friendlyAuthError(error) };
    return { ok: true };
  } catch (err) {
    return { ok: false, message: friendlyAuthError(err) };
  }
}

export async function signOut(): Promise<AuthResult> {
  if (!isSupabaseConfigured) return { ok: false, message: 'Accounts aren’t available in this build.' };
  try {
    const { error } = await supabase.auth.signOut();
    if (error) return { ok: false, message: friendlyAuthError(error) };
    currentUser = null;
    clearPasswordRecovery();
    notify();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: friendlyAuthError(err) };
  }
}

// ── Errors ───────────────────────────────────────────────────────────────────

// Supabase's own error text is written for developers ("Invalid login
// credentials", "AuthApiError: …"). Nothing raw ever reaches the user: this maps
// the handful we can actually hit onto sentences that say what to do next, and
// falls back to a calm generic line for everything else.
export function friendlyAuthError(err: unknown): string {
  const error = err as Partial<AuthError> & { message?: string };
  const code = typeof error?.code === 'string' ? error.code : '';
  const message = typeof error?.message === 'string' ? error.message : '';

  switch (code) {
    case 'invalid_credentials':
      return 'That email and password don’t match an account.';
    case 'email_not_confirmed':
      return 'Confirm your email first — check your inbox for the link.';
    case 'user_already_exists':
    case 'email_exists':
      return 'There’s already an account with that email. Sign in instead.';
    case 'weak_password':
      return 'That password is too weak — use at least 6 characters.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Too many tries. Wait a minute and try again.';
    case 'validation_failed':
      return 'Check the email address and try again.';
    case 'same_password':
      return 'That’s already your password.';
    case 'otp_expired':
      return 'That link has expired — ask for a new one.';
    case 'provider_disabled':
    case 'validation_failed_provider':
      return 'That sign-in method isn’t switched on yet.';
    case 'otp_disabled':
      // Only reachable from signInWithMagicLink, which asks Supabase not to
      // create accounts — so this always means "no account with that email".
      return 'No account with that email yet — register first.';
  }

  if (/invalid login credentials/i.test(message)) return 'That email and password don’t match an account.';
  if (/email not confirmed/i.test(message)) return 'Confirm your email first — check your inbox for the link.';
  if (/already registered/i.test(message)) return 'There’s already an account with that email. Sign in instead.';
  if (/password should be at least/i.test(message)) return 'That password is too short — use at least 6 characters.';
  if (/rate limit|too many/i.test(message)) return 'Too many tries. Wait a minute and try again.';
  if (/expired|invalid.*token/i.test(message)) return 'That link has expired — ask for a new one.';
  if (/signups not allowed for otp/i.test(message)) return 'No account with that email yet — register first.';
  if (/unsupported provider|provider is not enabled/i.test(message)) return 'That sign-in method isn’t switched on yet.';
  if (/failed to fetch|network|offline/i.test(message)) return 'Couldn’t reach the server — check your connection.';

  return 'Something went wrong. Try again in a moment.';
}
