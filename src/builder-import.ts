// The builder's "Import a game" popup, opened from the import icon next to Flip
// in the bottom bar. Five ways to get a game in:
//
//   a) Import my last game  — the single newest game from the connected account
//                             (saved with my games, deduped), opened on the board.
//   b) Browse my last games — a list of my last 10 games (with who I played and
//                             the result); tap one to load it on the board.
//   c) Paste PGN            — paste PGN text or pick a .pgn file; the mainline is
//                             parsed (comments become move notes) and opened on
//                             the board. A pasted Lichess study link, or a PGN
//                             holding several games, routes to the chapter list.
//   d) Lichess study        — paste a study link; each chapter becomes a line
//                             (author comments preserved as move notes), saved
//                             straight to My Lines.
//   e) Add a game manually   — hands off to the manual-entry form (manual-game.ts)
//                             for an OTB game or one played without a connected
//                             account; it saves straight to My games rather than
//                             opening the board.
//
// Loading a game just seeds the builder via `onLoadGame` — the caller decides
// what that means (it reuses buildFromUcis, so a Save makes a new line from it).

import { pushBack } from './back-nav';
import { Icons } from './icons';
import { showToast } from './toast';
import { connectedAccount, importLastGame } from './import-last';
import { importGames, type ImportedGame } from './import-games';
import { openAddGameForm } from './manual-game';
import {
  parseStudyUrl, parseAnnotatedPgn, parseStudyPgn, fetchStudyPgn, studyNameFromPgn,
  type StudyChapter,
} from './study-import';
import { renderChapterList } from './study-sheet';
import type { LineSeed } from './onboarding-starter';
import { t } from './i18n';

export interface BuilderImportDeps {
  // Seed the builder with a move list, oriented to `colour`, with an optional
  // hint (e.g. "vs alice") shown under the title. `gameId` is the stored game's
  // id when there is one (last game / browse), so a later save can attach its
  // analysis; a pasted PGN has none. `notes` carries PGN comments per ply.
  onLoadGame: (
    ucis: string[], colour: 'white' | 'black', description?: string,
    gameId?: string, endTime?: number, notes?: Record<number, string>,
  ) => void;
  // A game just landed in storage (import-last saves it) — refresh the slides.
  onGamesChanged: () => void;
  // A game was added manually (no board opened) — refresh whatever list is
  // showing (e.g. My games). Optional: only the My-games caller needs it.
  onManualAdd?: () => void;
  // Save a batch of lines (study chapters) straight to My Lines, oriented to
  // `colour`. Resolves with how many were saved. Optional: without it the
  // study option is hidden.
  onSaveLines?: (seeds: LineSeed[], colour: 'white' | 'black') => Promise<number>;
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
  title.textContent = t('games.importAGame');
  sheet.appendChild(title);

  // The body is swapped between the menu and the "browse" list in place, so the
  // sheet keeps its position while you drill in and out.
  const body = document.createElement('div');
  body.className = 'bimport-body';
  sheet.appendChild(body);

  // Seed the builder and dismiss the sheet.
  const load = (
    ucis: string[], colour: 'white' | 'black', description?: string,
    gameId?: string, endTime?: number, notes?: Record<number, string>,
  ): void => {
    if (!ucis.length) { showToast(t('builder.noMovesFoundTo')); return; }
    close();
    deps.onLoadGame(ucis, colour, description, gameId, endTime, notes);
  };

  // ── a) Import my last game ──────────────────────────────────────────────────
  async function runLastGame(btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true;
    showToast(t('builder.fetchingYourLastGame'));
    try {
      const game = await importLastGame();
      if (!game) { showToast(t('builder.noRecentGameFound')); btn.disabled = false; return; }
      deps.onGamesChanged();
      load(game.ucis, game.colour, `vs ${game.opponent}`, game.id, game.endTime);
    } catch {
      showToast(t('builder.couldnTReachYour'));
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
    loading.textContent = t('builder.loadingYourLastGames');
    body.appendChild(loading);

    let games: ImportedGame[] = [];
    try {
      const result = await importGames(account.platform, account.username, { months: 12, maxGames: 10 });
      games = result.games;
    } catch {
      loading.textContent = t('builder.couldnTReachYour');
      return;
    }
    if (closed) return;
    loading.remove();
    if (!games.length) {
      const none = document.createElement('p');
      none.className = 'bimport-note';
      none.textContent = t('builder.noRecentGamesFound');
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
    row.addEventListener('click', () => load(g.ucis, g.colour, `vs ${g.opponent}`, g.id, g.endTime));

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
    area.placeholder = t('builder.pastePgnHere');
    body.appendChild(area);

    const fileRow = document.createElement('label');
    fileRow.className = 'bimport-file';
    fileRow.appendChild(Icons.upload(16));
    fileRow.appendChild(document.createTextNode(t('builder.orChooseAPgn')));
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = '.pgn,.txt,application/x-chess-pgn,text/plain';
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (!f) return;
      f.text().then(txt => { area.value = txt; loadFromPgn(area.value); }).catch(() => {
        showToast(t('builder.couldnTReadThat'));
      });
    });
    fileRow.appendChild(file);
    body.appendChild(fileRow);

    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'btn-primary bimport-pgn-go';
    go.textContent = t('builder.openGame');
    go.addEventListener('click', () => loadFromPgn(area.value));
    body.appendChild(go);
  }

