// The landing page's language versions: complete, with the chess intact, and with the
// redirect from `/` following the same rule as the app. No browser needed.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildEnglishLegalPage, buildLanguagePage, buildLegalPage, buildRootPage, buildSitemap, landingText, localiseMoves, rewriteEnglish } from './landing-pages.mjs';
import { formatMove } from '../src/notation';
import { englishDictionary, useDictionary, type Dictionary } from '../src/i18n';
import { BROWSER_REDIRECTS, pickLanguage, type Language } from '../src/language-choice';
import { checkoutLocale } from '../worker/checkout-locale';
import { checkEdit, copySections, replaceDictionaryLine } from './copy-editor.mjs';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

interface LandingWords {
  blocks?: Record<string, string>;
  data?: Record<string, string>;
  text?: Record<string, string>;
  scripts?: Record<string, string>;
}

const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
const legalWords = (lang: string): LandingWords & { notice: string } => JSON.parse(readFileSync(new URL(`../src/locales/legal/${lang}.json`, import.meta.url), 'utf8'));

const words = (lang: string): LandingWords => JSON.parse(readFileSync(new URL(`../src/locales/landing/${lang}.json`, import.meta.url), 'utf8'));

const CHESS = /(?<![A-Za-zÀ-ÿ0-9])(O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)(?![A-Za-zÀ-ÿ0-9])/g;
const chessIn = (text: string): string => [...text.matchAll(CHESS)].map((m) => m[1]).sort().join(' ');

