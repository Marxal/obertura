// Which book am I looking at? — the repertoire selector, and the management
// that goes with it.
//
// A repertoire is a book of one colour. Everyone starts with two, White and
// Black, and the point of allowing more is situations rather than colours: one
// for blitz, one for a tournament, one prepared for a particular opponent. So
// the control is a NAME with a chevron rather than a colour switch, and the
// sheet behind it is where books are made, renamed, put aside and removed.
//
// The selection is remembered per device. It is not part of the data — a book
// you were last looking at is a view preference, and syncing it would make one
// phone's browsing move another phone's screen.

import {
  getAllRepertoires, saveRepertoire, deleteRepertoire,
} from './storage';
import { newRepertoire, type Repertoire } from './repertoire';
import { projectRepertoire } from './lines-view';
import { requestRepertoireSlot } from './entitlement';
import { pushBack } from './back-nav';
import { showDialog } from './dialog';
import { showToast } from './toast';
import { Icons } from './icons';

const SELECTED_KEY = 'obertura.lines.book';

/** The book the user last looked at, or 'all'. */
export function selectedBookId(): string {
  try { return localStorage.getItem(SELECTED_KEY) || 'all'; } catch { return 'all'; }
}

export function setSelectedBookId(id: string): void {
  try { localStorage.setItem(SELECTED_KEY, id); } catch { /* private mode */ }
}

/** Books plus their line counts, which is all any caller here needs. */
export interface BookRow {
  book: Repertoire;
  lines: number;
}

export async function loadBookRows(): Promise<BookRow[]> {
  const books = await getAllRepertoires();
  return books.map(book => ({ book, lines: projectRepertoire(book).length }));
}

/**
 * Is this line in the selected book? Lines carry their book in their id (see
 * lines-view.makeLineId), so this needs no lookup.
 */
export function lineInBook(lineId: string, bookId: string): boolean {
  if (bookId === 'all') return true;
  return lineId.startsWith(`${bookId}::`);
}

export interface PickerOptions {
  rows: BookRow[];
  selected: string;
  onSelect: (id: string) => void;
  /** Something about the books themselves changed — re-read and repaint. */
  onChanged: () => void;
}

/**
 * The one-line control: which book, how many lines, and a way into the rest.
 * Draws nothing at all when there is only one book and nothing to choose between
 * — a picker with a single option is furniture, not a control.
 */
export function renderRepertoirePicker(host: HTMLElement, opts: PickerOptions): void {
  host.innerHTML = '';
  if (opts.rows.length <= 1) return;

  const current = opts.rows.find(r => r.book.id === opts.selected);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'book-picker';

  const name = document.createElement('span');
  name.className = 'book-picker-name';
  name.textContent = current ? current.book.name : 'All repertoires';
  btn.appendChild(name);

  const count = document.createElement('span');
  count.className = 'book-picker-count';
  const n = current ? current.lines : opts.rows.reduce((a, r) => a + r.lines, 0);
  count.textContent = n === 1 ? '1 line' : `${n} lines`;
  btn.appendChild(count);

  const chev = Icons.chevronDown(16);
  chev.classList.add('book-picker-chev');
  btn.appendChild(chev);

  btn.addEventListener('click', () => openBooksSheet(opts));
  host.appendChild(btn);
}

// ── The sheet ────────────────────────────────────────────────────────────────

