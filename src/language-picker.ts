// The language control, in Settings and on first run. Shows nothing until there is
// more than one language to choose.
//
// SHORT CODES, NOT A DROPDOWN (2026-11-06): ES · EN · SV · CA, every language one tap
// away, as on the landing page. The dropdown was a small grey pill that didn't read
// as a control on a phone. Each code carries its language's own name as its label,
// so someone stuck in the wrong language can still find theirs. "Automatic" went with
// the dropdown: a fresh install still follows the phone until something is tapped.

import { activeLanguage, selectableLanguages, setLanguageChoice } from './language';
import { LANGUAGE_NAMES } from './language-choice';
import { t } from './i18n';
import { segmented } from './settings-controls';
import type { Language } from './language-choice';

export function hasLanguageChoice(): boolean {
  return selectableLanguages().length > 1;
}

// Marçal's order. A language under preview (?lang=) isn't in it, so it gets no code.
const CODE_ORDER: readonly Language[] = ['es', 'en', 'sv', 'ca'];

function codeLanguages(): Language[] {
  const selectable = selectableLanguages();
  return CODE_ORDER.filter((l) => selectable.includes(l));
}

function choose(language: Language): void {
  if (language !== activeLanguage()) setLanguageChoice(language);
}

/** The codes as a segmented control, for a Settings row. */
export function buildLanguageCodes(): HTMLElement {
  const languages = codeLanguages();
  const current = (languages.includes(activeLanguage()) ? activeLanguage() : languages[0]);
  const control = segmented<Language>(
    languages.map((l) => ({ value: l, label: l.toUpperCase() })),
    current,
    choose,
  );
  control.classList.add('lang-codes');
  control.setAttribute('aria-label', t('settings.language'));
  for (const btn of control.querySelectorAll<HTMLButtonElement>('.seg-btn')) {
    const name = LANGUAGE_NAMES[btn.dataset.value as Language];
    btn.title = name;
    btn.setAttribute('aria-label', name);
  }
  return control;
}

/** The codes as a quiet line of text: first run's top bar, and the foot of Settings. */
export function buildLanguageRail(): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'lang-rail';
  nav.setAttribute('aria-label', t('settings.language'));
  for (const language of codeLanguages()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lang-rail-code';
    btn.textContent = language.toUpperCase();
    btn.title = LANGUAGE_NAMES[language];
    btn.setAttribute('aria-label', LANGUAGE_NAMES[language]);
    const on = language === activeLanguage();
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.addEventListener('click', () => choose(language));
    nav.appendChild(btn);
  }
  return nav;
}
