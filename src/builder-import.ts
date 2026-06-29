// The builder's "Import a game" popup, opened from the import icon next to Flip
// in the bottom bar. Three ways to get a game onto the board:
//
//   a) Import my last game  — the single newest game from the connected account
//                             (saved with my games, deduped), opened on the board.
//   b) Browse my last games — a list of my last 10 games (with who I played and
//                             the result); tap one to load it on the board.
//   c) Paste PGN            — paste PGN text or pick a .pgn file; the mainline is
//                             parsed and opened on the board.
//
// Loading a game just seeds the builder via `onLoadGame` — the caller decides
// what that means (it reuses buildFromUcis, so a Save makes a new line from it).

import { Chess } from 'chess.js';
import { pushBack } from './back-nav';
import { Icons } from './icons';
import { showToast } from './toast';
import { connectedAccount, importLastGame } from './import-last';
import { importGames, type ImportedGame } from './import-games';

export interface BuilderImportDeps {
  // Seed the builder with a move list, oriented to `colour`, with an optional
  // hint (e.g. "vs alice") shown under the title. `gameId` is the stored game's
  // id when there is one (last game / browse), so a later save can attach its
  // analysis; a pasted PGN has none.
  onLoadGame: (ucis: string[], colour: 'white' | 'black', description?: string, gameId?: string) => void;
  // A game just landed in storage (import-last saves it) — refresh the slides.
  onGamesChanged: () => void;
}

const PLATFORM_LABEL = { chesscom: 'Chess.com', lichess: 'Lichess' } as const;

