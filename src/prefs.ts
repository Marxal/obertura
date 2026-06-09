// Small device-local training preferences, kept in localStorage (tiny, never
// synced). Mirrors the style of theme.ts / streak.ts.

const RETRIES_KEY = 'obertura.retriesBeforeReveal';
const NAMING_MODE_KEY = 'obertura.namingMode';

export type Retries = 0 | 1 | 2;

// How a saved line gets its title. "auto" (default) fills the name from the
// bundled opening database with no popup; "manual" will open a name popup on
// save — wired into Settings in task 7.2. Stored now so the default is set.
export type NamingMode = 'auto' | 'manual';

export function getNamingMode(): NamingMode {
  return localStorage.getItem(NAMING_MODE_KEY) === 'manual' ? 'manual' : 'auto';
}

export function setNamingMode(mode: NamingMode): void {
  localStorage.setItem(NAMING_MODE_KEY, mode);
}

// How many extra attempts a wrong move gets before the correct-move arrow is
// drawn. 0 = reveal immediately, 1 (default) = one retry, 2 = two retries.
export function getRetriesBeforeReveal(): Retries {
  const raw = localStorage.getItem(RETRIES_KEY);
  if (raw === '0') return 0;
  if (raw === '2') return 2;
  return 1;
}

export function setRetriesBeforeReveal(n: Retries): void {
  localStorage.setItem(RETRIES_KEY, String(n));
}
