// The buy flow's app half — everything between tapping "Unlock full access"
// and the cap actually lifting.
//
// ── WHY THIS IS A REDIRECT, AND WHY THAT IS FINE ────────────────────────────
// Bito Chess is an installed PWA, and sending an installed app off to another
// origin is genuinely awkward: the journey back lands wherever the browser feels
// like, very often a second copy of the app in a browser tab sitting next to the
// installed one that still shows the old, capped state. Lemon Squeezy's lemon.js
// used to paper over that by opening its checkout as an overlay INSIDE the app.
//
// Stripe's hosted Checkout is a redirect — there is no overlay to borrow. So the
// return journey has to be handled rather than avoided, and the machinery for
// that already existed and is unchanged below: `?purchased=1` on the way back,
// a focus watcher for when that URL is never reached, and a poll on a backoff
// because the webhook lands a moment after the money does.
//
// Two things about the redirect are actually BETTER than the overlay was:
//   • No third-party script. lemon.js was a request to another CDN loaded into
//     the app; nothing here loads anything. The privacy policy's "no
//     third-party requests" line is now true of the buy flow too.
//   • Wallets work. Apple Pay and Google Pay appear on Stripe's own domain with
//     no domain verification to register and no extra code here.
//
// (Stripe does offer an embedded Checkout that would restore the overlay feel. It
// costs js.stripe.com inside the app, Apple Pay domain verification, and an
// iframe to keep alive across the PWA's lifecycle. Not worth it for a €9 sale
// whose return path is already built and already handles the harder case.)
//
// ── HOW THE UNLOCK ACTUALLY ARRIVES ─────────────────────────────────────────
// Paying does not unlock anything by itself. Stripe calls the webhook
// (worker/stripe-webhook.ts), the webhook writes profiles.entitled, and only then
// can the app see it. So there is a gap — a second, sometimes a few — where the
// money has left and the app still says "10 of 10". Reading the flag once, right
// after the return, would land inside that gap about half the time and tell a
// paying customer they hadn't paid.
//
// So we POLL, on a short backoff, and THREE independent things can start the
// poll, because any one of them can fail to fire:
//   1. ?purchased=1 on the URL — Stripe's success_url, the normal path.
//   2. the app regaining focus — a Custom Tab dismissed, a tab switched back.
//   3. a checkout we started in this session, noticed on the way back.
// Whichever fires first wins and the others become no-ops. If all three miss,
// Settings has an "Already paid?" row that runs the same check by hand. Four ways
// to notice one flag is not paranoia when the alternative is a stranger who paid
// €9 and has no way to tell you it didn't work.
//
// ── WHICH WAY THE IMPORTS GO ────────────────────────────────────────────────
// This module imports entitlement.ts normally. entitlement.ts reaches BACK for
// this one only through a dynamic `import()` inside the button handler, and that
// asymmetry is deliberate: a plain `import { openCheckout }` there would make the
// two modules a cycle. Both sides only touch each other from inside functions, so
// a cycle would in fact work today — right up until someone adds a module-scope
// read and gets an undefined that only shows up in the built bundle. Keeping one
// direction dynamic means never having to think about it.

import { getAuthUser } from './auth';
import { supabase, isSupabaseConfigured } from './supabase';
import { isEntitled, refreshEntitlement } from './entitlement';
import { sellablePrice } from './pricing';
import { showDialog } from './dialog';
import { showToast } from './toast';

// The Worker endpoint that creates the Stripe session. An absolute path, so it
// resolves against the origin whatever base the app was built with.
const CHECKOUT_ENDPOINT = '/api/stripe/checkout';

// How long to wait for the session URL before giving up. A session is one Stripe
// API call behind a Worker; anything slower than this is a bad connection, and
// the user is staring at a button they just tapped.
const CHECKOUT_TIMEOUT_MS = 15000;

// When to re-read the flag after a checkout, in ms from the moment we start.
// Front-loaded because the webhook is usually quick, with a long tail because
// "usually" is not "always".
const POLL_DELAYS_MS = [0, 1500, 3000, 5000, 8000, 12000, 20000];

// The URL flag Stripe sends people back with (worker/stripe-checkout.ts builds
// the success_url). Read and stripped at boot.
const RETURN_FLAG = 'purchased';

// ── The entry point ──────────────────────────────────────────────────────────

