// ════════════════════════════════════════════════════════════════════════════
// BETA ACCESS GATE + INSTALL SCREEN  (self-contained — easy to remove later)
//
// First open in a browser shows a small "enter your beta access code" screen
// before the app boots. A correct code unlocks the device forever (a flag in
// localStorage) and then offers an install screen. Once unlocked — or when
// already running as an installed PWA — the gate is skipped entirely and the
// app boots straight away.
//
// HONEST CAVEAT: this is a CLIENT-SIDE gate. The code is checked against a
// SHA-256 hash baked into the bundle (never the plain code), but a determined
// developer can read the JS, see the flag, and bypass it. That's an accepted
// trade-off: this is a friendly speed-bump for a private beta, NOT real
// security. No email, no personal data, no analytics are collected here.
//
// TO ROTATE THE CODES: replace the hashes in ACCESS_CODE_SHA256S. Any code whose
// hash is in the list unlocks the app, so you can run several codes at once.
// Codes are trimmed and lower-cased before hashing, so generate each hash the
// same way, e.g. in a terminal:
//   node -e "crypto=require('crypto');console.log(crypto.createHash('sha256').update('your-new-code'.trim().toLowerCase()).digest('hex'))"
// Rotating the codes does NOT lock out already-unlocked devices — the localStorage
// flag below is the source of truth, not the code.
// ════════════════════════════════════════════════════════════════════════════

// SHA-256 of every currently-valid beta code (trim + lower-case before hashing).
// Current codes: "joan", "thunderchess"  ← rotate by replacing the hashes below.
const ACCESS_CODE_SHA256S = [
  'd2dae6d1b4625413eade8cafcb06d6d000fdb57d963fc3c5c497084d42288319', // joan
  '7832da28625d9bf6dd2c2bcb092731debdec80664a0f77da564ae074a4787681', // thunderchess
];

// Once set, the gate never shows on this device again.
const UNLOCKED_KEY = 'obertura.betaUnlocked';

// The Chrome/Android install prompt fires once, early, and only if we capture
// it. Start listening the moment this module loads (it's imported at the very
// top of boot) so the event is never missed, then surface it on the install
// screen. Typed loosely — `beforeinstallprompt` isn't in the standard lib.
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let deferredInstallPrompt: InstallPromptEvent | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // stop Chrome's mini-infobar; we trigger it from our button
  deferredInstallPrompt = e as InstallPromptEvent;
});

function isUnlocked(): boolean {
  try {
    return localStorage.getItem(UNLOCKED_KEY) === '1';
  } catch {
    return false; // storage off — treat as locked (the gate just won't persist)
  }
}

function markUnlocked(): void {
  try { localStorage.setItem(UNLOCKED_KEY, '1'); } catch { /* storage off */ }
}

// Already installed (Android/desktop report display-mode; iOS uses navigator.standalone).
function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

// Best-effort iOS detection: classic UA test plus the iPadOS-13+ case where
// Safari masquerades as a Mac but reports a touch screen.
function isIos(): boolean {
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

function isAndroid(): boolean {
  return /android/i.test(navigator.userAgent);
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// The app mark — Obertura's real installed icon (public/icons/icon-192.png),
// the same art Android puts on the home screen (mirrors onboarding.ts), so the
// gate reads as the same product before the app proper appears. Served from
// public/ under the app's base path; styled as a rounded app-icon tile.
function appMark(size = 88): HTMLImageElement {
  const img = document.createElement('img');
  img.src = `${import.meta.env.BASE_URL}icons/icon-192.png`;
  img.width = size;
  img.height = size;
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
  img.className = 'gate-mark-img';
  return img;
}

// The iOS "Share → Add to Home Screen" diagram: the share glyph, an arrow, then
// the add glyph — small, inline, themed via currentColor.
const IOS_DIAGRAM = `
<svg class="gate-ios-diagram" viewBox="0 0 80 32" width="120" height="48" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <g transform="translate(4 4)">
    <path d="M12 2v13" />
    <path d="m8 6 4-4 4 4" />
    <path d="M5 11H3a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-2" />
  </g>
  <path d="M34 16h12" />
  <path d="m42 12 4 4-4 4" />
  <g transform="translate(52 4)">
    <rect x="1" y="1" width="22" height="22" rx="4" />
    <path d="M12 7v10" />
    <path d="M7 12h10" />
  </g>
</svg>`;

// Mount a full-screen gate panel; returns the overlay element so a later screen
// can replace its contents in place (keeps a single overlay on screen).
function makeOverlay(): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.className = 'gate-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Beta access');
  document.body.appendChild(overlay);
  return overlay;
}

