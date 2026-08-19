// The "Account" group in Settings — registration, sign in, sign out, password
// reset, and the live sync caption.
//
// ONLY EVER BUILT WHEN SUPABASE IS CONFIGURED. settings-screen.ts checks
// `isSupabaseConfigured` before calling in here, so on the internal GitHub Pages
// build (no env vars) this section doesn't exist at all: not a disabled row, not
// a placeholder — nothing. That build stays exactly as it is today, entered
// through the beta-code gate as always.
//
// The group is a normal Settings accordion (same `group()` scaffolding as
// Appearance, Training and the rest), but it re-renders only its own body when
// the auth state changes. Re-rendering the whole Settings screen would snap the
// accordion shut the instant you signed in.
//
// ── THE TWO TABS ARE "REGISTRATION" AND "SIGN IN" ───────────────────────────
// Not "sign up" / "sign in", which differ by one letter in the middle of a word
// and are a genuine coin-toss to read at a glance on a phone. Registration also
// matches the checkbox underneath it, which is a registration-time consent and
// nothing else.

import {
  getAuthUser,
  onAuthChange,
  signUpWithPassword,
  signInWithPassword,
  signInWithProvider,
  signInWithMagicLink,
  sendPasswordReset,
  updatePassword,
  resendConfirmation,
  enabledOAuthProviders,
  OAUTH_PROVIDER_LABELS,
  clearPasswordRecovery,
  signOut,
  type OAuthProvider,
} from './auth';
import { entitlementLabel, isEntitled, ENTITLEMENT_CHANGE_EVENT } from './entitlement';
import { showToast } from './toast';
import { showDialog } from './dialog';
import { Icons } from './icons';
import { group } from './settings-screen';
import { pushBack } from './back-nav';
import { PRIVACY_URL, TERMS_URL } from './legal';
import { SYNC_CHANGE_EVENT, getSyncState, getLastSync, getSyncError, syncNow } from './repertoire-sync';

// Which of the two forms is showing. Kept per-instance, not persisted — every
// visit starts on Sign in, which is what a returning user wants.
type Mode = 'signin' | 'signup';

// Settings rebuilds itself often (an import, a Lichess connect, …), and each
// rebuild makes a fresh Account group. Only the newest one should be listening,
// so building a new one retires the previous one's subscription.
let dropPreviousListener: (() => void) | null = null;

export function buildAccountGroup(): HTMLElement {
  const sec = group('Account', Icons.userCircle(16));

  let mode: Mode = 'signin';

  // Swap everything after the <summary> for the current state's body. Signed
  // out, the group stands out and stays open — it leads the whole screen, and
  // there's a real decision to make here. Signed in, there's nothing left to
  // act on, so it folds back into an ordinary accordion.
  const render = (): void => {
    while (sec.childNodes.length > 1) sec.removeChild(sec.lastChild!);
    const signedIn = !!getAuthUser();
    sec.classList.toggle('section--acc-highlight', !signedIn);
    if (!signedIn) sec.setAttribute('open', '');
    sec.appendChild(signedIn ? signedInBody(render) : signedOutBody(mode, (m) => { mode = m; render(); }));
  };

  // Sign-in and sign-out both land here — including the one that completes on
  // the next page load, after an OAuth redirect. The plan pill also has to
  // repaint when the entitlement fetch lands, which is a moment after sign-in.
  dropPreviousListener?.();
  const dropAuth = onAuthChange(render);
  window.addEventListener(ENTITLEMENT_CHANGE_EVENT, render);
  dropPreviousListener = () => {
    dropAuth();
    window.removeEventListener(ENTITLEMENT_CHANGE_EVENT, render);
  };

  render();
  return sec;
}

// ── Signed in ────────────────────────────────────────────────────────────────