// Tapped "Unlock full access". Signs the user in first if they need it, then puts
// the checkout in front of them.
//
// AN ACCOUNT IS NOT OPTIONAL HERE, and this is the one place in the app where
// that's true. Everything else works as a guest on purpose; but a purchase has to
// attach to something that outlives the phone it was made on, and the webhook has
// no way to reach a guest. The sheet says as much rather than just demanding a
// sign-up, and the moment it succeeds we continue straight to the checkout — the
// user asked to buy, not to fill in a form.
export function openCheckout(): void {
  if (!isSupabaseConfigured) {
    // No accounts in this build, so nothing to attach a purchase to. The internal
    // GitHub Pages build is fully entitled anyway (entitlement.ts), so this is
    // unreachable from its UI — but never send someone to a checkout that cannot
    // possibly credit them.
    showToast('Buying isn’t available in this build.');
    return;
  }

  const user = getAuthUser();
  if (user) { void goToCheckout(); return; }

  void import('./onboarding-signup').then((m) => {
    m.openSignUpSheet('signup', {
      // "Bito Chess account", spelled out: the next screen after this one is
      // Stripe's, and nobody should have to work out which of the two accounts
      // they are being asked for.
      lead: 'Your unlock is tied to your Bito Chess account, so it follows you '
        + 'to any phone you sign in on — and comes back if you ever reinstall.',
      onSignedIn: () => {
        if (getAuthUser()) void goToCheckout();
      },
    });
  });
}

// Ask the Worker for a session and go there.
//
// Two things have to be in hand first and neither is guaranteed: the Stripe price
// id (pricing.ts will fetch one if it has none) and the user's access token
// (which supabase-js may need to refresh). Both failures get the same honest
// message — nothing has been charged, and trying again in a moment usually works.
async function goToCheckout(): Promise<void> {
  let url: string;
  try {
    const price = await sellablePrice();
    if (!price?.id) {
      // No price id means pricing.ts never reached the Worker. Sending a
      // hard-coded guess would be worse than saying so.
      showToast('Couldn’t reach the checkout. Check your connection and try again.');
      return;
    }

    const token = await accessToken();
    if (!token) {
      showToast('Sign in again to buy — your session has expired.');
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECKOUT_TIMEOUT_MS);
    let payload: unknown;
    try {
      const res = await fetch(CHECKOUT_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          // The whole security model: the Worker takes the account id and email
          // out of this token and ignores anything the body says about who is
          // asking. See worker/stripe-checkout.ts.
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ price_id: price.id }),
        signal: controller.signal,
      });
      if (!res.ok) {
        showToast(res.status === 401
          ? 'Sign in again to buy — your session has expired.'
          : 'Couldn’t start the checkout. Try again in a moment.');
        return;
      }
      payload = await res.json();
    } finally {
      clearTimeout(timer);
    }

    const candidate = (payload as { url?: unknown })?.url;
    if (typeof candidate !== 'string' || !isStripeCheckoutUrl(candidate)) {
      showToast('Couldn’t start the checkout. Try again in a moment.');
      return;
    }
    url = candidate;
  } catch {
    // Offline, aborted, or malformed JSON. Nothing has been charged.
    showToast('Couldn’t start the checkout. Try again in a moment.');
    return;
  }

  // Start watching for the app coming back to the foreground BEFORE leaving, so a
  // checkout abandoned with the back gesture — which never reaches success_url —
  // is still noticed on return.
  watchForReturn();
  window.location.href = url;
}

// The current session's access token, refreshed by supabase-js if it needs to be.
// Null when there is no usable session, which is the caller's cue to ask for a
// fresh sign-in rather than send an unauthenticated request.
async function accessToken(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    const token = data?.session?.access_token;
    return typeof token === 'string' && token ? token : null;
  } catch {
    return null;
  }
}

// Only ever navigate to Stripe. The URL comes from our own Worker, so this is
// belt-and-braces rather than a live threat — but `location.href` from a parsed
// response is exactly the line where an open redirect would live, and checking it
// costs four lines.
function isStripeCheckoutUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'https:') return false;
    return hostname === 'checkout.stripe.com' || hostname.endsWith('.stripe.com');
  } catch {
    return false;
  }
}

// ── Noticing that the unlock has landed ──────────────────────────────────────

let polling = false;
let watching = false;

// The app came back to the foreground after we sent someone to a checkout. That
// is the most reliable signal available — it fires whether a Custom Tab was
// dismissed, the tab was switched, or a redirect came home — so it starts the
// poll on its own and doesn't wait to be told a purchase succeeded. A poll that
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
// Called once at boot. This is the redirect's own signal — Stripe's success_url
// — and the focus watcher behind it covers a checkout that never got there.
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

// The moment it lands. A dialog rather than a toast: someone has just paid, and a
// message that fades after two seconds is not an acknowledgement.
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
