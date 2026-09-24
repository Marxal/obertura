// Keyboard shortcuts for every exercise — one handler for the whole app.
//
// WHY ONE HANDLER AND NOT ONE PER EXERCISE. Nine runners build their own
// overlays, but they all build the same few buttons with the same classes:
// Next (.pz-next-btn), Hint (.pz-hint-btn, or the drill's .pt-control--hint),
// Analyse, Show solution, and the header's End. So a key does exactly what a
// click on the visible button would, and the runners needed no changes: a
// shortcut can never reach a state the screen itself doesn't offer, because it
// only ever presses a button that is on screen and enabled.
//
// Esc also closes a dialog or sheet opened over an exercise (see below).
//
// WHAT IT LEAVES ALONE.
//   • Typing: nothing fires while focus is in a field.
//   • Space/Enter on a focused button: the browser already presses it.
//   • Anything under a sheet: only the TOPMOST overlay counts, so a note sheet
//     or a position peek opened over a run swallows nothing it shouldn't.
//   • Arrow keys: Blunder detective steps through the game with them.
//   • Modifier chords (Ctrl/Cmd/Alt), which belong to the browser.
//
// Installed once, from boot (main.ts). "?" lists the keys the current screen
// actually has.

import { openInfoSheet, type InfoEntry } from './info-sheet';

interface Shortcut {
  /** KeyboardEvent.key values, lower-cased. */
  keys: string[];
  /** What the help sheet shows as the key. */
  label: string;
  /** What it does, for the help sheet and the button's tooltip. */
  action: string;
  /** Buttons it presses — the first visible, enabled match wins. */
  selector: string;
}

export const SHORTCUTS: Shortcut[] = [
  {
    keys: [' ', 'enter'],
    label: 'Space or Enter',
    action: 'Next',
    selector: '.pz-next-btn, .pz-results-actions .btn-primary, .train-completion .btn-primary',
  },
  { keys: ['h'], label: 'H', action: 'Hint', selector: '.pz-hint-btn, .pt-control--hint' },
  { keys: ['s'], label: 'S', action: 'Show solution', selector: '.dt-reveal' },
  { keys: ['n'], label: 'N', action: 'Note', selector: '.pt-control--note' },
  { keys: ['a'], label: 'A', action: 'Analyse', selector: '.pz-analyse-btn, .mr-after-btn.btn-secondary' },
  {
    keys: ['escape'],
    label: 'Esc',
    action: 'End or close',
    selector: '.pt-header-end, .pz-results-actions .train-done-btn, .train-completion .train-done-btn',
  },
];

// Everything that sits on top of the page as its own layer. The last one in
// the document is the one on top — they are all appended to <body>.
const LAYERS = '.pt-overlay, .edit-overlay, .dc-overlay, .rmap-overlay, .picker-overlay, .tour-overlay, .promotion-overlay';

function layers(): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>(`:scope > :is(${LAYERS})`)];
}

function usable(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled || el.hidden) return false;
  if (el.closest('[hidden]')) return false;
  return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
}

function find(layer: HTMLElement, selector: string): HTMLElement | null {
  for (const el of layer.querySelectorAll<HTMLElement>(selector)) {
    if (usable(el)) return el;
  }
  return null;
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

function openHelp(layer: HTMLElement): void {
  const entries: InfoEntry[] = SHORTCUTS
    .filter((s) => find(layer, s.selector))
    .map((s) => ({ label: s.label, detail: s.action }));
  entries.push({ label: '?', detail: 'This list' });
  openInfoSheet({
    title: 'Keyboard shortcuts',
    intro: 'The keys this screen has right now. Each one presses the button it names.',
    entries,
  });
}

let installed = false;

export function installRunKeys(): void {
  if (installed) return;
  installed = true;

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(e.target)) return;
    const stack = layers();
    const layer = stack[stack.length - 1];
    if (!layer) return;
    const key = e.key.toLowerCase();

    // Esc on a dialog or info sheet opened FROM an exercise ("End this
    // session?", the shortcut list, a peek) dismisses it, exactly as a tap on
    // its backdrop does — the sheets already treat a click on the overlay
    // itself as "dismiss". Only over an exercise: elsewhere a sheet can hold a
    // half-written note, and a stray Esc must not throw that away.
    if (key === 'escape' && layer.classList.contains('edit-overlay')
      && stack.slice(0, -1).some((l) => l.classList.contains('pt-overlay'))) {
      e.preventDefault();
      layer.click();
      return;
    }
    if (!layer.classList.contains('pt-overlay')) return;

    if (key === '?') {
      e.preventDefault();
      openHelp(layer);
      return;
    }
    // A focused button already answers Space and Enter itself.
    if ((key === ' ' || key === 'enter') && (e.target as HTMLElement | null)?.closest('button, a, summary')) return;

    const shortcut = SHORTCUTS.find((s) => s.keys.includes(key));
    if (!shortcut) return;
    const button = find(layer, shortcut.selector);
    if (!button) return;
    e.preventDefault();
    button.click();
  });

  // Say the key in each button's tooltip, so a mouse user finds them without
  // the help sheet. Done on hover rather than at build time, because the
  // runners build their buttons without knowing this module exists.
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('.pt-overlay button');
    if (!el || el.dataset.keyHint) return;
    const shortcut = SHORTCUTS.find((s) => el.matches(s.selector));
    if (!shortcut) return;
    el.dataset.keyHint = '1';
    const base = el.title || el.textContent?.trim() || shortcut.action;
    el.title = `${base} (${shortcut.label})`;
  }, { passive: true });
}
