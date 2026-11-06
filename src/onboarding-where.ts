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
// means "Elsewhere" can be short enough to sit in a segment while the sentence
// that explains it lives in the panel below, where there is room to read it.
//
// THERE IS NO WAY PAST THIS SCREEN THAT ADDS NOTHING. The back gesture used to
// close it and leave a brand-new user in an empty app. It now does what back
// does on any app's first screen: it leaves the app. Every button on it leads
// to something being added.
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
// which is now reached only through "Build my own line" on the third tab.

import type { Platform } from './import-games';
import { userAvatar } from './avatar';
import { lookupPlayer, type FoundPlayer } from './player-lookup';
import { buildWhereShowcase } from './where-showcase';
import { buildLanguageRail, hasLanguageChoice } from './language-picker';
import { formatNumber, t } from './i18n';

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
  // The third tab's two routes. The ready-made one leads: the builder is the
  // densest screen in the app, and a pack line is a first line that's already
  // good (UX-AUDIT C2).
  onStarterPacks: () => void;
  onBuildOwn: () => void;
  // Which tab to open on, and a sentence to explain why: the import that found
  // too few games lands here on the third tab, saying so.
  initialTab?: 'chesscom' | 'lichess' | 'manual';
  notice?: string;
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
// already is. "Elsewhere" is deliberately the short label — the full sentence is
// in the panel below it.
const TABS: { value: Tab; label: string }[] = [
  { value: 'chesscom', label: 'Chess.com' },
  { value: 'lichess', label: 'Lichess' },
  { value: 'manual', label: t('where.elsewhere') },
];

const SITE_NAMES: Record<Platform, string> = { chesscom: 'Chess.com', lichess: 'Lichess' };

