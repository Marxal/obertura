// "Connect to Lichess" — OAuth 2.0 with PKCE, entirely in the browser (no
// backend, no client secret). This is the same flow, and the same library,
// Lichess's own client-side demo uses.
//
// We request a single scope: `puzzle:read`. The opening explorer needs no
// personal data, but the Puzzles tab benefits from it — Lichess then skips
// puzzles you've already seen and exposes your puzzle dashboard (rating +
// per-theme results) for the Statistics page. Everything still works without it
// (anonymous puzzles, no dashboard); the scope just makes the experience nicer.
// Existing connections keep working for the explorer; the puzzle extras switch on
// the next time you connect.
//
// Tokens are long-lived (~a year) and there are no refresh tokens; the library
// persists state in localStorage. On the phone the connect itself works fine —
// whether the *explorer fetch* then succeeds depends on Lichess's CORS, which we
// handle gracefully in lichess-explorer.ts.

import { OAuth2AuthCodePKCE } from '@bity/oauth2-auth-code-pkce';
import { clearExplorerCache } from './lichess-explorer';

const LICHESS = 'https://lichess.org';

// The single Lichess pitch, shared by the setup wizard, the Settings connect card
// and the Puzzles empty state so the promise reads the same everywhere.
export const LICHESS_CONNECT_BLURB =
  'Connect to unlock the live opening library, a stronger chess engine, and the ' +
  'Lichess puzzle dashboard with your rating and puzzle history. It’s free, ' +
  'accesses no personal data, and even a throwaway account works.';

let oauth: OAuth2AuthCodePKCE | null = null;

function client(): OAuth2AuthCodePKCE {
  if (!oauth) {
    oauth = new OAuth2AuthCodePKCE({
      authorizationUrl: `${LICHESS}/oauth`,
      tokenUrl: `${LICHESS}/api/token`,
      clientId: 'obertura',
      scopes: ['puzzle:read'],
      // The page Lichess returns to. Must be identical on both legs; the library
      // remembers it. A stable app URL with no query/hash.
      redirectUrl: location.origin + location.pathname,
      onAccessTokenExpiry: (refresh) => refresh(),
      onInvalidGrant: () => { /* token rejected — surfaced on next connect() */ },
    });
  }
  return oauth;
}

// Is there a usable Lichess token on this device right now? (Synchronous, for UI.)
export function isConnected(): boolean {
  try { return client().isAuthorized(); } catch { return false; }
}

// Kick off the login: redirects to Lichess, returns here with ?code=… afterward.
export async function connect(): Promise<void> {
  await client().fetchAuthorizationCode();
}

// Call once at app boot. If we've just returned from Lichess, complete the token
// exchange. Returns true ONLY when this boot is the return leg of a connect that
// succeeded — so the caller can toast and restore once, not on every launch.
// Never throws.
export async function tryCallback(): Promise<boolean> {
  let justConnected = false;
  try {
    if (await client().isReturningFromAuthServer()) {
      await client().getAccessToken();
      justConnected = isConnected();
      // Fresh auth state: drop any explorer entries fetched anonymously before
      // this connect, so the first authorised fetch isn't served a stale miss.
      if (justConnected) clearExplorerCache();
    }
  } catch { /* user denied, stale state, network — leave disconnected */ }
  return justConnected;
}

// The connect flow redirects to Lichess and back, reloading the page and losing
// the builder's in-memory position. We stash that position on the way out and
// hand it back once on return, so the user lands where they left off.
const RETURN_KEY = 'obertura.lichessReturnTo';

export function stashReturn(ucis: string[], colour: 'white' | 'black'): void {
  try {
    localStorage.setItem(RETURN_KEY, JSON.stringify({ ucis, colour, t: Date.now() }));
  } catch { /* storage blocked/full — we simply won't restore the position */ }
}

// Consume the stashed position (once). Null if there is none, it's malformed, or
// it's stale (> 10 min — a leftover from a connect the user abandoned).
export function takeReturn(): { ucis: string[]; colour: 'white' | 'black' } | null {
  try {
    const raw = localStorage.getItem(RETURN_KEY);
    if (!raw) return null;
    localStorage.removeItem(RETURN_KEY);
    const v = JSON.parse(raw) as { ucis?: unknown; colour?: unknown; t?: number };
    if (!Array.isArray(v.ucis) || !v.ucis.every((u) => typeof u === 'string')) return null;
    if (Date.now() - (v.t ?? 0) > 600_000) return null;
    return { ucis: v.ucis as string[], colour: v.colour === 'black' ? 'black' : 'white' };
  } catch { return null; }
}

// The current bearer token value, refreshing if needed. null when disconnected.
export async function getAccessToken(): Promise<string | null> {
  try {
    if (!client().isAuthorized()) return null;
    const ctx = await client().getAccessToken();
    return ctx.token?.value ?? null;
  } catch {
    return null;
  }
}

// Forget the token on this device.
export function disconnect(): void {
  try { client().reset(); } catch { /* nothing to reset */ }
  // Clear cached explorer answers fetched while connected, so they don't keep
  // showing after the token is gone (and so a later reconnect starts clean).
  clearExplorerCache();
}
