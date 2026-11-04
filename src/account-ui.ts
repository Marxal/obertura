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
// ── THE TWO TABS ARE "CREATE ACCOUNT" AND "SIGN IN" ─────────────────────────
// Not "sign up" / "sign in", which differ by one letter in the middle of a word
// and are a genuine coin-toss to read at a glance on a phone.

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
  verifyEmailCode,
  enabledOAuthProviders,
  OAUTH_PROVIDER_LABELS,
  clearPasswordRecovery,
  signOut,
  type OAuthProvider,
  type AuthResult,
  type EmailCodeKind,
} from './auth';
import {
  entitlementLabel,
  isEntitled,
  FREE_TRAINING_LINES,
  ENTITLEMENT_CHANGE_EVENT,
} from './entitlement';
import { showToast } from './toast';
import { showDialog } from './dialog';
import { Icons } from './icons';
import { group } from './settings-screen';
import { pushBack } from './back-nav';
import { PRIVACY_URL, TERMS_URL } from './legal';
import { SYNC_CHANGE_EVENT, getSyncState, getLastSync, getSyncError, syncNow } from './repertoire-sync';
import { t, tParts } from './i18n';

// Which of the two forms is showing. Kept per-instance, not persisted — every
// visit starts on Sign in, which is what a returning user wants.
type Mode = 'signin' | 'signup';

// Settings rebuilds itself often (an import, a Lichess connect, …), and each
// rebuild makes a fresh Account group. Only the newest one should be listening,
// so building a new one retires the previous one's subscription.
let dropPreviousListener: (() => void) | null = null;