export function openBooksSheet(opts: PickerOptions): void {
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet book-sheet';
  overlay.appendChild(sheet);

  const close = (): void => { overlay.remove(); removeBack(); };
  const removeBack = pushBack(close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  const title = document.createElement('h3');
  title.className = 'edit-sheet-title';
  title.textContent = 'Repertoires';
  sheet.appendChild(title);

  const list = document.createElement('div');
  list.className = 'book-list';
  sheet.appendChild(list);

  const pick = (id: string): void => { setSelectedBookId(id); opts.onSelect(id); close(); };

  // "All" first, so the way back to everything is never buried under books.
  list.appendChild(bookRow({
    label: 'All repertoires',
    note: `${opts.rows.reduce((a, r) => a + r.lines, 0)} lines`,
    active: opts.selected === 'all',
    onPick: () => pick('all'),
  }));

  for (const row of opts.rows) {
    list.appendChild(bookRow({
      label: row.book.name,
      note: `${row.book.colour === 'white' ? 'White' : 'Black'} · ${
        row.lines === 1 ? '1 line' : `${row.lines} lines`}${row.book.archived ? ' · put aside' : ''}`,
      active: opts.selected === row.book.id,
      archived: row.book.archived,
      onPick: () => pick(row.book.id),
      onManage: () => { close(); openBookManageSheet(row, opts); },
    }));
  }

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn-secondary book-add';
  add.textContent = '+ New repertoire';
  add.addEventListener('click', () => {
    void (async () => {
      if (!(await requestRepertoireSlot(opts.rows.length))) return;
      close();
      openNewBookSheet(opts);
    })();
  });
  sheet.appendChild(add);

  document.body.appendChild(overlay);
}

function bookRow(o: {
  label: string;
  note: string;
  active: boolean;
  archived?: boolean;
  onPick: () => void;
  onManage?: () => void;
}): HTMLElement {
  const row = document.createElement('div');
  row.className = `book-row${o.active ? ' is-active' : ''}${o.archived ? ' is-archived' : ''}`;

  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'book-row-pick';
  const name = document.createElement('span');
  name.className = 'book-row-name';
  name.textContent = o.label;
  const note = document.createElement('span');
  note.className = 'book-row-note';
  note.textContent = o.note;
  pick.appendChild(name);
  pick.appendChild(note);
  pick.addEventListener('click', o.onPick);
  row.appendChild(pick);

  if (o.onManage) {
    const manage = document.createElement('button');
    manage.type = 'button';
    manage.className = 'book-row-manage';
    manage.setAttribute('aria-label', `Manage ${o.label}`);
    manage.textContent = '⋯';
    manage.addEventListener('click', o.onManage);
    row.appendChild(manage);
  }
  return row;
}

// ── Making one ───────────────────────────────────────────────────────────────

function openNewBookSheet(opts: PickerOptions): void {
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet';
  overlay.appendChild(sheet);
  const close = (): void => { overlay.remove(); removeBack(); };
  const removeBack = pushBack(close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  const title = document.createElement('h3');
  title.className = 'edit-sheet-title';
  title.textContent = 'New repertoire';
  sheet.appendChild(title);

  const why = document.createElement('p');
  why.className = 'branch-sub';
  why.textContent = 'A separate book of lines — for blitz, for a tournament, or prepared for one opponent.';
  sheet.appendChild(why);

  const nameLabel = document.createElement('label');
  nameLabel.className = 'edit-label';
  nameLabel.textContent = 'Name';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'edit-input';
  nameInput.placeholder = 'e.g. Blitz — White';
  sheet.appendChild(nameLabel);
  sheet.appendChild(nameInput);

  const colourLabel = document.createElement('span');
  colourLabel.className = 'edit-label';
  colourLabel.textContent = 'The side you play';
  sheet.appendChild(colourLabel);

  let colour: 'white' | 'black' = 'white';
  const seg = document.createElement('div');
  seg.className = 'branch-seg';
  for (const c of ['white', 'black'] as const) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `branch-seg-btn${c === colour ? ' active' : ''}`;
    b.textContent = c === 'white' ? 'White' : 'Black';
    b.addEventListener('click', () => {
      colour = c;
      seg.querySelectorAll('.branch-seg-btn').forEach((el, i) =>
        el.classList.toggle('active', (i === 0) === (c === 'white')));
    });
    seg.appendChild(b);
  }
  sheet.appendChild(seg);

  const row = document.createElement('div');
  row.className = 'edit-btn-row';
  const create = document.createElement('button');
  create.type = 'button';
  create.className = 'btn-primary edit-save-btn';
  create.textContent = 'Create';
  create.addEventListener('click', () => {
    void (async () => {
      const name = nameInput.value.trim();
      const rep = newRepertoire(colour, name || undefined);
      await saveRepertoire(rep);
      setSelectedBookId(rep.id);
      close();
      showToast(`“${rep.name}” created ✓`, { variant: 'success' });
      opts.onSelect(rep.id);
      opts.onChanged();
    })();
  });
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn-secondary';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', close);
  row.appendChild(create);
  row.appendChild(cancel);
  sheet.appendChild(row);

  document.body.appendChild(overlay);
  requestAnimationFrame(() => nameInput.focus());
}

// ── Managing one ─────────────────────────────────────────────────────────────

function openBookManageSheet(row: BookRow, opts: PickerOptions): void {
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet';
  overlay.appendChild(sheet);
  const close = (): void => { overlay.remove(); removeBack(); };
  const removeBack = pushBack(close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  const title = document.createElement('h3');
  title.className = 'edit-sheet-title';
  title.textContent = row.book.name;
  sheet.appendChild(title);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'edit-input';
  nameInput.value = row.book.name;
  const nameLabel = document.createElement('label');
  nameLabel.className = 'edit-label';
  nameLabel.textContent = 'Name';
  sheet.appendChild(nameLabel);
  sheet.appendChild(nameInput);

  const actions = document.createElement('div');
  actions.className = 'branch-actions';

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn-primary';
  save.textContent = 'Save';
  save.addEventListener('click', () => {
    void (async () => {
      const name = nameInput.value.trim();
      if (name && name !== row.book.name) {
        row.book.name = name;
        await saveRepertoire(row.book);
      }
      close();
      opts.onChanged();
    })();
  });
  actions.appendChild(save);

  // Putting a book aside takes it out of training without touching a single
  // line — which is the whole reason archiving beats pausing twenty lines.
  const archive = document.createElement('button');
  archive.type = 'button';
  archive.className = 'btn-secondary';
  archive.textContent = row.book.archived ? 'Bring it back' : 'Put it aside';
  archive.addEventListener('click', () => {
    void (async () => {
      if (row.book.archived) delete row.book.archived;
      else row.book.archived = true;
      await saveRepertoire(row.book);
      close();
      showToast(row.book.archived
        ? `“${row.book.name}” put aside — its lines are out of training`
        : `“${row.book.name}” is back in training`);
      opts.onChanged();
    })();
  });
  actions.appendChild(archive);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn-danger';
  remove.textContent = 'Delete repertoire';
  remove.addEventListener('click', () => {
    showDialog({
      title: `Delete “${row.book.name}”?`,
      body: `All ${row.lines === 1 ? 'of its 1 line' : `${row.lines} of its lines`} and their `
        + `review history go with it. This can’t be undone — put it aside instead if you `
        + `might want it back.`,
      buttons: [
        {
          label: 'Delete', variant: 'danger', onClick: () => {
            void (async () => {
              await deleteRepertoire(row.book.id);
              if (selectedBookId() === row.book.id) setSelectedBookId('all');
              close();
              showToast(`“${row.book.name}” deleted`);
              opts.onSelect('all');
              opts.onChanged();
            })();
          },
        },
        { label: 'Cancel', variant: 'secondary' },
      ],
    });
  });
  actions.appendChild(remove);

  sheet.appendChild(actions);
  document.body.appendChild(overlay);
}
