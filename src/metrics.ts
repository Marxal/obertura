// The app's half of the anonymous event counter. One function matters: track().
//
// ── WHAT LEAVES THE DEVICE ──────────────────────────────────────────────────
// A POST to /api/event whose entire body is `{"name":"app_open"}` — one string
// off a fixed list, and nothing else. No id, no timestamp, no session token, no
// referrer (the fetch below turns Referer off explicitly), no cookie (there are
// none, and `credentials: 'omit'` says so anyway). The Worker on the other end
// reads no IP and no user agent (worker/metrics.ts), so two visits cannot be
// told apart at either end.
//
// The numbers this produces are therefore counts of EVENTS, never of people.
// Nothing here can answer "how many users" or "was that the same person" — and
// the whole design exists so that it never can.
//
// ── WHY THE STATE BELOW STAYS ON THE DEVICE ─────────────────────────────────
// Three keys are read here and none of them is ever sent anywhere: they exist
// only to stop this device counting the same once-ever thing twice. All three
// are registered as never-synced in local-keys.ts, each with its reason — a
// synced copy would make a second phone inherit the first phone's history and
// silently stop counting.
//
// ── FAILURE IS ALWAYS SILENT ────────────────────────────────────────────────
// Every path here swallows everything: no throw reaches a caller, no error
// surfaces to the user, nothing retries. A count is worth exactly one attempt
// and never worth a millisecond of anyone's attention — which is also why a
// once-ever event is marked as spent BEFORE it is sent. If the request fails,
// that count is simply gone, and that is the correct outcome.

// The endpoint is a root-absolute path, so it resolves the same from the
// trainer at /app/ as it would from anywhere else on the origin. It is NOT
// built from import.meta.env.BASE_URL: the Worker serves /api/event at the
// root, not under the app's base.
const ENDPOINT = '/api/event';

// Which once-ever events this device has already spent. One key holding a
// comma-joined list rather than a key per event, so the whole feature is three
// entries in localStorage instead of a growing family of them.
const SEEN_KEY = 'obertura.metricsSeen';
// When this browser profile first opened the app. Read ONLY to subtract from
// `Date.now()`; the value itself never leaves the device, and neither does
// anything derived from it beyond "a threshold was crossed".
const INSTALLED_KEY = 'obertura.installedAt';
// The "don't count me" switch in Settings.
const OPT_OUT_KEY = 'obertura.metricsOptOut';
// One cold launch. sessionStorage, so it survives an in-app reload (the sync
// path reloads after applying an account snapshot) but not a fresh launch.
const SESSION_KEY = 'obertura.metricsSession';

const DAY_MS = 24 * 60 * 60 * 1000;

// Every name the Worker will accept. Kept in step with the ALLOWED set in
// worker/metrics.ts BY HAND: the app and the Worker are separate builds with
// separate typechecks, and a list this short is cheaper to keep honest than a
// shared module bundled into both. A name that drifts out of step here is a
// 400 and a dropped count, never an error the user sees.
export type MetricName =
  | 'install'
  | 'app_open'
  | 'return_after_d2'
  | 'return_after_d7'
  | 'return_after_d30'
  | 'onboarding_complete'
  | 'starter_pack_added'
  | 'line_saved'
  | 'drill_completed'
  | 'puzzle_session'
  | 'daily_completed'
  | 'endgame_solved'
  | 'games_imported'
  | 'signed_in'
  | 'signed_up_email'
  | 'purchase_confirmed';

/**
 * True when this build can count anything at all.
 *
 * The GitHub Pages build has no Worker behind it — /api/event does not exist
 * there, and never will — so the entire feature is compiled down to nothing on
 * that target rather than firing requests into a 404. Settings also reads this,
 * so the "don't count me" switch only appears where there is something to
 * switch off.
 */
export function metricsActive(): boolean {
  return __DEPLOY_TARGET__ === 'cloudflare';
}

/**
 * Fire and forget. Never throws, never awaits, never reports.
 *
 * Called from ordinary UI code as a single line, so it has to be safe to call
 * from anywhere at any time — including from inside a handler that is about to
 * navigate away, which is what `keepalive` covers.
 */
export function track(name: MetricName): void {
  if (!metricsActive() || isMetricsOptedOut()) return;
  try {
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
      // Survives the page going away mid-flight — a count fired from a button
      // that also navigates would otherwise be cancelled.
      keepalive: true,
      // Belt and braces. There are no cookies to send and the Worker reads no
      // Referer, but saying so here means the browser never puts either on the
      // wire in the first place.
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    }).catch(() => { /* offline, blocked, 400 — all equally fine */ });
  } catch {
    /* fetch itself unavailable. Nothing to do and nothing worth saying. */
  }
}

/**
 * Track something that should be counted at most once on this device, ever.
 *
 * Spent BEFORE it is sent, on purpose: "once ever" means one attempt, not one
 * success. A failed send that stayed unspent would try again on every launch
 * forever, which is how a quiet counter turns into a loop.
 */
