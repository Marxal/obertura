// Sign-up / sign-in / sign-out — the only module that talks to `supabase.auth`.
// Everything else (account-ui.ts, main.ts) goes through these functions, so the
// rest of the app never has to know about sessions, tokens or redirects.
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
import type { AuthError, User } from '@supabase/supabase-js';

// How many lines a free account gets. Shown on the Account card; nothing
// enforces it yet — entitlement logic lands in a later session.
export const FREE_LINE_LIMIT = 3;

export type Entitlement = 'full' | 'free';

// ── The OAuth return leg ─────────────────────────────────────────────────────
// Supabase's PKCE flow comes back to the app as `?code=…`, and so does the
// Lichess connect flow (lichess-auth.ts). If we let supabase-js pick codes out
// of the URL by itself (`detectSessionInUrl: true`) it would swallow Lichess's
// code and strip it from the URL before that library ever saw it, quietly
// breaking "Connect to Lichess".
//
// So the client keeps `detectSessionInUrl: false` and we claim the code
// ourselves — but ONLY when we know it's ours. Two things have to agree:
//
//   1. we set a flag in localStorage immediately before redirecting to Google,
//      and it's recent (a stale flag from an abandoned sign-in is ignored), and
//   2. the URL has no `state` parameter — Supabase doesn't send one, and the
//      Lichess library always does, so `state` present means "not ours".
//
// The capture runs at module load (synchronously, on import) so the code is
// taken off the URL before anything else in boot can look at it.

const OAUTH_PENDING_KEY = 'obertura.supabase.oauthPending';
const OAUTH_PENDING_MAX_AGE_MS = 10 * 60 * 1000;

interface OAuthReturn {
  code?: string;
  errorDescription?: string;
}

function markOAuthPending(): void {
  try { localStorage.setItem(OAUTH_PENDING_KEY, String(Date.now())); } catch { /* storage off */ }
}

// True once, if a Google sign-in we started is still in flight. Always clears
// the flag, so a redirect that never came back can't linger and claim someone
// else's `?code=` later.
function takeOAuthPending(): boolean {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(OAUTH_PENDING_KEY);
    localStorage.removeItem(OAUTH_PENDING_KEY);
  } catch { /* storage off — we simply won't complete the redirect */ }
  if (!raw) return false;
  const started = Number(raw);
  return Number.isFinite(started) && Date.now() - started < OAUTH_PENDING_MAX_AGE_MS;
}

// Pull our OAuth result off the URL and tidy the address bar. Returns null when
// this load isn't the return leg of a sign-in we started.
function captureOAuthReturn(): OAuthReturn | null {
  if (!isSupabaseConfigured) return null;

  const params = new URLSearchParams(location.search);
  const hasSomething = params.has('code') || params.has('error') || params.has('error_description');
  if (!hasSomething) {
    // Nothing to claim — but still expire a stale pending flag.
    takeOAuthPending();
    return null;
  }
  // `state` means the Lichess library owns this callback, not us. Leave the URL
  // completely alone (and leave our flag in place, in case our own return is
  // still to come).
  if (params.has('state')) return null;
  if (!takeOAuthPending()) return null;

  const result: OAuthReturn = {
    code: params.get('code') ?? undefined,
    errorDescription: params.get('error_description') ?? params.get('error') ?? undefined,
  };

  for (const key of ['code', 'error', 'error_description', 'error_code', 'sb_flow_id']) {
    params.delete(key);
  }
  const query = params.toString();
  history.replaceState(null, '', location.pathname + (query ? `?${query}` : '') + location.hash);

  return result;
}

// Runs on import — before boot has a chance to read the URL.
const oauthReturn = captureOAuthReturn();

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