export function buildAccountGroup(): HTMLElement {
  const sec = group(t('account.account'), Icons.userCircle(16));

  // ── THE ANSWER TO "AM I SIGNED IN?", ON THE ROW ITSELF ─────────────────────
  // Everything that tells you the state used to be INSIDE the accordion, so the
  // only way to find out was to open it — and since signing out changes nothing
  // you can see (the lines are on the phone either way), people genuinely did
  // not know which they were. This hint sits on the closed row, next to the
  // chevron, and names the state and the tier in one glance.
  const summary = sec.querySelector('summary')!;
  const hint = document.createElement('span');
  hint.className = 'account-summary-hint';
  summary.insertBefore(hint, summary.lastElementChild);

  let mode: Mode = 'signin';

  // Swap everything after the <summary> for the current state's body. Signed
  // out, the group stands out and stays open — it leads the whole screen, and
  // there's a real decision to make here. Signed in, there's nothing left to
  // act on, so it folds back into an ordinary accordion.
  const render = (): void => {
    while (sec.childNodes.length > 1) sec.removeChild(sec.lastChild!);
    const signedIn = !!getAuthUser();
    hint.textContent = signedIn
      ? t(isEntitled() ? 'account.summary.pro' : 'account.summary.free')
      : t('account.notSignedIn');
    hint.classList.toggle('account-summary-hint--out', !signedIn);
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
  handle.textContent = user.email ?? t('account.signedIn');
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
  outBtn.textContent = t('account.signOut');
  outBtn.addEventListener('click', () => confirmSignOut(outBtn, refresh));

  const actions = document.createElement('div');
  actions.className = 'settings-actions';
  actions.appendChild(outBtn);
  wrap.appendChild(actions);

  return wrap;
}

// ── Signing out, said out loud ───────────────────────────────────────────────
//
// Sign-out used to be one tap with a "Signed out" toast, and the screen behind
// it looked *identical* afterwards — every line, every statistic, still there,
// because they live on the phone and always did. Nothing about that is wrong,
// but it means the one thing that DID change is invisible: a paid account is on
// the free tier again the moment it signs out, and the next cap comes as an
// ambush days later.
//
// So the tap now says what it costs, in the order the reader cares about: what
// they keep first (all of it), then what stops. The full-access line only
// appears for someone who actually has full access — telling a free user they
// are losing it would be nonsense.
function confirmSignOut(btn: HTMLButtonElement, refresh: () => void): void {
  const email = getAuthUser()?.email;
  const paid = isEntitled();

  const body = [
    t('account.yourLinesTrainingAnd'),
    paid
      ? t('account.whatStopsIsSyncing', { FREE_TRAINING_LINES: FREE_TRAINING_LINES })
      : t('account.whatStopsIsSyncingChanges'),
  ].join('\n\n');

  showDialog({
    title: email ? t('account.signOutOf', { email: email }) : t('account.signOut13'),
    body,
    buttons: [
      { label: t('account.staySignedIn') },
      {
        label: t('account.signOut'),
        variant: 'danger',
        onClick: () => { void runSignOut(btn, refresh); },
      },
    ],
  });
}

async function runSignOut(btn: HTMLButtonElement, refresh: () => void): Promise<void> {
  btn.disabled = true;
  const result = await signOut();
  btn.disabled = false;
  if (!result.ok) { showToast(result.message ?? t('account.couldnTSignOut')); return; }
  showToast(t('account.signedOutYourLines'));
  refresh();
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
  btn.textContent = t('account.syncNow');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const was = btn.textContent;
    btn.textContent = t('account.syncing');
    await syncNow();
    btn.textContent = was;
    btn.disabled = false;
    paint();
    if (getSyncState() !== 'failed') showToast(t('account.synced'), { variant: 'success' });
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

// Games only sync for an entitled account (see repertoire-sync.ts's
// gateGamesToEntitlement); a free caption has to say so rather than claim
// "Synced" for a half that never left the phone. Left off 'failed' — an error
// should stand alone, not share the line with an unrelated upsell note.
function syncCaption(): string {
  switch (getSyncState()) {
    case 'failed':
      // Whatever actually went wrong, in words. The old caption said "Sync
      // failed — will retry" for everything, which made a project whose SQL had
      // never been run look identical to a train tunnel; repertoire-sync.ts's
      // describeSyncError names the difference.
      return getSyncError() ?? t('account.syncFailedWillRetry');
    case 'pending':
      return isEntitled()
        ? t('account.sync.pending')
        : t('account.sync.pendingFree');
    case 'synced':
      return isEntitled()
        ? t('account.sync.synced', { when: agoLabel(getLastSync()) })
        : t('account.sync.syncedFree', { when: agoLabel(getLastSync()) });
    default:
      // 'never' — signed in, nothing up from this device yet. ('off' can't
      // reach here: this row only exists inside the signed-in body.)
      return t(isEntitled() ? 'account.sync.none' : 'account.sync.noneFree');
  }
}

// "just now" / "12 minutes ago" / "3 hours ago" / "2 days ago". Finer-grained
// than a daily caption would be, because a sync you triggered seconds ago
// showing "today" would read as broken.
function agoLabel(iso: string | null): string {
  if (!iso) return t('settings.ago.now');
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 90_000) return t('settings.ago.now');
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return t('account.ago.minutes', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('account.ago.hours', { n: hours });
  const days = Math.round(hours / 24);
  return t('account.ago.days', { n: days });
}

// ── Signed out ───────────────────────────────────────────────────────────────

// The registration / sign-in form, on its own. Exported so the post-onboarding
// sign-up sheet (onboarding-signup.ts) shows the SAME form rather than a second
// implementation of it — one place to fix a bug in, one place where the wording
// lives. The sheet passes its own blurb (it has already made the pitch in its
// title) and opens on Create account rather than Sign in.
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
    t('account.anAccountKeepsYour')
  );
  if (copy) {
    const blurb = document.createElement('p');
    blurb.className = 'section-desc';
    blurb.textContent = copy;
    wrap.appendChild(blurb);
  }

  // Create account / Sign in, as a two-way switch above the shared form.
  // Deliberately not the `segmented` control from Settings: this picks which
  // form you're filling in, it isn't a preference being saved.
  const tabs = document.createElement('div');
  tabs.className = 'account-tabs';
  for (const tab of [
    { value: 'signup' as Mode, label: t('account.createAccount') },
    { value: 'signin' as Mode, label: t('signup.signIn') },
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

  // Both tabs lead with the same choice — Google, Facebook, or email — because
  // for most people the fastest right answer is a provider they're already
  // logged into. Tapping "Continue with email" swaps the buttons for the actual
  // form; there's no separate treatment for consent per method any more (see
  // legalNote), so the two tabs can share this shape instead of diverging.
  if (mode === 'signup') buildSignUpBlock(wrap);
  else buildSignInBlock(wrap, setMode);

  return wrap;
}

// ── Create account ───────────────────────────────────────────────────────────
//
// Leads with the three ways in — Google, Facebook, email — as equal-weight
// buttons; tapping email swaps them for the actual form. No consent checkbox
// any more: a Google or Facebook tap could never carry one anyway (the app
// can't tell a first-time registration from a returning sign-in until the
// redirect comes back), so email gets the same passive legalNote as the other
// two instead of its own extra step.
//
// The magic link is deliberately absent here: it cannot create an account (see
// signInWithMagicLink), precisely so nobody ends up with an account they never
// saw the Terms for.

function buildSignUpBlock(wrap: HTMLElement): void {
  const providers = enabledOAuthProviders();
  const body = document.createElement('div');
  wrap.appendChild(body);

  let view: 'options' | 'email' = providers.length > 0 ? 'options' : 'email';
  const paint = (): void => {
    body.replaceChildren(view === 'options'
      ? optionsList(providers, () => { view = 'email'; paint(); })
      : signUpEmailPanel(providers.length > 0 ? () => { view = 'options'; paint(); } : null));
  };
  paint();

  wrap.appendChild(legalNote());
}

function signUpEmailPanel(onBack: (() => void) | null): HTMLElement {
  const host = document.createElement('div');
  host.className = 'account-email-panel';

  const form = document.createElement('form');
  form.className = 'account-form';

  const email = field('email', t('account.email'), 'you@example.com', 'username');
  const password = field('password', t('account.password'), '', 'new-password', t('account.atLeast6Characters'));
  form.appendChild(email.wrap);
  form.appendChild(password.wrap);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn-primary account-submit';
  submit.textContent = t('account.createAccount');
  form.appendChild(submit);
  const setFormError = formError(form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const emailValue = email.input.value.trim();
    const passwordValue = password.input.value;
    if (!emailValue) { email.setError(t('account.enterYourEmailAddress')); email.input.focus(); return; }
    if (!passwordValue) { password.setError(t('account.chooseAPassword')); password.input.focus(); return; }
    if (passwordValue.length < 6) {
      password.setError(t('account.useAtLeast6'));
      password.input.focus();
      return;
    }

    submit.disabled = true;
    submit.textContent = t('account.creating');

    const result = await signUpWithPassword(emailValue, passwordValue);

    submit.disabled = false;
    submit.textContent = t('account.createAccount');

    if (!result.ok) {
      setFormError(result.message ?? t('account.somethingWentWrongTry'));
      return;
    }
    if (result.needsEmailConfirmation) {
      // Worth more than a toast: nothing happens until the code is typed, and a
      // toast fades before they've read it. "Send it again" is in the sheet
      // because the commonest failure of email confirmation is an email that
      // never arrives, and re-registering would just say "already exists".
      openEmailCodeSheet({
        email: emailValue,
        kind: 'signup',
        submitLabel: t('account.confirmMyEmail'),
        successToast: t('account.emailConfirmedYouRe'),
        resend: () => resendConfirmation(emailValue),
      });
      password.input.value = '';
      return;
    }
    showToast(t('steps.account.done'), { variant: 'success' });
    // The auth listener re-renders this section; nothing else to do.
  });

  host.appendChild(form);
  if (onBack) host.appendChild(backLink(onBack));
  return host;
}

// ── Sign in ──────────────────────────────────────────────────────────────────
//
// Same three buttons as Create account — Google, Facebook, email — because a
// returning user is answering the same question ("which of these do I already
// have?") either way. Tapping email swaps to the address/password form, with
// the sign-in link as a quiet option under the password and a way back to the
// other two above it.

function buildSignInBlock(wrap: HTMLElement, setMode: (m: Mode) => void): void {
  const providers = enabledOAuthProviders();
  const body = document.createElement('div');
  wrap.appendChild(body);

  let view: 'options' | 'email' = providers.length > 0 ? 'options' : 'email';
  const paint = (): void => {
    body.replaceChildren(view === 'options'
      ? optionsList(providers, () => { view = 'email'; paint(); })
      : emailSignInPanel(setMode, providers.length > 0 ? () => { view = 'options'; paint(); } : null));
  };
  paint();

  wrap.appendChild(legalNote());
}

function emailSignInPanel(setMode: (m: Mode) => void, onBack: (() => void) | null): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'account-email-panel';

  // One form, two ways to finish it. The email you type is the same either way,
  // so hiding the password field must not throw the address away — which is why
  // this is one form with a hidden field rather than two forms. Password is the
  // default; `swap` below trades it for the link and back.
  let usePassword = true;

  const form = document.createElement('form');
  form.className = 'account-form';

  const email = field('email', t('account.email'), 'you@example.com', 'username');
  form.appendChild(email.wrap);

  const password = field('password', t('account.password'), '', 'current-password');
  // A hidden input that is still `required` silently blocks submit with a
  // validation bubble pointing at nothing, so `paint` keeps the two in step.
  form.appendChild(password.wrap);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn-primary account-submit';
  form.appendChild(submit);

  const setFormError = formError(form);
  panel.appendChild(form);

  const forgot = document.createElement('button');
  forgot.type = 'button';
  forgot.className = 'account-link-btn';
  forgot.textContent = t('account.forgotYourPassword');
  forgot.addEventListener('click', () => openPasswordResetSheet(email.input.value.trim()));
  panel.appendChild(forgot);

  // The sign-in code, LAST and quiet. It is a genuinely good way in — nothing to
  // remember, and it survives a phone with no password manager — but it costs a
  // trip to an inbox, so it sits under the password rather than in front of it.
  const swap = document.createElement('button');
  swap.type = 'button';
  swap.className = 'account-link-btn account-link-btn--quiet';
  panel.appendChild(swap);

  const paint = (): void => {
    password.wrap.hidden = !usePassword;
    password.input.required = usePassword;
    submit.textContent = usePassword ? t('signup.signIn') : t('account.emailMeASign');
    swap.textContent = usePassword
      ? t('account.emailMeASignIn')
      : t('account.useAPasswordInstead');
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
    if (!emailValue) { email.setError(t('account.enterYourEmailAddress')); email.input.focus(); return; }
    if (usePassword && !password.input.value) {
      password.setError(t('account.enterYourPassword'));
      password.input.focus();
      return;
    }

    submit.disabled = true;
    const restore = submit.textContent;
    submit.textContent = usePassword ? t('account.signingIn') : t('account.sending');

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
          title: t('account.noAccountWithThat'),
          body: t('account.weCouldnTFind', { emailValue: emailValue }),
          buttons: [
            { label: t('pro.notNow') },
            { label: t('account.createAccount'), variant: 'primary', onClick: () => setMode('signup') },
          ],
        });
        return;
      }
      setFormError(result.message ?? t('account.somethingWentWrongTry'));
      return;
    }

    if (usePassword) {
      showToast(t('account.signedIn'), { variant: 'success' });
      // The auth listener re-renders this section; nothing else to do.
      return;
    }

    openEmailCodeSheet({
      email: emailValue,
      kind: 'email',
      submitLabel: t('signup.signIn'),
      successToast: t('account.signedIn'),
      resend: () => signInWithMagicLink(emailValue),
    });
  });

  paint();
  if (onBack) panel.appendChild(backLink(onBack));
  return panel;
}

