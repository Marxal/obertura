/// <reference types="vite/client" />

// Injected at build time from package.json (see vite.config.ts → define).
declare const __APP_NAME__: string;
declare const __APP_VERSION__: string;

// Which host this bundle was built for: 'github' (internal beta, behind the
// access gate) or 'cloudflare' (the public bitochess.com build, open to guests).
declare const __DEPLOY_TARGET__: 'github' | 'cloudflare';

// Build-time env vars, read from .env locally and from the host's environment
// variables when deployed (see .env.example). Optional on purpose: a build with
// no Supabase project configured must still compile and boot — see supabase.ts.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  // Comma-separated list of the OAuth providers this build should offer:
  // `google`, `facebook`, `apple`. Unset means `google` alone. A name listed
  // here that isn't also enabled in the Supabase dashboard produces a button
  // that fails, so the two must be changed together — see auth.ts.
  readonly VITE_AUTH_PROVIDERS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
