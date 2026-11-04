// A tooltip for every icon-only button, for a mouse.
//
// Icon buttons already carry an aria-label for screen readers. A mouse user has
// nothing to go on until they click, which on a desktop is the one thing a hover
// is for. So the label is copied to `title` the first time the pointer lands on
// the button: one listener, nothing to remember at each of the app's many icon
// buttons, and touch never gets here.

export function installHoverLabels(): void {
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse' || !(e.target instanceof Element)) return;
    const el = e.target.closest<HTMLElement>('button[aria-label]:not([title]), a[aria-label]:not([title])');
    if (el && !el.textContent?.trim()) el.title = el.getAttribute('aria-label')!;
  });
}
