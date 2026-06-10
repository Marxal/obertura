// Back-gesture / hardware-back handling for the installed PWA.
//
// The problem: on Android the app boots with a single history entry, so the
// system back gesture pops it and the PWA closes outright — even when you're
// mid-builder, mid-drill, or have a sheet open. People expect back to step
// *within* the app first and only leave once there's nothing left to go back to.
//
// The fix: keep exactly one spare "buffer" history entry armed at all times. A
// back press consumes the buffer and fires `popstate`; we handle ONE step of
// in-app back, then re-arm the buffer so the next press is trapped too. When
// there's genuinely nothing left to go back to (home screen, no sheets open) we
// stop trapping and replay the press so the app closes as the user expects.
//
// Two kinds of "back" exist, checked in this order:
//   1. Dismissible layers — edit sheets, confirm dialogs, the drill / explore /
//      map overlays. Each registers a close step with `pushBack()` when it opens
//      and drops it when it closes. The topmost one is closed first.
//   2. View-level navigation — once no layers are open, fall back to the screen
//      router (registered via `setViewBack`) to step toward home.

const BUFFER_STATE = { obertura: true };

let started = false;

// LIFO stack of "close one layer" callbacks. The last registered runs first.
type BackStep = () => void;
const stack: BackStep[] = [];

// View-level fallback. Returns true if it moved one screen toward home, or
// false when already at the root (so a back press there should exit the app).
let viewBack: () => boolean = () => false;

export function setViewBack(fn: () => boolean): void {
  viewBack = fn;
}

// Register a dismissible layer. Call the returned remover from the layer's own
// close path (button, backdrop, etc.) so the stack stays in sync however the
// layer is dismissed. The remover is idempotent, and a back-gesture that closes
// the layer pops it from the stack before running it — so calling the remover
// again from inside the close handler is a safe no-op.
export function pushBack(close: BackStep): () => void {
  stack.push(close);
  return () => {
    const i = stack.lastIndexOf(close);
    if (i !== -1) stack.splice(i, 1);
  };
}

export function initBackNav(): void {
  if (started) return;
  started = true;
  history.pushState(BUFFER_STATE, '');
  window.addEventListener('popstate', onPopState);
}

function onPopState(): void {
  // A dismissible layer takes priority over view navigation.
  if (stack.length > 0) {
    const close = stack.pop()!;
    close();
    rearm();
    return;
  }
  // Otherwise step one screen back toward home.
  if (viewBack()) {
    rearm();
    return;
  }
  // Nothing left in-app: stop trapping and replay the press so it leaves the
  // app (on Android this closes the PWA; in a tab it returns to the prior page).
  window.removeEventListener('popstate', onPopState);
  history.back();
}

function rearm(): void {
  history.pushState(BUFFER_STATE, '');
}
