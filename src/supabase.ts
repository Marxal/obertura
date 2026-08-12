// The Supabase connection — one shared client, created once, for everything
// that will later need an account: sign-in, cross-device sync, and whatever
// else moves off the phone. Nothing calls it yet; this module exists so that
// work has a single, obvious place to start from instead of each feature
// spinning up its own client (which would each keep their own auth session and
// quietly disagree about who is signed in).
//
// The URL and the anon key come from build-time env vars — VITE_SUPABASE_URL
// and VITE_SUPABASE_ANON_KEY — set in `.env` locally and in the Cloudflare
// Pages dashboard for the deployed build (see .env.example). Vite inlines
// anything prefixed `VITE_` into the bundle, so both values end up visible in
// the shipped JavaScript. That is fine and intended: the anon key is a
// *public* key. It grants only what Supabase's row-level security policies
// allow, so the real protection
// lives in those policies, never in hiding this string. The service-role key is
// the secret one and must never come anywhere near this file.
//
// Fail-soft, same as the rest of the app: with no Supabase project configured
// the env vars are missing, and rather than throw on import — which would take
// the whole app down at boot, since bundlers hoist imports before any UI
// exists — we fall back to a harmless placeholder URL and export
// `isSupabaseConfigured` so callers can check first. Creating the client makes
// no network request; only an actual query would, and that would simply fail
// like any other offline request. Boot stays clean either way.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL ?? '';
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

// True only when this build was given both values. Check this before using the
// client for anything user-visible, so an unconfigured build can hide the
// feature instead of showing an error.
export const isSupabaseConfigured = Boolean(url && anonKey);

// Stand-ins used only when nothing is configured. createClient validates that
// the URL parses, so it needs *something*; this domain is reserved by the IETF
// for exactly this kind of placeholder and resolves nowhere.
const FALLBACK_URL = 'https://placeholder.example.invalid';
const FALLBACK_KEY = 'placeholder-anon-key';

export const supabase: SupabaseClient = createClient(
  isSupabaseConfigured ? url : FALLBACK_URL,
  isSupabaseConfigured ? anonKey : FALLBACK_KEY,
  {
    auth: {
      // Keep the session in localStorage and refresh it in the background, so a
      // signed-in user stays signed in across app launches — the PWA gets
      // relaunched constantly on a phone.
      persistSession: true,
      autoRefreshToken: true,
      // PKCE, not the library's default. supabase-js still defaults to the
      // *implicit* flow, which hands the tokens back in the URL fragment
      // (`#access_token=…&refresh_token=…`) — they land in the address bar and
      // the browser's history. PKCE instead returns a short-lived `?code=` that
      // only this device can redeem, which is both safer and the shape auth.ts
      // is built to read.
      flowType: 'pkce',
      // We claim the returning `?code=` ourselves, in auth.ts, rather than
      // letting supabase-js do it. "Connect to Lichess" comes back to the same
      // URL with its own `?code=`, and auth.ts knows how to tell the two apart
      // (see the notes there); supabase-js, left to run first, has no such
      // knowledge. Keep this false as long as both flows share a redirect URL.
      detectSessionInUrl: false,
      // Namespaced like every other key we own, so the Settings "erase
      // everything" sweep can clear it alongside the rest.
      storageKey: 'obertura.supabase.auth',
    },
  },
);
