// The study-chapter list shared by the builder's import popup and the Packs
// tab's study browser: pick a colour once, then save chapters as lines (each
// with its author comments as move notes). Chapters save tagged with the
// study's shortened title so they group under one chip in My Lines; a
// chapter's intro comment (the text before move one) is shown here and folded
// into the first move's note on save. Renders INTO a host element — the
// caller owns the surrounding sheet, back link, and close behaviour.

import { showToast } from './toast';
import { shortStudyTag, type StudyChapter } from './study-import';
import type { LineSeed } from './onboarding-starter';

export interface ChapterListDeps {
  chapters: StudyChapter[];
  // The study's title (for the grouping tag) — null skips tagging.
  studyName: string | null;
  // Save a batch of seeds to My Lines; resolves with how many were saved.
  onSaveLines: (seeds: LineSeed[], colour: 'white' | 'black') => Promise<number>;
  // Called after a successful "Save all" (the host closes itself).
  onAllSaved: () => void;
}

export function renderChapterList(body: HTMLElement, deps: ChapterListDeps): void {
  const { chapters, studyName } = deps;
  let colour: 'white' | 'black' = 'white';
  const saved = new Set<number>();
  const tag = studyName ? shortStudyTag(studyName) : null;

  // The study's introduction — the author's comment on the starting position —
  // sits at the top, above the chapter list, where a reader expects it.
  const singleChapter = chapters.length === 1;
  const studyIntro = chapters[0]?.intro;
  if (singleChapter && studyIntro) {
    body.appendChild(introBlock(studyIntro));
  }

  const colourRow = document.createElement('div');
  colourRow.className = 'bimport-study-colour';
  const lbl = document.createElement('span');
  lbl.className = 'bimport-note';
  lbl.textContent = 'Train these lines as:';
  colourRow.appendChild(lbl);
  const seg = document.createElement('div');
  seg.className = 'seg-control';
  const mkSeg = (c: 'white' | 'black', label: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg-btn' + (c === colour ? ' active' : '');
    b.textContent = label;
    b.addEventListener('click', () => {
      colour = c;
      seg.querySelectorAll('.seg-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    });
    return b;
  };
  seg.appendChild(mkSeg('white', '○ White'));
  seg.appendChild(mkSeg('black', '● Black'));
  colourRow.appendChild(seg);
  body.appendChild(colourRow);

  if (tag) {
    const tagNote = document.createElement('p');
    tagNote.className = 'bimport-note bimport-tag-note';
    tagNote.textContent = `Lines will be tagged “${tag}” so they stay grouped.`;
    body.appendChild(tagNote);
  }

  const seedOf = (c: StudyChapter): LineSeed => {
    // The chapter intro rides ahead of the first move's own note, so it greets
    // you at move one when the line is opened or trained.
    const notes: Record<number, string> = { ...c.notes };
    if (c.intro) notes[0] = notes[0] ? `${c.intro}\n\n${notes[0]}` : c.intro;
    return {
      ucis: c.ucis,
      notes: Object.keys(notes).length ? notes : undefined,
      name: c.name,
      tags: tag ? [tag] : undefined,
    };
  };

  const list = document.createElement('div');
  list.className = 'bimport-game-list';
  chapters.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'bimport-game bimport-chapter';

    const text = document.createElement('span');
    text.className = 'bimport-game-text';
    const name = document.createElement('span');
    name.className = 'bimport-game-name';
    name.textContent = c.name;
    text.appendChild(name);
    const sub = document.createElement('span');
    sub.className = 'bimport-game-sub';
    const noteCount = Object.keys(c.notes).length;
    sub.textContent = `${c.ucis.length} moves${noteCount ? ` · ${noteCount} note${noteCount === 1 ? '' : 's'}` : ''}`;
    text.appendChild(sub);
    // A multi-chapter study shows each chapter's intro with its row (a single
    // chapter's intro already leads the sheet).
    if (!singleChapter && c.intro) {
      const intro = document.createElement('span');
      intro.className = 'bimport-chapter-intro';
      intro.textContent = c.intro;
      text.appendChild(intro);
    }
    row.appendChild(text);

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn-secondary bimport-chapter-save';
    save.textContent = 'Save as line';
    save.addEventListener('click', () => {
      save.disabled = true;
      void deps.onSaveLines([seedOf(c)], colour).then(n => {
        if (n > 0) {
          saved.add(i);
          save.textContent = '✓ Saved';
          // A one-chapter study has no "Save all" — this save IS the whole
          // import, so confirm and dismiss just like the multi-chapter path.
          if (singleChapter) {
            showToast('Saved 1 line to My Lines ✓', { variant: 'success' });
            deps.onAllSaved();
          }
        } else { save.disabled = false; showToast('Couldn’t save that chapter.'); }
      });
    });
    row.appendChild(save);
    list.appendChild(row);
  });
  body.appendChild(list);

  if (chapters.length > 1) {
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'btn-primary bimport-pgn-go';
    all.textContent = `Save all ${chapters.length} as lines`;
    all.addEventListener('click', () => {
      all.disabled = true;
      const pending = chapters.filter((_, i) => !saved.has(i));
      void deps.onSaveLines(pending.map(seedOf), colour).then(n => {
        showToast(`Saved ${n} line${n === 1 ? '' : 's'} to My Lines ✓`, { variant: 'success' });
        deps.onAllSaved();
      });
    });
    body.appendChild(all);
  }
}

function introBlock(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'bimport-study-intro';
  p.textContent = text;
  return p;
}