// ── Shared pieces of both tabs ───────────────────────────────────────────────

// The three ways in, as equal-weight buttons — Google, Facebook, then email
// last so the order matches VITE_AUTH_PROVIDERS's own google/facebook/apple
// ordering (see auth.ts's KNOWN_PROVIDERS) with email as the one guaranteed
// option after it.
function optionsList(providers: OAuthProvider[], onEmail: () => void): HTMLElement {
  const lead = document.createElement('div');
  lead.className = 'account-providers-lead';
  for (const provider of providers) lead.appendChild(providerButton(provider, true));
  lead.appendChild(emailOptionButton(onEmail));
  return lead;
}

function emailOptionButton(onClick: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-secondary account-provider account-provider--lead account-provider--email';
  btn.appendChild(mailMark());
  btn.appendChild(document.createTextNode(t('account.continueWithEmail')));
  btn.addEventListener('click', onClick);
  return btn;
}

function backLink(onClick: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'account-link-btn account-link-btn--quiet account-back-link';
  btn.textContent = t('account.otherOptions');
  btn.addEventListener('click', onClick);
  return btn;
}

// Under whichever view is showing — the three buttons, or the email form —
// rather than tied to one method. A Google or Facebook tap can't carry
// affirmative consent anyway (the app can't tell a first-time registration
// from a returning sign-in until the redirect comes back), so this passive
// line is the whole of what every method gets, email included.
function legalNote(): HTMLElement {
  const legal = document.createElement('p');
  legal.className = 'account-legal-note';
  legal.append(...tParts('account.legal', {
    privacy: docLink(PRIVACY_URL, t('account.legal.privacy')),
    terms: docLink(TERMS_URL, t('account.legal.terms')),
  }));
  return legal;
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
  btn.appendChild(document.createTextNode(t('account.continueWith', { provider: OAUTH_PROVIDER_LABELS[provider] })));
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const result = await signInWithProvider(provider);
    // On success the browser is already on its way to the provider, so there's
    // nothing to re-enable — we only get here meaningfully when it failed.
    if (!result.ok) {
      btn.disabled = false;
      showToast(result.message ?? t('account.oauthFailed', { provider: OAUTH_PROVIDER_LABELS[provider] }));
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
  title.textContent = t('account.resetYourPassword');
  sheet.appendChild(title);

  const lead = document.createElement('p');
  lead.className = 'section-desc';
  lead.textContent = t('account.weLlEmailYou');
  sheet.appendChild(lead);

  const form = document.createElement('form');
  form.className = 'account-form';
  const email = field('email', t('account.email'), 'you@example.com', 'username');
  email.input.value = prefill;
  form.appendChild(email.wrap);

  const send = document.createElement('button');
  send.type = 'submit';
  send.className = 'btn-primary account-submit';
  send.textContent = t('account.sendTheCode');
  form.appendChild(send);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = email.input.value.trim();
    if (!value) { email.setError(t('account.enterYourEmailAddress')); email.input.focus(); return; }
    send.disabled = true;
    send.textContent = t('account.sending');
    const result = await sendPasswordReset(value);
    send.disabled = false;
    send.textContent = t('account.sendTheCode');
    if (!result.ok) { showToast(result.message ?? t('account.couldnTSendIt')); return; }
    close();
    openEmailCodeSheet({
      email: value,
      kind: 'recovery',
      // Still doesn't say whether the address has an account: see the note above.
      lead: t('account.ifThereSAn', { value: value }),
      submitLabel: t('common.continue'),
      // The "choose a new password" sheet takes over from here.
      successToast: null,
      resend: () => sendPasswordReset(value),
    });
  });

  sheet.appendChild(form);
  sheet.appendChild(cancelRow(close));
  document.body.appendChild(overlay);
}

