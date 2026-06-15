// Opt-in crash reporting via Sentry. This is the ONLY place Sentry is touched.
//
// Privacy first: the whole SDK is loaded lazily, behind a dynamic import(), and
// ONLY when "Send crash reports" is enabled in Settings. With the toggle off
// (the default), the import never runs — no Sentry code is downloaded, nothing
// initialises, and nothing is ever sent. Toggling the switch calls
// applyCrashReporting(), which starts or stops Sentry live, no reload needed.
//
// Because it's a dynamic import, the bundler splits Sentry into its own chunk;
// the main app bundle is unaffected for the default (opted-out) user.

import { getCrashReportsEnabled } from './prefs';

// ── DSN ───────────────────────────────────────────────────────────────────────
// Paste your Sentry project's DSN here. It's a public client key (safe to ship
// in a frontend bundle), not a secret. Until it's a real DSN, crash reporting
// stays disabled even when the toggle is on (see isPlaceholderDsn / initCrash).
//
// ⚠️  PLACEHOLDER — Marçal must replace this with the DSN from his Sentry
//     project (Settings → Projects → [project] → Client Keys (DSN)). It looks
//     like: https://<hash>@<org>.ingest.sentry.io/<projectId>
const SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';

// True while the placeholder above is still in place — used to no-op cleanly so
// the toggle does nothing harmful before a real DSN is pasted in.
function isPlaceholderDsn(dsn: string): boolean {
  return dsn.includes('examplePublicKey') || dsn.includes('o0.ingest.sentry.io/0');
}

// The loaded Sentry module, kept so we can close() it when the toggle goes off
// without re-importing. null = not initialised this session.
type SentryModule = typeof import('@sentry/browser');
let sentry: SentryModule | null = null;
let started = false;

// Load + initialise Sentry. Idempotent: a second call while already started is a
// no-op. Safe to call from boot and from the Settings toggle.
async function initCrash(): Promise<void> {
  if (started) return;
  if (isPlaceholderDsn(SENTRY_DSN)) {
    // No real DSN yet — refuse to start so we never point at the example project.
    console.warn('[crash] Sentry DSN is still the placeholder — crash reporting is off. Paste your project DSN into src/crash.ts.');
    return;
  }
  started = true;
  try {
    sentry = await import('@sentry/browser');
    sentry.init({
      dsn: SENTRY_DSN,
      // This is a chess app with no accounts — never attach IP or request bodies.
      sendDefaultPii: false,
      // Errors only. No performance tracing, no session replay — both can carry
      // far more incidental data than a personal openings trainer should emit.
      tracesSampleRate: 0,
      release: `obertura@${__APP_VERSION__}`,
      // Last line of defence: strip anything personal before an event leaves the
      // device. We scrub user identity and request/URL detail outright.
      beforeSend(event) {
        return scrubEvent(event);
      },
    });
  } catch (err) {
    // A failed load must never break the app — reporting is best-effort.
    started = false;
    sentry = null;
    console.warn('[crash] Sentry failed to load; continuing without crash reporting.', err);
  }
}

// Stop reporting for the rest of this session. close() flushes nothing further
// and detaches Sentry's global handlers, so no events are sent after opting out.
async function disableCrash(): Promise<void> {
  if (!started || !sentry) {
    started = false;
    return;
  }
  try {
    await sentry.close();
  } catch {
    /* ignore — we're tearing down anyway */
  }
  started = false;
  sentry = null;
}

// Scrub obvious PII from an outgoing event. A chess openings trainer should
// carry no personal data, so we drop the fields most likely to leak it: the
// user identity, the request (IP, headers, cookies, query string) and any
// absolute URL on the event or its breadcrumbs.
function scrubEvent<T extends import('@sentry/browser').ErrorEvent>(event: T): T {
  delete event.user;
  delete event.request;
  if (event.contexts) delete event.contexts.device;
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.data && 'url' in crumb.data) delete crumb.data.url;
  }
  return event;
}

// The single entry point used by boot AND the Settings toggle. Reads the pref
// and brings Sentry into the matching state — started when on, stopped when off.
// Call it once at boot, and again whenever the toggle changes.
export function applyCrashReporting(): void {
  if (getCrashReportsEnabled()) {
    void initCrash();
  } else {
    void disableCrash();
  }
}
