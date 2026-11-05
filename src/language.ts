// Loading the app's language at startup, and changing it.
//
// A choice is stored in `obertura.language`, so it follows the account (the
// `obertura` prefix is what backupLocalKey lets travel) and the landing page can
// set it too, being the same site. A detected language is never stored, so it
// can't follow someone onto a phone set to something else.
//
// Changing language reloads the app. The UI is built synchronously, and the sync
// code already reloads after applying a snapshot.
//
// Currency is separate on purpose: pricing.ts reads the phone's languages, not this.

import { englishDictionary, t, useDictionary, type Dictionary, type MessageKey } from './i18n';
import { BROWSER_REDIRECTS, RELEASED_LANGUAGES, isLanguage, pickLanguage, type Language } from './language-choice';

export const LANGUAGE_KEY = 'obertura.language';

// Lasts as long as the tab, and its name keeps it out of backups and the account.
const PREVIEW_KEY = 'bito-language-preview';

// A slow network must not hold up the app: past this, it starts in English.
const LOAD_TIMEOUT_MS = 4000;

const DICTIONARIES: Partial<Record<Language, () => Promise<Dictionary>>> = {
  ca: () => import('./locales/ca.json').then((m) => m.default as Dictionary),
  es: () => import('./locales/es.json').then((m) => m.default as Dictionary),
  sv: () => import('./locales/sv.json').then((m) => m.default as Dictionary),
  xx: () => import('./locales/pseudo').then((m) => m.pseudoDictionary(englishDictionary)),
};

let current: Language = 'en';

function storedChoice(): string | null {
  try { return localStorage.getItem(LANGUAGE_KEY); } catch { return null; }
}

/** `?lang=xx` previews a language for this tab. `?lang=` ends the preview. */
function previewFromAddress(): string | null {
  try {
    const asked = new URLSearchParams(location.search).get('lang');
    if (asked === null) return sessionStorage.getItem(PREVIEW_KEY);
    if (isLanguage(asked)) sessionStorage.setItem(PREVIEW_KEY, asked);
    else sessionStorage.removeItem(PREVIEW_KEY);
    return isLanguage(asked) ? asked : null;
  } catch {
    return null;
  }
}

/** Fill in the sentences written into index.html, which t() can't reach. */
function translateStaticPage(): void {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n as MessageKey);
  });
  // Icon buttons: the same words for the screen reader and the hover label.
  document.querySelectorAll<HTMLElement>('[data-i18n-label]').forEach((el) => {
    const label = t(el.dataset.i18nLabel as MessageKey);
    el.setAttribute('aria-label', label);
    if (el.hasAttribute('title')) el.title = label;
  });
}

/** Runs once, before any other part of the app is loaded. Never rejects. */
export async function loadLanguage(): Promise<void> {
  const wanted = pickLanguage({
    preview: previewFromAddress(),
    choice: storedChoice(),
    browser: navigator.languages ?? [],
    released: RELEASED_LANGUAGES,
    redirects: BROWSER_REDIRECTS,
  });
  const load = DICTIONARIES[wanted];
  if (load) {
    try {
      const dictionary = await Promise.race([
        load(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), LOAD_TIMEOUT_MS)),
      ]);
      useDictionary(dictionary, wanted === 'xx' ? 'en' : wanted);
      current = wanted;
    } catch (err) {
      console.warn(`Couldn't load language "${wanted}", starting in English.`, err);
    }
  }
  document.documentElement.lang = current;
  if (current !== 'en') translateStaticPage();
}

export function activeLanguage(): Language {
  return current;
}

/** The current choice, or null when following the device. */
export function languageChoice(): Language | null {
  const choice = storedChoice();
  return isLanguage(choice) && RELEASED_LANGUAGES.includes(choice) ? choice : null;
}

/** What the language control offers. With only one, the control isn't shown. */
export function selectableLanguages(): readonly Language[] {
  return RELEASED_LANGUAGES.includes(current) ? RELEASED_LANGUAGES : [...RELEASED_LANGUAGES, current];
}

/** Save the choice (null follows the device again), then reload into it. */
export function setLanguageChoice(language: Language | null): void {
  // A language under preview can be seen but not chosen, so it can't reach the account.
  if (language && !RELEASED_LANGUAGES.includes(language)) return;
  try {
    sessionStorage.removeItem(PREVIEW_KEY);
    if (language) localStorage.setItem(LANGUAGE_KEY, language);
    else localStorage.removeItem(LANGUAGE_KEY);
  } catch {
    return;
  }
  const url = new URL(location.href);
  url.searchParams.delete('lang');
  location.replace(url);
}
