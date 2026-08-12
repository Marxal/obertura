// "Create a free account" — the sign-up ask, and the only one the first run makes.
//
// It appears in exactly one place: after the user's FIRST clean confirm run, so
// the first thing we ever ask for comes straight after something that went well.
// Nothing before that point mentions an account, because nothing before that
// point has earned the right to.
//
// AND IT ARRIVES INSIDE A CELEBRATION, not on its own. The first line finishing
// is the end of the whole first run — the one moment the app has to say "that
// worked, here's what it was for". Dropping a bare sign-up form on the user
// there answers a question they hadn't asked yet and skips the answer to the one
// they had. So the ask now rides on a success card (showFirstLineSuccess): the
// celebrating pawn from the training finish, what just happened, what to do
// next, then the account offer and a quiet "Not now".
//
// The form itself is account-ui.ts's, unchanged — the same one in Settings, just
// opened on Sign up and dropped into a sheet. "Not now" means not now: it's
// remembered for the session AND persisted, so the post-win ask happens once in
// a device's life and never nags again.

import { buildAuthForm } from './account-ui';
import { isSupabaseConfigured } from './supabase';
import { getAuthUser, onAuthChange } from './auth';
import { pushBack } from './back-nav';
import { celebratePawn, burstConfetti } from './confetti';

// Asked once ever (persisted), and never twice in one session even if the flag
// write fails on a locked-down browser.
const ASKED_KEY = 'obertura.signupAsked';
let askedThisSession = false;

function markAsked(): void {
  askedThisSession = true;
  try { localStorage.setItem(ASKED_KEY, '1'); } catch { /* storage off */ }
}

function alreadyAsked(): boolean {
  if (askedThisSession) return true;
  try { return localStorage.getItem(ASKED_KEY) === '1'; } catch { return false; }
}

// ── The first line is done ───────────────────────────────────────────────────
//
// A centred card on the hub, shown once the first line has been saved AND
// learned. It does three things in the order they matter: says the first step is
// finished, says what a repertoire looks like from here, and — only if there's
// an account to be made — offers one. "Not now" is deliberately quiet: the user
// has just finished something, and the last impression of a first run shouldn't
// be a wall.
export function showFirstLineSuccess(): void {
  const canAsk = isSupabaseConfigured && !getAuthUser() && !alreadyAsked();
  if (canAsk) markAsked();

  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay firstwin-overlay';

  const card = document.createElement('div');
  card.className = 'firstwin-card';

  // The same pawn the training finish screens use — this IS a training finish,
  // it just happens to be the first one.
  const pawn = celebratePawn();
  pawn.classList.add('firstwin-pawn');
  card.appendChild(pawn);

  const title = document.createElement('h3');
  title.className = 'firstwin-title';
  title.textContent = 'Your first line is set!';
  card.appendChild(title);

  const lead = document.createElement('p');
  lead.className = 'firstwin-lead';
  lead.textContent = 'Add about five lines when you have a minute to build a repertoire '
    + 'worth training every day. You can save as many lines as you like.';
  card.appendChild(lead);

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    dropAuth();
    overlay.remove();
    removeBack();
  }
  const removeBack = pushBack(close);
  const dropAuth = onAuthChange(() => { if (getAuthUser()) close(); });

  if (canAsk) {
    const ask = document.createElement('p');
    ask.className = 'firstwin-ask';
    ask.textContent = 'Create a free account to sync your lines and progress across all your devices.';
    card.appendChild(ask);

    const cta = document.createElement('button');
    cta.type = 'button';
    cta.className = 'btn-primary firstwin-cta';
    cta.textContent = 'Create a free account';
    cta.addEventListener('click', () => { close(); openSignUpSheet(); });
    card.appendChild(cta);

    card.appendChild(dismissButton('Not now', close));
  } else {
    const cta = document.createElement('button');
    cta.type = 'button';
    cta.className = 'btn-primary firstwin-cta';
    cta.textContent = 'Keep going';
    cta.addEventListener('click', close);
    card.appendChild(cta);
  }

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  // One burst on arrival, from the card itself.
  requestAnimationFrame(() => burstConfetti(card));
}

