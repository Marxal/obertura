// The "Account" group in Settings — sign up, sign in, sign out.
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

import {
  getAuthUser,
  onAuthChange,
  signUpWithPassword,
  signInWithPassword,
  signInWithGoogle,
  signOut,
  entitlementLabel,
  getEntitlement,
} from './auth';
import { showToast } from './toast';
import { showDialog } from './dialog';
import { Icons } from './icons';
import { group } from './settings-screen';

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

  // Swap everything after the <summary> for the current state's body.
  const render = (): void => {
    while (sec.childNodes.length > 1) sec.removeChild(sec.lastChild!);
    sec.appendChild(getAuthUser() ? signedInBody(render) : signedOutBody(mode, (m) => { mode = m; render(); }));
  };

  // Sign-in and sign-out both land here — including the one that completes on
  // the next page load, after the Google redirect.
  dropPreviousListener?.();
  dropPreviousListener = onAuthChange(render);

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
    + (getEntitlement() === 'full' ? ' account-pill--full' : ' account-pill--free');
  pill.textContent = entitlementLabel();
  status.appendChild(pill);
  card.appendChild(status);

  wrap.appendChild(card);

  const note = document.createElement('p');
  note.className = 'settings-note';
  note.textContent =
    'Your lines and training still live on this device. Signing in doesn’t move ' +
    'anything yet — syncing comes later.';
  wrap.appendChild(note);

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

// ── Signed out ───────────────────────────────────────────────────────────────

function signedOutBody(mode: Mode, setMode: (m: Mode) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'account-auth';

  const blurb = document.createElement('p');
  blurb.className = 'section-desc';
  blurb.textContent =
    'An account is how you’ll keep your repertoire when you change phone. ' +
    'Everything works without one for now.';
  wrap.appendChild(blurb);

  // Sign in / Sign up, as a two-way switch above the shared form. Deliberately
  // not the `segmented` control from Settings: this picks which form you're
  // filling in, it isn't a preference being saved.
  const tabs = document.createElement('div');
  tabs.className = 'account-tabs';
  for (const tab of [
    { value: 'signin' as Mode, label: 'Sign in' },
    { value: 'signup' as Mode, label: 'Sign up' },
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

  const form = document.createElement('form');
  form.className = 'account-form';

  const email = field('email', 'Email', 'you@example.com', 'username');
  const password = field(
    'password',
    'Password',
    mode === 'signup' ? 'At least 6 characters' : 'Your password',
    mode === 'signup' ? 'new-password' : 'current-password',
  );
  form.appendChild(email.wrap);
  form.appendChild(password.wrap);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn-primary account-submit';
  submit.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
  form.appendChild(submit);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const emailValue = email.input.value.trim();
    const passwordValue = password.input.value;
    if (!emailValue || !passwordValue) {
      showToast('Enter your email and a password.');
      return;
    }

    submit.disabled = true;
    const busyLabel = submit.textContent;
    submit.textContent = mode === 'signup' ? 'Creating…' : 'Signing in…';

    const result = mode === 'signup'
      ? await signUpWithPassword(emailValue, passwordValue)
      : await signInWithPassword(emailValue, passwordValue);

    submit.disabled = false;
    submit.textContent = busyLabel;

    if (!result.ok) {
      showToast(result.message ?? 'Something went wrong. Try again in a moment.');
      return;
    }
    if (result.needsEmailConfirmation) {
      // Worth more than a toast: nothing happens until they open the link, and
      // a toast fades before they've read it.
      showDialog({
        title: 'Check your inbox',
        body: `We’ve sent a confirmation link to ${emailValue}. Open it to finish `
          + 'creating your account, then come back here and sign in.',
        buttons: [{ label: 'Got it', variant: 'primary' }],
      });
      password.input.value = '';
      return;
    }
    showToast(mode === 'signup' ? 'Account created' : 'Signed in', { variant: 'success' });
    // The auth listener re-renders this section; nothing else to do.
  });

  wrap.appendChild(form);

  const divider = document.createElement('div');
  divider.className = 'account-divider';
  divider.appendChild(document.createTextNode('or'));
  wrap.appendChild(divider);

  const googleBtn = document.createElement('button');
  googleBtn.type = 'button';
  googleBtn.className = 'btn-secondary account-google';
  googleBtn.appendChild(googleMark());
  googleBtn.appendChild(document.createTextNode('Continue with Google'));
  googleBtn.addEventListener('click', async () => {
    googleBtn.disabled = true;
    const result = await signInWithGoogle();
    // On success the browser is already on its way to Google, so there's nothing
    // to re-enable — we only get here in a meaningful sense when it failed.
    if (!result.ok) {
      googleBtn.disabled = false;
      showToast(result.message ?? 'Couldn’t start Google sign-in. Try again.');
    }
  });
  wrap.appendChild(googleBtn);

  return wrap;
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

// Google's four-colour "G". Fixed brand colours by design — it must look the
// same in every theme, which is the whole point of the mark.
function googleMark(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>'
    + '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>'
    + '<path fill="#FBBC05" d="M10.53 28.59A14.5 14.5 0 0 1 9.77 24c0-1.6.27-3.15.76-4.59l-7.98-6.19A23.94 23.94 0 0 0 0 24c0 3.88.93 7.54 2.56 10.78l7.97-6.19z"/>'
    + '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>';
  return svg;
}
