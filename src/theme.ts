// Theme control — light / dark / auto, persisted on the device.
//
// "auto" follows the OS preference and tracks it live; "light"/"dark" pin it.
// The chosen mode is stored in localStorage and resolved to a concrete
// light|dark value that we write to <html data-theme>. The CSS only ever reads
// data-theme (never prefers-color-scheme), so JS is the single source of truth.
//
// A tiny inline script in index.html applies the same logic before first paint
// to avoid a flash of the wrong theme; this module keeps it in sync afterwards.
// The user-facing control now lives in the Settings screen (settings-screen.ts),
// which calls setThemeChoice() / getThemeChoice() directly.

export type ThemeChoice = 'light' | 'dark' | 'auto';

const STORAGE_KEY = 'obertura-theme';

// Browser chrome colour per theme — matches --bg-page in style.css.
const THEME_COLOR: Record<'light' | 'dark', string> = {
  light: '#f1ece1',
  dark: '#211c16',
};

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

export function getThemeChoice(): ThemeChoice {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' || v === 'auto' ? v : 'auto';
}

function effectiveTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice === 'auto') return darkQuery.matches ? 'dark' : 'light';
  return choice;
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
}

// Apply the saved theme and keep "auto" in step with the OS as it changes.
// Called once at boot; the pre-paint script has already applied an initial value.
export function initTheme(): void {
  darkQuery.addEventListener('change', () => {
    if (getThemeChoice() === 'auto') applyTheme('auto');
  });
  // Re-assert in case the pre-paint script and storage ever disagree.
  applyTheme(getThemeChoice());
}