function signedInBody(refresh: () => void): HTMLElement {
  const user = getAuthUser()!;

  const wrap = document.createElement('div');

  const card = document.createElement('div');
  card.className = 'settings-connected settings-connected--compact';

  const who = document.createElement('div');
  who.className = 'settings-connected-who';
  who.appendChild(Icons.userCircle(22));
  const handle = document.createElement('span');
  handle.className = 'settings-connected-handle account-email';
  handle.textContent = user.email ?? 'Signed in';
  who.appendChild(handle);
  card.appendChild(who);

  const status = document.createElement('div');
  status.className = 'account-status';
  const pill = document.createElement('span');
  pill.className = 'account-pill'
    + (isEntitled() ? ' account-pill--full' : ' account-pill--free');
  pill.textContent = entitlementLabel();
  status.appendChild(pill);
  card.appendChild(status);

  wrap.appendChild(card);

  wrap.appendChild(syncRow());

  // The old note here explained the merge-or-replace question that signing in
  // used to ask. There is no question any more (repertoire-sync.ts merges), so
  // there is nothing left to warn about — and a paragraph describing a dialog
  // that no longer exists is worse than no paragraph at all.

  const outBtn = document.createElement('button');
  outBtn.type = 'button';
  outBtn.className = 'btn-secondary';
  outBtn.textContent = 'Sign out';
  outBtn.addEventListener('click', async () => {
    outBtn.disabled = true;
    const result = await signOut();
    outBtn.disabled = false;
    if (!result.ok) { showToast(result.message ?? 'Couldn’t sign out. Try again.'); return; }
    showToast('Signed out');
    refresh();
  });

  const actions = document.createElement('div');
  actions.className = 'settings-actions';
  actions.appendChild(outBtn);
  wrap.appendChild(actions);

  return wrap;
}

// ── Sync status ──────────────────────────────────────────────────────────────
//
// One live caption plus a button that stops the user having to wonder. Syncing
// happens in the background — a debounced push ~30s after the last edit, and a
// pull when the app comes back to the foreground — so this is how anyone ever
// knows it's working. The listener detaches itself once the row leaves the DOM.
function syncRow(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'account-sync-row';

  const line = document.createElement('p');
  line.setAttribute('aria-live', 'polite');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'account-sync-now';
  btn.textContent = 'Sync now';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const was = btn.textContent;
    btn.textContent = 'Syncing…';
    await syncNow();
    btn.textContent = was;
    btn.disabled = false;
    paint();
    if (getSyncState() !== 'failed') showToast('Synced', { variant: 'success' });
  });

  const paint = (): void => {
    const state = getSyncState();
    line.className = 'account-sync' + (state === 'failed' ? ' account-sync--error' : '');
    line.textContent = syncCaption();
  };

  const onChange = (): void => {
    if (!wrap.isConnected) {
      window.removeEventListener(SYNC_CHANGE_EVENT, onChange);
      return;
    }
    paint();
  };
  window.addEventListener(SYNC_CHANGE_EVENT, onChange);

  paint();
  wrap.appendChild(line);
  wrap.appendChild(btn);
  return wrap;
}

function syncCaption(): string {
  switch (getSyncState()) {
    case 'failed':
      // Whatever actually went wrong, in words. The old caption said "Sync
      // failed — will retry" for everything, which made a project whose SQL had
      // never been run look identical to a train tunnel; repertoire-sync.ts's
      // describeSyncError names the difference.
      return getSyncError() ?? 'Sync failed — will retry.';
    case 'pending':
      return 'Pending — your latest changes go up in a moment.';
    case 'synced':
      return `Synced ${agoLabel(getLastSync())}.`;
    default:
      // 'never' — signed in, nothing up from this device yet. ('off' can't
      // reach here: this row only exists inside the signed-in body.)
      return 'Nothing synced yet.';
  }
}

// "just now" / "12 minutes ago" / "3 hours ago" / "2 days ago". Finer-grained
// than a daily caption would be, because a sync you triggered seconds ago
// showing "today" would read as broken.
function agoLabel(iso: string | null): string {
  if (!iso) return 'just now';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 90_000) return 'just now';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// ── Signed out ───────────────────────────────────────────────────────────────

