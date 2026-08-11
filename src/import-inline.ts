// The boxed "import your games" form that empty states show INSTEAD of a button.
//
// Six screens in the app are useless until games are imported — Train → Middle
// game, Train → End game, My Lines → From my games, Explore → Recommended, My
// games, and Statistics → Your games. Every one of them used to show a button
// that opened a sheet that then asked for a platform and a username. That's a
// tap spent on nothing: the button carries no information the form doesn't, and
// the user has to discover that the sheet exists before they can see what's
// being asked of them.
//
// So the first step of the form lands directly on the screen, boxed and
// accented so it reads as the one thing to do there. Filling it in and hitting
// Scan opens the shared panel with `autoScan`, which skips its own step 1 and
// goes straight to the results — one step out of the flow, everywhere.
//
// It is deliberately the SAME two fields as the panel's step 1, prefilled from
// the same per-platform saved usernames, so someone who has imported before
// usually only has to press the button.

import { getLastPlatform, openImportPanel, platformLabel } from './import-panel';
import { getUsername as getChesscomUser } from './chesscom';
import { getUsername as getLichessUser } from './lichess';
import type { Platform } from './import-games';
import { Icons } from './icons';

export interface InlineImportOptions {
  // Heading inside the box. Say what THIS screen gets out of the import.
  title: string;
  // One sentence under it, same job.
  body: string;
  // Runs after games have actually been imported — re-render the screen.
  onImported: () => void;
}

function savedUsername(p: Platform): string {
  return p === 'lichess' ? getLichessUser() : getChesscomUser();
}

export function buildInlineImport(opts: InlineImportOptions): HTMLElement {
  let platform: Platform = getLastPlatform();

  const box = document.createElement('div');
  box.className = 'inline-import';

  const head = document.createElement('div');
  head.className = 'inline-import-head';
  const icon = document.createElement('span');
  icon.className = 'inline-import-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.appendChild(Icons.download(20));
  head.appendChild(icon);
  const title = document.createElement('h3');
  title.className = 'inline-import-title';
  title.textContent = opts.title;
  head.appendChild(title);
  box.appendChild(head);

  const body = document.createElement('p');
  body.className = 'inline-import-body';
  body.textContent = opts.body;
  box.appendChild(body);

  // Platform toggle — the same segmented control the panel's step 1 uses, so
  // moving from one to the other doesn't feel like a different form.
  const seg = document.createElement('div');
  seg.className = 'seg-control inline-import-platform';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Platform');
  const buttons: HTMLButtonElement[] = [];
  for (const p of ['chesscom', 'lichess'] as Platform[]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg-btn';
    b.dataset.value = p;
    b.textContent = platformLabel(p);
    b.addEventListener('click', () => {
      if (platform === p) return;
      platform = p;
      reflect();
      // Each platform keeps its own saved handle; swap to it, and only clobber
      // what the user has typed if we actually have something to put there.
      const saved = savedUsername(p);
      if (saved || !input.value) input.value = saved;
      input.placeholder = `your ${platformLabel(p)} username`;
    });
    buttons.push(b);
    seg.appendChild(b);
  }
  const reflect = (): void => {
    for (const b of buttons) {
      const on = b.dataset.value === platform;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  };
  reflect();
  box.appendChild(seg);

  // Username + Scan, on one row — this is a two-control form and shouldn't look
  // like a page of settings.
  const row = document.createElement('form');
  row.className = 'inline-import-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'settings-input inline-import-input';
  input.autocomplete = 'off';
  input.autocapitalize = 'none';
  input.spellcheck = false;
  input.placeholder = `your ${platformLabel(platform)} username`;
  input.value = savedUsername(platform);
  input.setAttribute('aria-label', 'Username');
  row.appendChild(input);

  const go = document.createElement('button');
  go.type = 'submit';
  go.className = 'btn-primary inline-import-go';
  go.textContent = 'Scan';
  row.appendChild(go);

  const error = document.createElement('p');
  error.className = 'inline-import-error';
  error.hidden = true;
  error.setAttribute('aria-live', 'polite');

  row.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = input.value.trim();
    if (!username) {
      error.textContent = `Enter your ${platformLabel(platform)} username first.`;
      error.hidden = false;
      input.focus();
      return;
    }
    error.hidden = true;
    // The panel takes it from here: it scans immediately, then shows the
    // "choose what to import" review with the counts and the White/Black split.
    openImportPanel({
      platform,
      username,
      autoScan: true,
      onImported: () => opts.onImported(),
    });
  });

  box.appendChild(row);
  box.appendChild(error);

  return box;
}
