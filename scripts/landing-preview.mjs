// `npm run copy`: the copy editor at /copy/, and the landing and legal pages in every
// language, built fresh on each request. Change a sentence, reload the page: no build.
// Prices and the founding counter need the live server, so they show their defaults.
// The editor saves only from this computer: the phone can look, not write.

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';
import { exec } from 'node:child_process';
import { buildLanguagePage, buildLegalPage, buildRootPage, LANDING_LANGUAGES } from './landing-pages.mjs';
import { copySections, saveEdit } from './copy-editor.mjs';

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
  const match = path.match(/^\/(ca|es|sv)\/(index\.html|privacy\.html|terms\.html|licences\.html)?$/);
  if (!match) return null;
  const [, lang, file = 'index.html'] = match;
  if (file === 'index.html') return buildLanguagePage(read('docs/index.html'), lang, words('landing', lang), LANGUAGES);
  return buildLegalPage(read(`docs/${file}`), file, lang, words('legal', lang), LANGUAGES);
}

const isThisComputer = (request) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)
  && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(request.headers.host ?? '');

function reply(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

function saveFrom(request, response) {
  // The JSON content type also keeps other websites from posting here.
  if (!isThisComputer(request) || !(request.headers['content-type'] ?? '').startsWith('application/json')) {
    reply(response, 403, { error: 'Saving only works on the computer, at localhost.' });
    return;
  }
  let body = '';
  request.on('data', (chunk) => { body += chunk; });
  request.on('end', () => {
    try {
      const error = saveEdit(JSON.parse(body));
      reply(response, error ? 400 : 200, error ? { error } : { ok: true });
    } catch (error) {
      reply(response, 500, { error: `Couldn’t save: ${error.message}` });
    }
  });
}

createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const path = decodeURIComponent(url.pathname);
  if (path === '/copy/save' && request.method === 'POST') { saveFrom(request, response); return; }
  if (path === '/copy/data') {
    try {
      reply(response, 200, copySections(url.searchParams.get('lang') ?? 'ca'));
    } catch (error) {
      reply(response, 500, { error: error.message });
    }
    return;
  }
  if (path === '/copy' || path === '/copy/') {
    response.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' });
    response.end(read('scripts/copy-editor.html'));
    return;
  }
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
}).on('error', (error) => {
  // Already running, most likely: just open it.
  if (error.code === 'EADDRINUSE' && process.argv.includes('--open')) {
    exec(`open http://localhost:${PORT}/copy/`);
    return;
  }
  throw error;
}).listen(PORT, () => {
  const addresses = Object.values(networkInterfaces()).flat().filter((a) => a?.family === 'IPv4' && !a.internal);
  console.log(`The editor: http://localhost:${PORT}/copy/`);
  for (const a of addresses) console.log(`On your phone (same Wi-Fi): http://${a.address}:${PORT}/ca/`);
  if (process.argv.includes('--open')) exec(`open http://localhost:${PORT}/copy/`);
});
