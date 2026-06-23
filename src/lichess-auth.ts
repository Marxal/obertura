// "Connect to Lichess" — OAuth 2.0 with PKCE, entirely in the browser (no
// backend, no client secret). This is the same flow, and the same library,
// Lichess's own client-side demo uses.
//
// We request NO scopes: the opening explorer reads no personal data, so any
// account — even a throwaway one — works. The token only lets our requests past
// Lichess's login gate on the explorer (anonymous requests are blocked now).
//
// Tokens are long-lived (~a year) and there are no refresh tokens; the library
// persists state in localStorage. On the phone the connect itself works fine —
// whether the *explorer fetch* then succeeds depends on Lichess's CORS, which we
// handle gracefully in lichess-explorer.ts.

import { OAuth2AuthCodePKCE } from '@bity/oauth2-auth-code-pkce';

const LICHESS = 'https://lichess.org';

let oauth: OAuth2AuthCodePKCE | null = null;

function client(): OAuth2AuthCodePKCE {
  if (!oauth) {
    oauth = new OAuth2AuthCodePKCE({
      authorizationUrl: `${LICHESS}/oauth`,
      tokenUrl: `${LICHESS}/api/token`,
      clientId: 'obertura',
      scopes: [],
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
// exchange. Returns true when a token is now held. Never throws.
export async function tryCallback(): Promise<boolean> {
  try {
    if (await client().isReturningFromAuthServer()) {
      await client().getAccessToken();
    }
  } catch { /* user denied, stale state, network — leave disconnected */ }
  return isConnected();
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
}