// A quiet reassurance shared by the welcome and installed screens: this is
// theirs, on their phone, with their data — no expiry, nothing held server-side.
function reassureNote(): HTMLParagraphElement {
  const note = document.createElement('p');
  note.className = 'gate-reassure';
  note.textContent =
    'It’s yours to keep — use Bito Chess on your phone for as long as you like, ' +
    'and all your data stays on your device.';
  return note;
}

// An extremely discrete "skip install" link. Install is the path we want; this
// is just an escape hatch, so it sits quietly at the bottom.
function addContinueLink(card: HTMLDivElement, label: string, onClick: () => void): void {
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'gate-continue-link';
  link.textContent = label;
  link.addEventListener('click', onClick);
  card.appendChild(link);
}

// ── Installed confirmation (shown after the user accepts the install prompt) ────
function showInstalled(overlay: HTMLDivElement, onPass: () => void): void {
  overlay.replaceChildren();

  const card = document.createElement('div');
  card.className = 'gate-card';

  const mark = document.createElement('div');
  mark.className = 'gate-mark';
  mark.appendChild(appMark(64));
  card.appendChild(mark);

  const h = document.createElement('h1');
  h.className = 'gate-heading';
  h.textContent = 'You’re all set';
  card.appendChild(h);

  const body = document.createElement('p');
  body.className = 'gate-body';
  body.textContent =
    'Bito Chess is now installed. Open it from your phone’s home screen — that’s ' +
    'where you’ll use it from now on.';
  card.appendChild(body);

  card.appendChild(reassureNote());

  addContinueLink(card, 'Continue in browser', () => { overlay.remove(); onPass(); });

  overlay.appendChild(card);
}

// ── Welcome / install screen (shown after a correct code) ──────────────────────
function showWelcome(overlay: HTMLDivElement, onPass: () => void): void {
  overlay.replaceChildren();

  const card = document.createElement('div');
  card.className = 'gate-card';

  const mark = document.createElement('div');
  mark.className = 'gate-mark';
  mark.appendChild(appMark(64));
  card.appendChild(mark);

  const h = document.createElement('h1');
  h.className = 'gate-heading';
  h.textContent = 'Welcome to the Bito Chess beta';
  card.appendChild(h);

  const lead = document.createElement('p');
  lead.className = 'gate-body';
  card.appendChild(lead);

  // Finish: boot the app. Shared by every "done here" path.
  const finish = () => { overlay.remove(); onPass(); };

  if (deferredInstallPrompt) {
    // Android / Chrome: a real install button driven by the captured event.
    lead.textContent = 'Install Bito Chess to your home screen for an app-like, full-screen experience.';

    const installBtn = document.createElement('button');
    installBtn.type = 'button';
    installBtn.className = 'btn-primary gate-install-btn';
    installBtn.textContent = 'Install app';
    installBtn.addEventListener('click', async () => {
      const prompt = deferredInstallPrompt;
      if (!prompt) { finish(); return; }
      deferredInstallPrompt = null;
      installBtn.disabled = true;
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') {
        // Installed: tell them to open it from the phone, app relaunches standalone.
        showInstalled(overlay, onPass);
      } else {
        // Dismissed: just let them carry on in the browser.
        finish();
      }
    });
    card.appendChild(installBtn);
  } else if (isIos()) {
    // iPhone / Safari: no programmatic prompt — show the manual gesture.
    lead.textContent = 'Add Bito Chess to your home screen for an app-like, full-screen experience.';

    const steps = document.createElement('div');
    steps.className = 'gate-steps';
    steps.innerHTML = IOS_DIAGRAM;
    const stepText = document.createElement('p');
    stepText.className = 'gate-step-text';
    stepText.textContent = 'Tap the Share button, then "Add to Home Screen".';
    steps.appendChild(stepText);
    card.appendChild(steps);
  } else if (isAndroid()) {
    // Android, but no install event — e.g. Firefox, which doesn't fire
    // `beforeinstallprompt`. Chromium browsers (Chrome, Edge, Samsung, Brave,
    // Opera) take the install-button branch above; this is the manual fallback.
    lead.textContent = 'Add Bito Chess to your home screen for an app-like, full-screen experience.';

    const steps = document.createElement('div');
    steps.className = 'gate-steps';
    const stepText = document.createElement('p');
    stepText.className = 'gate-step-text';
    stepText.textContent =
      'Open your browser menu (⋮), then tap "Install" or "Add to Home screen". ' +
      'For the smoothest install, open this page in Chrome.';
    steps.appendChild(stepText);
    card.appendChild(steps);
  } else {
    // No install path available (or already dismissible): just continue.
    lead.textContent = 'You’re in. Open this page on your phone to install it to your home screen.';
  }

  card.appendChild(reassureNote());

  // Always offer to just use it in the browser — but keep it extremely discrete.
  addContinueLink(card, 'Continue in browser', finish);

  overlay.appendChild(card);
}

