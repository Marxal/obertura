// The chronic-miss nudge: a quiet box that slides in BELOW the board when you
// finally fix a move you keep forgetting.
//
// Deliberately not a dialog. It never covers the board, never steals focus, and
// never opens the keyboard on its own — the drill carries straight on underneath
// it. It offers one thing: write down why this move keeps going. Two states:
//
//   collapsed — one line of copy + "Write a note". No input, no keyboard.
//   writing   — the textarea, focused (so the keyboard is always your choice).
//
// Dismiss by flicking it sideways, or with the × . Either way the caller stamps
// the snooze, so the ask doesn't come straight back next session.

import type { MoveNode } from './tree';
import { Icons } from './icons';
import { formatMove } from './notation';

export interface StruggleNudgeOptions {
  node: MoveNode;
  count: number;                 // lifetime misses, for the one-liner
  onNoteChanged: () => void;     // the note was edited — persist the line
  onDismiss: () => void;         // swiped away / closed / finished — stamp the snooze
}

// How far a drag must travel before release counts as "throw it away".
const DISMISS_PX = 72;

// If the line ends while the nudge is still up we hold the results screen for
// it — but never longer than this, so an abandoned phone still finishes the run.
const HOLD_MS = 25_000;

export interface StruggleNudge {
  el: HTMLElement;
  /** Resolves once the box has been written, closed, flicked away or timed out. */
  settled: Promise<void>;
  destroy: () => void;
}

export function createStruggleNudge(opts: StruggleNudgeOptions): StruggleNudge {
  const { node } = opts;

  let resolveSettled!: () => void;
  const settled = new Promise<void>((res) => { resolveSettled = res; });

  const el = document.createElement('div');
  el.className = 'pt-nudge';
  el.setAttribute('role', 'status');

  let done = false;          // dismissed once, callbacks fire once
  let exitTimer: ReturnType<typeof setTimeout> | undefined;

  // ── Collapsed row ──────────────────────────────────────────────────────────

  const row = document.createElement('div');
  row.className = 'pt-nudge-row';

  const icon = document.createElement('span');
  icon.className = 'pt-nudge-icon';
  icon.appendChild(Icons.note(16));
  row.appendChild(icon);

  const text = document.createElement('div');
  text.className = 'pt-nudge-text';
  const head = document.createElement('div');
  head.className = 'pt-nudge-head';
  head.textContent = `${formatMove(node.san)} keeps going — ${opts.count} misses`;
  text.appendChild(head);
  const sub = document.createElement('div');
  sub.className = 'pt-nudge-sub';
  sub.textContent = 'Leave yourself a reminder.';
  text.appendChild(sub);
  row.appendChild(text);

  const writeBtn = document.createElement('button');
  writeBtn.type = 'button';
  writeBtn.className = 'pt-nudge-write';
  writeBtn.textContent = 'Note';
  writeBtn.addEventListener('click', () => expand());
  row.appendChild(writeBtn);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'pt-nudge-close';
  closeBtn.setAttribute('aria-label', 'Dismiss');
  closeBtn.appendChild(Icons.close(15));
  closeBtn.addEventListener('click', () => exit('left'));
  row.appendChild(closeBtn);

  el.appendChild(row);

  // ── Writing state ──────────────────────────────────────────────────────────
  //
  // Built only when asked for, so the keyboard can never appear unbidden.

  function expand(): void {
    if (el.classList.contains('pt-nudge--writing')) return;
    el.classList.add('pt-nudge--writing');
    row.setAttribute('hidden', '');

    const pane = document.createElement('div');
    pane.className = 'pt-nudge-pane';

    const label = document.createElement('div');
    label.className = 'pt-nudge-label';
    label.textContent = `Why ${formatMove(node.san)}?`;
    pane.appendChild(label);

    const ta = document.createElement('textarea');
    ta.className = 'pt-nudge-input';
    ta.rows = 2;
    ta.placeholder = 'Knight before bishop — the pin is coming';
    ta.value = node.note ?? '';
    // Write straight to the node as you type and persist on pause, so nothing is
    // lost if the line ends (or you close the app) mid-sentence.
    ta.addEventListener('input', () => { node.note = ta.value.trim() || undefined; });
    ta.addEventListener('change', () => opts.onNoteChanged());
    pane.appendChild(ta);

    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = 'btn-primary pt-nudge-done';
    doneBtn.textContent = 'Done';
    doneBtn.addEventListener('click', () => {
      node.note = ta.value.trim() || undefined;
      opts.onNoteChanged();
      exit('down');
    });
    pane.appendChild(doneBtn);

    el.appendChild(pane);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  // ── Flick to dismiss ───────────────────────────────────────────────────────
  //
  // Horizontal only: the drill overlay scrolls vertically, and `touch-action:
  // pan-y` in the CSS keeps that scroll working while we claim sideways drags.

  let startX = 0;
  let dx = 0;
  let dragging = false;

  el.addEventListener('pointerdown', (e) => {
    // Never start a drag from the controls — a tap on "Note" must stay a tap.
    if ((e.target as HTMLElement).closest('button, textarea')) return;
    dragging = true;
    startX = e.clientX;
    dx = 0;
    el.classList.add('pt-nudge--dragging');
    el.setPointerCapture(e.pointerId);
  });

  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dx = e.clientX - startX;
    el.style.transform = `translateX(${dx}px)`;
    // Fade with distance, so the throw reads as "letting go of it".
    el.style.opacity = String(Math.max(0.25, 1 - Math.abs(dx) / (DISMISS_PX * 3)));
  });

  function endDrag(): void {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('pt-nudge--dragging');
    if (Math.abs(dx) >= DISMISS_PX) {
      exit(dx < 0 ? 'left' : 'right');
    } else {
      el.style.transform = '';
      el.style.opacity = '';
    }
  }
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);

  // ── Exit ───────────────────────────────────────────────────────────────────

  function exit(dir: 'left' | 'right' | 'down'): void {
    if (done) return;
    done = true;
    if (holdTimer) clearTimeout(holdTimer);
    el.classList.add(`pt-nudge--exit-${dir}`);
    el.style.transform = '';
    el.style.opacity = '';
    exitTimer = setTimeout(() => el.remove(), 240);
    opts.onDismiss();
    resolveSettled();
  }

  // The line can finish while this is still on screen — most obviously when the
  // move you keep missing IS the line's last move. Rather than yanking the box
  // away with the drill, the caller waits on `settled`; this cap stops that wait
  // being forever if the phone is simply put down.
  let holdTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
    if (!done) exit('down');
  }, HOLD_MS);

  function destroy(): void {
    if (exitTimer) clearTimeout(exitTimer);
    if (holdTimer) clearTimeout(holdTimer);
    el.remove();
    resolveSettled();
  }

  return { el, settled, destroy };
}
