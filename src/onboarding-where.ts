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
// anyone, and the answer is worth something immediately: their games come in,
// and the app can show them their own openings inside a minute.
// onboarding-recap.ts turns that import into the payoff screen.
//
// ── ONE SCREEN, NOT TWO ─────────────────────────────────────────────────────
// The username is typed HERE, not in the import sheet's own step 1. The first
// draft picked a platform here and then opened the import panel, which asked
// for the platform again alongside the username — the same question twice, in
// two different visual languages, before anything had happened. The panel
// already supports exactly this handover (`autoScan`, which import-inline.ts
// uses for the same reason), so the platform and username go straight in and
// the scan starts on arrival.
//
// ── A SEGMENTED TOGGLE, NOT THREE STACKED BUTTONS ───────────────────────────
// The three answers are mutually exclusive and the third changes what the rest
// of the screen is FOR, which is a tab strip's job rather than a menu's. It also
// means "I'm new" can be short enough to sit in a segment while the sentence
// that explains it ("I don't play online — build my repertoire by hand") lives
// in the panel below, where there is room to read it.
//
// THE PRECEDENT THIS RESPECTS. onboarding-picker.ts's own comments record a
// three-question wizard (colour / depth / style) that was built and cut, because
// every question was unanswerable by someone who did not yet know what the app
// did. This screen asks one thing, and it is about them.
//
// COLOUR IS NO LONGER ASKED on this path. The import knows which colour they
// play more (buildRecap's dominantColour), so asking would make the user answer
// something the app is about to find out. The manual branch still asks it,
// because there is nothing to derive it from there — see onboarding-picker.ts,
// which is now reached only through "I'm new".

import { pushBack } from './back-nav';
import type { Platform } from './import-games';

// Where the brand mark points. The marketing page, not the app — same as the
// colour picker's, and for the same reason: a stranger who landed on the app
// itself has no other way back to "what is this?".
const BITO_CHESS_URL = 'https://bitochess.com';

/** Which segment is showing. 'manual' is the no-games branch. */
type Tab = Platform | 'manual';

export interface WherePickerDeps {
  // A platform and a username: open the import for them. The screen has already
  // closed itself by the time this runs.
  onPlatform: (platform: Platform, username: string) => void;
  // "I'm new" — hand over to the manual branch (the colour picker).
  onManual: () => void;
  // "I already have an account" — absent in a build with no accounts, where the
  // line would be a dead end.
  onSignIn?: () => void;
  // Fires once the screen is actually up, so the caller can drop the boot splash.
  // This IS the first screen on a first visit and the splash sits above
  // everything, so nothing may wait on a choice that might never come.
  onShown?: () => void;
}

// The three segments, in order. Chess.com first: it is much the larger site, so
// it is the likelier answer, and the likelier answer goes where the thumb
// already is. "I'm new" is deliberately the short label — the full sentence is
// in the panel below it.
const TABS: { value: Tab; label: string }[] = [
  { value: 'chesscom', label: 'Chess.com' },
  { value: 'lichess', label: 'Lichess' },
  { value: 'manual', label: 'I’m new' },
];

const PLACEHOLDERS: Record<Platform, string> = {
  chesscom: 'Your Chess.com username',
  lichess: 'Your Lichess username',
};

// Where a user can go and read their own handle off the page. A mistyped
// username is the single most likely way this screen fails, and "check the
// spelling" is useless advice to someone who genuinely isn't sure what theirs
// is — so the answer is one tap away, on the site itself, before they submit.
const USERNAME_HELP: Record<Platform, string> = {
  chesscom: 'https://www.chess.com/settings',
  lichess: 'https://lichess.org/account/profile',
};

export function showWherePicker(deps: WherePickerDeps): void {
  let tab: Tab = 'chesscom';

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
  sub.textContent = 'We’ll read your games and show you the openings you actually play.';
  stage.appendChild(sub);

  // ── The segmented toggle ──
  const tabs = document.createElement('div');
  tabs.className = 'where-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Where do you play?');

  const tabButtons = new Map<Tab, HTMLButtonElement>();
  for (const entry of TABS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'where-tab';
    btn.textContent = entry.label;
    btn.setAttribute('role', 'tab');
    btn.addEventListener('click', () => select(entry.value));
    tabButtons.set(entry.value, btn);
    tabs.appendChild(btn);
  }
  stage.appendChild(tabs);

  // ── The panel the toggle switches ──
  const panel = document.createElement('div');
  panel.className = 'where-panel';
  stage.appendChild(panel);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'where-input';
  input.autocomplete = 'username';
  input.autocapitalize = 'none';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Your username');
  panel.appendChild(input);

  // The manual branch's explanation, in the panel where there is room for the
  // whole sentence. Hidden while a platform tab is selected.
  // "How do I find my username?" — opens the platform's own settings page.
  const help = document.createElement('a');
  help.className = 'where-help';
  help.target = '_blank';
  help.rel = 'noopener noreferrer';
  help.textContent = 'How do I find my username?';
  panel.appendChild(help);

  const manualNote = document.createElement('p');
  manualNote.className = 'where-manual-note';
  manualNote.textContent =
    'I don’t play online — build my repertoire by hand.';
  panel.appendChild(manualNote);

  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'btn-primary where-go';
  panel.appendChild(go);

  const submit = (): void => {
    if (tab === 'manual') { close(); deps.onManual(); return; }
    const username = input.value.trim();
    if (!username) { input.focus(); return; }
    close();
    deps.onPlatform(tab, username);
  };

  go.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  });
  // The button says nothing can happen yet, rather than failing on a tap.
  input.addEventListener('input', () => reflectGo());

  function reflectGo(): void {
    if (tab === 'manual') {
      go.textContent = 'Build my first line →';
      go.disabled = false;
      return;
    }
    go.textContent = 'Import my games →';
    go.disabled = input.value.trim().length === 0;
  }

  function select(next: Tab): void {
    tab = next;
    for (const [value, btn] of tabButtons) {
      const on = value === next;
      btn.classList.toggle('where-tab--on', on);
      btn.setAttribute('aria-selected', String(on));
    }
    const manual = next === 'manual';
    input.hidden = manual;
    help.hidden = manual;
    manualNote.hidden = !manual;
    if (!manual) {
      input.placeholder = PLACEHOLDERS[next];
      help.href = USERNAME_HELP[next];
    }
    reflectGo();
  }

  select('chesscom');
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
