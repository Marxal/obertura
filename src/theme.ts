// Theme control — five named choices, persisted on the device.
//
//   classic-light → the original light theme
//   classic-dark  → the original dark theme
//   elegant       → a warm casino-felt green, between light and dark
//   gamer         → near-black base with neon-cyan/violet glow on the chrome
//   system        → follows the OS, resolving to classic-light / classic-dark
//
// The chosen value is stored in localStorage and resolved to a concrete theme
// ("light" | "dark" | "game" | "gamer") that we write to <html data-theme>. The CSS only
// ever reads data-theme (never prefers-color-scheme), so JS is the single source
// of truth. Older stored values (light/dark/auto, from before v1.3) are migrated
// on read to their new names.
//
// NOTE: the "elegant" choice was originally called "game" (display label "Game").
// It was renamed to "Elegant" for v0.4; the stored value and the resolved
// data-theme still read "game" so the colours/CSS are untouched. Old stored
// "game" values migrate to "elegant" on read (see normalise) so a returning
// user's selection isn't reset.
//
// A tiny inline script in index.html applies the same logic before first paint
// to avoid a flash of the wrong theme; this module keeps it in sync afterwards.
// The user-facing control lives in the Settings screen (settings-screen.ts),
// which calls setThemeChoice() / getThemeChoice() directly.

import { applyThemeDefaultBoardColour } from './appearance';

export type ThemeChoice = 'classic-light' | 'classic-dark' | 'elegant' | 'gamer' | 'system';

type ResolvedTheme = 'light' | 'dark' | 'game' | 'gamer';

const STORAGE_KEY = 'obertura-theme';

// Browser chrome colour per resolved theme — matches --bg-page in style.css.
const THEME_COLOR: Record<ResolvedTheme, string> = {
  light: '#f1ece1',
  dark: '#211c16',
  game: '#1e3128',
  gamer: '#0e1020',
};

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

// Map any stored value — current or pre-v1.3 — to a valid ThemeChoice.
function normalise(raw: string | null): ThemeChoice {
  switch (raw) {
    case 'classic-light':
    case 'classic-dark':
    case 'elegant':
    case 'gamer':
    case 'system':
      return raw;
    case 'game':
      return 'elegant'; // migrated: "Game" was renamed to "Elegant" in v0.4
    case 'light':
      return 'classic-light'; // migrated
    case 'dark':
      return 'classic-dark'; // migrated
    case 'auto':
      return 'system'; // migrated
    default:
      return 'system';
  }
}

export function getThemeChoice(): ThemeChoice {
  return normalise(localStorage.getItem(STORAGE_KEY));
}

function effectiveTheme(choice: ThemeChoice): ResolvedTheme {
  switch (choice) {
    case 'classic-light':
      return 'light';
    case 'classic-dark':
      return 'dark';
    case 'elegant':
      return 'game'; // resolves to the unchanged "game" CSS/colours
    case 'gamer':
      return 'gamer';
    case 'system':
      return darkQuery.matches ? 'dark' : 'light';
  }
}

function applyTheme(choice: ThemeChoice): void {
  const eff = effectiveTheme(choice);
  document.documentElement.dataset.theme = eff;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[eff]);
}

export function setThemeChoice(choice: ThemeChoice): void {
  localStorage.setItem(STORAGE_KEY, choice);
  applyTheme(choice);
  // "System" isn't a theme the user explicitly picked — it just follows the OS
  // — so it never sets a board default, even on the first OS-driven resolve.
  if (choice !== 'system') applyThemeDefaultBoardColour(choice);
}

// Apply the saved theme and keep "system" in step with the OS as it changes.
// Called once at boot; the pre-paint script has already applied an initial value.
// We also re-write storage with the normalised name so a migrated value (e.g.
// the old "light") is cleaned up on first run.
export function initTheme(): void {
  darkQuery.addEventListener('change', () => {
    if (getThemeChoice() === 'system') applyTheme('system');
  });
  const choice = getThemeChoice();
  if (localStorage.getItem(STORAGE_KEY) !== choice) {
    localStorage.setItem(STORAGE_KEY, choice);
  }
  // Re-assert in case the pre-paint script and storage ever disagree.
  applyTheme(choice);
}
