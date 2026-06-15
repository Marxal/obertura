// The one transient toast — a small status message that fades after a moment.
// Lives here so any screen (main, import panel, …) can fire it without owning
// the DOM node or timer. Styling is in style.css (.toast / .toast--show).
//
// The optional 'success' variant dresses the pill up with a green check badge
// for the moments worth celebrating (a finished import); plain toasts stay the
// quiet dark pill.

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export type ToastVariant = 'default' | 'success';

export interface ToastOptions {
  variant?: ToastVariant;
  // How long the toast stays up, ms. Success messages linger a touch longer.
  durationMs?: number;
}

export function showToast(message: string, opts: ToastOptions = {}): void {
  const variant = opts.variant ?? 'default';
  const duration = opts.durationMs ?? (variant === 'success' ? 2800 : 2200);

  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }

  toast.className = 'toast' + (variant === 'success' ? ' toast--success' : '');
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

  toast.classList.add('toast--show');
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast!.classList.remove('toast--show'), duration);
}