/**
 * "Check your inbox", with the box to type the code into.
 *
 * This is what keeps the whole flow inside the installed app (UX-AUDIT C4). The
 * link in the same email still works, so it's mentioned, but on most Android
 * phones it opens the browser rather than this app. Any length of digits the
 * project is set to is accepted, so the wording never promises a number.
 */
function openEmailCodeSheet(opts: {
  email: string;
  kind: EmailCodeKind;
  lead?: string;
  submitLabel: string;
  /** Null when the next thing on screen says it instead. */
  successToast: string | null;
  resend: () => Promise<AuthResult>;
}): void {
  const { overlay, sheet, close } = openSheet();

  const title = document.createElement('h3');
  title.className = 'edit-sheet-title';
  title.textContent = t('account.checkYourInbox');
  sheet.appendChild(title);

  const lead = document.createElement('p');
  lead.className = 'section-desc';
  lead.textContent = `${opts.lead ?? t('account.code.sent', { email: opts.email })} ${t('account.code.typeIt')}`;
  sheet.appendChild(lead);

  const form = document.createElement('form');
  form.className = 'account-form';
  const code = field('code', t('account.codeFromTheEmail'), '', 'one-time-code');
  form.appendChild(code.wrap);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn-primary account-submit';
  submit.textContent = opts.submitLabel;
  form.appendChild(submit);
  const setFormError = formError(form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    // People paste "123 456", or a code with a stray space from the mail app.
    const value = code.input.value.replace(/\s/g, '');
    if (!/^\d{4,10}$/.test(value)) {
      code.setError(t('account.enterTheCodeFrom'));
      code.input.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = t('settings.checking');
    const result = await verifyEmailCode(opts.email, value, opts.kind);
    submit.disabled = false;
    submit.textContent = opts.submitLabel;
    if (!result.ok) {
      setFormError(result.message ?? t('account.somethingWentWrongTry'));
      return;
    }
    close();
    if (opts.successToast) showToast(opts.successToast, { variant: 'success' });
  });
  sheet.appendChild(form);

  const again = document.createElement('button');
  again.type = 'button';
  again.className = 'account-link-btn';
  again.textContent = t('account.sendItAgain');
  again.addEventListener('click', async () => {
    again.disabled = true;
    const result = await opts.resend();
    again.disabled = false;
    showToast(
      result.ok
        ? t('account.sentCheckYourInbox')
        : result.message ?? t('account.couldnTSendItTry'),
      result.ok ? { variant: 'success' } : undefined,
    );
  });
  sheet.appendChild(again);

  const note = document.createElement('p');
  note.className = 'account-field-hint';
  note.textContent = t('account.theEmailHasA');
  sheet.appendChild(note);

  sheet.appendChild(cancelRow(close));
  document.body.appendChild(overlay);
  code.input.focus();
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
  title.textContent = t('account.chooseANewPassword');
  sheet.appendChild(title);

  const lead = document.createElement('p');
  lead.className = 'section-desc';
  lead.textContent = t('account.youReSignedIn');
  sheet.appendChild(lead);

  const form = document.createElement('form');
  form.className = 'account-form';
  const pw = field('password', t('account.newPassword'), t('account.atLeast6Characters'), 'new-password');
  const again = field('password', t('account.repeatIt'), t('account.theSameAgain'), 'new-password');
  form.appendChild(pw.wrap);
  form.appendChild(again.wrap);

  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'btn-primary account-submit';
  save.textContent = t('account.savePassword');
  form.appendChild(save);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (pw.input.value.length < 6) { showToast(t('account.useAtLeast6')); return; }
    if (pw.input.value !== again.input.value) { showToast(t('account.thoseTwoDonT')); return; }
    save.disabled = true;
    save.textContent = t('account.saving');
    const result = await updatePassword(pw.input.value);
    save.disabled = false;
    save.textContent = t('account.savePassword');
    if (!result.ok) { showToast(result.message ?? t('account.couldnTSaveIt')); return; }
    close();
    showToast(t('account.passwordChangedYouRe'), { variant: 'success' });
  });

  sheet.appendChild(form);

  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'account-link-btn';
  later.textContent = t('pro.notNow');
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
  cancel.textContent = t('common.cancel');
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
  return a;
}

