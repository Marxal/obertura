// The Lemon Squeezy checkout — one shared client for the buy flow, the same way
// supabase.ts is the one shared Supabase client.
//
// This is the CLIENT half of the purchase. The server half already exists in
// worker/lemonsqueezy-webhook.ts: Lemon Squeezy calls it after a payment, it
// verifies the signature, and it is the only thing in the whole system that can
// write `profiles.entitled`. Nothing here grants access; this file only opens
// the checkout and then waits for the webhook's work to show up.
//
// ── WHY AN OVERLAY, NOT A REDIRECT ──────────────────────────────────────────
// The obvious way to sell something is to send the browser to the checkout and
// hope it comes back. That is wrong for this app twice over. Bito Chess is an
// installed PWA: navigating away drops the user out of the app window and into
// a browser tab, and on Android the way back in is not obvious. And a redirect
// gives you nothing to react to — you would have to poll a return URL and guess
// when to stop. Lemon.js's overlay keeps the checkout in an iframe on top of
// the app, so the user never leaves, and it fires a `Checkout.Success` event
// the instant the payment clears, which is a real signal instead of a guess.
//
// ── WHY THE SCRIPT IS INJECTED LAZILY ───────────────────────────────────────
// Lemon.js is third-party code from a payments company. Putting the <script> in
// index.html would make every launch of the app — including the overwhelming
// majority that never go anywhere near a buy button — fetch and run it. So it
// is injected the first time someone actually clicks buy, exactly like the
// Google Identity script in drive-backup.ts, and cached in a module-level
// promise so a second click reuses the first load.
//
// ── WHY THE SUCCESS EVENT IS NOT THE END ────────────────────────────────────
// `Checkout.Success` fires in the BROWSER when the payment clears. The webhook
// that sets `entitled` fires separately, server to server, and routinely lands a
// second or three later. Trusting the client event alone would mean showing
// "you're unlocked" while `isEntitled()` still says false — the cap would still
// bite, and the plan pill would still read "Free". So the event only starts a
// short polling window: re-fetch the profile a handful of times over ~10s until
// the flag actually flips. If it never does, the money is still safe (the
// webhook retries on its own schedule) and we say so plainly rather than
// claiming success we cannot see.
//
// ── CONFIGURATION ───────────────────────────────────────────────────────────
// VITE_LEMONSQUEEZY_CHECKOUT_URL is the store's buy link, set in `.env` locally
// and in the Cloudflare Pages environment for the deployed build (see
// .env.example and LEMONSQUEEZY-SETUP.md). It is a public URL — anyone can open
// the store page — so having Vite inline it into the bundle is fine, exactly
// like the Supabase anon key. The webhook's three secrets are a different
// matter entirely and live only in the Worker; none of them are `VITE_`.
//
// With no URL configured `isCheckoutConfigured` is false and callers hide the
// button rather than showing one that cannot work.

// entitlement.ts imports this file back (its upgrade dialog opens the
// checkout), which is a cycle — a deliberate one, and safe: neither module
// touches the other while it is still evaluating, only from inside functions
// that run long after boot. Settings does exactly the same thing with
// account-ui.ts.
import { showToast } from './toast';
import { refreshEntitlement, isEntitled } from './entitlement';

const CHECKOUT_URL = import.meta.env.VITE_LEMONSQUEEZY_CHECKOUT_URL ?? '';

// True only when this build was given a checkout link. Check this before
// rendering anything that offers to sell, so an unconfigured build shows no
// button at all instead of a dead one.
export const isCheckoutConfigured = Boolean(CHECKOUT_URL);

const LEMON_JS_SRC = 'https://app.lemonsqueezy.com/js/lemon.js';

// The event Lemon.js emits when a payment has cleared in the overlay.
const SUCCESS_EVENT = 'Checkout.Success';

// How long to keep asking Supabase whether the webhook has landed. Front-loaded
// because the common case is fast — the whole sequence covers ~10s, and the
// first check happens immediately, before any of these waits.
const POLL_DELAYS_MS = [900, 1600, 2200, 2600, 3000];

// ── Opening the checkout ─────────────────────────────────────────────────────

// Open the Lemon Squeezy overlay for this Supabase user. Never throws and never
// leaves the caller's button dead: every failure path ends in a toast.
export async function openCheckout(userId: string): Promise<void> {
  if (!userId) {
    // Belt and braces — every call site already checks, but a checkout with no
    // user id would produce a payment nobody can be matched to (the webhook
    // answers 422 and it has to be fixed by hand). Refuse instead.
    showToast('Sign in first, then buy full access.');
    return;
  }
  if (!isCheckoutConfigured) {
    showToast('The checkout isn’t set up in this build.');
    return;
  }

  try {
    const lemon = await loadLemonJs();
    lemon.Url.Open(checkoutUrlFor(userId));
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Couldn’t open the checkout. Try again.');
  }
}

