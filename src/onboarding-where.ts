// The first screen a stranger sees: "Where do you play?"
//
// ── WHY THIS REPLACED THE COLOUR PICKER AS THE FRONT DOOR ───────────────────
// The first run used to open on "which colour are you preparing for?" and go
// straight into an empty builder with a guided walkthrough. That taught the
// HARDEST thing first: building a line by hand on an empty board is the most
// advanced thing this app does, and it was minute one. Everything the app is
// actually good at — training, the daily challenge, mistakes from your own
// games, coverage gaps, the map — sat behind a three-line wall the user had to
// grind through before seeing any of it.
//
// So the first question is now a fact about the user rather than a judgement
// about a product they haven't seen. "Where do you play?" is answerable by
// anyone in one tap, and the answer is worth something immediately: their games
// come in, and the app can show them their own openings inside a minute.
// onboarding-recap.ts turns that import into the payoff screen.
//
// THE PRECEDENT THIS RESPECTS. onboarding-picker.ts's own comments record a
// three-question wizard (colour / depth / style) that was built and cut, because
// every question was unanswerable by someone who did not yet know what the app
// did. This screen is one question, it is about them, and picking an answer is
// the whole interaction — no Start button to press afterwards, because there is
// nothing left to decide.
//
// COLOUR IS NO LONGER ASKED on this path. The import knows which colour they
// play more (buildRecap's dominantColour), so asking would be making the user
// answer something the app is about to find out. The manual branch still asks
// it, because there is nothing to derive it from there — see onboarding-picker.ts,
// which is now reached only through "I don't play online".

import { Icons } from './icons';
import { pushBack } from './back-nav';
import type { Platform } from './import-games';

// Where the brand mark points. The marketing page, not the app — same as the
// colour picker's, and for the same reason: a stranger who landed on the app
// itself has no other way back to "what is this?".
const BITO_CHESS_URL = 'https://bitochess.com';

export interface WherePickerDeps {
  // A platform was picked: open the import for it. The screen has already closed
  // itself by the time this runs.
  onPlatform: (platform: Platform) => void;
  // "I don't play online" — hand over to the manual branch (the colour picker).
  onManual: () => void;
  // "I already have an account" — absent in a build with no accounts, where the
  // line would be a dead end.
  onSignIn?: () => void;
  // Fires once the screen is actually up, so the caller can drop the boot splash.
  // This IS the first screen on a first visit and the splash sits above
  // everything, so nothing may wait on a choice that might never come.
  onShown?: () => void;
}

// The two platforms, in the order they're offered. Chess.com first: it is much
// the larger site, so it is the likelier answer, and the likelier answer goes
// where the thumb already is.
//
// NO CAPTION UNDER THE NAME. Both rows led with "Import your games", which is
// the same sentence twice and so tells you nothing about which to pick — and no
// honest caption CAN differentiate them, because both go to the same import
// asking for the same thing. The site's name is the whole answer to "where do
// you play?", and the line above the rows already said what happens next.
const PLATFORMS: { value: Platform; label: string }[] = [
  { value: 'chesscom', label: 'Chess.com' },
  { value: 'lichess', label: 'Lichess' },
];

export function showWherePicker(deps: WherePickerDeps): void {
  const overlay = document.createElement('div');
  overlay.className = 'picker-overlay picker-overlay--slim';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Where do you play?');

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.remove();
    document.documentElement.classList.remove('picker-open');
    removeBack();
  };
  // The system back gesture closes this the same way a pick does — it just
  // doesn't pick anything. There is nothing behind it but Train.
  const removeBack = pushBack(close);

  // ── Identity, one line, at the top ──
  const bar = document.createElement('div');
  bar.className = 'picker-bar';

  const brandRow = document.createElement('a');
  brandRow.className = 'picker-brandrow';
  brandRow.href = BITO_CHESS_URL;
  brandRow.target = '_blank';
  brandRow.rel = 'noopener noreferrer';
  brandRow.setAttribute('aria-label', 'Bito Chess — about the app');
  brandRow.appendChild(appMark());
  const brand = document.createElement('span');
  brand.className = 'picker-brand';
  brand.textContent = 'bito chess';
  brandRow.appendChild(brand);
  bar.appendChild(brandRow);
  overlay.appendChild(bar);

  // ── The one question ──
  const stage = document.createElement('div');
  stage.className = 'picker-stage-slim';

  const lead = document.createElement('h1');
  lead.className = 'picker-lead';
  lead.textContent = 'Where do you play?';
  stage.appendChild(lead);

  const sub = document.createElement('p');
  sub.className = 'picker-sub';
  sub.textContent = 'We’ll look at your games and show you the openings you actually play.';
  stage.appendChild(sub);

  const list = document.createElement('div');
  list.className = 'picker-platforms';
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', 'Where do you play?');

  for (const platform of PLATFORMS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'picker-platform';

    const token = document.createElement('span');
    token.className = 'picker-platform-token';
    token.setAttribute('aria-hidden', 'true');
    token.appendChild(Icons.download(22));
    btn.appendChild(token);

    const label = document.createElement('span');
    label.className = 'picker-platform-label';
    label.textContent = platform.label;
    btn.appendChild(label);

    btn.addEventListener('click', () => {
      close();
      deps.onPlatform(platform.value);
    });
    list.appendChild(btn);
  }
  stage.appendChild(list);

  // ── The manual way in ──
  //
  // "I don't play online", not "I'm new". It names the SITUATION rather than the
  // person: plenty of people who play over the board for a club have been playing
  // for thirty years and are not new to anything. It also says plainly what the
  // branch is for, so nobody who does play online takes it by mistake.
  const manual = document.createElement('button');
  manual.type = 'button';
  manual.className = 'picker-manual';
  manual.textContent = 'I don’t play online — build my repertoire by hand';
  manual.addEventListener('click', () => {
    close();
    deps.onManual();
  });
  stage.appendChild(manual);

  overlay.appendChild(stage);

  // ── The returning user's way in, at the very bottom ──
  if (deps.onSignIn) {
    const foot = document.createElement('div');
    foot.className = 'picker-foot-signin';
    const text = document.createElement('span');
    text.textContent = 'I already have an account,';
    foot.appendChild(text);
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'picker-signin-link';
    link.textContent = 'log in';
    link.addEventListener('click', () => deps.onSignIn?.());
    foot.appendChild(link);
    overlay.appendChild(foot);
  }

  document.body.appendChild(overlay);
  // Freeze the page behind the screen — see onboarding-picker.ts for why.
  document.documentElement.classList.add('picker-open');
  deps.onShown?.();
}

// The real installed app icon (public/icons/icon-192.png) — the same art Android
// puts on the home screen, so the very first screen opens on the actual brand
// mark. Mirrors onboarding-picker.ts.
function appMark(): HTMLImageElement {
  const img = document.createElement('img');
  img.src = `${import.meta.env.BASE_URL}icons/icon-192.png`;
  img.width = 28;
  img.height = 28;
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
  img.className = 'picker-mark';
  return img;
}
