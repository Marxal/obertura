// The one transient toast — a small status message that fades after a moment.
// Lives here so any screen (main, import panel, …) can fire it without owning
// the DOM node or timer. Styling is in style.css (.toast / .toast--show).

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function showToast(message: string): void {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('toast--show');
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast!.classList.remove('toast--show'), 2200);
}
