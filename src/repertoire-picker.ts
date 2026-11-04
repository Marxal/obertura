// Repertoires: making them, naming them, putting them aside, removing them —
// and choosing which one new lines are filed into.
//
// A repertoire is a book of one colour. Everyone starts with two, White and
// Black, and that is all most people ever need. The point of allowing more is
// SITUATIONS rather than colours: one for blitz, one for a tournament, one
// prepared for a particular opponent.
//
// WHERE THIS LIVES, AND WHY IT MOVED. It used to be a picker at the top of My
// Lines, above the filter bar — a control on the busiest screen in the app,
// asking a question ("which book?") that the overwhelming majority of users
// never have a second answer to. Worse, its answer HID lines: pick the White
// book and half your repertoire disappears, which on a screen called My Lines
// reads as data loss. It is a setup decision, so it is a setting now
// (settings-screen.ts's Repertoires group). My Lines shows every line, always,
// and the colour segment — which people do use — is what narrows it.
//
// The selection is remembered per device. It is not part of the data — where a
// device files new lines is a local preference, and syncing it would make one
// phone's choice move another phone's work.

import {
  getAllRepertoires, saveRepertoire, deleteRepertoire,
} from './storage';
import { newRepertoire, type Repertoire } from './repertoire';
import { projectRepertoire } from './lines-view';
import { requestRepertoireSlot } from './entitlement';
import { pushBack } from './back-nav';
import { showDialog } from './dialog';
import { showToast } from './toast';
import { t } from './i18n';

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
 * The Repertoires body, for Settings: what you have, and what can be done with
 * each. Rendered into `host`, which the caller owns and which this replaces
 * wholesale on every change.
 *
 * "Which book new lines go into" is offered only once there are more than the
 * two defaults. With exactly White and Black the question has no second answer —
 * the colour you are building decides — and a control whose only setting is its
 * default is furniture.
 */
export function renderRepertoireManager(host: HTMLElement, opts: PickerOptions): void {
  host.replaceChildren();

  const list = document.createElement('div');
  list.className = 'book-list';
  host.appendChild(list);

  // More than the two defaults means the filing choice is real, so "All" (file
  // by colour) leads the list as the way back to not choosing.
  const choosable = opts.rows.length > 2;
  if (choosable) {
    list.appendChild(bookRow({
      label: t('repertoire.byColour'),
      note: t('repertoire.newLinesGoTo'),
      active: opts.selected === 'all',
      onPick: () => { setSelectedBookId('all'); opts.onSelect('all'); },
    }));
  }

  for (const row of opts.rows) {
    list.appendChild(bookRow({
      label: row.book.name,
      note: `${t(row.book.colour === 'white' ? 'common.white' : 'common.black')} · ${
        t('starter.lines', { n: row.lines })}${row.book.archived ? ` · ${t('repertoire.putAside')}` : ''}`,
      active: choosable && opts.selected === row.book.id,
      archived: row.book.archived,
      // With only the two defaults there is nothing to pick BETWEEN, so the row
      // is a way into managing that book rather than a radio button.
      onPick: choosable
        ? () => { setSelectedBookId(row.book.id); opts.onSelect(row.book.id); }
        : () => openBookManageSheet(row, opts),
      onManage: () => openBookManageSheet(row, opts),
    }));
  }

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn-secondary book-add';
  add.textContent = t('repertoire.newRepertoire');
  add.addEventListener('click', () => {
    void (async () => {
      if (!(await requestRepertoireSlot(opts.rows.length))) return;
      openNewBookSheet(opts);
    })();
  });
  host.appendChild(add);
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
    manage.setAttribute('aria-label', t('repertoire.manage', { label: o.label }));
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
  title.textContent = t('repertoire.newRepertoire13');
  sheet.appendChild(title);

  const why = document.createElement('p');
  why.className = 'branch-sub';
  why.textContent = t('repertoire.aSeparateBookOf');
  sheet.appendChild(why);

  const nameLabel = document.createElement('label');
  nameLabel.className = 'edit-label';
  nameLabel.textContent = t('repertoire.name');
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'edit-input';
  nameInput.placeholder = t('repertoire.eGBlitzWhite');
  sheet.appendChild(nameLabel);
  sheet.appendChild(nameInput);

  const colourLabel = document.createElement('span');
  colourLabel.className = 'edit-label';
  colourLabel.textContent = t('repertoire.theSideYouPlay');
  sheet.appendChild(colourLabel);

  let colour: 'white' | 'black' = 'white';
  const seg = document.createElement('div');
  seg.className = 'branch-seg';
  for (const c of ['white', 'black'] as const) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `branch-seg-btn${c === colour ? ' active' : ''}`;
    b.textContent = c === 'white' ? t('common.white') : t('common.black');
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
  create.textContent = t('repertoire.create');
  create.addEventListener('click', () => {
    void (async () => {
      const name = nameInput.value.trim();
      const rep = newRepertoire(colour, name || undefined);
      await saveRepertoire(rep);
      setSelectedBookId(rep.id);
      close();
      showToast(t('repertoire.created', { name: rep.name }), { variant: 'success' });
      opts.onSelect(rep.id);
      opts.onChanged();
    })();
  });
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn-secondary';
  cancel.textContent = t('common.cancel');
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
  nameLabel.textContent = t('repertoire.name');
  sheet.appendChild(nameLabel);
  sheet.appendChild(nameInput);

  const actions = document.createElement('div');
  actions.className = 'branch-actions';

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn-primary';
  save.textContent = t('repertoire.save');
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
  archive.textContent = row.book.archived ? t('repertoire.bringItBack') : t('repertoire.putItAside');
  archive.addEventListener('click', () => {
    void (async () => {
      if (row.book.archived) delete row.book.archived;
      else row.book.archived = true;
      await saveRepertoire(row.book);
      close();
      showToast(row.book.archived
        ? t('repertoire.putAsideItsLines', { name: row.book.name })
        : t('repertoire.isBackInTraining', { name: row.book.name }));
      opts.onChanged();
    })();
  });
  actions.appendChild(archive);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn-danger';
  remove.textContent = t('repertoire.deleteRepertoire');
  remove.addEventListener('click', () => {
    showDialog({
      title: t('repertoire.delete', { name: row.book.name }),
      body: t('repertoire.deleteBody', { n: row.lines }),
      buttons: [
        {
          label: t('repertoire.delete13'), variant: 'danger', onClick: () => {
            void (async () => {
              await deleteRepertoire(row.book.id);
              if (selectedBookId() === row.book.id) setSelectedBookId('all');
              close();
              showToast(t('repertoire.deleted', { name: row.book.name }));
              opts.onSelect('all');
              opts.onChanged();
            })();
          },
        },
        { label: t('common.cancel'), variant: 'secondary' },
      ],
    });
  });
  actions.appendChild(remove);

  sheet.appendChild(actions);
  document.body.appendChild(overlay);
}