function dismissButton(label: string, onClick: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'signup-sheet-dismiss';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

// The sheet itself. Also the target of ?auth=signup / ?auth=signin, which open
// it directly (from the marketing site's "Sign in" link and its final CTA) —
// that route deliberately does NOT consult the asked-flag: an explicit request
// is not a nag.
//
// The two modes are the same sheet with a different opening line: the form
// underneath can switch either way on its own, so this only decides which one
// the visitor lands on. A "Sign in" link that opened a sign-up form would be a
// small lie.
//
// `opts` exists for the buy flow (checkout.ts), which opens this sheet on the
// way to a checkout rather than as an end in itself. It needs to say WHY it's
// asking — "so your unlock follows you" answers a question the standard lead
// doesn't — and it needs to know the moment the account exists so it can carry
// on to the payment instead of dropping the user on whatever screen is behind.
export function openSignUpSheet(
  mode: 'signup' | 'signin' = 'signup',
  opts: {
    // Replaces the line under the title. Omit for the standard sync pitch.
    lead?: string;
    // Runs once, after an account exists and the sheet has closed itself.
    onSignedIn?: () => void;
  } = {},
): void {
  if (!isSupabaseConfigured) return;

  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet signup-sheet';

  // The title and the line under it used to say the same thing twice — "Save
  // your progress" over "Create an account to save your progress". The title now
  // states the ask (and that it costs nothing, which is the objection worth
  // answering first); the line says what it buys.
  const title = document.createElement('h3');
  title.className = 'edit-sheet-title';
  title.textContent = mode === 'signin' ? 'Sign in' : 'Create a free account';
  sheet.appendChild(title);

  const lead = document.createElement('p');
  lead.className = 'signup-sheet-lead';
  lead.textContent = opts.lead ?? (mode === 'signin'
    ? 'Your lines and progress come back the moment you do.'
    : 'Your lines and progress follow you to any phone you sign in on.');
  sheet.appendChild(lead);

  sheet.appendChild(buildAuthForm({ initialMode: mode, blurb: '' }));

  const notNow = document.createElement('button');
  notNow.type = 'button';
  notNow.className = 'signup-sheet-dismiss';
  notNow.textContent = 'Not now';
  notNow.addEventListener('click', () => { markAsked(); close(); });
  sheet.appendChild(notNow);

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    dropAuth();
    overlay.remove();
    removeBack();
  }
  const removeBack = pushBack(close);

  // Signing in (or finishing a sign-up that didn't need email confirmation)
  // makes the sheet pointless — close it rather than leave a form up behind the
  // "Signed in" toast.
  //
  // onSignedIn runs ONLY down this path, never from close() itself: "Not now"
  // and a backdrop tap also close the sheet, and neither of them means the
  // caller should carry on to whatever it wanted an account for. It runs after
  // the close so the sheet is already out of the way when a checkout opens over
  // the top of it.
  const dropAuth = onAuthChange(() => {
    if (!getAuthUser()) return;
    close();
    opts.onSignedIn?.();
  });

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}

// ?auth=signup / ?auth=signin → open the sheet in that mode and tidy the URL,
// so a refresh doesn't reopen it. Called once at boot. Any other value is
// ignored rather than guessed at.
//
// `&buy=1` rides along when the visitor came from the landing page's Buy
// button without an account. It is what stops the buy intent evaporating at
// the door: the landing page can't open a checkout for somebody who has no
// user id yet, so it hands the intent over here, and this carries it through
// the sign-up to the checkout on the other side. Someone who taps Buy should
// end up at a payment page, not on the Train screen wondering what happened.
//
// Signed in already (a returning customer who tapped Buy in a browser that had
// forgotten them, then turned out to be signed in inside the app): skip the
// sheet entirely and go straight to the checkout.
export function handleAuthUrlParam(): void {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return;
  }
  const asked = params.get('auth');
  const wantsCheckout = params.get('buy') === '1';
  const validAuth = asked === 'signup' || asked === 'signin';
  if (!validAuth && !wantsCheckout) return;

  params.delete('auth');
  params.delete('buy');
  const query = params.toString();
  window.history.replaceState(
    {},
    '',
    window.location.pathname + (query ? `?${query}` : '') + window.location.hash,
  );

  const openCheckout = (): void => {
    void import('./checkout').then(m => m.openCheckout());
  };

  if (getAuthUser()) {
    if (wantsCheckout) openCheckout();
    return;
  }
  if (!validAuth) {
    // ?buy=1 on its own, with nobody signed in. The checkout needs an account,
    // and openCheckout() asks for one itself — so hand it straight over rather
    // than duplicating the sign-up sheet's wiring here.
    openCheckout();
    return;
  }

  openSignUpSheet(asked, wantsCheckout
    ? {
      lead: 'Your unlock is tied to your account, so it follows you to any '
        + 'phone you sign in on — and comes back if you ever reinstall.',
      onSignedIn: openCheckout,
    }
    : {});
}
