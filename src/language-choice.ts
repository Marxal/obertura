// Which language the app runs in: the decision alone, with no storage or DOM, so
// it can be tested. language.ts feeds it from the device.

export type Language = 'en' | 'ca' | 'es' | 'sv' | 'xx';

export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English', ca: 'Català', es: 'Español', sv: 'Svenska', xx: 'Fake language',
};

/** What people can pick or be detected into. A language joins this list once reviewed. */
export const RELEASED_LANGUAGES: readonly Language[] = ['en'];

/**
 * A phone in one language that starts the app in another, while we go after one
 * audience first. Many Catalans have their phone in Spanish, so for now Spanish phones
 * from Spain start in Catalan, and the person can switch in Settings. Plain `es` counts,
 * since it names no other country. Other Spanish (`es-MX`) isn't listed: Catalan means
 * nothing there. Delete the lines when Spain should get Spanish.
 */
export const BROWSER_REDIRECTS: Readonly<Record<string, Language>> = { es: 'ca', 'es-es': 'ca' };

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LANGUAGE_NAMES, value);
}

export function pickLanguage(input: {
  /** A `?lang=` preview. It can reach unreleased languages, for testing and review. */
  preview: string | null;
  /** What the person chose in Settings or first run. */
  choice: string | null;
  /** navigator.languages, in the browser's order of preference. */
  browser: readonly string[];
  released: readonly Language[];
  /** BROWSER_REDIRECTS. Has no effect until the language it points to is released. */
  redirects: Readonly<Record<string, Language>>;
}): Language {
  if (isLanguage(input.preview)) return input.preview;
  const { released } = input;
  if (isLanguage(input.choice) && released.includes(input.choice)) return input.choice;
  for (const [position, tag] of input.browser.entries()) {
    const lower = tag.toLowerCase();
    // Only the phone's main language: a German phone that also lists Spanish isn't
    // who a redirect is for.
    const redirect = position === 0 ? input.redirects[lower] : undefined;
    if (redirect && released.includes(redirect)) return redirect;
    const primary = lower.split('-')[0];
    if (isLanguage(primary) && released.includes(primary)) return primary;
  }
  return 'en';
}