// One labelled input, stacked. `autocomplete` matters more than it looks — it's
// what makes a phone's password manager offer to fill and save.
//
// Errors are written UNDER the field they are about, not into a toast at the
// bottom of the screen that fades before it is read (UX-AUDIT C4). A rule the
// field has to meet ("At least 6 characters") is a hint that stays visible,
// rather than a placeholder that vanishes on the first keystroke. Passwords get
// a Show/Hide toggle: on a phone keyboard a typo you can't see is the commonest
// reason a brand-new account "doesn't work".
interface Field {
  wrap: HTMLElement;
  input: HTMLInputElement;
  /** Show a message under the field (and mark it invalid); '' clears it. */
  setError: (message: string) => void;
}

function field(
  type: 'email' | 'password' | 'code',
  label: string,
  placeholder: string,
  autocomplete: AutoFill,
  hint?: string,
): Field {
  const wrap = document.createElement('div');
  wrap.className = 'account-field';

  const id = `acct-${autocomplete}-${Math.random().toString(36).slice(2, 8)}`;
  const text = document.createElement('label');
  text.className = 'account-field-label';
  text.textContent = label;
  text.htmlFor = id;
  wrap.appendChild(text);

  const row = document.createElement('div');
  row.className = 'account-input-row';

  const input = document.createElement('input');
  input.type = type === 'code' ? 'text' : type;
  input.id = id;
  input.className = 'account-input';
  input.placeholder = placeholder;
  input.autocomplete = autocomplete;
  input.required = true;
  if (type === 'email') {
    input.autocapitalize = 'none';
    input.spellcheck = false;
    input.inputMode = 'email';
  }
  if (type === 'code') {
    input.inputMode = 'numeric';
    input.spellcheck = false;
    input.classList.add('account-input--code');
  }
  row.appendChild(input);

  if (type === 'password') {
    const reveal = document.createElement('button');
    reveal.type = 'button';
    reveal.className = 'account-reveal';
    reveal.textContent = t('account.show');
    reveal.setAttribute('aria-label', t('account.showPassword'));
    reveal.addEventListener('click', () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      reveal.textContent = showing ? t('account.show') : t('account.hide');
      reveal.setAttribute('aria-label', showing ? t('account.showPassword') : t('account.hidePassword'));
    });
    row.appendChild(reveal);
  }
  wrap.appendChild(row);

  if (hint) {
    const h = document.createElement('span');
    h.className = 'account-field-hint';
    h.id = `${id}-hint`;
    h.textContent = hint;
    input.setAttribute('aria-describedby', h.id);
    wrap.appendChild(h);
  }

  const error = document.createElement('span');
  error.className = 'account-field-error';
  error.id = `${id}-error`;
  error.setAttribute('role', 'alert');
  error.hidden = true;
  wrap.appendChild(error);

  const setError = (message: string): void => {
    error.textContent = message;
    error.hidden = !message;
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  };
  input.addEventListener('input', () => setError(''));

  return { wrap, input, setError };
}