// The registration / sign-in form, on its own. Exported so the post-onboarding
// sign-up sheet (onboarding-signup.ts) shows the SAME form rather than a second
// implementation of it — one place to fix a bug in, one place where the wording
// lives. The sheet passes its own blurb (it has already made the pitch in its
// title) and opens on Registration rather than Sign in.
export function buildAuthForm(opts: {
  initialMode?: Mode;
  // Replacement for the standing blurb. Pass '' to drop it entirely, which is
  // what the sheet does — its title has already made the pitch.
  blurb?: string;
} = {}): HTMLElement {
  const host = document.createElement('div');
  let mode: Mode = opts.initialMode ?? 'signin';
  const render = (): void => {
    host.replaceChildren(signedOutBody(mode, (m) => { mode = m; render(); }, opts.blurb));
  };
  render();
  return host;
}

function signedOutBody(
  mode: Mode,
  setMode: (m: Mode) => void,
  blurbText?: string,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'account-auth';

  const copy = blurbText ?? (
    'An account keeps your lines, training and statistics in step across your '
    + 'phones, and brings them back if you ever reinstall.'
  );
  if (copy) {
    const blurb = document.createElement('p');
    blurb.className = 'section-desc';
    blurb.textContent = copy;
    wrap.appendChild(blurb);
  }

  // Registration / Sign in, as a two-way switch above the shared form.
  // Deliberately not the `segmented` control from Settings: this picks which
  // form you're filling in, it isn't a preference being saved.
  const tabs = document.createElement('div');
  tabs.className = 'account-tabs';
  for (const tab of [
    { value: 'signup' as Mode, label: 'Registration' },
    { value: 'signin' as Mode, label: 'Sign in' },
  ]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'account-tab' + (tab.value === mode ? ' active' : '');
    btn.setAttribute('aria-pressed', String(tab.value === mode));
    btn.textContent = tab.label;
    btn.addEventListener('click', () => { if (tab.value !== mode) setMode(tab.value); });
    tabs.appendChild(btn);
  }
  wrap.appendChild(tabs);

  // The two tabs are shaped differently ON PURPOSE, and it isn't inconsistency.
  //
  // Registration is a form: creating an account means agreeing to two documents,
  // so the checkbox has to be on screen and the email/password pair leads.
  // Signing in is a CHOICE, and for most people the fastest right answer is a
  // provider they're already logged into — so Google and Facebook lead there,
  // and email is folded away behind one tap for the people who want it.
  if (mode === 'signup') buildSignUpBlock(wrap);
  else buildSignInBlock(wrap, setMode);

  return wrap;
}

// ── Registration ─────────────────────────────────────────────────────────────
//
// Unchanged: email + password + the consent checkbox, then the providers under
// a divider. Sign-up has exactly one door and this is it — the magic link on
// the other tab cannot create an account (see signInWithMagicLink), precisely so
// nobody ends up with an account they never agreed to the Terms for.