export function trackOnce(name: MetricName): void {
  if (!metricsActive() || isMetricsOptedOut()) return;
  const seen = readSeen();
  if (seen.has(name)) return;
  seen.add(name);
  writeSeen(seen);
  track(name);
}

/**
 * Called once from the boot path, after the gate has let the app through.
 *
 * Does three things in order: stamps the install date (and counts the install
 * if this is the first launch), counts one cold launch, and counts any
 * retention milestone this launch has just crossed.
 *
 * ── "COLD LAUNCH", NOT "SESSION" ────────────────────────────────────────────
 * The session flag lives in sessionStorage, which belongs to the document. So:
 *   • backgrounding the PWA and coming straight back does NOT count again — the
 *     document survives, and so does the flag;
 *   • a back/forward restore from bfcache does not count again either;
 *   • BUT Android evicts a backgrounded PWA's document freely under memory
 *     pressure, and resuming then re-navigates: new document, new flag, new
 *     count.
 * So this number is closer to "launches, plus however often the OS reclaimed
 * the app" than to "sessions", and it must never be read as a headcount. There
 * is no way to close that gap without a persistent per-device marker, which is
 * exactly what this feature refuses to have.
 */
export function trackAppOpen(): void {
  if (!metricsActive() || isMetricsOptedOut()) return;

  stampInstall();

  if (readRaw(sessionStore(), SESSION_KEY) === '1') return;
  writeRaw(sessionStore(), SESSION_KEY, '1');

  track('app_open');
  trackReturnMilestones();
}

// ── The "don't count me" switch ─────────────────────────────────────────────
//
// Off by default, so a fresh install counts. Its one job is to keep the owner's
// own phone out of their own numbers, which is otherwise impossible: with no
// identifier of any kind there is nothing to filter on afterwards.
//
// Turning it on does not delete anything already counted — there is nothing to
// delete it BY. It only stops this device contributing from now on.

export function isMetricsOptedOut(): boolean {
  return readRaw(localStore(), OPT_OUT_KEY) === '1';
}

export function setMetricsOptedOut(on: boolean): void {
  const store = localStore();
  if (!store) return;
  try {
    if (on) store.setItem(OPT_OUT_KEY, '1');
    else store.removeItem(OPT_OUT_KEY);
  } catch {
    /* storage full or blocked */
  }
}

// ── Install date and retention ──────────────────────────────────────────────

// The milestones, in the only shape that survives having no identifier: each is
// counted once ever, the first time the app is opened at least that many days
// after it was installed.
//
// THEY NEST. Someone who comes back after 40 days trips d2, d7 and d30 in the
// same launch, so `return_after_d30 ⊆ return_after_d7 ⊆ return_after_d2`. That
// makes these "ever came back after N days", NOT classic day-N retention — the
// numbers are read as a ratio against `install` from an earlier period, and the
// lag smears across the boundary. That imprecision is the price of cohorts that
// cannot be reconstructed, and it was paid deliberately.
const RETURN_MILESTONES: { days: number; name: MetricName }[] = [
  { days: 2, name: 'return_after_d2' },
  { days: 7, name: 'return_after_d7' },
  { days: 30, name: 'return_after_d30' },
];

// Stamp the install date if this profile has none, and count the install.
//
// "Install" means the first launch on THIS browser profile, which is not the
// same as a person or a phone: clearing site data, using a private window or
// switching browsers all mint a new one. It is the closest honest thing to a
// new-user count that leaves no identifier behind.
function stampInstall(): void {
  if (installedAt() !== null) return;
  writeRaw(localStore(), INSTALLED_KEY, String(Date.now()));
  trackOnce('install');
}

function installedAt(): number | null {
  const raw = readRaw(localStore(), INSTALLED_KEY);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Count every milestone this launch has crossed. The `>=` also handles a clock
// that has moved backwards (elapsed goes negative, nothing fires); a clock
// moved forwards will trip a milestone early, which is not worth defending
// against for a number read as a trend.
function trackReturnMilestones(): void {
  const since = installedAt();
  if (since === null) return;
  const elapsed = Date.now() - since;
  for (const m of RETURN_MILESTONES) {
    if (elapsed >= m.days * DAY_MS) trackOnce(m.name);
  }
}

// ── Storage plumbing ────────────────────────────────────────────────────────
//
// Every access is wrapped, because storage genuinely throws in the wild —
// Safari private mode, a browser set to block site data, a full quota. A phone
// that cannot store anything still runs the app perfectly; it just counts its
// once-ever events more than once, which is a rounding error and not a bug
// worth carrying code for.

function localStore(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

function sessionStore(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

function readRaw(store: Storage | null, key: string): string | null {
  if (!store) return null;
  try { return store.getItem(key); } catch { return null; }
}

function writeRaw(store: Storage | null, key: string, value: string): void {
  if (!store) return;
  try { store.setItem(key, value); } catch { /* storage off or full */ }
}

function readSeen(): Set<string> {
  const raw = readRaw(localStore(), SEEN_KEY);
  return new Set(raw ? raw.split(',').filter(Boolean) : []);
}

function writeSeen(seen: Set<string>): void {
  writeRaw(localStore(), SEEN_KEY, [...seen].join(','));
}
