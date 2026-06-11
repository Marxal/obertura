// The About sheet — App / Open source / Version. Opened from the row in the
// Feedback & about group at the bottom of Settings. Name and version are baked in
// at build time from package.json (see vite.config.ts → define). The support
// links ("Buy me a coffee") live in their own Settings section — see support.ts.

import { pushBack } from './back-nav';

interface Licence { name: string; licence: string; }

// Third-party software and data we ship.
const LICENCES: Licence[] = [
  { name: 'chessground', licence: 'GPL-3.0' },
  { name: 'chess.js', licence: 'BSD-2-Clause' },
  { name: 'Stockfish', licence: 'GPL-3.0' },
  { name: 'Lichess chess-openings data', licence: 'CC0-1.0 (public domain)' },
  { name: 'cburnett piece set', licence: 'GPL-2.0-or-later' },
  { name: 'Merida piece set (Armando H. Marroquin)', licence: 'GPL-2.0-or-later' },
  { name: 'Chessnut piece set (Alexis Luengas)', licence: 'Apache-2.0' },
  { name: 'Kiwen-Suwi piece set (neverRare)', licence: 'CC-BY-4.0' },
];

function externalLink(text: string, href: string, className: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.className = className;
  a.textContent = text;
  return a;
}

function sectionHeading(text: string): HTMLElement {
  const h = document.createElement('h4');
  h.className = 'about-section-title';
  h.textContent = text;
  return h;
}

export function openAboutSheet(): void {
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet about-sheet';

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    overlay.remove();
    removeBack();
  }
  const removeBack = pushBack(close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const title = document.createElement('h3');
  title.className = 'edit-sheet-title';
  title.textContent = 'About';
  sheet.appendChild(title);

  // ── App ──
  sheet.appendChild(sectionHeading('App'));
  const appName = document.createElement('p');
  appName.className = 'about-app-name';
  appName.textContent = `${__APP_NAME__} v${__APP_VERSION__}`;
  sheet.appendChild(appName);
  sheet.appendChild(externalLink('Created by marxal', 'https://marxal.net', 'about-link'));

  // ── Open source ──
  sheet.appendChild(sectionHeading('Open source'));
  const details = document.createElement('details');
  details.className = 'about-licences';
  const summary = document.createElement('summary');
  summary.textContent = 'Licences';
  details.appendChild(summary);

  const list = document.createElement('ul');
  list.className = 'about-licence-list';
  for (const l of LICENCES) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'about-licence-name';
    name.textContent = l.name;
    const lic = document.createElement('span');
    lic.className = 'about-licence-type';
    lic.textContent = l.licence;
    li.append(name, lic);
    list.appendChild(li);
  }
  details.appendChild(list);
  sheet.appendChild(details);

  // ── Version row, quiet, at the very bottom ──
  const version = document.createElement('p');
  version.className = 'about-version';
  version.textContent = `Version ${__APP_VERSION__}`;
  sheet.appendChild(version);

  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'btn-secondary';
  done.textContent = 'Close';
  done.addEventListener('click', close);
  sheet.appendChild(done);

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}
