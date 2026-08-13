// The buy flow's app half — everything between tapping "Unlock full access"
// and the cap actually lifting.
//
// ── WHY AN OVERLAY AND NOT A REDIRECT ───────────────────────────────────────
// Bito Chess is an installed PWA. Sending an installed app off to another
// origin hands the user to a Custom Tab, and the journey back lands wherever
// the browser feels like — very often a second copy of the app in a browser
// tab, sitting next to the installed one that is still showing the old, capped
// state. Lemon Squeezy's own lemon.js opens the checkout as an overlay INSIDE
// the app instead, so there is no journey back to get wrong.
//
// The overlay is an ENHANCEMENT, never a requirement. The script is fetched
// only when someone actually taps buy — nobody who never buys pays for it —
// and if it doesn't arrive (offline, a content blocker, a bad day at their
// CDN) the very same URL is opened as a plain redirect instead. Someone who
// wants to give us money is never told "try again later".
//
// ── HOW THE UNLOCK ACTUALLY ARRIVES ─────────────────────────────────────────
// Paying does not unlock anything by itself. Lemon Squeezy calls the webhook
// (worker/lemonsqueezy-webhook.ts), the webhook writes profiles.entitled, and
// only then can the app see it. So there is a gap — a second, sometimes a few
// — where the money has left and the app still says "10 of 10". Reading the
// flag once, right after the overlay closes, would land inside that gap about
// half the time and tell a paying customer they hadn't paid.
//
// So we POLL, on a short backoff, and THREE independent things can start the
// poll, because any one of them can fail to fire:
//   1. lemon.js's Checkout.Success event, when it comes.
//   2. the app regaining focus — the overlay closed, or a redirect came back.
//   3. ?purchased=1 on the URL, which is the redirect path's own signal.
// Whichever fires first wins and the others become no-ops. If all three miss,
// Settings has an "Already paid?" row that runs the same check by hand. Four
// ways to notice one flag is not paranoia when the alternative is a stranger
// who paid €9 and has no way to tell you it didn't work.
//
// ── WHICH WAY THE IMPORTS GO ────────────────────────────────────────────────
// This module imports entitlement.ts normally. entitlement.ts reaches BACK for
// this one only through a dynamic `import()` inside the button handler, and
// that asymmetry is deliberate: a plain `import { openCheckout }` there would
// make the two modules a cycle. Both sides only touch each other from inside
// functions, so a cycle would in fact work today — right up until someone adds
// a module-scope read and gets an undefined that only shows up in the built
// bundle. Keeping one direction dynamic means never having to think about it.
//
// (lemon.js itself is the only genuinely heavy thing here, and it is fetched
// from Lemon Squeezy's CDN on demand rather than bundled, so nobody who never
// taps buy ever downloads it.)

import { getAuthUser } from './auth';
import { isSupabaseConfigured } from './supabase';
import { isEntitled, refreshEntitlement } from './entitlement';
import { showDialog } from './dialog';
import { showToast } from './toast';

// The Lemon Squeezy product. A store-hosted checkout page, so there is no key
// and nothing secret here — the URL is as public as the landing page it sits on.
const CHECKOUT_URL = 'https://bitochess.lemonsqueezy.com/checkout/buy/8f39bf24-f731-4c65-870b-8b843b0e2311';

// Lemon Squeezy's overlay script.
const LEMON_JS = 'https://assets.lemonsqueezy.com/lemon.js';

// How long to wait for that script before giving up and redirecting. Long
// enough for a slow phone on a bad connection, short enough that nobody
// wonders whether their tap registered.
const LEMON_JS_TIMEOUT_MS = 6000;

// When to re-read the flag after a checkout, in ms from the moment we start.
// Front-loaded because the webhook is usually quick, with a long tail because
// "usually" is not "always".
const POLL_DELAYS_MS = [0, 1500, 3000, 5000, 8000, 12000, 20000];

// The URL flag Lemon Squeezy sends people back with (set on the product's
// "Redirect to URL after purchase"). Read and stripped at boot.
const RETURN_FLAG = 'purchased';

// ── Talking to lemon.js ──────────────────────────────────────────────────────

