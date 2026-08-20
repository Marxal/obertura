// The cover that makes signing in look like one step instead of two.
//
// THE PROBLEM IT SOLVES. Signing in on a phone that already has an account's
// copy waiting has to end in a page reload: a pull writes the whole app-state
// snapshot back to localStorage (statistics, streaks, ratings, board colours,
// which walkthroughs are finished), and modules that read those at boot — and
// the boot-time DOM work that applies them — have already run. Re-deriving all
// of it live would mean teaching fifty modules to re-read themselves, and every
// one of them would be a place for a stale screen to hide.
//
// So the reload stays. What was wrong was that you SAW it: the app painted, sat
// there for 1.2 seconds looking finished, and then blinked and painted again.
// That reads as a crash, not as a restore.
//
// THE FIX IS THE BOOT SPLASH, BORROWED. This cover is the same pulsing app icon
// on the same background as `#app-splash` in index.html, with a caption under
// it. It goes up the moment sign-in starts and is still up when the reload
// fires — and the page that comes back shows the real boot splash, identical,
// until its first screen is ready. Nothing flashes, because there is nothing
// between the two: one continuous "signing you in", then the finished app.
//
// It deliberately can't get stuck. Every caller gets a dismiss function back and
// the module drops the node when it's called; a caller that never calls it (a
// failed connect that returns early) would be a bug, so there is also a hard
// ceiling — see MAX_MS.

const MAX_MS = 20_000;

let node: HTMLElement | null = null;
let timer: number | undefined;

/**
 * Cover the app while an account is being restored. Returns the function that
 * takes the cover away — calling it twice, or after the ceiling has already
 * fired, does nothing.
 *
 * A second call while one is already up just re-labels it, so overlapping auth
 * events can't stack two covers on top of each other.
 */
export function showSigningIn(caption: string): () => void {
  if (node) {
    const line = node.querySelector('p');
    if (line) line.textContent = caption;
    return hideSigningIn;
  }

  const el = document.createElement('div');
  el.className = 'auth-splash';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');

  const img = document.createElement('img');
  img.src = `${import.meta.env.BASE_URL}icons/icon-192.png`;
  img.alt = '';
  img.width = 96;
  img.height = 96;
  el.appendChild(img);

  const line = document.createElement('p');
  line.textContent = caption;
  el.appendChild(line);

  document.body.appendChild(el);
  node = el;

  // The ceiling. A cover that outlives whatever it was covering would lock the
  // app behind a screen with no way out, which is far worse than the flicker
  // this exists to hide.
  timer = window.setTimeout(hideSigningIn, MAX_MS);

  return hideSigningIn;
}

export function hideSigningIn(): void {
  if (timer !== undefined) {
    window.clearTimeout(timer);
    timer = undefined;
  }
  node?.remove();
  node = null;
}
