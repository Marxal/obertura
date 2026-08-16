// The one transient toast — a small status message that fades after a moment.
// Lives here so any screen (main, import panel, …) can fire it without owning
// the DOM node or timer. Styling is in style.css (.toast / .toast--show).
//
// The optional 'success' variant dresses the pill up with a green check badge
// for the moments worth celebrating (a finished import); plain toasts stay the
// quiet dark pill.
//
// An optional single ACTION turns the pill into an offer you can take or ignore
// — "Saved ✓ · this continues an older line" with a "Remove it" tap. That is the
// whole reason a toast is the right shape for it: a dialog would demand an
// answer before the user could carry on, and the answer is almost always "not
// now". Firing two toasts in a row QUEUES the second rather than replacing the
// first, so an offer can't be swallowed by whatever fires next.

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export type ToastVariant = 'default' | 'success';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  variant?: ToastVariant;
  // How long the toast stays up, ms. Success messages linger a touch longer,
  // and one carrying an action longer still — it has to be readable AND tappable.
  durationMs?: number;
  action?: ToastAction;
}

interface QueuedToast { message: string; opts: ToastOptions }

const queue: QueuedToast[] = [];
let showing = false;

export function showToast(message: string, opts: ToastOptions = {}): void {
  queue.push({ message, opts });
  if (!showing) drain();
}

function drain(): void {
  const next = queue.shift();
  if (!next) { showing = false; return; }
  showing = true;
  paint(next.message, next.opts);
}

function paint(message: string, opts: ToastOptions): void {
  const variant = opts.variant ?? 'default';
  const duration = opts.durationMs
    ?? (opts.action ? 6000 : variant === 'success' ? 2800 : 2200);

  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }

  toast.className = 'toast'
    + (variant === 'success' ? ' toast--success' : '')
    + (opts.action ? ' toast--action' : '');
  toast.innerHTML = '';

  if (variant === 'success') {
    const badge = document.createElement('span');
    badge.className = 'toast-badge';
    badge.setAttribute('aria-hidden', 'true');
    badge.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none"'
      + ' stroke="currentColor" stroke-width="3" stroke-linecap="round"'
      + ' stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
    toast.appendChild(badge);
  }

  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = message;
  toast.appendChild(text);

  if (opts.action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = opts.action.label;
    const act = opts.action.onClick;
    btn.addEventListener('click', () => {
      hide();
      act();
    });
    toast.appendChild(btn);
  }

  const el = toast;
  el.classList.add('toast--show');
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toastTimer = setTimeout(hide, duration);

  function hide(): void {
    if (toastTimer !== undefined) clearTimeout(toastTimer);
    toastTimer = undefined;
    el.classList.remove('toast--show');
    // Let the fade finish before the next one paints, so a queued pair reads as
    // two messages rather than one flickering between texts.
    setTimeout(drain, 220);
  }
}