  function loadFromPgn(pgn: string): void {
    // A pasted Lichess study link routes to the study flow.
    if (deps.onSaveLines && parseStudyUrl(pgn)) { showStudy(pgn.trim()); return; }
    // A PGN holding several games (e.g. a downloaded study) → chapter list.
    const chapters = parseStudyPgn(pgn);
    if (chapters.length > 1 && deps.onSaveLines) {
      showChapters(chapters, studyNameFromPgn(pgn), () => showPgn());
      return;
    }
    const game = parseAnnotatedPgn(pgn);
    if (!game) { showToast(t('builder.couldnTReadThatPgn')); return; }
    // A pasted game has no "me" — orient to White and let the user flip.
    load(game.ucis, 'white', undefined, undefined, undefined, game.notes);
  }

  // ── d) Import a Lichess study ───────────────────────────────────────────────
  function showStudy(prefill?: string): void {
    body.innerHTML = '';
    body.appendChild(backLink(() => renderMenu()));

    const hint = document.createElement('p');
    hint.className = 'bimport-note';
    hint.textContent = t('builder.pasteAPublicLichess');
    body.appendChild(hint);

    const input = document.createElement('input');
    input.type = 'url';
    input.className = 'bimport-pgn bimport-study-url';
    input.placeholder = 'https://lichess.org/study/…';
    if (prefill) input.value = prefill;
    body.appendChild(input);

    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'btn-primary bimport-pgn-go';
    go.textContent = t('builder.fetchStudy');
    go.addEventListener('click', () => { void fetchAndList(); });
    body.appendChild(go);

    async function fetchAndList(): Promise<void> {
      const ref = parseStudyUrl(input.value);
      if (!ref) { showToast(t('builder.thatDoesnTLook')); return; }
      go.disabled = true;
      go.textContent = t('builder.fetching');
      try {
        const pgn = await fetchStudyPgn(ref);
        const chapters = parseStudyPgn(pgn);
        if (closed) return;
        if (!chapters.length) { showToast(t('builder.noReadableChaptersIn')); return; }
        showChapters(chapters, studyNameFromPgn(pgn), () => showStudy(input.value));
      } catch (e) {
        showToast(e instanceof Error ? e.message : t('builder.couldnTFetchThat'));
      } finally {
        go.disabled = false;
        go.textContent = t('builder.fetchStudy');
      }
    }

    if (prefill) void fetchAndList();
  }

  // The fetched study's chapters — the shared chapter list (study-sheet.ts):
  // colour picker, intro comments up top, per-chapter save + save-all, lines
  // tagged with the study's title. Lines land in My Lines un-enrolled —
  // training stays opt-in via the normal flow.
  function showChapters(chapters: StudyChapter[], studyName: string | null, onBack: () => void): void {
    body.innerHTML = '';
    body.appendChild(backLink(onBack));
    renderChapterList(body, {
      chapters,
      studyName,
      onSaveLines: deps.onSaveLines!,
      onAllSaved: close,
    });
  }

  // ── The menu ────────────────────────────────────────────────────────────────
  function renderMenu(): void {
    body.innerHTML = '';

    if (account) {
      body.appendChild(menuOption(
        Icons.download(20), t('builder.importMyLastGame'),
        t('builder.theNewestGameOn', { site: PLATFORM_LABEL[account.platform] }),
        btn => { void runLastGame(btn); },
      ));
      body.appendChild(menuOption(
        Icons.list(20), t('builder.browseMyLastGames'),
        t('builder.pickFromYourRecent', { site: PLATFORM_LABEL[account.platform] }),
        () => { void showBrowse(); },
      ));
    } else {
      const note = document.createElement('p');
      note.className = 'bimport-note';
      note.textContent = t('builder.connectAnAccountIn');
      body.appendChild(note);
    }

    body.appendChild(menuOption(
      Icons.note(20), t('builder.pastePgn'),
      t('builder.pastePgnTextOr'),
      () => showPgn(),
    ));

    if (deps.onSaveLines) {
      body.appendChild(menuOption(
        Icons.link(20), t('builder.importALichessStudy'),
        t('builder.eachChapterBecomesA'),
        () => showStudy(),
      ));
    }

    body.appendChild(menuOption(
      Icons.plus(20), t('builder.addAGameManually'),
      t('builder.logAnOtbGame'),
      () => {
        close();
        openAddGameForm({ onAdded: () => deps.onManualAdd?.() });
      },
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
    back.appendChild(document.createTextNode(t('builder.importOptions')));
    back.addEventListener('click', onClick);
    return back;
  }

  renderMenu();
  document.body.appendChild(overlay);
  overlay.appendChild(sheet);
}

const RESULT_LABEL: Record<ImportedGame['result'], string> = {
  win: t('showcase.won'), draw: t('showcase.drew'), loss: t('showcase.lost'),
};

function span(cls: string, text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}
