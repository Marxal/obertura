// The Full Access popup — the app's half of the "Your whole repertoire. One
// payment." pitch on bitochess.com.
//
// WHY THIS IS NOT showDialog(). The upgrade offer used to be a generic
// title + one paragraph + two buttons, which is the right shape for "save or
// discard?" and the wrong shape for the only screen in the app that asks
// somebody for money. This one is centred at every width (not a bottom sheet on
// a phone), leads with the price, and says the same four things the website
// says, in the same words. Someone who read the landing page and then met a cap
// three weeks later should recognise the offer, not re-evaluate it.
//
// THE WORDING IS THE LANDING PAGE'S WORDING, deliberately duplicated rather
// than derived: docs/index.html is a standalone static file that cannot import
// from src/. docs/LANDING-COPY.md is the source of truth for both — change it
// there first, then mirror it into the page and into this file.
//
// Nothing here knows about entitlement or checkout: the caller passes the price
// and the free-tier size in, and passes the "what happens when they tap buy"
// action in. That keeps this module out of the entitlement ⇄ checkout import
// cycle that the note over PRO_PRICE describes.

import { pushBack } from './back-nav';

export interface ProSheetOptions {
  // Optional context line above the title, for when the offer was *run into*
  // rather than asked for — "You've got 10 lines in training". Omitted when the
  // user opened the offer themselves, where a number they haven't reached would
  // just be wrong.
  eyebrow?: string;
  // '€9' — passed in so the price lives in exactly one constant (PRO_PRICE).
  price: string;
  // How many lines the free tier trains at once, for the one line that has to
  // state the actual limit.
  freeLines: number;
  // Tapped "Unlock full access". The sheet closes first, then this runs.
  onBuy: () => void;
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

  const title = document.createElement('h3');
  title.className = 'pro-title';
  title.textContent = 'Your whole repertoire. One payment.';
  sheet.appendChild(title);

  const lead = document.createElement('p');
  lead.className = 'pro-lead';
  lead.textContent = 'Want to train everything you’ve built?';
  sheet.appendChild(lead);

  const body = document.createElement('p');
  body.className = 'pro-body';
  body.textContent =
    'Bito Chess is a solo project — no ads, no investors, no subscriptions. '
    + 'Full Access unlocks unlimited training and helps fund what’s next.';
  sheet.appendChild(body);

  // ── The price card ──────────────────────────────────────────────────────────
  const card = document.createElement('div');
  card.className = 'pro-card';

  const price = document.createElement('p');
  price.className = 'pro-price';
  price.appendChild(document.createTextNode(opts.price));
  const once = document.createElement('span');
  once.textContent = 'once';
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

  // The one line that states the actual limit being lifted. It sits under the
  // card rather than in the pitch: the offer is what's on sale, this is the
  // fact behind it.
  const limit = document.createElement('p');
  limit.className = 'pro-limit';
  limit.textContent = `Free training rotation: ${opts.freeLines} lines at a time. Saving lines is unlimited either way.`;
  sheet.appendChild(limit);

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
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
  note.textContent =
    'Secure checkout via Lemon Squeezy. An account is required so your purchase '
    + 'can follow you across devices.';
  sheet.appendChild(note);

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
