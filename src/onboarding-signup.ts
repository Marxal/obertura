// The sign-up sheet, and the card that closes the first run.
//
// The card celebrates and points at the next step; the account is an offer under
// that, one button opening the ordinary sheet below, and it simply isn't built
// for someone already signed in.
//
// The sheet is otherwise opened only when someone asks for it: the first
// screen's log-in line, Settings, the buy flow, and the marketing site's ?auth=
// links.
//
// The form itself is account-ui.ts's, unchanged — the same one in Settings, just
// dropped into a sheet.

import { buildAuthForm } from './account-ui';
import { isSupabaseConfigured } from './supabase';
import { getAuthUser, onAuthChange } from './auth';
import { pushBack } from './back-nav';
import { celebratePawn, burstConfetti } from './confetti';
import { t } from './i18n';

// ── First run is done ───────────────────────────────────────────────────────
//
// A centred card over the hub: what they now have, the one thing to do next, and
// the account as a separate, optional thought under it.
//
// THE FORM IS OFF THE CARD AGAIN. It came and went more than once, and the audit
// settled it (UX-AUDIT 2.3.1, 2.3.2): three sign-up buttons under a celebration
// made the account the point of the moment and left the actual next step, a first
// session, nowhere. The sheet is one tap away and says the same thing.
export function showFirstLineSuccess(opts: {
  title?: string;
  lead?: string;
  // The one thing to do next. Absent: a plain "Keep going" that closes the card.
  primary?: { label: string; onClick: () => void };
} = {}): void {
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay firstwin-overlay';

  const card = document.createElement('div');
  card.className = 'firstwin-card';

  // The same pawn the training finish screens use.
  const pawn = celebratePawn();
  pawn.classList.add('firstwin-pawn');
  card.appendChild(pawn);

  const title = document.createElement('h3');
  title.className = 'firstwin-title';
  title.textContent = opts.title ?? t('signup.firstLine');
  card.appendChild(title);

  if (opts.lead) {
    const lead = document.createElement('p');
    lead.className = 'firstwin-lead';
    lead.textContent = opts.lead;
    card.appendChild(lead);
  }

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    overlay.remove();
    removeBack();
  }
  const removeBack = pushBack(close);

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'btn-primary firstwin-cta';
  next.textContent = opts.primary?.label ?? t('signup.keepGoing');
  next.addEventListener('click', () => { close(); opts.primary?.onClick(); });
  card.appendChild(next);

  // The offer, only where it means something: accounts have to exist in this
  // build, and someone already signed in has nothing to be asked for.
  if (isSupabaseConfigured && !getAuthUser()) {
    const why = document.createElement('p');
    why.className = 'firstwin-ask';
    why.textContent = t('signup.why');
    card.appendChild(why);

    const account = document.createElement('button');
    account.type = 'button';
    account.className = 'btn-secondary firstwin-account';
    account.textContent = t('common.createAccount');
    account.addEventListener('click', () => { close(); openSignUpSheet('signup'); });
    card.appendChild(account);
  }

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  // One burst on arrival, from the card itself.
  requestAnimationFrame(() => burstConfetti(card));
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
  title.textContent = t(mode === 'signin' ? 'signup.signIn' : 'common.createAccount');
  sheet.appendChild(title);

  const lead = document.createElement('p');
  lead.className = 'signup-sheet-lead';
  lead.textContent = opts.lead ?? t(mode === 'signin' ? 'signup.lead.signin' : 'signup.lead.signup');
  sheet.appendChild(lead);

  sheet.appendChild(buildAuthForm({ initialMode: mode, blurb: '' }));

  // "Continue as a guest", not "Not now" — the same words the first-line card
  // uses for the same choice. "Not now" describes only what the user is
  // declining; this names what they are choosing instead, which is a real state
  // with real consequences (everything stays on this phone alone). Nobody
  // should end up a guest without having read the word once.
  const notNow = document.createElement('button');
  notNow.type = 'button';
  notNow.className = 'signup-sheet-dismiss';
  notNow.textContent = t('signup.guest');
  notNow.addEventListener('click', close);
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
      lead: t('signup.unlockLead'),
      onSignedIn: openCheckout,
    }
    : {});
}
