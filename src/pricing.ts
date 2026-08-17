// What the unlock costs, in the currency the reader thinks in.
//
// The app used to hard-code '9€'. It still carries that number as a fallback, but
// the price the paywall SHOWS — and the price id the checkout SELLS — now come
// from Stripe, via GET /api/stripe/prices (worker/stripe-prices.ts). One place
// holds the truth, and it is the place that takes the money.
//
// ── EUR AND SEK, CHOSEN BY LOCALE ───────────────────────────────────────────
// Two Price objects exist in Stripe, each with an amount set by hand: €9 and a
// round 99 kr. Not a converted amount — a Swede should see a number that looks
// deliberate in Swedish, not 103,47 kr picked by yesterday's exchange rate.
//
// The pick is by the DEVICE's language list, not by IP. A Swedish phone gets SEK;
// everyone else gets EUR. That is a guess, and it will be wrong for a Swede whose
// phone is in English — they will be quoted €9 and charged €9, which is a
// perfectly good outcome, just not the friendliest one. Guessing from an IP
// address would be a request to a geolocation service on every paywall open,
// which the privacy policy's "no third-party requests" line rules out and which
// would be wrong for anyone travelling anyway.
//
// ── WHY THERE IS A FALLBACK AT ALL ──────────────────────────────────────────
// The pro sheet is built SYNCHRONOUSLY (the whole UI is), so it cannot wait for a
// network round trip before painting a price. Three layers make sure it always
// has something honest to show:
//   1. the quote fetched this session, if it has landed;
//   2. the last quote this device saw, from localStorage;
//   3. FALLBACK_AMOUNTS below — the built-in numbers.
// Layers 1 and 2 also carry the Stripe price id, which is what the buy button
// needs. Layer 3 does not, so a first-ever visitor with no network sees the right
// number and, on tapping buy, gets one more fetch attempt before being told to
// try again. See openCheckout() in checkout.ts.
//
// KEEP FALLBACK_AMOUNTS IN STEP WITH STRIPE. They are the fourth copy of the
// price (the others being the landing page's tier card, this app's paywall, and
// Stripe itself). If they ever disagree, Stripe is right and this is the bug —
// the buy button charges the Stripe amount regardless of what was shown.

import { isSupabaseConfigured } from './supabase';

export interface PriceQuote {
  // The Stripe price id. Absent on a fallback quote, which is exactly what makes
  // a fallback unsellable — see the note above.
  id?: string;
  // ISO 4217, lower-case, as Stripe returns it.
  currency: string;
  // The smallest unit of the currency: 900 is €9.00, 9900 is 99,00 kr.
  unitAmount: number;
}

// The endpoint. An absolute path, so it resolves against the origin whatever base
// the app was built with — /app/ on bitochess.com is the only build that has a
// Worker in front of it, and the guard in fetchPrices() keeps every other build
// from asking.
const PRICES_ENDPOINT = '/api/stripe/prices';

// Long enough for a phone on a bad connection, short enough that a buy button
// never feels stuck. The paywall doesn't wait on this at all; only the tap does.
const FETCH_TIMEOUT_MS = 6000;

// The built-in numbers. See the note above: keep them equal to the Stripe prices.
const FALLBACK_AMOUNTS: Record<string, number> = {
  eur: 900,
  sek: 9900,
};

const DEFAULT_CURRENCY = 'eur';

// The last quote this device saw. Not part of a backup: prices are per-locale,
// cheap to re-fetch, and carrying one into another device's restore would quote
// a Swedish price to a Spanish phone. storage.ts's backupLocalKey() excludes it
// by name, alongside the entitlement cache and the sync flags.
const CACHE_KEY = 'obertura.pricing';

// How long a cached quote is trusted before a fresh fetch is preferred. It is
// still USED past this — a week-old price beats no price — but a fetch is started
// on the next paywall open. Matches the Worker's own ten-minute cache.
const CACHE_FRESH_MS = 10 * 60 * 1000;