function buildSignUpBlock(wrap: HTMLElement): void {
  const form = document.createElement('form');
  form.className = 'account-form';

  const email = field('email', 'Email', 'you@example.com', 'username');
  const password = field('password', 'Password', 'At least 6 characters', 'new-password');
  form.appendChild(email.wrap);
  form.appendChild(password.wrap);

  // ── The consent checkbox ───────────────────────────────────────────────────
  //
  // Registration only, and required. It is not decoration: the terms and the
  // privacy policy are the two documents this account is created under, and
  // "carry on and you'll have agreed" is not consent anybody can point at
  // later. Sign-in doesn't show it — you agreed when you registered, and asking
  // again every time would train people to tick without reading.
  //
  // The social buttons below get the passive line instead of a checkbox,
  // because from here a Google tap is indistinguishable from a Google tap: the
  // app cannot tell a first-time registration from a returning sign-in until
  // the redirect comes back.
  const row = document.createElement('label');
  row.className = 'account-consent';
  const consent = document.createElement('input');
  consent.type = 'checkbox';
  consent.className = 'account-consent-box';
  consent.required = true;
  row.appendChild(consent);
  const text = document.createElement('span');
  text.className = 'account-consent-text';
  text.appendChild(document.createTextNode('I have read and agree to the '));
  text.appendChild(docLink(PRIVACY_URL, 'Privacy policy'));
  text.appendChild(document.createTextNode(' and '));
  text.appendChild(docLink(TERMS_URL, 'Terms'));
  text.appendChild(document.createTextNode('.'));
  row.appendChild(text);
  form.appendChild(row);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn-primary account-submit';
  submit.textContent = 'Create account';
  form.appendChild(submit);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const emailValue = email.input.value.trim();
    const passwordValue = password.input.value;
    if (!emailValue || !passwordValue) {
      showToast('Enter your email and a password.');
      return;
    }
    if (!consent.checked) {
      showToast('Please agree to the Privacy policy and Terms first.');
      consent.focus();
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Creating…';

    const result = await signUpWithPassword(emailValue, passwordValue);

    submit.disabled = false;
    submit.textContent = 'Create account';

    if (!result.ok) {
      showToast(result.message ?? 'Something went wrong. Try again in a moment.');
      return;
    }
    if (result.needsEmailConfirmation) {
      // Worth more than a toast: nothing happens until they open the link, and
      // a toast fades before they've read it. The "send it again" button is
      // here because the commonest failure of email confirmation is an email
      // that never arrives, and re-registering would just say "already exists".
      showDialog({
        title: 'Check your inbox',
        body: `We’ve sent a confirmation link to ${emailValue}. Open it to finish `
          + 'creating your account — the link signs you in, so you can come straight back. '
          + 'It can take a minute, and it sometimes lands in spam.',
        buttons: [
          {
            label: 'Send it again',
            onClick: () => { void resendAndReport(emailValue); },
          },
          { label: 'Got it', variant: 'primary' },
        ],
      });
      password.input.value = '';
      return;
    }
    showToast('Account created', { variant: 'success' });
    // The auth listener re-renders this section; nothing else to do.
  });

  wrap.appendChild(form);

  const providers = enabledOAuthProviders();
  if (providers.length > 0) {
    wrap.appendChild(orDivider());
    for (const provider of providers) wrap.appendChild(providerButton(provider));
    wrap.appendChild(legalNote());
  }
}

// ── Sign in ──────────────────────────────────────────────────────────────────
//
// Providers first, at equal weight — neither is "the" way in, and a returning
// user who registered with Google should be one tap from done. Email lives
// under the divider, closed, because it is the slower path and only some people
// want it; opening it offers the sign-in LINK first (nothing to remember, works
// from any device) with the password field one small link away for anyone who
// prefers it.

function buildSignInBlock(wrap: HTMLElement, setMode: (m: Mode) => void): void {
  const providers = enabledOAuthProviders();

  if (providers.length > 0) {
    const lead = document.createElement('div');
    lead.className = 'account-providers-lead';
    for (const provider of providers) lead.appendChild(providerButton(provider, true));
    wrap.appendChild(lead);
    wrap.appendChild(orDivider());
  }

  // With no provider configured at all (a build that named none) there is
  // nothing to fold email away behind — it's the only way in, so it opens.
  wrap.appendChild(emailSignInSection(setMode, providers.length === 0));

  wrap.appendChild(legalNote());
}

