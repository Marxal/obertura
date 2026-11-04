// The language control, in Settings and on first run. Shows nothing until there is
// more than one language to choose. The names are always in their own language, so
// someone stuck in the wrong one can still find theirs.

import { Icons } from './icons';
import { activeLanguage, languageChoice, selectableLanguages, setLanguageChoice } from './language';
import { LANGUAGE_NAMES, isLanguage } from './language-choice';
import { t } from './i18n';

export function hasLanguageChoice(): boolean {
  return selectableLanguages().length > 1;
}

export function buildLanguagePicker(): HTMLElement {
  const pill = document.createElement('label');
  pill.className = 'lib-band-pick';

  const label = document.createElement('span');
  label.className = 'lib-band-pick-label';
  label.textContent = LANGUAGE_NAMES[activeLanguage()];
  pill.appendChild(label);

  const chevron = Icons.chevronDown(12);
  chevron.classList.add('lib-band-pick-chev');
  pill.appendChild(chevron);

  const select = document.createElement('select');
  select.className = 'lib-band-select';
  select.setAttribute('aria-label', t('settings.language'));

  const automatic = document.createElement('option');
  automatic.value = '';
  automatic.textContent = t('settings.language.automatic');
  select.appendChild(automatic);

  for (const language of selectableLanguages()) {
    const option = document.createElement('option');
    option.value = language;
    option.textContent = LANGUAGE_NAMES[language];
    select.appendChild(option);
  }
  select.value = languageChoice() ?? '';

  select.addEventListener('change', () => {
    setLanguageChoice(isLanguage(select.value) ? select.value : null);
  });
  pill.appendChild(select);
  return pill;
}