// Fired on window when a fetch changes the answer, so an open pro sheet can swap
// its placeholder for the real number instead of sitting stale. Same idea as
// ENTITLEMENT_CHANGE_EVENT.
export const PRICING_CHANGE_EVENT = 'obertura:pricingchange';

// ── The current answer ───────────────────────────────────────────────────────

let quotes: PriceQuote[] | null = null;
let fetchedAt = 0;
let inFlight: Promise<PriceQuote[]> | null = null;

// Which currency this device should be quoted in. 'sek' for a Swedish phone,
// 'eur' for everyone else.
//
// Both the language tag and the region are checked, so `sv`, `sv-SE` and an
// English-speaking Swede's `en-SE` all land on kronor. `navigator.languages` is
// the full preference list; the first entry that matches wins.
export function preferredCurrency(): string {
  let tags: readonly string[] = [];
  try {
    const nav = navigator as Navigator & { languages?: readonly string[] };
    tags = nav.languages?.length ? nav.languages : [nav.language].filter(Boolean) as string[];
  } catch {
    return DEFAULT_CURRENCY;
  }

  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    const lower = tag.toLowerCase();
    // `sv`, `sv-se`, `sv-fi` … or any tag with an -SE region.
    if (lower === 'sv' || lower.startsWith('sv-') || /(^|-)se($|-)/.test(lower)) return 'sek';
  }
  return DEFAULT_CURRENCY;
}

// The quote to show and sell right now. Synchronous, never null, and never
// throws — the paywall calls it while painting.
//
// Falls through the three layers described at the top of this file. The returned
// quote may have no `id`, which means "correct number, cannot be bought with";
// checkout.ts is the only caller that cares about the difference.
export function currentPrice(currency = preferredCurrency()): PriceQuote {
  const live = pick(quotes, currency);
  if (live) return live;

  const cached = pick(readCache(), currency);
  if (cached) return cached;

  return {
    currency,
    unitAmount: FALLBACK_AMOUNTS[currency] ?? FALLBACK_AMOUNTS[DEFAULT_CURRENCY],
  };
}

// The price as a string, in the house style: symbol after the number for euros
// ("9€", as the landing page has always written it), "kr" after a space for
// kronor, and whole numbers with no decimals at all.
export function formatPrice(quote: PriceQuote = currentPrice()): string {
  const { unitAmount, currency } = quote;
  const digits = unitAmount % 100 === 0 ? 0 : 2;
  const major = unitAmount / 100;

  // The decimal separator follows the currency's own convention (a comma in both
  // of these), which is what a reader in either place expects. Only ever used on
  // an amount that has decimals — €9 stays "9€", not "9,00€".
  const numberLocale = currency === 'sek' ? 'sv-SE' : 'de-DE';
  let number: string;
  try {
    number = new Intl.NumberFormat(numberLocale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(major);
  } catch {
    number = digits === 0 ? String(major) : major.toFixed(2);
  }

  if (currency === 'eur') return `${number}€`;
  if (currency === 'sek') return `${number} kr`;

  // A currency somebody added in Stripe that this file has never heard of. Let
  // Intl write it however it writes it rather than inventing a symbol.
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(major);
  } catch {
    return `${number} ${currency.toUpperCase()}`;
  }
}

// ── Fetching ─────────────────────────────────────────────────────────────────