export function openBuilderImport(deps: BuilderImportDeps): void {
  const account = connectedAccount();

  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet bimport-sheet';

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    overlay.remove();
    removeBack();
  }
  const removeBack = pushBack(close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  const title = document.createElement('h3');
  title.className = 'edit-sheet-title';
  title.textContent = 'Import a game';
  sheet.appendChild(title);

  // The body is swapped between the menu and the "browse" list in place, so the
  // sheet keeps its position while you drill in and out.
  const body = document.createElement('div');
  body.className = 'bimport-body';
  sheet.appendChild(body);

  // Seed the builder and dismiss the sheet.
  const load = (ucis: string[], colour: 'white' | 'black', description?: string, gameId?: string): void => {
    if (!ucis.length) { showToast('No moves found to load.'); return; }
    close();
    deps.onLoadGame(ucis, colour, description, gameId);
  };

  // ── a) Import my last game ──────────────────────────────────────────────────
  async function runLastGame(btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true;
    showToast('Fetching your last game…');
    try {
      const game = await importLastGame();
      if (!game) { showToast('No recent game found to import.'); btn.disabled = false; return; }
      deps.onGamesChanged();
      load(game.ucis, game.colour, `vs ${game.opponent}`, game.id);
    } catch {
      showToast('Couldn’t reach your account — check your connection.');
      btn.disabled = false;
    }
  }

  // ── b) Browse my last 10 games ──────────────────────────────────────────────
  async function showBrowse(): Promise<void> {
    if (!account) return;
    body.innerHTML = '';
    const back = backLink(() => renderMenu());
    body.appendChild(back);
    const loading = document.createElement('p');
    loading.className = 'bimport-note';
    loading.textContent = 'Loading your last games…';
    body.appendChild(loading);

    let games: ImportedGame[] = [];
    try {
      const result = await importGames(account.platform, account.username, { months: 12, maxGames: 10 });
      games = result.games;
    } catch {
      loading.textContent = 'Couldn’t reach your account — check your connection.';
      return;
    }
    if (closed) return;
    loading.remove();
    if (!games.length) {
      const none = document.createElement('p');
      none.className = 'bimport-note';
      none.textContent = 'No recent games found.';
      body.appendChild(none);
      return;
    }
    const list = document.createElement('div');
    list.className = 'bimport-game-list';
    for (const g of games) list.appendChild(gameRow(g));
    body.appendChild(list);
  }

  function gameRow(g: ImportedGame): HTMLElement {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'bimport-game';
    row.addEventListener('click', () => load(g.ucis, g.colour, `vs ${g.opponent}`, g.id));

    const pip = document.createElement('span');
    pip.className = `colour-pip colour-pip--${g.colour}`;
    pip.setAttribute('aria-hidden', 'true');
    row.appendChild(pip);

    const text = document.createElement('span');
    text.className = 'bimport-game-text';
    const name = document.createElement('span');
    name.className = 'bimport-game-name';
    name.textContent = `vs ${g.opponent}`;
    text.appendChild(name);
    const sub = document.createElement('span');
    sub.className = 'bimport-game-sub';
    sub.textContent = `${RESULT_LABEL[g.result]} · ${g.timeClass}`;
    text.appendChild(sub);
    row.appendChild(text);

    const chev = Icons.chevronRight(18);
    chev.classList.add('bimport-game-chev');
    row.appendChild(chev);
    return row;
  }

  // ── c) Paste PGN ────────────────────────────────────────────────────────────
  function showPgn(): void {
    body.innerHTML = '';
    body.appendChild(backLink(() => renderMenu()));

    const area = document.createElement('textarea');
    area.className = 'bimport-pgn';
    area.rows = 6;
    area.placeholder = 'Paste PGN here…';
    body.appendChild(area);

    const fileRow = document.createElement('label');
    fileRow.className = 'bimport-file';
    fileRow.appendChild(Icons.upload(16));
    fileRow.appendChild(document.createTextNode('…or choose a .pgn file'));
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = '.pgn,.txt,application/x-chess-pgn,text/plain';
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (!f) return;
      f.text().then(txt => { area.value = txt; loadFromPgn(area.value); }).catch(() => {
        showToast('Couldn’t read that file.');
      });
    });
    fileRow.appendChild(file);
    body.appendChild(fileRow);

    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'btn-primary bimport-pgn-go';
    go.textContent = 'Open game';
    go.addEventListener('click', () => loadFromPgn(area.value));
    body.appendChild(go);
  }

  function loadFromPgn(pgn: string): void {
    const moves = pgnToMoves(pgn);
    if (!moves) { showToast('Couldn’t read that PGN.'); return; }
    // A pasted game has no "me" — orient to White and let the user flip.
    load(moves, 'white');
  }

  // ── The menu ────────────────────────────────────────────────────────────────
  function renderMenu(): void {
    body.innerHTML = '';

    if (account) {
      body.appendChild(menuOption(
        Icons.download(20), 'Import my last game',
        `The newest game on ${PLATFORM_LABEL[account.platform]}`,
        btn => { void runLastGame(btn); },
      ));
      body.appendChild(menuOption(
        Icons.list(20), 'Browse my last games',
        `Pick from your recent ${PLATFORM_LABEL[account.platform]} games`,
        () => { void showBrowse(); },
      ));
    } else {
      const note = document.createElement('p');
      note.className = 'bimport-note';
      note.textContent = 'Connect an account in My games to import your own games.';
      body.appendChild(note);
    }

    body.appendChild(menuOption(
      Icons.note(20), 'Paste PGN',
      'Paste PGN text or choose a .pgn file',
      () => showPgn(),
    ));
  }

  function menuOption(
    icon: SVGElement, label: string, sub: string, onClick: (btn: HTMLButtonElement) => void,
  ): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bimport-option';
    icon.classList.add('bimport-option-icon');
    btn.appendChild(icon);
    const text = document.createElement('span');
    text.className = 'bimport-option-text';
    const l = document.createElement('span');
    l.className = 'bimport-option-label';
    l.textContent = label;
    text.appendChild(l);
    const s = document.createElement('span');
    s.className = 'bimport-option-sub';
    s.textContent = sub;
    text.appendChild(s);
    btn.appendChild(text);
    btn.addEventListener('click', () => onClick(btn));
    return btn;
  }

  function backLink(onClick: () => void): HTMLElement {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'bimport-back';
    back.appendChild(span('bimport-back-arrow', '‹'));
    back.appendChild(document.createTextNode(' Import options'));
    back.addEventListener('click', onClick);
    return back;
  }

  renderMenu();
  document.body.appendChild(overlay);
  overlay.appendChild(sheet);
}

const RESULT_LABEL: Record<ImportedGame['result'], string> = {
  win: 'Won', draw: 'Drew', loss: 'Lost',
};

// Parse a PGN's mainline into a UCI list (chess.js `lan` is UCI), or null when
// it can't be read or holds no moves. strict:false tolerates clock comments and
// header quirks, matching the importer.
function pgnToMoves(pgn: string): string[] | null {
  if (!pgn.trim()) return null;
  const ch = new Chess();
  try { ch.loadPgn(pgn, { strict: false }); } catch { return null; }
  const verbose = ch.history({ verbose: true });
  if (!verbose.length) return null;
  return verbose.map(m => m.lan);
}

function span(cls: string, text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}