function emailSignInSection(setMode: (m: Mode) => void, startOpen: boolean): HTMLElement {
  const host = document.createElement('div');
  host.className = 'account-email-section';

  const panel = document.createElement('div');
  panel.className = 'account-email-panel';
  panel.hidden = !startOpen;

  if (!startOpen) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn-secondary account-email-toggle';
    toggle.textContent = 'Use email instead';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) email.input.focus();
    });
    host.appendChild(toggle);
  }

  // One form, two ways to finish it. The email you type is the same either way,
  // so revealing the password field must not throw the address away — which is
  // why this is one form with a hidden field rather than two forms.
  let usePassword = false;

  const form = document.createElement('form');
  form.className = 'account-form';

  const email = field('email', 'Email', 'you@example.com', 'username');
  form.appendChild(email.wrap);

  const password = field('password', 'Password', 'Your password', 'current-password');
  password.wrap.hidden = true;
  // A hidden input that is still `required` silently blocks submit with a
  // validation bubble pointing at nothing. It gets its required back when shown.
  password.input.required = false;
  form.appendChild(password.wrap);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn-primary account-submit';
  form.appendChild(submit);

  panel.appendChild(form);

  const swap = document.createElement('button');
  swap.type = 'button';
  swap.className = 'account-link-btn';
  panel.appendChild(swap);

  const forgot = document.createElement('button');
  forgot.type = 'button';
  forgot.className = 'account-link-btn';
  forgot.textContent = 'Forgot your password?';
  forgot.hidden = true;
  forgot.addEventListener('click', () => openPasswordResetSheet(email.input.value.trim()));
  panel.appendChild(forgot);

  const paint = (): void => {
    password.wrap.hidden = !usePassword;
    password.input.required = usePassword;
    submit.textContent = usePassword ? 'Sign in' : 'Send me a sign-in link';
    swap.textContent = usePassword ? 'Email me a link instead' : 'Use a password instead';
    forgot.hidden = !usePassword;
  };

  swap.addEventListener('click', () => {
    usePassword = !usePassword;
    paint();
    if (usePassword) password.input.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const emailValue = email.input.value.trim();
    if (!emailValue) { showToast('Enter your email address.'); return; }
    if (usePassword && !password.input.value) { showToast('Enter your password.'); return; }

    submit.disabled = true;
    const restore = submit.textContent;
    submit.textContent = usePassword ? 'Signing in…' : 'Sending…';

    const result = usePassword
      ? await signInWithPassword(emailValue, password.input.value)
      : await signInWithMagicLink(emailValue);

    submit.disabled = false;
    submit.textContent = restore;

    if (!result.ok) {
      if (result.noSuchAccount) {
        // A dead end unless we point somewhere: the address simply isn't
        // registered, and the fix is one tab away.
        showDialog({
          title: 'No account with that email',
          body: `We couldn’t find an account for ${emailValue}. Sign-in links only `
            + 'work for accounts that already exist — register first and you can use '
            + 'them from then on.',
          buttons: [
            { label: 'Not now' },
            { label: 'Register', variant: 'primary', onClick: () => setMode('signup') },
          ],
        });
        return;
      }
      showToast(result.message ?? 'Something went wrong. Try again in a moment.');
      return;
    }

    if (usePassword) {
      showToast('Signed in', { variant: 'success' });
      // The auth listener re-renders this section; nothing else to do.
      return;
    }

    showDialog({
      title: 'Check your inbox',
      body: `We’ve sent a sign-in link to ${emailValue}. Open it and you’re in — no `
        + 'password needed. It expires after an hour, and it sometimes lands in spam.',
      buttons: [{ label: 'Got it', variant: 'primary' }],
    });
  });

  paint();
  host.appendChild(panel);
  return host;
}

// ── Shared pieces of both tabs ───────────────────────────────────────────────

function orDivider(): HTMLElement {
  const divider = document.createElement('div');
  divider.className = 'account-divider';
  divider.appendChild(document.createTextNode('or'));
  return divider;
}

// The consent the registration checkbox can't cover — see the note by the
// checkbox. Small, always visible, and linked rather than summarised.
function legalNote(): HTMLElement {
  const legal = document.createElement('p');
  legal.className = 'account-legal-note';
  legal.appendChild(document.createTextNode('By continuing you agree to our '));
  legal.appendChild(docLink(PRIVACY_URL, 'Privacy policy'));
  legal.appendChild(document.createTextNode(' and '));
  legal.appendChild(docLink(TERMS_URL, 'Terms'));
  legal.appendChild(document.createTextNode('.'));
  return legal;
}

async function resendAndReport(email: string): Promise<void> {
  const result = await resendConfirmation(email);
  showToast(
    result.ok
      ? 'Sent — check your inbox again in a minute.'
      : result.message ?? 'Couldn’t send it. Try again in a minute.',
    result.ok ? { variant: 'success' } : undefined,
  );
}

// `lead` is the sign-in tab's treatment: bigger, on a card of its own, and
// identical for every provider — the choice between Google and Facebook is
// "whichever you already use", so neither may look like the recommended one.
function providerButton(provider: OAuthProvider, lead = false): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `btn-secondary account-provider account-provider--${provider}`
    + (lead ? ' account-provider--lead' : '');
  btn.appendChild(providerMark(provider));
  btn.appendChild(document.createTextNode(`Continue with ${OAUTH_PROVIDER_LABELS[provider]}`));
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const result = await signInWithProvider(provider);
    // On success the browser is already on its way to the provider, so there's
    // nothing to re-enable — we only get here meaningfully when it failed.
    if (!result.ok) {
      btn.disabled = false;
      showToast(result.message ?? `Couldn’t start ${OAUTH_PROVIDER_LABELS[provider]} sign-in. Try again.`);
    }
  });
  return btn;
}

