// A bottom sheet for writing the note on one move.
//
// Lifted out of train-screen.ts (where it served the results screen's position
// peek) so the chronic-miss prompt can reuse it instead of growing a near-copy.
// The two callers differ only in copy: the quick editor is a bare "Note for ♞f3",
// the chronic-miss prompt adds a subtitle and a line of framing above the box.
//
// It layers over anything: .edit-overlay sits at z-index 300 and the drill
// overlay at 200, so this opens cleanly on top of a running drill.

import type { MoveNode } from './tree';
import { pushBack } from './back-nav';
import { showToast } from './toast';

export interface MoveNoteSheetOptions {
  // The node written to directly. `note` is set to the trimmed text, or cleared
  // to undefined when the box is emptied.
  node: MoveNode;
  title: string;
  subtitle?: string;    // e.g. "♞f3 · missed 6×"
  intro?: string;       // a line of framing above the textarea
  placeholder?: string;
  saveLabel?: string;   // default "Save"
  skipLabel?: string;   // default "Cancel"
  // Fired after the note is written to the node — the caller owns persistence.
  onSave: () => void;
  // Fired when the sheet is dismissed without saving (button, backdrop or the
  // system back gesture), so a prompt can record that it was shown.
  onSkip?: () => void;
}

// Resolves once the sheet closes, whichever way it went — so a caller that
// paused something (a drill mid-line) can await it and then carry on.
export function openMoveNoteSheet(opts: MoveNoteSheetOptions): Promise<void> {
  return new Promise<void>((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'edit-overlay';
    const sheet = document.createElement('div');
    sheet.className = 'edit-sheet';

    const h = document.createElement('h3');
    h.className = 'edit-sheet-title';
    h.textContent = opts.title;
    sheet.appendChild(h);

    if (opts.subtitle) {
      const sub = document.createElement('div');
      sub.className = 'note-sheet-sub';
      sub.textContent = opts.subtitle;
      sheet.appendChild(sub);
    }

    if (opts.intro) {
      const intro = document.createElement('p');
      intro.className = 'note-sheet-intro';
      intro.textContent = opts.intro;
      sheet.appendChild(intro);
    }

    const textarea = document.createElement('textarea');
    textarea.className = 'prompt-sheet-textarea';
    textarea.rows = 3;
    textarea.value = opts.node.note ?? '';
    textarea.placeholder = opts.placeholder ?? 'Reminder or plan for this move…';
    sheet.appendChild(textarea);

    const btnRow = document.createElement('div');
    btnRow.className = 'dialog-btn-row';

    let closed = false;
    // `saved` keeps the dismissal path honest: the backdrop and the back gesture
    // both count as a skip, but only when nothing was saved first.
    const close = (saved: boolean): void => {
      if (closed) return;
      closed = true;
      overlay.remove();
      removeBack();
      if (!saved) opts.onSkip?.();
      resolve();
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'dialog-btn btn-secondary';
    cancelBtn.textContent = opts.skipLabel ?? 'Cancel';
    cancelBtn.addEventListener('click', () => close(false));

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'dialog-btn btn-primary';
    saveBtn.textContent = opts.saveLabel ?? 'Save';
    saveBtn.addEventListener('click', () => {
      const value = textarea.value.trim();
      opts.node.note = value ? value : undefined;
      close(true);
      opts.onSave();
      showToast(value ? 'Note saved ✓' : 'Note cleared');
    });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(saveBtn);
    sheet.appendChild(btnRow);

    const removeBack = pushBack(() => close(false));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  });
}