// A form-level message, under the submit button — for what isn't about one
// field (the network, the server's own refusal).
function formError(form: HTMLFormElement): (message: string) => void {
  const el = document.createElement('p');
  el.className = 'account-form-error';
  el.setAttribute('role', 'alert');
  el.hidden = true;
  form.appendChild(el);
  form.addEventListener('input', () => { el.hidden = true; });
  return (message: string) => { el.textContent = message; el.hidden = !message; };
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

// Not a brand mark — the email option isn't a provider, so it takes
// `currentColor` like Apple's rather than a fixed colour of its own.
function mailMark(): SVGElement {
  return svg('0 0 24 24',
    '<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" '
    + 'stroke-linejoin="round" d="M3 5.5h18v13H3z"/>'
    + '<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" '
    + 'stroke-linejoin="round" d="m3 6 9 7 9-7"/>');
}

function appleMark(): SVGElement {
  return svg('0 0 24 24',
    '<path fill="currentColor" d="M16.36 12.72c-.02-2.3 1.88-3.4 1.96-3.45-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.83-.81-3-.79-1.55.02-2.98.9-3.77 2.28-1.61 2.79-.41 6.92 1.15 9.18.77 1.11 1.68 2.35 2.87 2.3 1.15-.05 1.59-.74 2.98-.74 1.39 0 1.78.74 3 .72 1.24-.02 2.02-1.12 2.78-2.24.88-1.29 1.24-2.54 1.26-2.6-.03-.01-2.41-.93-2.43-3.69zM14.1 5.98c.63-.77 1.06-1.83.94-2.9-.91.04-2.02.61-2.67 1.37-.58.68-1.09 1.77-.95 2.81 1.02.08 2.05-.52 2.68-1.28z"/>');
}