// Run the page's redirect snippet against a pretend browser.
function redirectFor(released: string[], browser: string[], saved: string | null = null, search = ''): string | null {
  const page = buildRootPage('<head></head><footer></footer>', released, BROWSER_REDIRECTS);
  const snippet = page.match(/<script>(\(function\(\)\{try\{if\(localStorage[\s\S]*?)<\/script>/)?.[1];
  if (!snippet) return null;
  let target: string | null = null;
  vm.runInNewContext(snippet, {
    localStorage: { getItem: () => saved },
    navigator: { languages: browser, language: browser[0] },
    location: { search, replace: (to: string) => { target = to; } },
  });
  return target;
}

export function runLandingPagesSelfTest(): TestResult[] {
  const out: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    out.push({ name, pass, detail });
  };
  const english = landingText(html);

  for (const lang of ['ca', 'es', 'sv']) {
    const dictionary = words(lang);
    const page = buildLanguagePage(html, lang, dictionary, []);
    const untranslated = landingText(page).scripts.filter((s) => /^(White to move|Fewer|More|Moves$)/.test(s));
    check(`${lang}: the page's scripts have no English sentence left that we know of`, untranslated.length === 0, untranslated.join(' | '));
    check(`${lang}: moves are in the language's letters`, !/<b>Nf3<\/b>|san: 'Ne7\+'|5\.Nxe5/.test(page) && page.includes(`<b>${localiseMoves('Nf3', lang)}</b>`));
    useDictionary(englishDictionary as Dictionary, lang);
    check(`${lang}: the same letters as the app`, ['Nf3', 'Bxf7+', 'Rd1', 'Qh5#', 'Kf1'].every((m) => localiseMoves(m, lang) === formatMove(m, 'standard')));
    useDictionary(englishDictionary as Dictionary, 'en');

    const all = { ...dictionary.text, ...dictionary.scripts, ...dictionary.blocks };
    const wrong = Object.entries(all).filter(([en, tr]) => chessIn(en) !== chessIn(tr));
    check(`${lang}: the landing page's moves match the English`, wrong.length === 0, wrong.slice(0, 3).map(([en]) => en).join(' | '));

    check(`${lang}: the page says what language it is`, page.includes(`<html lang="${lang}"`));
    check(`${lang}: it points at its own address`, page.includes(`rel="canonical" href="https://bitochess.com/${lang}/"`));
    check(`${lang}: images load from one folder up, and privacy and terms from this one`,
      page.includes('src="../art/') && page.includes('href="privacy.html"') && page.includes('href="licences.html"') && !/\b(src|srcset|imagesrcset)="art\//.test(page) && page.includes("url('../fonts/"));
    check(`${lang}: links on the page itself still stay on the page`, /href="#[a-z]/.test(page) && !page.includes('href="../#'));
    check(`${lang}: opening the app carries the language`, page.includes(`'obertura.language','${lang}'`));
    check(`${lang}: the page scripts still parse`, [...page.matchAll(/<script(?![^>]*ld\+json)[^>]*>([\s\S]*?)<\/script>/g)].every((m) => {
      try { new vm.Script(m[1]); return true; } catch { return false; }
    }));
  }

  // Marçal's call (2026-11-05): "cagades" may be on the landing page, in its colour. Never the legal text.
  check('Catalan: "cagada" stays out of the legal pages', !/cagad/i.test(JSON.stringify(legalWords('ca'))));
  const coloured = buildLanguagePage(html, 'ca', { text: { 'Become a blunder detective': 'Fes de detectiu de <span class="word-blunder">cagades</span>' } }, []);
  check('ca: a coloured word reaches the page as markup', coloured.includes('<h3>Fes de detectiu de <span class="word-blunder">cagades</span></h3>'));
  check('the colours exist on the page', html.includes('.word-blunder {') && html.includes('.word-mistake {'));
  const labelled = buildLanguagePage('<a aria-label="Mistakes">Mistakes</a>', 'ca', { text: { Mistakes: '<span class="word-mistake">Badades</span>' } }, []);
  check('a coloured word stays out of a label', labelled.includes('aria-label="Badades"'), labelled);

  // ── Privacy and terms ───────────────────────────────────────────────────────
  for (const lang of ['ca', 'es', 'sv']) {
    const dictionary = legalWords(lang);
    for (const file of ['privacy.html', 'terms.html', 'licences.html']) {
      const english = readFileSync(new URL(`../docs/${file}`, import.meta.url), 'utf8');
      const page = buildLegalPage(english, file, lang, dictionary, []);
      check(`${lang}: ${file} says the English governs, and links to it`, page.includes('data-translation-notice') && page.includes(`href="/${file}"`));
      check(`${lang}: ${file} points at its own address`, page.includes(`rel="canonical" href="https://bitochess.com/${lang}/${file}"`) && page.includes(`<html lang="${lang}"`));
      check(`${lang}: ${file} loads its styles from one folder up`, page.includes('href="../legal.css"') && page.includes('href="licences.html"') && page.includes('href="./"'));
    }
    const allLegal = JSON.stringify(dictionary);
    check(`${lang}: the legal pages keep the facts`, ['SE871224129101', 'creative@marxal.net', '120', '500', '13', '14', '30', '60'].every((f) => allLegal.includes(f)));
  }
  const terms = readFileSync(new URL('../docs/terms.html', import.meta.url), 'utf8');
  check('the English terms say the English governs', terms.includes('the English version applies'));
  check('the price is 120 SEK in the terms', terms.includes('€12 / 120 SEK') && !terms.includes('139'));
  check('with nothing released, the English legal pages are untouched', buildEnglishLegalPage(terms, 'terms.html', []) === terms);
  check('the search data has the real price', html.includes('"price": "12"') && !html.includes('"price": "9"'));

  // ── `/` ─────────────────────────────────────────────────────────────────────
  check('with nothing released, `/` is untouched', buildRootPage(html, [], BROWSER_REDIRECTS) === html);
  check('with nothing released, the sitemap gains nothing', buildSitemap('<urlset></urlset>', []) === '<urlset></urlset>');
  check('a released language appears in the sitemap', buildSitemap('<urlset></urlset>', ['ca']).includes('https://bitochess.com/ca/'));
  const rootWithCa = buildRootPage(html, ['ca'], BROWSER_REDIRECTS);
  check('a released language gets a link from `/`', rootWithCa.includes('hreflang="ca"') && rootWithCa.includes('data-language-choice="ca"'));

  const rail = (html2: string): string[] => [...(html2.match(/<nav class="lang-rail"[\s\S]*?<\/nav>/)?.[0] ?? '').matchAll(/<span class="lang-rail__short">([A-Z]{2})<\/span>/g)].map((m) => m[1]);
  const all = ['ca', 'es', 'sv'];
  check('the switcher on `/` leaves out English, in order', rail(buildRootPage(html, all, BROWSER_REDIRECTS)).join(' ') === 'CA ES SV');
  check('the switcher on /ca/ leaves out Catalan, in order', rail(buildLanguagePage(html, 'ca', words('ca'), all)).join(' ') === 'ES EN SV');
  check('the switcher on /sv/ leaves out Swedish, in order', rail(buildLanguagePage(html, 'sv', words('sv'), all)).join(' ') === 'CA ES EN');
  check('the switcher only offers released languages', rail(buildLanguagePage(html, 'ca', words('ca'), ['ca'])).join(' ') === 'EN');

  check('Catalan phone goes to /ca/', redirectFor(['ca'], ['ca-ES']) === '/ca/');
  check("Spain's Spanish goes to /ca/ for now", redirectFor(['ca'], ['es-ES', 'en']) === '/ca/');
  check('Mexican Spanish stays on `/` until Spanish is released', redirectFor(['ca'], ['es-MX', 'en']) === null);
  check('Mexican Spanish goes to /es/ once it is', redirectFor(['ca', 'es'], ['es-MX']) === '/es/');
  check('Swedish goes to /sv/', redirectFor(['ca', 'sv'], ['sv-SE']) === '/sv/');
  check('English stays', redirectFor(['ca', 'es', 'sv'], ['en-GB', 'ca']) === null);
  check('a saved choice is never redirected', redirectFor(['ca'], ['ca-ES'], 'en') === null);
  check('nothing released, nothing redirects', redirectFor([], ['ca-ES']) === null);

  // The landing page and the app have to agree, or someone changes language on the way in.
  const cases = [['ca-ES'], ['es-ES', 'en'], ['es-MX', 'en'], ['sv-SE'], ['en-GB', 'ca'], ['fr-FR'], ['fr-FR', 'ca'], ['pt-BR', 'es']];
  const released = ['ca', 'es', 'sv'];
  const differ = cases.filter((browser) => {
    const app = pickLanguage({ preview: null, choice: null, browser, released: ['en', ...released] as Language[], redirects: BROWSER_REDIRECTS });
    const landing = redirectFor(released, browser);
    return (landing ?? '/en/') !== `/${app}/`;
  });
  check('`/` and the app pick the same language', differ.length === 0, differ.map((c) => c.join(',')).join(' | '));

  // ── The copy editor ─────────────────────────────────────────────────────────
  const editable = (section: string, en: string) => ({ section, en });
  check('the editor takes a free rewording', checkEdit(editable('landing', 'Improve your next move'), 'Juga millor demà', 'ca') === null);
  check('the editor refuses an empty sentence', checkEdit(editable('landing', 'Hi'), '  ', 'ca') !== null);
  check('the editor refuses a lost placeholder', checkEdit(editable('app', '{n} lines'), '3 línies', 'ca') !== null);
  check('the editor refuses a lost link', checkEdit(editable('legal', 'See <a href="x">this</a>'), 'Mira això', 'ca') !== null);
  check('the editor refuses a changed move', checkEdit(editable('packs', 'Play Nf3 and d4'), 'Juga Nf3 i d5', 'ca') !== null);
  check('the editor accepts the same moves reworded', checkEdit(editable('packs', 'Play Nf3 and d4'), 'Primer d4, després Nf3', 'ca') === null);
  check('the editor lets "cagades" onto the landing page', checkEdit(editable('landing', 'Mistakes'), 'Cagades', 'ca') === null);
  check('the editor takes a word in a move colour', checkEdit(editable('landing', 'Try your mistakes again'), 'Torna a provar les teves <span class="word-mistake">badades</span>', 'ca') === null);
  check('the editor refuses any other new tag', checkEdit(editable('landing', 'Try your mistakes again'), 'Torna a provar les <a href="x">badades</a>', 'ca') !== null);
  check('the English tab refuses a changed move', checkEdit(editable('packs', 'Play Nf3 and d4'), 'Play Nc3 and d4', 'en') !== null);
  check('the English tab takes a rewording', checkEdit(editable('app', '{n} lines'), '{n} lines saved', 'en') === null && checkEdit(editable('app', '{n} lines'), 'Some lines', 'en') !== null);
  const page = '<h3>\n  Become a blunder\n  detective</h3><p title="Become a blunder detective">x</p><script>var a = \'Find it\';</script>';
  const rewritten = rewriteEnglish(page, 'text', 'Become a blunder detective', 'Turn detective');
  check('the English tab rewrites a heading and its label, keeping the spacing', rewritten.startsWith('<h3>\n  Turn detective</h3><p title="Turn detective">'), rewritten);
  check('the English tab rewrites a script sentence', rewriteEnglish(page, 'scripts', 'Find it', "It's here").includes("var a = 'It\\'s here';"));
  check('the English tab leaves scripts alone for page text', rewriteEnglish(page, 'text', 'Find it', 'x') === page);
  const englishTab = copySections('en');
  check('the English tab lists the landing page, the app and the packs', englishTab.map((s: { id: string }) => s.id).join() === 'landing,app,packs');
  const englishItems = englishTab.flatMap((s: { groups: { items: { en: string; value: string }[] }[] }) => s.groups.flatMap((g) => g.items));
  check(`the English as written passes the English tab's rules (${englishItems.length})`, englishItems.every((i: { en: string; value: string }) => checkEdit(i, i.value, 'en') === null));
  const dictionary = '{\n  "a.b": "old",\n  "c.d": {"one": "x", "other": "y"},\n  "e.f": "z"\n}\n';
  const edited = replaceDictionaryLine(dictionary, 'a.b', 'new "words"');
  check('a dictionary edit changes one line', edited === '{\n  "a.b": "new \\"words\\"",\n  "c.d": {"one": "x", "other": "y"},\n  "e.f": "z"\n}\n', edited);
  check('a plural stays on its line', replaceDictionaryLine(dictionary, 'c.d', { one: '1', other: '2' }).includes('"c.d": {"one": "1", "other": "2"},'));
  for (const lang of ['ca', 'es', 'sv']) {
    const sections = copySections(lang);
    const items = sections.flatMap((s: { groups: { items: { section: string; en: string; value: string; path: string[] }[] }[] }) => s.groups.flatMap((g) => g.items));
    // A sentence not translated yet is waiting, not wrong: `npm run i18n:status` lists those.
    const refused = items.filter((i: { value: string }) => i.value && checkEdit(i, i.value, lang) !== null);
    check(`${lang}: everything already written passes the editor's own rules (${items.length})`, refused.length === 0,
      refused.slice(0, 3).map((i: { en: string }) => i.en.slice(0, 50)).join(' | '));
  }

  // ── Checkout ────────────────────────────────────────────────────────────────
  check('Catalan buyers get Stripe in Spanish, which is the closest it has', checkoutLocale('ca') === 'es');
  check('Spanish and Swedish get their own', checkoutLocale('es') === 'es' && checkoutLocale('sv') === 'sv');
  check('English and anything unknown stay as they were', checkoutLocale('en') === 'auto' && checkoutLocale('en-GB') === 'auto' && checkoutLocale(undefined) === 'auto' && checkoutLocale(7) === 'auto');
  check('a landing page language counts too', checkoutLocale('sv') === 'sv' && checkoutLocale('ca') === 'es');

  return out;
}
