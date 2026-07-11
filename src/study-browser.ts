// The Packs tab's "Lichess studies" section: browse popular opening studies
// without leaving the app, and import any of them as lines. Two ways in:
//
//   • Search — an offline search over the bundled study index (title, author,
//     opening family). Lichess has no CORS-enabled study-search API, so the
//     index is assembled at build time (scripts/build-study-index.mjs) from
//     the most-liked studies per opening family — the same bundled-table
//     pattern as the openings dataset. Any study NOT in the index can still
//     be imported by pasting its link in the board's Import menu.
//   • Recommended — the same index ranked against your repertoire and your
//     imported games' openings (study-catalog.ts), so the picks follow what
//     you actually play.
//
// Importing fetches the study's PGN live (the /api/study endpoint IS
// CORS-enabled) and opens the shared chapter sheet: chapters save as lines,
// tagged with the study's shortened title so they group in My Lines.

import type { Line } from './types';
import type { ImportedGame } from './chesscom';
import type { LineSeed } from './onboarding-starter';
import { Icons } from './icons';
import { compactCount } from './builder-panels';
import { showToast } from './toast';
import { pushBack } from './back-nav';
import { fetchStudyPgn, parseStudyPgn } from './study-import';
import { renderChapterList } from './study-sheet';
import {
  loadStudyIndex, buildStudyProfile, recommendStudies, searchStudyIndex,
  type StudyIndexEntry,
} from './study-catalog';

export interface StudyBrowserDeps {
  lines: Line[];
  games: ImportedGame[];
  // Save chapter seeds to My Lines; resolves with how many were saved.
  onSaveLines: (seeds: LineSeed[], colour: 'white' | 'black') => Promise<number>;
}

// How many studies each view shows.
const RECOMMEND_CAP = 6;
const SEARCH_CAP = 12;

export function buildStudySection(deps: StudyBrowserDeps): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'study-browser';

  const desc = document.createElement('p');
  desc.className = 'section-desc';
  desc.textContent =
    'Popular Lichess studies — import one and its chapters become lines, grouped under the study’s name.';
  wrap.appendChild(desc);

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'study-search';
  search.placeholder = 'Search studies — “Caro-Kann”, “London”…';
  search.setAttribute('aria-label', 'Search Lichess studies');
  wrap.appendChild(search);

  const listTitle = document.createElement('div');
  listTitle.className = 'study-list-title';
  wrap.appendChild(listTitle);

  const list = document.createElement('div');
  list.className = 'group study-list';
  wrap.appendChild(list);

  const foot = document.createElement('p');
  foot.className = 'study-foot-note';
  foot.textContent =
    'A bundled catalogue of well-liked opening studies. Any other public study can be imported by link from the board’s Import menu.';
  wrap.appendChild(foot);

  void loadStudyIndex().then(index => {
    const profile = buildStudyProfile(deps.lines, deps.games);
    const recommended = recommendStudies(index, profile, RECOMMEND_CAP);
    const popular = [...index].sort((a, b) => b.likes - a.likes).slice(0, RECOMMEND_CAP);

    const render = (): void => {
      list.innerHTML = '';
      const q = search.value.trim();
      let entries: StudyIndexEntry[];
      if (q) {
        entries = searchStudyIndex(index, q, SEARCH_CAP);
        listTitle.textContent = entries.length ? 'Search results' : '';
        if (!entries.length) {
          const none = document.createElement('p');
          none.className = 'section-desc';
          none.textContent = 'Nothing in the catalogue matches — try an opening name, or paste the study’s link in the board’s Import menu.';
          list.appendChild(none);
          return;
        }
      } else if (recommended.length) {
        entries = recommended;
        listTitle.textContent = 'Recommended for your repertoire';
      } else {
        entries = popular;
        listTitle.textContent = 'Popular studies';
      }
      for (const e of entries) list.appendChild(studyCard(e, deps));
    };

    search.addEventListener('input', render);
    render();
  }).catch(() => {
    listTitle.textContent = '';
    const err = document.createElement('p');
    err.className = 'section-desc';
    err.textContent = 'The study catalogue couldn’t be loaded.';
    list.appendChild(err);
  });

  return wrap;
}

function studyCard(entry: StudyIndexEntry, deps: StudyBrowserDeps): HTMLElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'study-card';
  card.addEventListener('click', () => openStudyImport(entry, deps));

  const text = document.createElement('span');
  text.className = 'study-card-text';

  const name = document.createElement('span');
  name.className = 'study-card-name';
  name.textContent = entry.name;
  text.appendChild(name);

  const sub = document.createElement('span');
  sub.className = 'study-card-sub';
  sub.textContent = `by ${entry.by} · ${entry.chapters} chapter${entry.chapters === 1 ? '' : 's'} · ♥ ${compactCount(entry.likes)}`;
  text.appendChild(sub);

  if (entry.families.length) {
    const fam = document.createElement('span');
    fam.className = 'study-card-family';
    fam.textContent = entry.families.join(' · ');
    text.appendChild(fam);
  }

  card.appendChild(text);
  const chev = Icons.chevronRight(18);
  chev.classList.add('study-card-chev');
  card.appendChild(chev);
  return card;
}

// Fetch the study live and open the shared chapter sheet in a lightbox.
function openStudyImport(entry: StudyIndexEntry, deps: StudyBrowserDeps): void {
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
  title.textContent = entry.name;
  sheet.appendChild(title);

  const body = document.createElement('div');
  body.className = 'bimport-body';
  sheet.appendChild(body);

  const loading = document.createElement('p');
  loading.className = 'bimport-note';
  loading.textContent = 'Fetching the study from Lichess…';
  body.appendChild(loading);

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'edit-cancel-btn';
  cancel.textContent = 'Close';
  cancel.addEventListener('click', close);
  sheet.appendChild(cancel);

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  void (async () => {
    try {
      const pgn = await fetchStudyPgn({ studyId: entry.id });
      const chapters = parseStudyPgn(pgn);
      if (closed) return;
      body.innerHTML = '';
      if (!chapters.length) {
        const none = document.createElement('p');
        none.className = 'bimport-note';
        none.textContent = 'No readable chapters in this study.';
        body.appendChild(none);
        return;
      }
      renderChapterList(body, {
        chapters,
        studyName: entry.name,
        onSaveLines: deps.onSaveLines,
        onAllSaved: close,
      });
    } catch (e) {
      if (closed) return;
      loading.textContent = e instanceof Error ? e.message : 'Couldn’t fetch that study.';
      showToast(loading.textContent);
    }
  })();
}