// Ask the Worker for the current prices. Resolves to whatever we end up with —
// never rejects, because every caller's fallback is the same and a rejection here
// would just be an unhandled error on the way to it.
//
// Concurrent calls share one request: the paywall opening while boot's own prime
// is still in the air is the common case, not the exception.
export function fetchPrices(): Promise<PriceQuote[]> {
  // No Supabase means no accounts, which means nothing to sell and nobody to
  // sell it to (src/entitlement.ts treats that build as fully entitled). It is
  // also the GitHub Pages build, which has no Worker behind it, so this fetch
  // would be a guaranteed 404 on every launch.
  if (!isSupabaseConfigured) return Promise.resolve([]);
  if (inFlight) return inFlight;

  inFlight = (async (): Promise<PriceQuote[]> => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let payload: unknown;
      try {
        const res = await fetch(PRICES_ENDPOINT, {
          headers: { accept: 'application/json' },
          signal: controller.signal,
        });
        if (!res.ok) return quotes ?? readCache() ?? [];
        payload = await res.json();
      } finally {
        clearTimeout(timer);
      }

      const fresh = parseQuotes(payload);
      // An empty list means the Worker has no Stripe key yet, or Stripe is down
      // and it had nothing cached. Keep whatever we already had rather than
      // replacing a real price with nothing.
      if (fresh.length === 0) return quotes ?? readCache() ?? [];

      const changed = JSON.stringify(fresh) !== JSON.stringify(quotes);
      quotes = fresh;
      fetchedAt = Date.now();
      writeCache(fresh);
      if (changed) window.dispatchEvent(new Event(PRICING_CHANGE_EVENT));
      return fresh;
    } catch {
      // Offline, aborted, or malformed JSON. The previous answer stands.
      return quotes ?? readCache() ?? [];
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

// Start a fetch unless a fresh one already landed. Called at boot and whenever
// the paywall opens, so the price id is usually in hand before anyone taps buy.
export function primePricing(): void {
  if (quotes && Date.now() - fetchedAt < CACHE_FRESH_MS) return;
  void fetchPrices();
}

// The quote to actually charge, for the buy button. Waits for a fetch when it
// has no sellable quote yet, and resolves to null when even that fails — which
// is the caller's cue to say "try again", never to guess an id.
export async function sellablePrice(currency = preferredCurrency()): Promise<PriceQuote | null> {
  const known = currentPrice(currency);
  if (known.id) {
    // Refresh in the background: this quote is good enough to sell right now,
    // and a price edited in Stripe ten minutes ago should still land eventually.
    primePricing();
    return known;
  }

  await fetchPrices();
  const fetched = currentPrice(currency);
  return fetched.id ? fetched : null;
}

// ── The device's copy ────────────────────────────────────────────────────────

function readCache(): PriceQuote[] | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(CACHE_KEY);
  } catch {
    return null; // storage off — behave as if nothing was ever cached
  }
  if (!raw) return null;
  try {
    return parseQuotes(JSON.parse(raw));
  } catch {
    return null; // corrupt entry — treat it as absent
  }
}

function writeCache(list: PriceQuote[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ prices: list }));
  } catch {
    /* storage off — we simply won't have an offline price */
  }
}

// ── Reading the wire ─────────────────────────────────────────────────────────

// Everything from the network is untrusted, including our own Worker's answer —
// a half-deployed Worker or a captive-portal login page can both return JSON. A
// quote with a bad amount is dropped rather than shown as "NaN€".
function parseQuotes(payload: unknown): PriceQuote[] {
  const list = (payload as { prices?: unknown })?.prices;
  if (!Array.isArray(list)) return [];

  const out: PriceQuote[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const { id, currency, unitAmount } = item as Record<string, unknown>;
    if (typeof currency !== 'string' || !currency) continue;
    if (typeof unitAmount !== 'number' || !Number.isFinite(unitAmount) || unitAmount <= 0) continue;
    out.push({
      ...(typeof id === 'string' && id ? { id } : {}),
      currency: currency.toLowerCase(),
      unitAmount: Math.round(unitAmount),
    });
  }
  return out;
}

// The quote for a currency, or — when that currency isn't offered — the default
// one, so a Norwegian phone asking for NOK is quoted in euros rather than
// nothing. Returns null only when the list is empty.
function pick(list: PriceQuote[] | null, currency: string): PriceQuote | null {
  if (!list || list.length === 0) return null;
  return list.find(q => q.currency === currency)
    ?? list.find(q => q.currency === DEFAULT_CURRENCY)
    ?? list[0];
}
