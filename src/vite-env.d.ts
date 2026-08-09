/// <reference types="vite/client" />

// Injected at build time from package.json (see vite.config.ts → define).
declare const __APP_NAME__: string;
declare const __APP_VERSION__: string;

// Build-time env vars, read from .env locally and from the host's environment
// variables when deployed (see .env.example). Optional on purpose: a build with
// no Supabase project configured must still compile and boot — see supabase.ts.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
