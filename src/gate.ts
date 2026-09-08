// ════════════════════════════════════════════════════════════════════════════
// THE INSTALL PROMPT — capturing it, and offering it where it's useful.
//
// THIS FILE USED TO BE THE BETA GATE. A "enter your beta access code" screen
// stood in front of the whole app on first open: a SHA-256 check against hashes
// baked into the bundle, a localStorage flag once passed, and an install screen
// behind it. It was always a friendly speed bump rather than security — the
// check ran in JavaScript the user was holding, and the flag was one devtools
// line away — and its only real job was keeping a private beta private.
//
// The app is public at bitochess.com now, so the gate had nothing left to guard.
// What it did still do was stand between a fresh browser profile and the app on
// every local dev server and every preview URL, which is pure friction. Removed
// 2026-09, along with BETA-ACCESS.md's reason to exist.
//
// The install-prompt plumbing stayed, because it was always a separate job that
// merely happened to live in the same file: `beforeinstallprompt` fires ONCE,
// EARLY, and only if something is listening when it does. This module is
// imported at the top of boot precisely so that something always is.
// ════════════════════════════════════════════════════════════════════════════

// The Chrome/Android install prompt fires once, early, and only if we capture
// it. Start listening the moment this module loads so the event is never missed,
// then surface it on demand. Typed loosely — `beforeinstallprompt` isn't in the
// standard lib.
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let deferredInstallPrompt: InstallPromptEvent | null = null;
// Screens that offer an install button need to know when one becomes possible.
// The event can land AFTER the Train screen has painted (Chrome fires it once
// the service worker and manifest have both been checked), so a screen that
// asked "can I install?" at paint time and got "no" would be wrong a second
// later — and the row would never appear until the user navigated away and back.
const installListeners = new Set<() => void>();
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // stop Chrome's mini-infobar; we trigger it from our button
  deferredInstallPrompt = e as InstallPromptEvent;
  for (const fn of [...installListeners]) fn();
});

// Subscribe to "an install prompt is now available". Returns an unsubscribe.
export function onInstallAvailable(fn: () => void): () => void {
  installListeners.add(fn);
  return () => installListeners.delete(fn);
}

// Already installed (Android/desktop report display-mode; iOS uses navigator.standalone).
function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

// ── Install, offered where it makes sense ────────────────────────────────────
// The Get-started checklist (first-steps.ts) offers an "Install the app" row.
// It has to ask THIS module, because the `beforeinstallprompt` event fires once,
// early, and only this module is listening when it does.

// Is there a REAL install to offer? A captured prompt, and not already running
// from the home screen — nothing else.
//
// Deliberately not "is this Android?". A button that can't install and instead
// opens a card explaining where the browser's own menu item lives is not an
// install button, it's a help page wearing one; it also can't tell whether the
// user already installed the app from that menu, so it nags forever. Where no
// prompt exists (Firefox, iOS Safari) the row simply isn't offered.
export function canInstallApp(): boolean {
  return deferredInstallPrompt !== null && !isStandalone();
}

// Already running from the home screen — nothing to install.
export function isAppInstalled(): boolean {
  return isStandalone();
}

// Fire the real install prompt. Resolves 'accepted' / 'dismissed' from the
// browser's own dialog, or 'unavailable' when there was no prompt to fire (which
// canInstallApp has already ruled out for anything that shows a button).
export async function promptInstallApp(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const prompt = deferredInstallPrompt;
  if (!prompt) return 'unavailable';
  // A captured prompt is single-use; drop it whatever the user chooses, so
  // canInstallApp stops advertising an install we can no longer perform.
  deferredInstallPrompt = null;
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  return outcome;
}