// Returns what closes it, for a caller whose reason to close arrives from outside
// (an account's copy landing after a sign-in).
export function showWherePicker(deps: WherePickerDeps): () => void {
  let tab: Tab = deps.initialTab ?? 'chesscom';

  const overlay = document.createElement('div');
  overlay.className = 'picker-overlay picker-overlay--slim';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', t('where.title'));

  const LOOKUP_PAUSE_MS = 450;
  let lookupTimer = 0;
  let lookupAbort: AbortController | null = null;
  let closed = false;
  let followWindow = (): void => {};
  let stopFollowing = (): void => {};
  const close = (): void => {
    if (closed) return;
    closed = true;
    stopFollowing();
    window.clearTimeout(lookupTimer);
    lookupAbort?.abort();
    overlay.remove();
    document.documentElement.classList.remove('picker-open');
  };

  // ── Identity, one line, at the top ──
  const bar = document.createElement('div');
  bar.className = 'picker-bar';

  const brandRow = document.createElement('a');
  brandRow.className = 'picker-brandrow';
  brandRow.href = BITO_CHESS_URL;
  brandRow.target = '_blank';
  brandRow.rel = 'noopener noreferrer';
  brandRow.setAttribute('aria-label', t('where.aboutApp'));
  brandRow.appendChild(appMark());
  const brand = document.createElement('span');
  brand.className = 'picker-brand';
  brand.textContent = 'bito chess';
  brand.setAttribute('aria-label', 'Bito Chess');
  brandRow.appendChild(brand);
  bar.appendChild(brandRow);
  // Many Catalans have their phone set to Spanish, so this can't wait for Settings.
  if (hasLanguageChoice()) bar.appendChild(buildLanguageRail());
  overlay.appendChild(bar);

  // ── The one question ──
  const stage = document.createElement('div');
  stage.className = 'picker-stage-slim';

  const lead = document.createElement('h1');
  lead.className = 'picker-lead';
  lead.textContent = t('where.title');
  stage.appendChild(lead);

  const sub = document.createElement('p');
  sub.className = 'picker-sub';
  sub.textContent = t('where.sub');
  stage.appendChild(sub);

  // ── The segmented toggle ──
  const tabs = document.createElement('div');
  tabs.className = 'where-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', t('where.title'));

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
  input.setAttribute('aria-label', t('where.username'));
  panel.appendChild(input);

  // "Is this you?": the player behind what's been typed, before anything imports.
  // The row keeps its height whatever it says, so the button under it stays put.
  const who = document.createElement('div');
  who.className = 'where-who';
  who.setAttribute('role', 'status');
  panel.appendChild(who);

  // The manual branch's explanation, in the panel where there is room for the
  // whole sentence. Hidden while a platform tab is selected.
  const manualNote = document.createElement('p');
  manualNote.className = 'where-manual-note';
  manualNote.textContent = deps.notice ?? t('where.manualNote');
  panel.appendChild(manualNote);

  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'btn-primary where-go';
  panel.appendChild(go);

  const buildOwn = document.createElement('button');
  buildOwn.type = 'button';
  buildOwn.className = 'btn-secondary where-go where-go--second';
  buildOwn.textContent = t('where.buildOwn');
  buildOwn.addEventListener('click', () => { close(); deps.onBuildOwn(); });
  panel.appendChild(buildOwn);

  // ── The lookup ──
  // Waits for a pause in the typing, so a site is asked about a name rather than
  // about every letter of one, and a newer name cancels an older question.
  // Only a definite "no such player" holds the import back. Still looking, or the
  // site not answering, never does: this is a courtesy in front of the import.
  let missing = false;

  function paintWho(content: HTMLElement | string | null, cls = ''): void {
    who.className = `where-who ${cls}`.trim();
    who.replaceChildren();
    if (typeof content === 'string') who.textContent = content;
    else if (content) who.appendChild(content);
  }

  function foundRow(p: FoundPlayer): HTMLElement {
    const row = document.createElement('div');
    row.className = 'where-who-found';
    row.appendChild(userAvatar(p.avatarUrl, 36));
    const text = document.createElement('div');
    text.className = 'where-who-text';
    const ask = document.createElement('span');
    ask.className = 'where-who-ask';
    ask.textContent = t('where.isThisYou');
    text.appendChild(ask);
    const name = document.createElement('span');
    name.className = 'where-who-name';
    name.textContent = p.username;
    text.appendChild(name);
    const facts: string[] = [];
    if (p.rating) facts.push(`${p.rating.label} ${p.rating.value}`);
    if (p.games !== undefined) {
      facts.push(t('where.games', { n: p.games, count: formatNumber(p.games) }));
    }
    if (facts.length > 0) {
      const line = document.createElement('span');
      line.className = 'where-who-facts';
      line.textContent = facts.join(' · ');
      text.appendChild(line);
    }
    row.appendChild(text);
    return row;
  }

  function scheduleLookup(): void {
    window.clearTimeout(lookupTimer);
    lookupAbort?.abort();
    lookupAbort = null;
    missing = false;
    paintWho(null);
    const name = input.value.trim();
    if (tab === 'manual' || name.length < 2) return;
    const platform: Platform = tab;
    lookupTimer = window.setTimeout(() => {
      const ctrl = new AbortController();
      lookupAbort = ctrl;
      paintWho(t('where.looking'), 'where-who--quiet');
      lookupPlayer(platform, name, ctrl.signal).then((res) => {
        if (ctrl.signal.aborted || closed) return;
        if (res.status === 'found') {
          paintWho(foundRow(res));
        } else if (res.status === 'missing') {
          missing = true;
          paintWho(t('where.missing', { name, site: SITE_NAMES[platform] }), 'where-who--missing');
        } else {
          paintWho(null);
        }
      }).catch(() => { /* cancelled by newer typing */ });
    }, LOOKUP_PAUSE_MS);
  }

  input.addEventListener('input', scheduleLookup);

  const submit = (): void => {
    if (tab === 'manual') { close(); deps.onStarterPacks(); return; }
    const username = input.value.trim();
    if (!username || missing) { input.focus(); return; }
    close();
    deps.onPlatform(tab, username);
  };

  go.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  });

  // Always lit. A greyed button read as broken rather than as "waiting for you",
  // and a tap on it with nothing typed already puts the cursor in the field,
  // which is the answer to the only question a tap there can be asking.
  function reflectGo(): void {
    go.textContent = t(tab === 'manual' ? 'where.startReady' : 'where.importGames');
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
    manualNote.hidden = !manual;
    buildOwn.hidden = !manual;
    who.hidden = manual;
    if (!manual) input.placeholder = t('where.usernameOn', { site: SITE_NAMES[next] });
    reflectGo();
    // The same name on the other site is a different person.
    scheduleLookup();
  }

  select(tab);
  overlay.appendChild(stage);

  // A desktop has room to show what the import is for; a phone doesn't build it.
  // Follows the window: built the first time it is wide enough, and told to redraw
  // when it comes back, since a board can't measure itself while it's hidden.
  const wide = window.matchMedia('(min-width: 960px)');
  let showcase: ReturnType<typeof buildWhereShowcase> | null = null;
  followWindow = (): void => {
    if (!wide.matches) return;
    if (showcase) { showcase.redraw(); return; }
    showcase = buildWhereShowcase();
    overlay.appendChild(showcase.el);
  };
  wide.addEventListener('change', followWindow);
  stopFollowing = () => wide.removeEventListener('change', followWindow);
  followWindow();

  // ── The returning user's way in, at the very bottom ──
  if (deps.onSignIn) {
    const foot = document.createElement('div');
    foot.className = 'picker-foot-signin';
    const text = document.createElement('span');
    text.textContent = t('where.haveAccount');
    foot.appendChild(text);
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'picker-signin-link';
    link.textContent = t('where.logIn');
    link.addEventListener('click', () => deps.onSignIn?.());
    foot.appendChild(link);
    overlay.appendChild(foot);
  }

  document.body.appendChild(overlay);
  // Freeze the page behind the screen — see onboarding-picker.ts for why.
  document.documentElement.classList.add('picker-open');
  deps.onShown?.();
  return close;
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