// Only the bits of the lemon.js surface this file touches. Typed by hand and
// treated as entirely optional: every call is guarded, so a change at their end
// degrades to the redirect rather than throwing.
interface LemonSqueezyApi {
  Setup?: (opts: { eventHandler: (event: { event?: string }) => void }) => void;
  Url?: { Open?: (url: string) => void };
}

declare global {
  interface Window {
    LemonSqueezy?: LemonSqueezyApi;
    createLemonSqueezy?: () => void;
  }
}

let lemonJsPromise: Promise<LemonSqueezyApi | null> | null = null;

// Fetch lemon.js once, lazily. Resolves null on any failure at all — a missing
// script, a blocked request, a timeout, or a load that somehow leaves no
// LemonSqueezy object behind. Never rejects: every caller's fallback is the
// same, and a rejected promise here would just be an unhandled error on the way
// to it.
function loadLemonJs(): Promise<LemonSqueezyApi | null> {
  if (lemonJsPromise) return lemonJsPromise;

  lemonJsPromise = new Promise<LemonSqueezyApi | null>((resolve) => {
    let settled = false;
    const finish = (api: LemonSqueezyApi | null): void => {
      if (settled) return;
      settled = true;
      resolve(api);
    };

    // Don't let a hung request hold the user on a dead button.
    const timer = setTimeout(() => finish(null), LEMON_JS_TIMEOUT_MS);

    const script = document.createElement('script');
    script.src = LEMON_JS;
    script.async = true;
    script.addEventListener('load', () => {
      clearTimeout(timer);
      // lemon.js auto-initialises on DOMContentLoaded. Loading it later than
      // that (which is always, since we only fetch it on a tap) means we have
      // to kick it ourselves.
      try { window.createLemonSqueezy?.(); } catch { /* fall through to the check */ }
      finish(window.LemonSqueezy ?? null);
    });
    script.addEventListener('error', () => {
      clearTimeout(timer);
      finish(null);
    });

    document.head.appendChild(script);
  });

  // A failed load shouldn't be cached forever — the next tap deserves a fresh
  // try, in case they've since regained signal.
  void lemonJsPromise.then((api) => { if (!api) lemonJsPromise = null; });

  return lemonJsPromise;
}

// ── Building the checkout URL ────────────────────────────────────────────────

// The user id is the whole point: it is the ONLY thing that tells the webhook
// whose account to unlock. Without it a real payment lands as a red "422 no
// user id" in the Lemon Squeezy dashboard and has to be fixed by hand, so this
// function is never called without one (openCheckout signs the user in first).
//
// `embed=1` is what makes the page render as an overlay rather than a full
// checkout; it is harmless on the redirect path, but left off there so the
// fallback is the ordinary hosted page.
function buildCheckoutUrl(userId: string, embed: boolean): string {
  const params = new URLSearchParams();
  if (embed) params.set('embed', '1');
  params.set('checkout[custom][user_id]', userId);
  return `${CHECKOUT_URL}?${params.toString()}`;
}

// ── The entry point ──────────────────────────────────────────────────────────

// Tapped "Unlock full access". Signs the user in first if they need it, then
// puts the checkout in front of them.
//
// AN ACCOUNT IS NOT OPTIONAL HERE, and this is the one place in the app where
// that's true. Everything else works as a guest on purpose; but a purchase has
// to attach to something that outlives the phone it was made on, and the
// webhook has no way to reach a guest. The sheet says as much rather than just
// demanding a sign-up, and the moment it succeeds we continue straight to the
// checkout — the user asked to buy, not to fill in a form.
export function openCheckout(): void {
  if (!isSupabaseConfigured) {
    // No accounts in this build, so nothing to attach a purchase to. The
    // internal GitHub Pages build is fully entitled anyway (entitlement.ts), so
    // this is unreachable from its UI — but never send someone to a checkout
    // that cannot possibly credit them.
    showToast('Buying isn’t available in this build.');
    return;
  }

  const user = getAuthUser();
  if (user) { goToCheckout(user.id); return; }

  void import('./onboarding-signup').then((m) => {
    m.openSignUpSheet('signup', {
      // "Bito Chess account", spelled out: the next screen after this one is
      // Lemon Squeezy's, and nobody should have to work out which of the two
      // accounts they are being asked for.
      lead: 'Your unlock is tied to your Bito Chess account, so it follows you '
        + 'to any phone you sign in on — and comes back if you ever reinstall.',
      onSignedIn: () => {
        const signedIn = getAuthUser();
        if (signedIn) goToCheckout(signedIn.id);
      },
    });
  });
}

