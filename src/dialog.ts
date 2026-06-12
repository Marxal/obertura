// A small bottom-sheet dialog, reusing the builder's edit-sheet look. Used for
// the exit guards (save / abandon) and the post-save "add to training" prompt.
//
// Every dialog wires itself into the back-nav dismissible-layer stack via
// pushBack, so the system back gesture closes it (running onDismiss) rather than
// leaving the screen. A button click closes the dialog first, then runs its
// handler; a backdrop tap or back gesture counts as a dismiss.

import { pushBack } from './back-nav';

export interface DialogButton {
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
  onClick?: () => void;
}

export interface DialogOptions {
  title: string;
  body?: string;
  buttons: DialogButton[];
  // Runs when the dialog is dismissed without a button — a backdrop tap or the
  // system back gesture. Defaults to nothing (the dialog just closes).
  onDismiss?: () => void;
}

export function showDialog(opts: DialogOptions): void {
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet';

  const h = document.createElement('h3');
  h.className = 'edit-sheet-title';
  h.textContent = opts.title;
  sheet.appendChild(h);

  if (opts.body) {
    const p = document.createElement('p');
    p.className = 'section-desc';
    p.textContent = opts.body;
    sheet.appendChild(p);
  }

  const btnRow = document.createElement('div');
  btnRow.className = 'dialog-btn-row' + (opts.buttons.length >= 3 ? ' dialog-btn-row--stack' : '');

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    overlay.remove();
    removeBack();
  }

  for (const b of opts.buttons) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dialog-btn ' + (
      b.variant === 'primary' ? 'btn-primary'
      : b.variant === 'danger' ? 'btn-danger'
      : 'btn-secondary'
    );
    btn.textContent = b.label;
    btn.addEventListener('click', () => {
      close();
      b.onClick?.();
    });
    btnRow.appendChild(btn);
  }
  sheet.appendChild(btnRow);

  // Backdrop tap and the system back gesture both count as a dismiss.
  const removeBack = pushBack(() => { close(); opts.onDismiss?.(); });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { close(); opts.onDismiss?.(); }
  });

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}

export interface PromptSheetOptions {
  title: string;
  initialValue?: string;
  placeholder?: string;
  saveLabel?: string;
  cancelLabel?: string;
  // Receives the raw textarea value on Save — the caller decides what an empty
  // value means (e.g. deleting a note).
  onSave: (value: string) => void;
}

// A bottom-sheet with a single textarea and Save / Cancel, built on the same
// edit-overlay / edit-sheet look as showDialog. Cancel, a backdrop tap and the
// system back gesture all dismiss without saving.
export function showPromptSheet(opts: PromptSheetOptions): void {
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet';

  const h = document.createElement('h3');
  h.className = 'edit-sheet-title';
  h.textContent = opts.title;
  sheet.appendChild(h);

  const textarea = document.createElement('textarea');
  textarea.className = 'prompt-sheet-textarea';
  textarea.rows = 3;
  textarea.value = opts.initialValue ?? '';
  if (opts.placeholder) textarea.placeholder = opts.placeholder;
  sheet.appendChild(textarea);

  const btnRow = document.createElement('div');
  btnRow.className = 'dialog-btn-row';

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    overlay.remove();
    removeBack();
  }

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'dialog-btn btn-secondary';
  cancelBtn.textContent = opts.cancelLabel ?? 'Cancel';
  cancelBtn.addEventListener('click', () => close());

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'dialog-btn btn-primary';
  saveBtn.textContent = opts.saveLabel ?? 'Save';
  saveBtn.addEventListener('click', () => {
    const value = textarea.value;
    close();
    opts.onSave(value);
  });

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(saveBtn);
  sheet.appendChild(btnRow);

  const removeBack = pushBack(() => close());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  // Focus after mount so the keyboard opens straight onto the note, cursor at
  // the end of any existing text.
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}
