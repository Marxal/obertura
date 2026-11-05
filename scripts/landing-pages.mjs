// Generates the language versions of the landing page and the legal pages from docs/, so
// there is one page to edit and not four. The translations are in
// src/locales/landing/<lang>.json and src/locales/legal/<lang>.json, keyed by the English
// text: nothing marks up the pages, and an English sentence that changes simply falls back
// to English there until it is translated again (`scripts/landing-pages.selftest.ts` lists
// those). A translation is free to say something different from the English.
//
// What gets translated:
//   - text between tags, with its surrounding whitespace kept
//   - the attributes people read or hear (LABEL_ATTRIBUTES, plus <meta content>)
//   - string literals in the page's scripts, only when the dictionary has that string
//   - `blocks`: a whole element's inner HTML, for a sentence with a link or <em> in it,
//     because a sentence must never be translated in fragments
//   - moves everywhere on the page, into the language's own letters: Nf3 is Cf3 in Catalan
//
// No dependencies, because this runs inside the deploy build.

const LABEL_ATTRIBUTES = ['alt', 'aria-label', 'title', 'placeholder', 'data-name', 'data-one', 'data-many'];

// The address of each language's page, and how the page says so.
export const LANDING_LANGUAGES = {
  ca: { name: 'Català', locale: 'ca_ES' },
  es: { name: 'Español', locale: 'es_ES' },
  sv: { name: 'Svenska', locale: 'sv_SE' },
};

const SITE = 'https://bitochess.com/';

// Text that reads the same in every language: names and moves. Not waiting for a translation.
export const LANDING_KEEP = /^(bito chess|Bito Chess|Chess\.com|Lichess|Marçal|Marçal, marxal\.net|Ruy López|© 2026 Bito Chess|5 parts|\d+[.…]+[a-h]?x?[a-h][1-8])$/;
export const LEGAL_KEEP = /^(Component|Data|Software|github\.com\/Marxal\/obertura|openfontlicense\.org|MIT|Apache-2\.0|BSD-2-Clause|[A-Z-]+-[0-9.]+(-or-later|-[A-Z]+)*|CC-BY.*|cburnett|Maestro|California|Mpchess|Kiwen-Suwi|Horsey|Gioco|Tatiana|Letter|Anarcandy|Colin M\.L\. Burnett|sadsnake1|Jerry S\.|Maxime Chupin|neverRare|cham, michael1241|usolando|caderek|[a-zA-Z-]+\/[a-zA-Z0-9.-]+|chessground|Stockfish|chess\.js|supabase-js|Vite|@bity.*|Lichess chess-openings|Chakra Petch|SIL Open Font License 1\.1|Cadson Demak|bito chess|Bito Chess|Supabase|Cloudflare|Stripe|Google|Resend|Web3Forms|© 2026 Bito Chess|creative@marxal\.net|stripe\.com\/.*|.*\.se|Umami|ARN|IMY|Lichess|Chess\.com|chess-api\.com|YouTube|EU \(Frankfurt\)|USA|ec\.europa\.eu.*|\.)$/;

// The same letters as src/notation.ts, and a selftest holds them together. The page has
// no notation setting, so it uses the language's letters as the English page uses its own.
const LETTERS = {
  ca: { K: 'R', Q: 'D', R: 'T', B: 'A', N: 'C' },
  es: { K: 'R', Q: 'D', R: 'T', B: 'A', N: 'C' },
  sv: { K: 'K', Q: 'D', R: 'T', B: 'L', N: 'S' },
};
const MOVE = /(?<![\p{L}\p{N}])([KQRBN])([a-h]?[1-8]?x?[a-h][1-8][+#]?)(?![\p{L}\p{N}])/gu;

export function localiseMoves(text, lang) {
  return text.replace(MOVE, (_all, piece, rest) => LETTERS[lang][piece] + rest);
}

const normalise = (text) => text.replace(/\s+/g, ' ').trim();
const hasWords = (text) => /\p{L}{2}/u.test(text);

// Split the page into the parts that hold code (never touched) and the parts that hold text.
function regions(html) {
  const out = [];
  const pattern = /<!--[\s\S]*?-->|<style\b[\s\S]*?<\/style>|<script\b[^>]*>[\s\S]*?<\/script>/g;
  let last = 0;
  for (const match of html.matchAll(pattern)) {
    if (match.index > last) out.push({ kind: 'markup', text: html.slice(last, match.index) });
    const code = match[0];
    let kind = 'raw';
    if (code.startsWith('<style')) kind = 'style';
    else if (code.startsWith('<script')) kind = /ld\+json/.test(code.slice(0, 80)) ? 'data' : 'script';
    out.push({ kind, text: code });
    last = match.index + code.length;
  }
  if (last < html.length) out.push({ kind: 'markup', text: html.slice(last) });
  return out;
}

const TEXT_NODE = />([^<]+)</g;
const ATTRIBUTE = new RegExp(`\\s(${LABEL_ATTRIBUTES.join('|')})="([^"]*)"`, 'g');
const META_CONTENT = /<meta\s+(?:name|property)="(description|og:title|og:description|og:image:alt|twitter:title|twitter:description|twitter:image:alt)"\s+content="([^"]*)"/g;
const STRING_LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g;

