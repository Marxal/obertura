// The "what is this?" sheet — one shared popup for the (i) buttons that sit
// beside a section title.
//
// It exists because the alternative kept losing. A menu of six practice modes
// with a one-line subtitle each is scannable, and that is exactly why the
// subtitles have to stay short — which leaves no room to say what "Repertoire
// run" actually does differently from "Drill new lines". Putting the difference
// in a second line under every card turns a menu into a wall; putting it behind
// an (i) means the menu stays a menu and the answer is one tap away for the one
// visit where someone wants it.
//
// Deliberately NOT dialog.ts's `steps`: those are numbered, because they
// describe a sequence. These are a set of choices, and numbering a set implies
// an order that isn't there.

import { pushBack } from './back-nav';
import { Icons } from './icons';

export interface InfoEntry {
  /** The mode's own icon, so the sheet and the card it explains match. */
  icon?: SVGElement;
  /** Its accent colour, for the icon chip — same reason. */
  accent?: string;
  label: string;
  detail: string;
}

export interface InfoSheetOptions {
  title: string;
  /** One short paragraph above the list. Optional — the list often says it all. */
  intro?: string;
  entries: InfoEntry[];
  /** A closing line under the list (a caveat, a where-to-find-it). */
  footnote?: string;
}

export function openInfoSheet(opts: InfoSheetOptions): void {
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet info-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');

  const h = document.createElement('h3');
  h.className = 'edit-sheet-title';
  h.textContent = opts.title;
  sheet.appendChild(h);

  if (opts.intro) {
    const p = document.createElement('p');
    p.className = 'section-desc';
    p.textContent = opts.intro;
    sheet.appendChild(p);
  }

  const list = document.createElement('ul');
  list.className = 'info-sheet-list';
  for (const entry of opts.entries) {
    const li = document.createElement('li');
    li.className = 'info-sheet-item';

    if (entry.icon) {
      const chip = document.createElement('span');
      chip.className = 'info-sheet-icon';
      chip.setAttribute('aria-hidden', 'true');
      if (entry.accent) chip.style.setProperty('--mode-accent', entry.accent);
      chip.appendChild(entry.icon);
      li.appendChild(chip);
    }

    const text = document.createElement('span');
    text.className = 'info-sheet-text';
    const label = document.createElement('span');
    label.className = 'info-sheet-label';
    label.textContent = entry.label;
    text.appendChild(label);
    const detail = document.createElement('span');
    detail.className = 'info-sheet-detail';
    detail.textContent = entry.detail;
    text.appendChild(detail);
    li.appendChild(text);

    list.appendChild(li);
  }
  sheet.appendChild(list);

  if (opts.footnote) {
    const note = document.createElement('p');
    note.className = 'info-sheet-foot';
    note.textContent = opts.footnote;
    sheet.appendChild(note);
  }

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    overlay.remove();
    removeBack();
  }

  const row = document.createElement('div');
  row.className = 'dialog-btn-row';
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'dialog-btn btn-primary';
  done.textContent = 'Got it';
  done.addEventListener('click', close);
  row.appendChild(done);
  sheet.appendChild(row);

  const removeBack = pushBack(close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}

/**
 * The (i) button itself — a quiet circle that sits beside a section title.
 * Shared so every "what is this?" in the app is the same target in the same
 * place, rather than a different-sized glyph per screen.
 */
export function buildInfoButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'info-btn';
  btn.setAttribute('aria-label', label);
  btn.appendChild(Icons.info(17));
  btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return btn;
}