// The user's plan. PLACEHOLDER: it reads a flag Supabase may put on the account
// and otherwise says "free". Nothing sets that flag yet and nothing enforces the
// limit — real entitlement (and the purchase that grants it) is a later session.
// This exists only so the Account card can show an honest status today.
export function getEntitlement(): Entitlement {
  const user = currentUser;
  if (!user) return 'free';
  const fromApp = (user.app_metadata as Record<string, unknown> | undefined)?.entitlement;
  const fromUser = (user.user_metadata as Record<string, unknown> | undefined)?.entitlement;
  return fromApp === 'full' || fromUser === 'full' ? 'full' : 'free';
}

export function entitlementLabel(): string {
  return getEntitlement() === 'full' ? 'Full access' : `Free — ${FREE_LINE_LIMIT} lines`;
}

// ── Boot ─────────────────────────────────────────────────────────────────────

// Call once at boot, and ONLY when Supabase is configured (main.ts checks).
// Completes a Google sign-in if we're returning from one, then reads any stored
// session so the Account card can render signed-in on the first paint. Never
// throws — a failure here just leaves the app signed out.
export async function initAuth(): Promise<void> {
  if (!isSupabaseConfigured) return;

  // Keep the snapshot in step with everything supabase-js does on its own
  // (token refreshes, sign-out in another tab, the initial session).
  supabase.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user ?? null;
    notify();
  });

  if (oauthReturn?.errorDescription) {
    showToast(`Google sign-in failed — ${oauthReturn.errorDescription}`);
  } else if (oauthReturn?.code) {
    try {
      const { error } = await supabase.auth.exchangeCodeForSession(oauthReturn.code);
      if (error) showToast(friendlyAuthError(error));
      else showToast('Signed in', { variant: 'success' });
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
  // A plain-language message, ready to drop straight into a toast.
  message?: string;
}

// Where Supabase (and Google) send the browser back to. Built from the app's
// own base path rather than the current URL, so it's the same string on every
// screen — which matters, because it has to match the allow-list exactly.
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
    // No session back means Supabase wants the email confirmed first.
    if (!data.session) return { ok: true, needsEmailConfirmation: true };
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
    return { ok: true };
  } catch (err) {
    return { ok: false, message: friendlyAuthError(err) };
  }
}

// Leaves the app: Google takes over the tab and sends the browser back to
// authRedirectUrl() with a `?code=`, which captureOAuthReturn() picks up on the
// next load. Only returns (with an error) if the redirect couldn't be started.
export async function signInWithGoogle(): Promise<AuthResult> {
  if (!isSupabaseConfigured) return { ok: false, message: 'Accounts aren’t available in this build.' };
  try {
    markOAuthPending();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: authRedirectUrl() },
    });
    if (error) {
      try { localStorage.removeItem(OAUTH_PENDING_KEY); } catch { /* storage off */ }
      return { ok: false, message: friendlyAuthError(error) };
    }
    return { ok: true };
  } catch (err) {
    try { localStorage.removeItem(OAUTH_PENDING_KEY); } catch { /* storage off */ }
    return { ok: false, message: friendlyAuthError(err) };
  }
}

export async function signOut(): Promise<AuthResult> {
  if (!isSupabaseConfigured) return { ok: false, message: 'Accounts aren’t available in this build.' };
  try {
    const { error } = await supabase.auth.signOut();
    if (error) return { ok: false, message: friendlyAuthError(error) };
    currentUser = null;
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
  }

  if (/invalid login credentials/i.test(message)) return 'That email and password don’t match an account.';
  if (/email not confirmed/i.test(message)) return 'Confirm your email first — check your inbox for the link.';
  if (/already registered/i.test(message)) return 'There’s already an account with that email. Sign in instead.';
  if (/password should be at least/i.test(message)) return 'That password is too short — use at least 6 characters.';
  if (/rate limit|too many/i.test(message)) return 'Too many tries. Wait a minute and try again.';
  if (/failed to fetch|network|offline/i.test(message)) return 'Couldn’t reach the server — check your connection.';

  return 'Something went wrong. Try again in a moment.';
}
