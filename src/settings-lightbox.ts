// Settings as a centred lightbox — the desktop path only (see openSettings in
// main.ts). Below the desktop-nav breakpoint Settings is still a swapped-in
// full-screen view (#view-settings, showView('settings')); this module is what
// the sidebar's bottom entry opens instead once the sidebar is carrying the
// app's identity and there's no header left to hold a "Settings" title.
//
// Deliberately NOT a view: it never touches showView/currentView, so the
// BACK_VIEWS + returnView bookkeeping (which assumes Settings is a view) is
// left alone, the sidebar stays visible behind it, and closing lands back on
// whichever tab was already showing — by construction, not by tracking.
//
// Content is the exact same renderSettingsScreen() the full-screen view uses;
// only the container differs. Dismisses via the X, a backdrop click, Escape, or
// the system back gesture (pushBack, like every other overlay in the app).

import { renderSettingsScreen } from './settings-screen';
import { pushBack } from './back-nav';
import { Icons } from './icons';

let openOverlay: HTMLElement | null = null;
let closeOpen: (() => void) | null = null;

export function isSettingsLightboxOpen(): boolean {
  return openOverlay !== null;
}

export function closeSettingsLightbox(): void {
  closeOpen?.();
}

export function openSettingsLightbox(): void {
  // Never stack two.
  if (openOverlay) return;

  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay settings-lightbox-overlay';

  const box = document.createElement('div');
  box.className = 'settings-lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Settings');

  // A fixed head (title + X) over a scrolling body, so the way out stays put
  // however far down the accordions you are.
  const head = document.createElement('div');
  head.className = 'settings-lightbox-head';

  const title = document.createElement('h2');
  title.className = 'settings-lightbox-title';
  title.textContent = 'Settings';
  head.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'settings-lightbox-close';
  closeBtn.setAttribute('aria-label', 'Close settings');
  closeBtn.appendChild(Icons.close(20));
  head.appendChild(closeBtn);

  box.appendChild(head);

  const body = document.createElement('div');
  body.className = 'settings-lightbox-body';
  renderSettingsScreen(body);
  box.appendChild(body);

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    overlay.remove();
    removeBack();
    document.removeEventListener('keydown', onKey);
    openOverlay = null;
    closeOpen = null;
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  }

  const removeBack = pushBack(close);
  document.addEventListener('keydown', onKey);
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.appendChild(box);
  document.body.appendChild(overlay);
  openOverlay = overlay;
  closeOpen = close;
  closeBtn.focus();
}