// ── Code-entry screen ──────────────────────────────────────────────────────────
function showCodeEntry(overlay: HTMLDivElement, onPass: () => void): void {
  overlay.replaceChildren();

  const card = document.createElement('div');
  card.className = 'gate-card';

  const mark = document.createElement('div');
  mark.className = 'gate-mark';
  mark.appendChild(appMark(64));
  card.appendChild(mark);

  const h = document.createElement('h1');
  h.className = 'gate-heading';
  h.textContent = 'Enter your beta access code';
  card.appendChild(h);

  const body = document.createElement('p');
  body.className = 'gate-body';
  body.textContent = 'Bito Chess is in a private beta. Enter the code you were given to continue.';
  card.appendChild(body);

  const form = document.createElement('form');
  form.className = 'gate-form';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'gate-input';
  input.placeholder = 'Access code';
  input.autocomplete = 'off';
  input.autocapitalize = 'none';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Beta access code');
  form.appendChild(input);

  const error = document.createElement('p');
  error.className = 'gate-error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  error.textContent = 'That code didn’t match. Check it and try again.';
  form.appendChild(error);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn-primary gate-submit-btn';
  submit.textContent = 'Unlock';
  form.appendChild(submit);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = input.value.trim().toLowerCase();
    if (!value) return;
    submit.disabled = true;
    const hash = await sha256Hex(value);
    if (ACCESS_CODE_SHA256S.includes(hash)) {
      markUnlocked();
      showWelcome(overlay, onPass);
    } else {
      error.hidden = false;
      input.classList.add('gate-input--error');
      submit.disabled = false;
      input.select();
    }
  });

  // Clear the error as soon as they start fixing the code.
  input.addEventListener('input', () => {
    error.hidden = true;
    input.classList.remove('gate-input--error');
  });

  card.appendChild(form);
  overlay.appendChild(card);

  requestAnimationFrame(() => input.focus());
}

// Public entry point. Call at the very top of boot, before app init. Skips the
// gate (boots immediately) when already unlocked or already installed; otherwise
// shows the code screen and only calls onPass once the user is through.
//
// onGateShown fires as soon as the gate is actually on screen — and only on that
// branch. The caller uses it to clear its own boot splash: the gate IS the first
// screen in that case, so nothing may wait on onPass (which may never come) to
// get out of the way.
export function maybeShowGate(onPass: () => void, onGateShown?: () => void): void {
  if (isUnlocked() || isStandalone()) {
    onPass();
    return;
  }
  const overlay = makeOverlay();
  showCodeEntry(overlay, onPass);
  onGateShown?.();
}