// Overlay if we can, redirect if we can't.
function goToCheckout(userId: string): void {
  void loadLemonJs().then((api) => {
    if (!api?.Url?.Open) {
      // No overlay available — the ordinary hosted checkout, full page.
      window.location.href = buildCheckoutUrl(userId, false);
      return;
    }

    // Start watching for the app coming back to the foreground BEFORE opening,
    // so a checkout that closes faster than we expect is still noticed.
    watchForReturn();

    try {
      api.Setup?.({
        eventHandler: (event) => {
          // Their event names are not something this app should depend on:
          // anything that even looks like a success starts the poll, and the
          // focus watcher above covers the case where nothing arrives at all.
          if (typeof event?.event === 'string' && /success/i.test(event.event)) {
            startPolling();
          }
        },
      });
      api.Url.Open(buildCheckoutUrl(userId, true));
    } catch {
      // The overlay refused to open. Same fallback as no script at all.
      window.location.href = buildCheckoutUrl(userId, false);
    }
  });
}

// ── Noticing that the unlock has landed ──────────────────────────────────────

let polling = false;
let watching = false;

// The app came back to the foreground after we sent someone to a checkout.
// That is the most reliable signal available — it fires whether the overlay was
// closed, the tab was switched, or a redirect came home — so it starts the poll
// on its own and doesn't wait to be told a purchase succeeded. A poll that
// finds nothing is silent, so starting one after an abandoned checkout costs a
// couple of requests and shows the user nothing.
function watchForReturn(): void {
  if (watching) return;
  watching = true;

  const onVisible = (): void => {
    if (document.visibilityState !== 'visible') return;
    window.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
    watching = false;
    startPolling();
  };

  window.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
}

// Re-read profiles.entitled on a backoff until it turns true or we run out of
// patience. Silent until it succeeds: an abandoned checkout must not produce an
// error, and a webhook that is merely slow must not produce one either.
function startPolling(): void {
  if (polling) return;
  polling = true;

  void (async () => {
    try {
      if (isEntitled()) return; // already sorted — nothing to announce

      for (const delay of POLL_DELAYS_MS) {
        if (delay > 0) await sleep(delay);
        await refreshEntitlement();
        if (isEntitled()) { celebrate(); return; }
      }
    } finally {
      polling = false;
    }
  })();
}

// The "Already paid?" row in Settings. One immediate read, and unlike the poll
// this one ALWAYS says something — it was asked a direct question, and silence
// would be the worst possible answer.
export async function checkForPurchase(): Promise<boolean> {
  if (isEntitled()) return true;

  if (!getAuthUser()) {
    showToast('Sign in first — your unlock is on your account.');
    return false;
  }

  await refreshEntitlement();
  if (isEntitled()) { celebrate(); return true; }

  showToast('No purchase found on this account yet.');
  return false;
}

// Read ?purchased=1 and tidy it off the URL, so a refresh doesn't re-run this.
// Called once at boot. This is the redirect path's signal; the overlay path
// gets there via its own event or the focus watcher.
export function handlePurchaseReturn(): void {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return;
  }
  if (!params.has(RETURN_FLAG)) return;

  params.delete(RETURN_FLAG);
  const query = params.toString();
  window.history.replaceState(
    {},
    '',
    window.location.pathname + (query ? `?${query}` : '') + window.location.hash,
  );

  startPolling();
}

// The moment it lands. A dialog rather than a toast: someone has just paid, and
// a message that fades after two seconds is not an acknowledgement.
function celebrate(): void {
  showDialog({
    title: 'You’re in',
    body: 'Full access is on your account. Train as many lines as you like — '
      + 'and the coaching from your own games is open too.\n\n'
      + 'Thank you. Genuinely.',
    buttons: [{ label: 'Let’s go', variant: 'primary' }],
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
