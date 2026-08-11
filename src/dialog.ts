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
  // A numbered "here's what happens" list under the body. Each row is a badge,
  // a bold label and one line of detail — the shape a user scans instead of
  // reads. Prose paragraphs that start "① Watch it — the board plays…" carry
  // exactly the same words and get read by nobody.
  steps?: Array<{ label: string; detail: string }>;
  // Discrete "learn more" links shown as a small row under the body. Open in a
  // new tab; purely informational (no effect on the dialog).
  links?: Array<{ label: string; href: string }>;
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
    // Blank lines split the body into separate paragraphs.
    for (const para of opts.body.split('\n\n')) {
      const p = document.createElement('p');
      p.className = 'section-desc';
      p.textContent = para;
      sheet.appendChild(p);
    }
  }

  if (opts.steps?.length) {
    const list = document.createElement('ol');
    list.className = 'dialog-steps';
    opts.steps.forEach((s, i) => {
      const li = document.createElement('li');
      li.className = 'dialog-step';

      const badge = document.createElement('span');
      badge.className = 'dialog-step-num';
      badge.setAttribute('aria-hidden', 'true');
      badge.textContent = String(i + 1);
      li.appendChild(badge);

      const text = document.createElement('span');
      text.className = 'dialog-step-text';
      const label = document.createElement('span');
      label.className = 'dialog-step-label';
      label.textContent = s.label;
      text.appendChild(label);
      const detail = document.createElement('span');
      detail.className = 'dialog-step-detail';
      detail.textContent = s.detail;
      text.appendChild(detail);
      li.appendChild(text);

      list.appendChild(li);
    });
    sheet.appendChild(list);
  }

  if (opts.links?.length) {
    const row = document.createElement('div');
    row.className = 'dialog-links';
    for (const l of opts.links) {
      const a = document.createElement('a');
      a.className = 'dialog-link';
      a.href = l.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = `${l.label} ↗`;
      row.appendChild(a);
    }
    sheet.appendChild(row);
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
