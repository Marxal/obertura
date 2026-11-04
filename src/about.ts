// The About sheet — App / Open source / Version. Opened from the row in the
// Feedback & about group at the bottom of Settings. Name and version are baked in
// at build time from package.json (see vite.config.ts → define). The support
// links ("Buy me a coffee") live in their own Settings section — see support.ts.

import { pushBack } from './back-nav';
import { t } from './i18n';

interface Licence { name: string; licence: string; }

// Third-party software and data we ship.
const LICENCES: Licence[] = [
  { name: 'chessground', licence: 'GPL-3.0' },
  { name: 'chess.js', licence: 'BSD-2-Clause' },
  { name: 'Stockfish', licence: 'GPL-3.0' },
  { name: 'Lichess chess-openings data', licence: 'CC0-1.0 (public domain)' },
  { name: 'cburnett piece set (Colin M.L. Burnett)', licence: 'GPL-2.0-or-later' },
  { name: 'Maestro piece set (sadsnake1)', licence: 'CC-BY-NC-SA-4.0' },
  { name: 'California piece set (Jerry S.)', licence: 'CC-BY-NC-SA-4.0' },
  { name: 'Mpchess piece set (Maxime Chupin)', licence: 'GPL-3.0-or-later' },
  { name: 'Kiwen-Suwi piece set (neverRare)', licence: 'CC-BY-4.0' },
  { name: 'Horsey piece set (cham, michael1241)', licence: 'CC-BY-NC-SA-4.0' },
  { name: 'Gioco piece set (sadsnake1)', licence: 'CC-BY-NC-SA-4.0' },
  { name: 'Tatiana piece set (sadsnake1)', licence: 'CC-BY-NC-SA-4.0' },
  { name: 'Letter piece set (usolando)', licence: 'AGPL-3.0-or-later' },
  { name: 'Anarcandy piece set (caderek)', licence: 'CC-BY-NC-SA-4.0' },
  { name: 'Board textures (the lila authors, pirouetti)', licence: 'AGPL-3.0-or-later' },
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
  title.textContent = t('settings.about');
  sheet.appendChild(title);

  // ── App ──
  sheet.appendChild(sectionHeading(t('about.app')));
  const appName = document.createElement('p');
  appName.className = 'about-app-name';
  appName.textContent = `${__APP_NAME__} v${__APP_VERSION__}`;
  sheet.appendChild(appName);
  sheet.appendChild(externalLink(t('about.createdByMarxal'), 'https://marxal.net', 'about-link'));

  // ── Open source ──
  sheet.appendChild(sectionHeading(t('about.openSource')));
  const details = document.createElement('details');
  details.className = 'about-licences';
  const summary = document.createElement('summary');
  summary.textContent = t('about.licences');
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
  version.textContent = t('about.version', { version: __APP_VERSION__ });
  sheet.appendChild(version);

  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'btn-secondary';
  done.textContent = t('common.close');
  done.addEventListener('click', close);
  sheet.appendChild(done);

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}
