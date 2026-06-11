// The About sheet — App / Support / Open source / Version. Opened from the row at
// the bottom of Settings. Name and version are baked in at build time from
// package.json (see vite.config.ts → define).

import { pushBack } from './back-nav';

// Swish brand colour, used by the fallback logo below.
const SWISH_TEAL = '#00b9ae';

// The official Swish logo is fetched from swish.nu at build time and embedded
// inline. That host wasn't reachable from the build environment, so we ship the
// spec's fallback: the word "Swish" in a sans-serif with a small circular swirl
// to its left, in the brand teal. Swap in the official SVG here if it becomes
// reachable.
const SWISH_LOGO_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 40" role="img" aria-label="Swish" focusable="false">
  <path d="M27 13a11 11 0 1 0 3.2 9.4" fill="none" stroke="${SWISH_TEAL}" stroke-width="3.4" stroke-linecap="round"/>
  <path d="M27 13l1.8-6.4 5.6 3.4" fill="none" stroke="${SWISH_TEAL}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="44" y="28" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="700" fill="${SWISH_TEAL}">Swish</text>
</svg>`.trim();

// Deep link that opens Swish pre-filled on a Swedish phone and does nothing
// elsewhere. The payment data is URL-encoded onto the swish:// scheme.
const SWISH_DEEPLINK = (() => {
  const data = {
    version: 1,
    payee: { value: '+46761899199', editable: false },
    amount: { value: 0, editable: true },
    message: { value: 'Obertura', editable: true },
  };
  return `swish://payment?data=${encodeURIComponent(JSON.stringify(data))}`;
})();

interface Licence { name: string; licence: string; }

// Third-party software and data we ship.
const LICENCES: Licence[] = [
  { name: 'chessground', licence: 'GPL-3.0' },
  { name: 'chess.js', licence: 'BSD-2-Clause' },
  { name: 'Stockfish', licence: 'GPL-3.0' },
  { name: 'Lichess chess-openings data', licence: 'CC0-1.0 (public domain)' },
  { name: 'cburnett piece set', licence: 'GPL-2.0-or-later' },
  // NEXT TASK (Piece sets): add one entry per new piece set here —
  // { name: '<set name>', licence: '<licence>' }.
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

  // ── Support ──
  sheet.appendChild(sectionHeading('Support'));

  const kofi = externalLink('Buy me a coffee ☕', 'https://ko-fi.com/marxal', 'btn-primary about-support-btn');
  sheet.appendChild(kofi);

  // Swish — logo only, quiet styling. The deep link opens Swish pre-filled on a
  // Swedish phone and is inert elsewhere; hence the note below.
  const swish = document.createElement('a');
  swish.href = SWISH_DEEPLINK;
  swish.className = 'btn-secondary about-support-btn about-swish-btn';
  swish.setAttribute('aria-label', 'Pay with Swish');
  swish.innerHTML = SWISH_LOGO_SVG;
  sheet.appendChild(swish);

  const swishNote = document.createElement('p');
  swishNote.className = 'about-swish-note';
  swishNote.textContent = 'Swedish users only';
  sheet.appendChild(swishNote);

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