// The English a page offers for translation, for the coverage test and for translators.
export function landingText(html) {
  const texts = new Set();
  const scripts = new Set();
  for (const part of regions(html)) {
    if (part.kind === 'markup') {
      for (const m of part.text.matchAll(TEXT_NODE)) {
        const text = normalise(m[1]);
        if (text && hasWords(text)) texts.add(text);
      }
      for (const m of part.text.matchAll(ATTRIBUTE)) if (hasWords(m[2])) texts.add(normalise(m[2]));
      for (const m of part.text.matchAll(META_CONTENT)) texts.add(normalise(m[2]));
    } else if (part.kind === 'script') {
      for (const m of part.text.matchAll(STRING_LITERAL)) {
        const text = m[1] ?? m[2];
        if (text && hasWords(text)) scripts.add(text);
      }
    }
  }
  return { texts: [...texts], scripts: [...scripts] };
}

// Page assets are relative to the site root, and this page sits one folder down. The home
// page, privacy, terms and licences exist in the same folder, so links to them stay.
function fromSubfolder(html) {
  return html
    .replace(/\b(href|src)="(?!https?:|mailto:|#|\/|\.\.\/|\.\/|data:|tel:|privacy\.html|terms\.html|licences\.html)([^"]+)"/g, '$1="../$2"')
    .replace(/\b(srcset|imagesrcset)="([^"]+)"/g, (_all, name, list) => `${name}="${list.split(',').map((item) => `../${item.trim()}`).join(', ')}"`)
    .replace(/url\('fonts\//g, "url('../fonts/")
    .replace(/content="(?!https?:)([\w./-]+\.(?:png|webp|jpg))"/g, 'content="../$1"');
}

function escapeForAttribute(text) {
  return text.replace(/"/g, '&quot;');
}

function translateScript(code, dictionary, lang) {
  return code.replace(STRING_LITERAL, (whole, single, double) => {
    const text = single ?? double;
    const translated = dictionary.scripts?.[text];
    const quote = whole[0];
    if (translated === undefined) return `${quote}${localiseMoves(text, lang)}${quote}`;
    const safe = localiseMoves(translated, lang).replace(/\\/g, '\\\\').replaceAll(quote, `\\${quote}`);
    return `${quote}${safe}${quote}`;
  });
}

function translateMarkup(markup, dictionary, lang) {
  const lookup = dictionary.text ?? {};
  return markup
    .replace(TEXT_NODE, (whole, raw) => {
      const translated = lookup[normalise(raw)];
      if (translated === undefined) return `>${localiseMoves(raw, lang)}<`;
      const before = raw.match(/^\s*/)[0];
      const after = raw.match(/\s*$/)[0];
      return `>${before}${localiseMoves(translated, lang)}${after}<`;
    })
    .replace(ATTRIBUTE, (whole, name, raw) => {
      const translated = lookup[normalise(raw)];
      return translated === undefined ? whole : ` ${name}="${escapeForAttribute(plain(translated))}"`;
    })
    .replace(META_CONTENT, (whole, _name, raw) => {
      const translated = lookup[normalise(raw)];
      return translated === undefined ? whole : whole.replace(`content="${raw}"`, `content="${escapeForAttribute(plain(translated))}"`);
    });
}

// A coloured word (`<span class="word-blunder">`) is for the page, not for a label or a tab title.
const plain = (text) => text.replace(/<[^>]+>/g, '');

/**
 * The English page with one sentence changed wherever the page shows it, for the copy
 * editor's English tab. `part` is where the dictionaries keep it: text, blocks or scripts.
 */
export function rewriteEnglish(html, part, before, after) {
  if (part === 'blocks') return html.replaceAll(`>${before}</`, `>${after}</`);
  return regions(html).map((region) => {
    if (part === 'scripts') {
      if (region.kind !== 'script') return region.text;
      return region.text.replace(STRING_LITERAL, (whole, single, double) => {
        if ((single ?? double) !== before) return whole;
        const quote = whole[0];
        return `${quote}${after.replace(new RegExp(`(?<!\\\\)${quote}`, 'g'), `\\${quote}`)}${quote}`;
      });
    }
    if (region.kind !== 'markup') return region.text;
    return region.text
      .replace(TEXT_NODE, (whole, raw) => {
        if (normalise(raw) !== before) return whole;
        return `>${raw.match(/^\s*/)[0]}${after}${raw.match(/\s*$/)[0]}<`;
      })
      .replace(ATTRIBUTE, (whole, name, raw) => (normalise(raw) === before ? ` ${name}="${escapeForAttribute(after)}"` : whole))
      .replace(META_CONTENT, (whole, _name, raw) => (normalise(raw) === before ? whole.replace(`content="${raw}"`, `content="${escapeForAttribute(after)}"`) : whole));
  }).join('');
}

function translateData(block, dictionary) {
  let out = block;
  for (const [english, translated] of Object.entries(dictionary.data ?? {})) {
    out = out.replaceAll(english, translated);
  }
  return out;
}

// Links between the versions, for search engines.
function languageLinks(released, page = '') {
  const links = [`<link rel="alternate" hreflang="en" href="${SITE}${page}" />`];
  for (const lang of released) links.push(`<link rel="alternate" hreflang="${lang}" href="${SITE}${lang}/${page}" />`);
  links.push(`<link rel="alternate" hreflang="x-default" href="${SITE}${page}" />`);
  return links.join('\n');
}

// A visible switcher at the foot of the page. Picking a language saves it, so it also
// carries into the app, and it stops `/` sending this person anywhere else.
function switcher(current, released, page = '') {
  const options = [['en', 'English', `/${page}`], ...released.map((l) => [l, LANDING_LANGUAGES[l].name, `/${l}/${page}`])];
  const links = options.map(([lang, name, href]) => (
    lang === current
      ? `<span aria-current="true">${name}</span>`
      : `<a href="${href}" hreflang="${lang}" lang="${lang}" data-language-choice="${lang}">${name}</a>`
  )).join(' ');
  return `<nav class="foot__links" style="margin-top:12px">${links}</nav>
<script>document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('[data-language-choice]');if(!a)return;try{localStorage.setItem('obertura.language',a.getAttribute('data-language-choice'))}catch(_){}});</script>`;
}

// A pill pinned to the bottom-left corner, as on connectart.se (Marçal, 2026-11-05): short
// names on a phone, full names on a computer, in a fixed order, and only the languages you
// could change to: the one you're reading isn't a choice. On a phone it rises above the
// sticky "Try it" bar when that slides in.
const RAIL_ORDER = ['ca', 'es', 'en', 'sv'];
const RAIL_STYLE = `<style>
.lang-rail { position: fixed; z-index: 45; display: flex; gap: 2px; padding: 4px;
  left: calc(12px + env(safe-area-inset-left, 0px)); bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  background: var(--bg-card); border: 1px solid var(--hairline); border-radius: 999px;
  box-shadow: 0 4px 16px rgba(28, 22, 16, .14); transition: transform 240ms ease-out; }
.lang-rail a { display: block; min-width: 40px; padding: 9px 10px; border-radius: 999px; text-align: center;
  font: 700 12px/1 var(--font-display, system-ui, sans-serif); letter-spacing: .03em; color: var(--text-muted, inherit); text-decoration: none; }
.lang-rail a:hover { color: var(--accent); background: var(--hairline); }
.lang-rail a:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.lang-rail__long { display: none; }
@media (prefers-reduced-motion: reduce) { .lang-rail { transition: none; } }
@media (max-width: 899px) { html:has(.cta-bar.show) .lang-rail { transform: translateY(calc(-1 * var(--cta-bar-height, 76px))); } }
@media (min-width: 900px) {
  .lang-rail { left: 16px; bottom: 16px; }
  .lang-rail a { padding: 10px 14px; font-size: 14px; letter-spacing: 0; }
  .lang-rail__short { display: none; }
  .lang-rail__long { display: inline; }
}
</style>`;

function languageRail(current, languages) {
  const paths = { en: '/', ...Object.fromEntries(languages.map((l) => [l, `/${l}/`])) };
  const names = { en: 'English', ...Object.fromEntries(languages.map((l) => [l, LANDING_LANGUAGES[l].name])) };
  const links = RAIL_ORDER
    .filter((lang) => lang !== current && paths[lang])
    .map((lang) => `<a href="${paths[lang]}" hreflang="${lang}" lang="${lang}" aria-label="${names[lang]}" data-language-choice="${lang}"><span class="lang-rail__short">${lang.toUpperCase()}</span><span class="lang-rail__long">${names[lang]}</span></a>`)
    .join('');
  // The sticky bar's real height, so the pill clears it exactly.
  return `<nav class="lang-rail" aria-label="Language">${links}</nav>
<script>(function(){var b=document.querySelector('.cta-bar');if(!b)return;function h(){document.documentElement.style.setProperty('--cta-bar-height',b.offsetHeight+'px')}h();addEventListener('resize',h)})();document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('[data-language-choice]');if(!a)return;try{localStorage.setItem('obertura.language',a.getAttribute('data-language-choice'))}catch(_){}});</script>`;
}

// A language page sends people to the app in that language, unless they already chose one.
function carryLanguageIntoApp(lang) {
  return `<script>document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href^="/app/"]');if(!a)return;try{if(!localStorage.getItem('obertura.language'))localStorage.setItem('obertura.language','${lang}')}catch(_){}});</script>`;
}

// Only `/` redirects, and never someone with a saved choice, so every version stays
// reachable at its own address. The same rule as the app: src/language-choice.ts.
function redirectFromRoot(released, redirects) {
  return `<script>(function(){try{if(localStorage.getItem('obertura.language')||location.search.indexOf('lang=')>=0)return;var r=${JSON.stringify(released)},x=${JSON.stringify(redirects)},t=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language||''],m=String(t[0]||'').toLowerCase();if(x[m]&&r.indexOf(x[m])>=0){location.replace('/'+x[m]+'/');return}for(var i=0;i<t.length;i++){var c=String(t[i]).toLowerCase().split('-')[0];if(c==='en')return;if(r.indexOf(c)>=0){location.replace('/'+c+'/');return}}}catch(_){}})();</script>`;
}

/** One more address per released language. With none released, the file stays as it is. */
export function buildSitemap(xml, released) {
  const urls = released.map((lang) => `  <url>\n    <loc>${SITE}${lang}/</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.9</priority>\n  </url>\n`).join('');
  return xml.replace('</urlset>', `${urls}</urlset>`);
}

/** The English page at `/`, with the language links added once a language is released. */
export function buildRootPage(html, released, redirects) {
  if (released.length === 0) return html;
  return html
    .replace('</head>', `${languageLinks(released)}\n${redirectFromRoot(released, redirects)}\n${RAIL_STYLE}\n</head>`)
    .replace(/<\/body>/, `${languageRail('en', released)}\n</body>`);
}

/** The English privacy or terms page, with the language links added once a language is released. */
export function buildEnglishLegalPage(html, page, released) {
  if (released.length === 0) return html;
  return html
    .replace('</head>', `${languageLinks(released, page)}\n</head>`)
    .replace('</footer>', `${switcher('en', released, page)}\n</footer>`);
}

function translated(html, lang, dictionary) {
  let page = html;
  for (const [english, words] of Object.entries(dictionary.blocks ?? {})) {
    // Anchored to the whole element, so a short sentence can't land inside a longer one.
    page = page.replaceAll(`>${english}</`, `>${words}</`);
  }
  return regions(page).map((part) => {
    if (part.kind === 'markup') return translateMarkup(part.text, dictionary, lang);
    if (part.kind === 'script') return translateScript(part.text, dictionary, lang);
    if (part.kind === 'data') return translateData(part.text, dictionary);
    return part.text;
  }).join('');
}

/** One language's landing page, built from the English page and its dictionary. */
export function buildLanguagePage(html, lang, dictionary, released) {
  const languages = released.includes(lang) ? released : [...released, lang];
  return fromSubfolder(translated(html, lang, dictionary))
    .replace(/<html lang="[^"]*"/, `<html lang="${lang}"`)
    .replace('<link rel="canonical" href="https://bitochess.com/" />', `<link rel="canonical" href="${SITE}${lang}/" />`)
    .replace('<meta property="og:url" content="https://bitochess.com/" />', `<meta property="og:url" content="${SITE}${lang}/" />`)
    .replace('<meta property="og:locale" content="en_GB" />', `<meta property="og:locale" content="${LANDING_LANGUAGES[lang].locale}" />`)
    .replace('</head>', `${languageLinks(languages)}\n${RAIL_STYLE}\n</head>`)
    .replace(/<\/body>/, `${languageRail(lang, languages)}\n${carryLanguageIntoApp(lang)}\n</body>`);
}

/**
 * One language's privacy or terms page. A notice under the title says the English governs,
 * and links to it.
 */
export function buildLegalPage(html, page, lang, dictionary, released) {
  const languages = released.includes(lang) ? released : [...released, lang];
  const notice = dictionary.notice.replace('{english}', `/${page}`);
  return fromSubfolder(translated(html, lang, dictionary))
    .replace(/<html lang="[^"]*"/, `<html lang="${lang}"`)
    .replace(`<link rel="canonical" href="${SITE}${page}" />`, `<link rel="canonical" href="${SITE}${lang}/${page}" />`)
    .replace('</head>', `${languageLinks(languages, page)}\n</head>`)
    .replace(/(<p class="doc__meta">[\s\S]*?<\/p>)/, `$1\n  <p class="doc__meta" data-translation-notice>${notice}</p>`)
    .replace('</footer>', `${switcher(lang, languages, page)}\n</footer>`)
    .replace(/<\/body>/, `${carryLanguageIntoApp(lang)}\n</body>`);
}