// ── Password reset ───────────────────────────────────────────────────────────

/**
 * "Forgot your password?" — ask for the address, send the link, say so.
 *
 * The confirmation deliberately does NOT say whether that address had an
 * account. Telling a stranger which emails are registered here is an
 * enumeration hole, and the honest phrasing ("if there's an account…") costs
 * nothing to read.
 */
export function openPasswordResetSheet(prefill = ''): void {
  const { overlay, sheet, close } = openSheet();

  const title = document.createElement('h3');
  title.className = 'edit-sheet-title';
  title.textContent = 'Reset your password';
  sheet.appendChild(title);

  const lead = document.createElement('p');
  lead.className = 'section-desc';
  lead.textContent = 'We’ll email you a link. Open it on this phone and you can '
    + 'choose a new password straight away.';
  sheet.appendChild(lead);

  const form = document.createElement('form');
  form.className = 'account-form';
  const email = field('email', 'Email', 'you@example.com', 'username');
  email.input.value = prefill;
  form.appendChild(email.wrap);

  const send = document.createElement('button');
  send.type = 'submit';
  send.className = 'btn-primary account-submit';
  send.textContent = 'Send the link';
  form.appendChild(send);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = email.input.value.trim();
    if (!value) { showToast('Enter your email address.'); return; }
    send.disabled = true;
    send.textContent = 'Sending…';
    const result = await sendPasswordReset(value);
    send.disabled = false;
    send.textContent = 'Send the link';
    if (!result.ok) { showToast(result.message ?? 'Couldn’t send it. Try again.'); return; }
    close();
    showDialog({
      title: 'Check your inbox',
      body: `If there’s an account for ${value}, a reset link is on its way. `
        + 'It expires after an hour, and it sometimes lands in spam.',
      buttons: [{ label: 'Got it', variant: 'primary' }],
    });
  });

  sheet.appendChild(form);
  sheet.appendChild(cancelRow(close));
  document.body.appendChild(overlay);
}

/**
 * The other half: the reset link has been opened, Supabase has handed this
 * device a recovery session, and now a new password has to be set before the
 * user wanders off thinking they're done.
 *
 * Opened from main.ts on the PASSWORD_RECOVERY signal. Not dismissable by
 * tapping the backdrop — that is exactly the tap that would strand somebody
 * signed in with the password they couldn't remember.
 */
export function openNewPasswordSheet(): void {
  const { overlay, sheet, close } = openSheet({ dismissable: false });

  const title = document.createElement('h3');
  title.className = 'edit-sheet-title';
  title.textContent = 'Choose a new password';
  sheet.appendChild(title);

  const lead = document.createElement('p');
  lead.className = 'section-desc';
  lead.textContent = 'You’re signed in from the reset link. Pick a new password '
    + 'now — at least 6 characters.';
  sheet.appendChild(lead);

  const form = document.createElement('form');
  form.className = 'account-form';
  const pw = field('password', 'New password', 'At least 6 characters', 'new-password');
  const again = field('password', 'Repeat it', 'The same again', 'new-password');
  form.appendChild(pw.wrap);
  form.appendChild(again.wrap);

  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'btn-primary account-submit';
  save.textContent = 'Save password';
  form.appendChild(save);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (pw.input.value.length < 6) { showToast('Use at least 6 characters.'); return; }
    if (pw.input.value !== again.input.value) { showToast('Those two don’t match.'); return; }
    save.disabled = true;
    save.textContent = 'Saving…';
    const result = await updatePassword(pw.input.value);
    save.disabled = false;
    save.textContent = 'Save password';
    if (!result.ok) { showToast(result.message ?? 'Couldn’t save it. Try again.'); return; }
    close();
    showToast('Password changed — you’re signed in', { variant: 'success' });
  });

  sheet.appendChild(form);

  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'account-link-btn';
  later.textContent = 'Not now';
  later.addEventListener('click', () => { clearPasswordRecovery(); close(); });
  sheet.appendChild(later);

  document.body.appendChild(overlay);
}