// The checkout link with the buyer's Supabase id attached as custom data.
//
// `checkout[custom][user_id]` is Lemon Squeezy's documented way of passing your
// own data through a checkout link: anything under `checkout[custom][…]` is
// handed straight back in the webhook payload as `meta.custom_data`. The key
// must be exactly `user_id` — that is what the Worker reads. The brackets stay
// literal (that is the form Lemon Squeezy documents and parses); only the value
// is encoded.
//
// `embed=1` is what makes the page render as an overlay rather than the full
// store page inside the iframe. Harmless on any link that already has it.
function checkoutUrlFor(userId: string): string {
  const params = `embed=1&checkout[custom][user_id]=${encodeURIComponent(userId)}`;
  return CHECKOUT_URL + (CHECKOUT_URL.includes('?') ? '&' : '?') + params;
}

// ── Loading Lemon.js ─────────────────────────────────────────────────────────

let lemonPromise: Promise<LemonSqueezyGlobal> | null = null;

// Inject the script once and resolve with the global it defines. Cached, so
// concurrent clicks share one load; cleared on failure so a flaky network can
// be retried by clicking again.
function loadLemonJs(): Promise<LemonSqueezyGlobal> {
  if (lemonPromise) return lemonPromise;

  lemonPromise = new Promise<LemonSqueezyGlobal>((resolve, reject) => {
    const ready = (): void => {
      // Lemon.js initialises itself when the browser loads it as a page script.
      // Injected after boot it may not have, so we call the documented
      // initialiser ourselves. It is safe to call when it has already run.
      window.createLemonSqueezy?.();
      const lemon = window.LemonSqueezy;
      if (!lemon?.Url?.Open) {
        reject(new Error('The checkout didn’t start up. Try again in a moment.'));
        return;
      }
      setupEventHandler(lemon);
      resolve(lemon);
    };

    // Already there (a previous load, or someone added the tag by hand).
    if (window.LemonSqueezy) { ready(); return; }

    const script = document.createElement('script');
    script.src = LEMON_JS_SRC;
    script.defer = true;
    script.onload = ready;
    script.onerror = () => {
      lemonPromise = null; // allow a retry after a flaky network
      script.remove();
      reject(new Error('Couldn’t load the checkout — check your connection.'));
    };
    document.head.appendChild(script);
  });

  return lemonPromise;
}

let handlerAttached = false;

// One Setup() call for the life of the page. Calling it again would replace the
// handler, and a checkout opened by the previous one would then land nowhere.
function setupEventHandler(lemon: LemonSqueezyGlobal): void {
  if (handlerAttached) return;
  handlerAttached = true;
  lemon.Setup({
    eventHandler: (event) => {
      if (event?.event === SUCCESS_EVENT) void onCheckoutSuccess();
    },
  });
}

// ── After the payment ────────────────────────────────────────────────────────

let activating = false;

// The payment cleared in the browser. Close the overlay, say something
// immediately, then wait for the webhook to actually flip the flag.
async function onCheckoutSuccess(): Promise<void> {
  // Lemon.js can emit the event more than once for one purchase (a re-render of
  // the confirmation step). One activation sequence is enough.
  if (activating) return;
  activating = true;

  try {
    window.LemonSqueezy?.Url?.Close?.();
    showToast('Purchase received — activating your account…', { durationMs: 4000 });

    // Check straight away: sometimes the webhook has already landed by the time
    // the overlay finishes animating out.
    for (let attempt = 0; ; attempt++) {
      await refreshEntitlement();
      // refreshEntitlement fires ENTITLEMENT_CHANGE_EVENT when the answer
      // changes, so Settings and the Account card repaint themselves — there is
      // nothing to re-render from here.
      if (isEntitled()) {
        showToast('Full access unlocked — thank you.', { variant: 'success' });
        return;
      }
      if (attempt >= POLL_DELAYS_MS.length) break;
      await sleep(POLL_DELAYS_MS[attempt]);
    }

    // The payment went through — Lemon Squeezy told us so — but the webhook
    // hasn't reached Supabase yet. It retries on its own, so this resolves
    // itself; say that rather than pretending either success or failure.
    showToast(
      'Payment went through. Access can take a minute — reopen the app if it hasn’t appeared.',
      { durationMs: 5000 },
    );
  } finally {
    activating = false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── The bits of Lemon.js this file touches ───────────────────────────────────
//
// Typed by hand rather than pulled from a package: Lemon.js is a script tag,
// not an npm dependency, and only these three entry points are used. Everything
// is optional-chained at the call sites, so a future version that drops one of
// them fails soft instead of throwing.

interface LemonSqueezyEvent {
  event?: string;
  // Checkout.Success carries the freshly created order. Unused — the webhook is
  // the authority on what was bought, and this data is client-side, so it must
  // never be trusted to grant anything.
  data?: unknown;
}

interface LemonSqueezyGlobal {
  Setup(options: { eventHandler: (event: LemonSqueezyEvent) => void }): void;
  Url: {
    Open(url: string): void;
    Close?(): void;
  };
}

declare global {
  interface Window {
    LemonSqueezy?: LemonSqueezyGlobal;
    createLemonSqueezy?: () => void;
  }
}
