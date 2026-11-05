// The landing page's language versions: complete, with the chess intact, and with the
// redirect from `/` following the same rule as the app. No browser needed.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildEnglishLegalPage, buildLanguagePage, buildLegalPage, buildRootPage, buildSitemap, landingText, localiseMoves } from './landing-pages.mjs';
import { formatMove } from '../src/notation';
import { englishDictionary, useDictionary, type Dictionary } from '../src/i18n';
import { BROWSER_REDIRECTS, pickLanguage, type Language } from '../src/language-choice';
import { checkoutLocale } from '../worker/checkout-locale';

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
const LEGAL_KEEP = /^(bito chess|Bito Chess|Supabase|Cloudflare|Stripe|Google|Resend|Web3Forms|© 2026 Bito Chess|creative@marxal\.net|stripe\.com\/.*|.*\.se|Umami|ARN|IMY|Lichess|Chess\.com|chess-api\.com|YouTube|EU \(Frankfurt\)|USA|ec\.europa\.eu.*|\.)$/;
const words = (lang: string): LandingWords => JSON.parse(readFileSync(new URL(`../src/locales/landing/${lang}.json`, import.meta.url), 'utf8'));

// Names and moves read the same in every language.
const KEEP = /^(bito chess|Bito Chess|Chess\.com|Lichess|Marçal|Marçal, marxal\.net|Ruy López|© 2026 Bito Chess|5 parts|\d+[.…]+[a-h]?x?[a-h][1-8])$/;
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
    const left = landingText(page).texts.filter((t) => english.texts.includes(t) && !KEEP.test(t));
    check(`${lang}: no landing text left in English`, left.length === 0, left.slice(0, 5).join(' | '));

    const stale = [
      ...Object.keys(dictionary.text ?? {}).filter((k) => !english.texts.includes(k)),
      ...Object.keys(dictionary.scripts ?? {}).filter((k) => !english.scripts.includes(k)),
      ...Object.keys({ ...dictionary.blocks, ...dictionary.data }).filter((k) => !html.includes(k)),
    ];
    check(`${lang}: every translation still has its English on the page`, stale.length === 0, stale.slice(0, 5).join(' | '));

    const all = { ...dictionary.text, ...dictionary.scripts, ...dictionary.blocks };
    const wrong = Object.entries(all).filter(([en, tr]) => chessIn(en) !== chessIn(tr));
    check(`${lang}: the landing page's moves match the English`, wrong.length === 0, wrong.slice(0, 3).map(([en]) => en).join(' | '));

    check(`${lang}: the page says what language it is`, page.includes(`<html lang="${lang}"`));
    check(`${lang}: it points at its own address`, page.includes(`rel="canonical" href="https://bitochess.com/${lang}/"`));
    check(`${lang}: images load from one folder up, and privacy and terms from this one`,
      page.includes('src="../art/') && page.includes('href="privacy.html"') && page.includes('href="../licences.html"') && !/\b(src|srcset|imagesrcset)="art\//.test(page) && page.includes("url('../fonts/"));
    check(`${lang}: links on the page itself still stay on the page`, /href="#[a-z]/.test(page) && !page.includes('href="../#'));
    check(`${lang}: opening the app carries the language`, page.includes(`'obertura.language','${lang}'`));
    check(`${lang}: the page scripts still parse`, [...page.matchAll(/<script(?![^>]*ld\+json)[^>]*>([\s\S]*?)<\/script>/g)].every((m) => {
      try { new vm.Script(m[1]); return true; } catch { return false; }
    }));
  }

  const catalan = JSON.stringify(words('ca'));
  check('Catalan: "cagada" stays inside the app', !/cagad/i.test(catalan));

  // ── Privacy and terms ───────────────────────────────────────────────────────
  for (const lang of ['ca', 'es', 'sv']) {
    const dictionary = legalWords(lang);
    const stale: string[] = [];
    const left: string[] = [];
    let used = '';
    for (const file of ['privacy.html', 'terms.html']) {
      const english = readFileSync(new URL(`../docs/${file}`, import.meta.url), 'utf8');
      const page = buildLegalPage(english, file, lang, dictionary, []);
      used += english;
      const before = landingText(english).texts;
      left.push(...landingText(page).texts.filter((t) => before.includes(t) && !LEGAL_KEEP.test(t)));
      check(`${lang}: ${file} says the English governs, and links to it`, page.includes('data-translation-notice') && page.includes(`href="/${file}"`));
      check(`${lang}: ${file} points at its own address`, page.includes(`rel="canonical" href="https://bitochess.com/${lang}/${file}"`) && page.includes(`<html lang="${lang}"`));
      check(`${lang}: ${file} loads its styles from one folder up`, page.includes('href="../legal.css"') && page.includes('href="../licences.html"') && page.includes('href="./"'));
    }
    for (const key of Object.keys({ ...dictionary.text, ...dictionary.blocks })) if (!used.includes(key.replace('&amp;', '&amp;'))) stale.push(key);
    check(`${lang}: no privacy or terms text left in English`, left.length === 0, [...new Set(left)].slice(0, 5).join(' | '));
    check(`${lang}: every privacy or terms translation still has its English`, stale.length === 0, stale.slice(0, 3).join(' | '));
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

  // ── Checkout ────────────────────────────────────────────────────────────────
  check('Catalan buyers get Stripe in Spanish, which is the closest it has', checkoutLocale('ca') === 'es');
  check('Spanish and Swedish get their own', checkoutLocale('es') === 'es' && checkoutLocale('sv') === 'sv');
  check('English and anything unknown stay as they were', checkoutLocale('en') === 'auto' && checkoutLocale('en-GB') === 'auto' && checkoutLocale(undefined) === 'auto' && checkoutLocale(7) === 'auto');
  check('a landing page language counts too', checkoutLocale('sv') === 'sv' && checkoutLocale('ca') === 'es');

  return out;
}