// ── Small shared pieces ──────────────────────────────────────────────────────

function openSheet(opts: { dismissable?: boolean } = {}): {
  overlay: HTMLElement; sheet: HTMLElement; close: () => void;
} {
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet';
  overlay.appendChild(sheet);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.remove();
    removeBack();
  };
  const removeBack = pushBack(close);
  if (opts.dismissable !== false) {
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }
  return { overlay, sheet, close };
}

function cancelRow(close: () => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'edit-btn-row';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'edit-cancel-btn';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', close);
  row.appendChild(cancel);
  return row;
}

function docLink(href: string, label: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  // The app is an installed PWA; a document tab must never get scripting access
  // back to it.
  a.rel = 'noopener noreferrer';
  a.textContent = label;
  // The checkbox's own <label> wraps this, so a tap on the link would otherwise
  // toggle the box as well as opening the document.
  a.addEventListener('click', (e) => e.stopPropagation());
  return a;
}

// One labelled input, stacked. `autocomplete` matters more than it looks — it's
// what makes a phone's password manager offer to fill and save.
function field(
  type: 'email' | 'password',
  label: string,
  placeholder: string,
  autocomplete: AutoFill,
): { wrap: HTMLElement; input: HTMLInputElement } {
  const wrap = document.createElement('label');
  wrap.className = 'account-field';

  const text = document.createElement('span');
  text.className = 'account-field-label';
  text.textContent = label;
  wrap.appendChild(text);

  const input = document.createElement('input');
  input.type = type;
  input.className = 'account-input';
  input.placeholder = placeholder;
  input.autocomplete = autocomplete;
  input.required = true;
  if (type === 'email') {
    input.autocapitalize = 'none';
    input.spellcheck = false;
    input.inputMode = 'email';
  }
  wrap.appendChild(input);

  return { wrap, input };
}

// ── Provider marks ───────────────────────────────────────────────────────────
//
// Fixed brand colours by design — a brand mark must look the same in every
// theme, which is the whole point of it. Apple's is the exception: its guidance
// is black on light and white on dark, so it takes `currentColor`.

function providerMark(provider: OAuthProvider): SVGElement {
  switch (provider) {
    case 'facebook': return facebookMark();
    case 'apple': return appleMark();
    default: return googleMark();
  }
}

function svg(viewBox: string, inner: string): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', viewBox);
  el.setAttribute('width', '18');
  el.setAttribute('height', '18');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = inner;
  return el;
}

function googleMark(): SVGElement {
  return svg('0 0 48 48',
    '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>'
    + '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>'
    + '<path fill="#FBBC05" d="M10.53 28.59A14.5 14.5 0 0 1 9.77 24c0-1.6.27-3.15.76-4.59l-7.98-6.19A23.94 23.94 0 0 0 0 24c0 3.88.93 7.54 2.56 10.78l7.97-6.19z"/>'
    + '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>');
}

function facebookMark(): SVGElement {
  return svg('0 0 24 24',
    '<path fill="#1877F2" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.96h-1.51c-1.49 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z"/>');
}

function appleMark(): SVGElement {
  return svg('0 0 24 24',
    '<path fill="currentColor" d="M16.36 12.72c-.02-2.3 1.88-3.4 1.96-3.45-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.83-.81-3-.79-1.55.02-2.98.9-3.77 2.28-1.61 2.79-.41 6.92 1.15 9.18.77 1.11 1.68 2.35 2.87 2.3 1.15-.05 1.59-.74 2.98-.74 1.39 0 1.78.74 3 .72 1.24-.02 2.02-1.12 2.78-2.24.88-1.29 1.24-2.54 1.26-2.6-.03-.01-2.41-.93-2.43-3.69zM14.1 5.98c.63-.77 1.06-1.83.94-2.9-.91.04-2.02.61-2.67 1.37-.58.68-1.09 1.77-.95 2.81 1.02.08 2.05-.52 2.68-1.28z"/>');
}
