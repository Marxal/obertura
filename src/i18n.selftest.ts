// Pure checks of the translation layer: t(), its English fallback, the fake
// language and the choice of language. No DOM, no storage.

import { appLocale, englishDictionary, t, tOrdinal, tParts, useDictionary, type Dictionary } from './i18n';
import { pickLanguage, RELEASED_LANGUAGES, type Language } from './language-choice';
import { pseudoDictionary, pseudoText } from './locales/pseudo';
import ca from './locales/ca.json';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const placeholders = (text: string): string[] => (text.match(/\{\w+\}/g) ?? []).sort();

export function runI18nSelfTest(): TestResult[] {
  const out: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    out.push({ name, pass, detail });
  };

  // ── t() ────────────────────────────────────────────────────────────────────
  check('English is what t() reads by default', t('nav.home') === 'Home', t('nav.home'));

  const fake = { 'nav.home': 'Inici' } as Dictionary;
  useDictionary(fake, 'ca');
  check('a translated key shows the translation', t('nav.home') === 'Inici', t('nav.home'));
  check('a missing key falls back to English, never to the key name',
    t('nav.train') === 'Train', t('nav.train'));
  useDictionary(englishDictionary as Dictionary, 'en');

  const plural = {
    'nav.home': { one: '{n} línia', other: '{n} línies' },
    'nav.train': 'Hola {name}, {n} i {missing}',
  } as Dictionary;
  useDictionary(plural, 'ca');
  check('n = 1 picks the singular', t('nav.home', { n: 1 }) === '1 línia', t('nav.home', { n: 1 }));
  check('n = 3 picks the plural', t('nav.home', { n: 3 }) === '3 línies', t('nav.home', { n: 3 }));
  check('n = 0 uses the language\'s own rule', t('nav.home', { n: 0 }) === '0 línies', t('nav.home', { n: 0 }));
  check('a plural with no count falls to "other" rather than breaking',
    t('nav.home') === '{n} línies', t('nav.home'));
  check('values fill in, and a missing value stays visible',
    t('nav.train', { name: 'Marçal', n: 2 }) === 'Hola Marçal, 2 i {missing}', t('nav.train', { name: 'Marçal', n: 2 }));
  useDictionary(englishDictionary as Dictionary, 'en');

  const pieces = tParts('where.missing', { name: 7 }, { site: 'Lichess' });
  check('a sentence can hold something that isn\'t text',
    pieces.length === 3 && pieces[1] === 7 && pieces[2] === '” on Lichess. Check the spelling.', JSON.stringify(pieces));

  const ords = [1, 2, 3, 4, 11, 21, 22, 103].map((n) => tOrdinal('ordinal.number', n)).join(' ');
  check('ordinals follow the language\'s rules', ords === '1st 2nd 3rd 4th 11th 21st 22nd 103rd', ords);
  check('English dates follow the device', appLocale() === undefined);
  useDictionary(fake, 'ca');
  check('other languages write dates their own way', appLocale() === 'ca');
  useDictionary(englishDictionary as Dictionary, 'en');

  // ── The dictionary itself ──────────────────────────────────────────────────
  const empty = Object.entries(englishDictionary).filter(([, message]) => (
    typeof message === 'string' ? !message.trim() : !message.other?.trim()
  ));
  check('every English message has text', empty.length === 0, empty.map(([key]) => key).join(', '));

  // ── The fake language ──────────────────────────────────────────────────────
  const sentence = 'Your {count} games and <b>mistakes</b>';
  const pseudo = pseudoText(sentence);
  check('the fake language keeps placeholders', pseudo.includes('{count}'), pseudo);
  check('the fake language keeps markup', pseudo.includes('<b>') && pseudo.includes('</b>'), pseudo);
  check('the fake language is bracketed', pseudo.startsWith('[') && pseudo.endsWith(']'), pseudo);
  const long = 'Your most forgotten moves come back sooner';
  check('the fake language is about 40% longer',
    pseudoText(long).length >= long.length * 1.3, `${pseudoText(long).length} vs ${long.length}`);
  const pseudoAll = pseudoDictionary(englishDictionary);
  check('the fake language covers every key',
    Object.keys(pseudoAll).length === Object.keys(englishDictionary).length);
  const lostPlaceholder = Object.entries(englishDictionary).filter(([key, message]) => (
    typeof message === 'string' && String(placeholders(message)) !== String(placeholders(pseudoAll[key] as string))
  ));
  check('no key loses a placeholder in the fake language', lostPlaceholder.length === 0,
    lostPlaceholder.map(([key]) => key).join(', '));

  // ── The real languages ─────────────────────────────────────────────────────
  // A placeholder a translation lost shows nothing, and one it invented shows {like this}.
  for (const [lang, dictionary] of Object.entries({ ca }) as [string, Dictionary][]) {
    const extra = Object.keys(dictionary).filter((key) => !(key in englishDictionary));
    check(`${lang}: no keys English doesn't have`, extra.length === 0, extra.join(', '));
    const broken = Object.entries(dictionary).filter(([key, message]) => {
      const source = englishDictionary[key];
      if (source === undefined) return false;
      if (typeof message === 'string' && typeof source === 'string') {
        return String(placeholders(message)) !== String(placeholders(source));
      }
      // A plural's singular may say "one" instead of {n}, so it may use fewer, never others.
      const allowed = new Set(Object.values(source).flatMap((text) => placeholders(text)));
      return Object.values(message).some((text) => placeholders(text).some((p) => !allowed.has(p)));
    });
    check(`${lang}: placeholders match English`, broken.length === 0, broken.map(([key]) => key).join(', '));
    const shapes = Object.entries(dictionary).filter(([key, message]) => (
      englishDictionary[key] !== undefined && typeof message !== typeof englishDictionary[key]
    ));
    check(`${lang}: plurals stay plurals`, shapes.length === 0, shapes.map(([key]) => key).join(', '));
    const noOther = Object.entries(dictionary).filter(([, message]) => typeof message !== 'string' && !message.other);
    check(`${lang}: every plural has "other"`, noOther.length === 0, noOther.map(([key]) => key).join(', '));
    const empty2 = Object.entries(dictionary).filter(([, message]) => typeof message === 'string' && !message.trim());
    check(`${lang}: no empty sentences`, empty2.length === 0, empty2.map(([key]) => key).join(', '));
  }

  // ── Choosing a language ────────────────────────────────────────────────────
  const released: Language[] = ['en', 'ca', 'es'];
  const pick = (over: Partial<Parameters<typeof pickLanguage>[0]>): Language => pickLanguage({
    preview: null, choice: null, browser: [], released, redirects: {}, ...over,
  });
  check('a choice beats the browser', pick({ choice: 'ca', browser: ['es-ES'] }) === 'ca');
  check('the browser\'s first match wins', pick({ browser: ['fr-FR', 'es-ES', 'ca'] }) === 'es');
  check('English in the browser stops the search', pick({ browser: ['en-GB', 'es-ES'] }) === 'en');
  check('region and case don\'t matter', pick({ browser: ['CA-es'] }) === 'ca');
  check('nothing matching means English', pick({ browser: ['fr-FR', 'de'] }) === 'en');
  check('no browser list means English', pick({}) === 'en');
  check('an unreleased choice is ignored', pick({ choice: 'sv', browser: ['ca'] }) === 'ca');
  check('an unreleased browser language is ignored', pick({ browser: ['sv-SE'] }) === 'en');
  check('a corrupt choice is ignored', pick({ choice: 'constructor', browser: ['ca'] }) === 'ca');
  check('a preview beats everything', pick({ preview: 'xx', choice: 'ca', browser: ['es'] }) === 'xx');
  check('a preview can reach an unreleased language', pick({ preview: 'sv' }) === 'sv');
  check('a bad preview is ignored', pick({ preview: 'zz', choice: 'ca' }) === 'ca');

  // ── Spanish phones starting in Catalan ─────────────────────────────────────
  const redirects = { es: 'ca', 'es-es': 'ca' } as const;
  const steer = (browser: string[], onSale: Language[] = released): Language => pick({ browser, redirects, released: onSale });
  check('a Spanish phone starts in Catalan', steer(['es-ES', 'es', 'en']) === 'ca');
  check('plain Spanish counts as Spain', steer(['es']) === 'ca');
  check('a Mexican phone gets Spanish, not Catalan', steer(['es-MX', 'en']) === 'es');
  check('and English while Spanish isn\'t out', steer(['es-419'], ['en', 'ca']) === 'en');
  check('a strange language tag does nothing', steer(['constructor']) === 'en');
  check('so does a Catalan phone', steer(['ca-ES', 'es-ES']) === 'ca');
  check('a Swedish phone starts in Swedish', steer(['sv-SE'], ['en', 'ca', 'es', 'sv']) === 'sv');
  check('any other phone starts in English', steer(['fr-FR', 'de']) === 'en');
  check('an English phone with Spanish listed stays English', steer(['en-GB', 'es-ES']) === 'en');
  check('a German phone that also lists Spanish isn\'t redirected to Catalan', steer(['de-DE', 'es-ES']) === 'es');
  check('the same phone gets English when Spanish isn\'t out', steer(['de-DE', 'es-ES'], ['en', 'ca']) === 'en');
  check('choosing Spanish beats the redirect', pick({ choice: 'es', browser: ['es-ES'], redirects }) === 'es');
  check('choosing English beats the redirect', pick({ choice: 'en', browser: ['es-ES'], redirects }) === 'en');
  check('no redirect while Catalan isn\'t out: Spanish stays Spanish', steer(['es-ES'], ['en', 'es']) === 'es');
  check('and with neither out, English', steer(['es-ES'], ['en']) === 'en');
  check('without the redirect, Spanish phones get Spanish', pick({ browser: ['es-ES'] }) === 'es');

  check('the fake language can never be released', !RELEASED_LANGUAGES.includes('xx'));

  return out;
}
