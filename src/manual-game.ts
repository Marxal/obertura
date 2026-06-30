// "Add a game" — a manual entry form for My games, next to the importer. Logs a
// game you played off-platform (an OTB tournament round, a friendly) without
// fetching: date, both players, which side you were, the result, a tournament
// name (stored as a tag) and any extra tags. An optional PGN paste fills in the
// moves so the manual game opens and analyses just like an imported one; left
// empty, it's a pure record (the card shows the start position).
//
// Reuses the builder's bottom-sheet look (edit-overlay / edit-sheet) and the
// segmented-control styling (seg-control / seg-btn).

import { Chess } from 'chess.js';
import { pushBack } from './back-nav';
import { showToast } from './toast';
import { saveGames } from './storage';
import { connectedAccount } from './import-last';
import type { ImportedGame, GameResult } from './import-core';

export interface AddGameOptions {
  // Run after a game is saved so the My-games list can re-render.
  onAdded: () => void;
}

// A YYYY-MM-DD string for today, for the date input's default.
function todayInputValue(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Parse a YYYY-MM-DD date input into unix seconds at local noon (noon avoids the
// date slipping a day across time zones). Falls back to now on a blank/bad value.
function dateToEndTime(value: string): number {
  const ms = Date.parse(`${value}T12:00:00`);
  return Number.isFinite(ms) ? Math.round(ms / 1000) : Math.round(Date.now() / 1000);
}

export function openAddGameForm(opts: AddGameOptions): void {
  const me = connectedAccount()?.username ?? '';

  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet manual-game-sheet';

  // Lift the sheet above the on-screen keyboard while a field is focused.
  const vv = window.visualViewport;
  function syncKeyboardInset(): void {
    if (!vv) return;
    overlay.style.paddingBottom = `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`;
  }
  vv?.addEventListener('resize', syncKeyboardInset);
  vv?.addEventListener('scroll', syncKeyboardInset);

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    vv?.removeEventListener('resize', syncKeyboardInset);
    vv?.removeEventListener('scroll', syncKeyboardInset);
    overlay.remove();
    removeBack();
  }
  const removeBack = pushBack(close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const title = document.createElement('h3');
  title.className = 'edit-sheet-title';
  title.textContent = 'Add a game';
  sheet.appendChild(title);

  // ── Date ──
  sheet.appendChild(fieldLabel('Date'));
  const date = document.createElement('input');
  date.type = 'date';
  date.className = 'edit-input';
  date.value = todayInputValue();
  sheet.appendChild(date);

  // Which side the user played — drives colour + perspective. The "Me" buttons
  // next to each name set both the name field and this toggle.
  let colour: 'white' | 'black' = 'white';

  // ── White / Black, each with a "Me" shortcut ──
  const whiteInput = document.createElement('input');
  const blackInput = document.createElement('input');

  const youSeg = document.createElement('div');
  youSeg.className = 'seg-control';
  youSeg.setAttribute('role', 'group');
  const youButtons: HTMLButtonElement[] = [];
  const reflectYou = (): void => {
    for (const b of youButtons) {
      const on = b.dataset.value === colour;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  };

  sheet.appendChild(fieldLabel('White'));
  sheet.appendChild(playerRow(whiteInput, 'White player', me, () => {
    whiteInput.value = me;
    colour = 'white';
    reflectYou();
  }, me !== ''));

  sheet.appendChild(fieldLabel('Black'));
  sheet.appendChild(playerRow(blackInput, 'Black player', me, () => {
    blackInput.value = me;
    colour = 'black';
    reflectYou();
  }, me !== ''));

  // ── You played as ──
  sheet.appendChild(fieldLabel('You played as'));
  for (const c of ['white', 'black'] as const) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg-btn';
    b.dataset.value = c;
    b.textContent = c === 'white' ? 'White' : 'Black';
    b.addEventListener('click', () => { colour = c; reflectYou(); });
    youButtons.push(b);
    youSeg.appendChild(b);
  }
  reflectYou();
  sheet.appendChild(youSeg);

  // ── Result (your perspective) ──
  let result: GameResult = 'win';
  sheet.appendChild(fieldLabel('Result'));
  const resultSeg = document.createElement('div');
  resultSeg.className = 'seg-control';
  resultSeg.setAttribute('role', 'group');
  const resultButtons: HTMLButtonElement[] = [];
  const reflectResult = (): void => {
    for (const b of resultButtons) {
      const on = b.dataset.value === result;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  };
  for (const [value, label] of [['win', 'Won'], ['draw', 'Drew'], ['loss', 'Lost']] as const) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg-btn';
    b.dataset.value = value;
    b.textContent = label;
    b.addEventListener('click', () => { result = value; reflectResult(); });
    resultButtons.push(b);
    resultSeg.appendChild(b);
  }
  reflectResult();
  sheet.appendChild(resultSeg);

  // ── Tournament (stored as a tag) ──
  sheet.appendChild(fieldLabel('Tournament (optional)'));
  const tournament = document.createElement('input');
  tournament.type = 'text';
  tournament.className = 'edit-input';
  tournament.placeholder = 'Shown as a tag';
  sheet.appendChild(tournament);

  // ── Extra tags ──
  sheet.appendChild(fieldLabel('Tags (optional)'));
  const tags = document.createElement('input');
  tags.type = 'text';
  tags.className = 'edit-input';
  tags.placeholder = 'Comma-separated';
  sheet.appendChild(tags);

  // ── Optional PGN ──
  sheet.appendChild(fieldLabel('Moves / PGN (optional)'));
  const pgn = document.createElement('textarea');
  pgn.className = 'edit-input manual-game-pgn';
  pgn.rows = 3;
  pgn.placeholder = 'Paste the game so it opens in the analyser';
  sheet.appendChild(pgn);
  // A friendly touch: when a PGN with headers is pasted, fill in any empty
  // name/date fields from it.
  pgn.addEventListener('change', () => {
    if (!pgn.value.trim()) return;
    try {
      const ch = new Chess();
      ch.loadPgn(pgn.value, { strict: false });
      const h = ch.getHeaders();
      if (!whiteInput.value && h.White) whiteInput.value = h.White;
      if (!blackInput.value && h.Black) blackInput.value = h.Black;
      if (h.Date && /^\d{4}\.\d{2}\.\d{2}$/.test(h.Date)) date.value = h.Date.replace(/\./g, '-');
    } catch { /* not parseable yet — leave fields be */ }
  });

  // ── Status line ──
  const status = document.createElement('p');
  status.className = 'settings-note';
  status.setAttribute('aria-live', 'polite');

  // ── Actions ──
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn-primary';
  addBtn.textContent = 'Add game';
  addBtn.addEventListener('click', () => {
    const white = whiteInput.value.trim();
    const black = blackInput.value.trim();
    if (!white || !black) {
      status.textContent = 'Add both players first.';
      return;
    }

    // Optional PGN → moves. A bad paste blocks the save with a clear message.
    let sans: string[] = [];
    let ucis: string[] = [];
    let eco: string | null = null;
    let opening: string | null = null;
    const pgnText = pgn.value.trim();
    if (pgnText) {
      const ch = new Chess();
      try {
        ch.loadPgn(pgnText, { strict: false });
      } catch {
        status.textContent = 'Couldn’t read those moves — check the PGN.';
        return;
      }
      const verbose = ch.history({ verbose: true });
      if (verbose.length === 0) {
        status.textContent = 'Those moves are empty — check the PGN.';
        return;
      }
      sans = verbose.map((m) => m.san);
      ucis = verbose.map((m) => m.lan); // chess.js `lan` is UCI ("e2e4")
      const h = ch.getHeaders();
      eco = h.ECO ?? null;
      opening = h.Opening ?? null;
    }

    const tagList = [tournament.value, ...tags.value.split(',')]
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const game: ImportedGame = {
      id: `manual-${Date.now()}`,
      url: '',
      endTime: dateToEndTime(date.value),
      timeClass: 'daily',
      timeControl: '-',
      rated: false,
      colour,
      result,
      opponent: colour === 'white' ? black : white,
      eco,
      opening,
      sans,
      ucis,
      plyCount: sans.length,
      ...(tagList.length ? { tags: tagList } : {}),
    };

    void saveGames([game]).then(() => {
      showToast('Game added ✓', { variant: 'success' });
      close();
      opts.onAdded();
    });
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', close);

  const actions = document.createElement('div');
  actions.className = 'manual-game-actions';
  actions.append(addBtn, cancelBtn);
  sheet.append(status, actions);

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  date.focus();
}

function fieldLabel(text: string): HTMLLabelElement {
  const l = document.createElement('label');
  l.className = 'edit-label';
  l.textContent = text;
  return l;
}

// A name input with a quiet "Me" button that fills it with your saved username
// (hidden when no account is connected).
function playerRow(
  input: HTMLInputElement,
  placeholder: string,
  me: string,
  onMe: () => void,
  showMe: boolean,
): HTMLElement {
  input.type = 'text';
  input.className = 'edit-input manual-game-name';
  input.placeholder = placeholder;

  const row = document.createElement('div');
  row.className = 'manual-game-player';
  row.appendChild(input);

  if (showMe) {
    const meBtn = document.createElement('button');
    meBtn.type = 'button';
    meBtn.className = 'manual-game-me';
    meBtn.textContent = 'Me';
    meBtn.title = `Use ${me}`;
    meBtn.addEventListener('click', onMe);
    row.appendChild(meBtn);
  }
  return row;
}
