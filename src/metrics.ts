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
// ── NOTHING IS STORED FOR COUNTING ──────────────────────────────────────────
// It used to keep notes on the device of what it had already counted. Those are
// gone (2026-11), and storage.ts removes any left behind. "Once" now means once in
// this launch, held in memory. A first time is worked out from data the app keeps
// anyway: no games yet, no training days yet (first-use.ts, streak.ts). The only
// counting key left is the "leave me out" switch, which is the person's own answer.
//
// ── FAILURE IS ALWAYS SILENT ────────────────────────────────────────────────
// Every path here swallows everything: no throw reaches a caller, no error
// surfaces to the user, nothing retries. A count is worth exactly one attempt
// and never worth a millisecond of anyone's attention. If the request fails,
// that count is simply gone, and that is the correct outcome.

// The endpoint is a root-absolute path, so it resolves the same from the
// trainer at /app/ as it would from anywhere else on the origin. It is NOT
// built from import.meta.env.BASE_URL: the Worker serves /api/event at the
// root, not under the app's base.
const ENDPOINT = '/api/event';

// The "leave me out" switch in Settings.
const OPT_OUT_KEY = 'obertura.metricsOptOut';

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
  | 'first_games_imported'
  | 'first_scan_done'
  | 'first_interaction'
  | 'training_cap_hit'
  | 'lines_cap_hit'
  | 'repertoire_cap_hit'
  | 'pro_sheet_shown'
  | 'checkout_started'
  | 'signed_in'
  | 'signed_up_email'
  | 'purchase_confirmed';

/**
 * True when this build can count anything at all.
 *
 * The GitHub Pages build has no Worker behind it — /api/event does not exist
 * there, and never will — so the entire feature is compiled down to nothing on
 * that target rather than firing requests into a 404. Settings also reads this,
 * so the "leave me out" switch only appears where there is something to switch
 * off. The self-tests have no build target at all, which also means no counting.
 */
export function metricsActive(): boolean {
  return typeof __DEPLOY_TARGET__ !== 'undefined' && __DEPLOY_TARGET__ === 'cloudflare';
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
  if (USE_EVENTS.has(name)) noteAppUsed();
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
 * Count something at most once in this launch. Held in memory, so a walled-off
 * button pressed five times is one count, and the next launch can count again.
 */
const spentThisLaunch = new Set<MetricName>();
export function trackOncePerLaunch(name: MetricName): void {
  if (spentThisLaunch.has(name)) return;
  spentThisLaunch.add(name);
  track(name);
}

/**
 * One cold launch, called once from the boot path.
 *
 * A launch is a document, so backgrounding and coming back doesn't count again,
 * but a reload does, and Android reclaims backgrounded PWAs freely. So this is
 * closer to "launches, plus however often the OS reclaimed the app" than to
 * "sessions", and it must never be read as a headcount.
 */
export function trackAppOpen(): void {
  trackOncePerLaunch('app_open');
}

// ── Used the app ────────────────────────────────────────────────────────────
//
// Finishing some training counts as using the app. first-use.ts reads at boot
// whether this device had trained before this launch, because by the time an event
// fires, its own result has already been saved. Saving a line isn't on the list:
// nothing the app keeps says whether that was the first, so it would count again
// on every launch for someone who builds and never trains.
const USE_EVENTS: ReadonlySet<MetricName> = new Set<MetricName>([
  'drill_completed',
  'puzzle_session',
  'daily_completed',
  'endgame_solved',
]);

let usedBefore: boolean | null = null;

export function setUsedBefore(used: boolean): void {
  usedBefore = used;
}

export function noteAppUsed(): void {
  if (usedBefore !== false) return;
  usedBefore = true;
  track('first_interaction');
}

/** Only for the self-test: forgets this launch between cases. */
export function resetMetricsForTest(): void {
  spentThisLaunch.clear();
  usedBefore = null;
}

// ── The "leave me out" switch ───────────────────────────────────────────────
//
// Off by default. It also keeps the owner's own phone out of the numbers, which is
// otherwise impossible: with no identifier there is nothing to filter on afterwards.
//
// Turning it on doesn't delete anything already counted, because there is nothing
// to delete it BY. It only stops this device contributing from now on.

export function isMetricsOptedOut(): boolean {
  try {
    return window.localStorage.getItem(OPT_OUT_KEY) === '1';
  } catch {
    return false;
  }
}

export function setMetricsOptedOut(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(OPT_OUT_KEY, '1');
    else window.localStorage.removeItem(OPT_OUT_KEY);
  } catch {
    /* storage full or blocked */
  }
}
