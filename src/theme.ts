// Theme control — light / dark / auto, persisted on the device.
//
// "auto" follows the OS preference and tracks it live; "light"/"dark" pin it.
// The chosen mode is stored in localStorage and resolved to a concrete
// light|dark value that we write to <html data-theme>. The CSS only ever reads
// data-theme (never prefers-color-scheme), so JS is the single source of truth.
//
// A tiny inline script in index.html applies the same logic before first paint
// to avoid a flash of the wrong theme; this module keeps it in sync afterwards
// and wires up the in-header switch. (The control moves into Settings in 7.2.)

export type ThemeChoice = 'light' | 'dark' | 'auto';

const STORAGE_KEY = 'obertura-theme';

// Browser chrome colour per theme — matches --bg-page in style.css.
const THEME_COLOR: Record<'light' | 'dark', string> = {
  light: '#f1ece1',
  dark: '#1a1512',
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

function setThemeChoice(choice: ThemeChoice): void {
  localStorage.setItem(STORAGE_KEY, choice);
  applyTheme(choice);
}

// Wire the header segmented control, reflect the active choice, and keep "auto"
// in step with the OS as it changes.
export function initThemeControl(): void {
  const group = document.getElementById('theme-switch');
  const buttons = group
    ? Array.from(group.querySelectorAll<HTMLButtonElement>('[data-theme-choice]'))
    : [];

  function reflect(): void {
    const choice = getThemeChoice();
    for (const btn of buttons) {
      const active = btn.dataset.themeChoice === choice;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
  }

  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      setThemeChoice(btn.dataset.themeChoice as ThemeChoice);
      reflect();
    });
  }

  // Follow the OS only while on "auto".
  darkQuery.addEventListener('change', () => {
    if (getThemeChoice() === 'auto') applyTheme('auto');
  });

  // Re-assert in case the pre-paint script and storage ever disagree.
  applyTheme(getThemeChoice());
  reflect();
}
