// The Full Access popup — the app's half of the offer on bitochess.com.
//
// WHY THIS IS NOT showDialog(). The upgrade offer used to be a generic
// title + one paragraph + two buttons, which is the right shape for "save or
// discard?" and the wrong shape for the only screen in the app that asks
// somebody for money. This one is centred at every width (not a bottom sheet on
// a phone), leads with the price, and says the same things the website says, in
// the same words. Someone who read the landing page and then met a cap three
// weeks later should recognise the offer, not re-evaluate it.
//
// KEEP IT SHORT. A popup that asks for money and then makes you read four
// paragraphs first gets dismissed. The website has room to explain that this is
// a solo project with no ads and no investors; here the question is just "do you
// want this", so it opens on that question and everything else has been cut.
//
// THE WORDING IS THE LANDING PAGE'S WORDING, deliberately duplicated rather
// than derived: docs/index.html is a standalone static file that cannot import
// from src/. docs/LANDING-COPY.md is the source of truth for both — change it
// there first, then mirror it into the page and into this file.
//
// Nothing here knows about entitlement, checkout or Stripe: the caller passes the
// price in, passes the "what happens when they tap buy" action in, and — since
// the price now comes off the network — passes a way to be told when it changes.
// That keeps this module out of the entitlement ⇄ checkout import cycle that the
// note in entitlement.ts describes, and keeps it ignorant of where a price comes
// from.

import { pushBack } from './back-nav';

export interface ProSheetOptions {
  // Optional context line above the title, for when the offer was *run into*
  // rather than asked for — "You've got 10 lines in training". Omitted when the
  // user opened the offer themselves, where a number they haven't reached would
  // just be wrong.
  eyebrow?: string;
  // '9€' or '99 kr' — already formatted. The sheet is built synchronously, so
  // this is whatever the caller has in hand right now, which may be a cached or
  // built-in number rather than a freshly fetched one.
  price: string;
  // Optional. Subscribe to later corrections of that price: called once with an
  // `update` function, and must return an unsubscribe function, which the sheet
  // calls when it closes.
  //
  // This exists because the price is fetched from Stripe and the sheet cannot
  // wait for it. Showing a stale number for half a second and then correcting it
  // is better than a spinner where the price should be — and better than a
  // number that stays wrong.
  onPriceChange?: (update: (price: string) => void) => () => void;
  // Tapped "Unlock full access". The sheet closes first, then this runs.
  onBuy: () => void;
  // Optional, and passed only when nobody is signed in: tapped "Already have
  // Full Access? Sign in". The sheet closes first, then this runs.
  //
  // It exists because a purchase belongs to the ACCOUNT, not to the phone — so a
  // paid user who signs out (or picks up a second device) meets the free tier's
  // caps and, without this line, is offered the thing they already own with no
  // hint that signing in is the answer. Being asked to pay twice is the single
  // worst moment this sheet can produce.
  onSignIn?: () => void;
}

// The two promises, in the landing page's order and wording.
const POINTS = [
  'Unlimited active training rotation',
  'One-time payment, no subscription ever',
];

function tick(): SVGSVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('width', '18');
  el.setAttribute('height', '18');
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', '2.6');
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<path d="m5 12.5 4.5 4.5L19 7"/>';
  return el;
}

export function openProSheet(opts: ProSheetOptions): void {
  const overlay = document.createElement('div');
  // --pro marks this as the centred treatment; edit-overlay keeps the backdrop,
  // the z-index above the drill overlays, and the keyboard-lift behaviour.
  overlay.className = 'edit-overlay edit-overlay--pro';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Full Access');

  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet pro-sheet';

  if (opts.eyebrow) {
    const eyebrow = document.createElement('p');
    eyebrow.className = 'pro-eyebrow';
    eyebrow.textContent = opts.eyebrow;
    sheet.appendChild(eyebrow);
  }

  // The question IS the title. There used to be a headline above this one
  // ("Your whole repertoire. One payment.") saying the same thing twice.
  const title = document.createElement('h3');
  title.className = 'pro-title';
  title.textContent = 'Want to train everything you’ve built?';
  sheet.appendChild(title);

  const body = document.createElement('p');
  body.className = 'pro-body';
  body.textContent = 'Full Access unlocks unlimited training and helps fund what’s next.';
  sheet.appendChild(body);

  // ── The price card ──────────────────────────────────────────────────────────
  const card = document.createElement('div');
  card.className = 'pro-card';

  const price = document.createElement('p');
  price.className = 'pro-price';
  // Held as a node rather than set through textContent, so a late correction can
  // replace just the number without rebuilding the "one payment" span beside it.
  const priceText = document.createTextNode(opts.price);
  price.appendChild(priceText);
  const once = document.createElement('span');
  once.textContent = 'one payment';
  price.appendChild(once);
  card.appendChild(price);

  const plan = document.createElement('p');
  plan.className = 'pro-plan';
  plan.textContent = 'Full Access & Project Support';
  card.appendChild(plan);

  const planDesc = document.createElement('p');
  planDesc.className = 'pro-plan-desc';
  planDesc.textContent = 'Your entire repertoire, always available for training.';
  card.appendChild(planDesc);

  const list = document.createElement('ul');
  list.className = 'pro-points';
  for (const point of POINTS) {
    const li = document.createElement('li');
    li.appendChild(tick());
    const span = document.createElement('span');
    span.textContent = point;
    li.appendChild(span);
    list.appendChild(li);
  }
  card.appendChild(list);

  sheet.appendChild(card);

  // Corrections to the price, if the caller offered any. Unsubscribed on close so
  // a dismissed sheet stops holding a listener and stops writing to a detached
  // node.
  const unsubscribePrice = opts.onPriceChange?.((next) => { priceText.data = next; });

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    unsubscribePrice?.();
    overlay.remove();
    removeBack();
  }

  const buy = document.createElement('button');
  buy.type = 'button';
  buy.className = 'btn-primary pro-buy';
  buy.textContent = 'Unlock full access →';
  buy.addEventListener('click', () => { close(); opts.onBuy(); });
  sheet.appendChild(buy);

  const note = document.createElement('p');
  note.className = 'pro-note';
  // "A Bito Chess account", not "an account" — at this point in the flow the
  // reader is one tap from Stripe's own screen and has no reason to know which of
  // the two they are being asked to create.
  note.textContent =
    'Secure checkout via Stripe. A Bito Chess account is required so your '
    + 'purchase can follow you across devices.';
  sheet.appendChild(note);

  if (opts.onSignIn) {
    const restore = document.createElement('p');
    restore.className = 'pro-restore';
    restore.appendChild(document.createTextNode('Already have Full Access? '));
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'pro-restore-link';
    link.textContent = 'Sign in';
    link.addEventListener('click', () => { close(); opts.onSignIn?.(); });
    restore.appendChild(link);
    sheet.appendChild(restore);
  }

  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'pro-later';
  later.textContent = 'Not now';
  later.addEventListener('click', close);
  sheet.appendChild(later);

  // Backdrop tap and the system back gesture both just close it — declining an
  // offer needs no confirmation.
  const removeBack = pushBack(close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  requestAnimationFrame(() => buy.focus());
}
