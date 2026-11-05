// `npm run landing:preview`: the landing and legal pages in every language, built fresh on
// each request. Edit src/locales/landing/ca.json, save, reload the page on the phone: no
// build. Prices and the founding counter need the live server, so they show their defaults.

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';
import { buildLanguagePage, buildLegalPage, buildRootPage, LANDING_LANGUAGES } from './landing-pages.mjs';

const PORT = Number(process.env.PORT ?? 4190);
const ROOT = new URL('..', import.meta.url).pathname;
const LANGUAGES = Object.keys(LANDING_LANGUAGES);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json', '.xml': 'text/xml',
};

const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const words = (folder, lang) => JSON.parse(read(`src/locales/${folder}/${lang}.json`));

function page(path) {
  if (path === '/') return buildRootPage(read('docs/index.html'), LANGUAGES, {});
  const match = path.match(/^\/(ca|es|sv)\/(index\.html|privacy\.html|terms\.html)?$/);
  if (!match) return null;
  const [, lang, file = 'index.html'] = match;
  if (file === 'index.html') return buildLanguagePage(read('docs/index.html'), lang, words('landing', lang), LANGUAGES);
  return buildLegalPage(read(`docs/${file}`), file, lang, words('legal', lang), LANGUAGES);
}

createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  let html;
  try {
    html = page(path);
  } catch (error) {
    // A slip in the file, such as a missing quote or comma. Say so on the phone.
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`Something in the translation file needs fixing:\n\n${error.message}\n`);
    return;
  }
  if (html) {
    response.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' });
    response.end(html);
    return;
  }
  const file = join(ROOT, 'docs', normalize(path));
  if (file.startsWith(join(ROOT, 'docs')) && existsSync(file) && statSync(file).isFile()) {
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    response.end(readFileSync(file));
    return;
  }
  response.writeHead(404);
  response.end('Not here. Prices and the app need the live site.\n');
}).listen(PORT, () => {
  const addresses = Object.values(networkInterfaces()).flat().filter((a) => a?.family === 'IPv4' && !a.internal);
  for (const a of addresses) console.log(`On your phone (same Wi-Fi): http://${a.address}:${PORT}/ca/`);
  console.log(`On this computer: http://localhost:${PORT}/ca/`);
});
