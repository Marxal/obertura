// `npm run i18n:status`: what's waiting to be translated, in every language. The check at
// the end of any round that touched text (the protocol is in CLAUDE.md).
//
//   npm run i18n:status          list what's missing, and what changed in English since it
//                                was last translated. Always exits 0: English is a fine
//                                fallback, so this informs and never blocks.
//   npm run i18n:status -- --done   after translating: remember today's English as the
//                                version the translations were made from.
//
// A key whose English changes keeps its old translation, which still reads fine and is now
// out of date. Nothing else can notice that, so src/locales/translated-from.json keeps a
// short fingerprint of the English each translation was made from. It never ships.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { landingText, LANDING_KEEP, LEGAL_KEEP } from './landing-pages.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const json = (path) => JSON.parse(read(path));
const LANGUAGES = ['ca', 'es', 'sv'];
const SNAPSHOT = 'src/locales/translated-from.json';
const fingerprint = (text) => createHash('sha1').update(text).digest('hex').slice(0, 8);

// Every English sentence with a stable address, for spotting one that changed.
function englishNow() {
  const out = {};
  const add = (address, text) => { if (text) out[address] = fingerprint(typeof text === 'string' ? text : JSON.stringify(text)); };
  for (const [key, text] of Object.entries(json('src/locales/en.json'))) add(`app|${key}`, text);
  for (const pack of json('src/starter-packs.json')) {
    add(`pack|${pack.id}|title`, pack.title);
    add(`pack|${pack.id}|blurb`, pack.blurb);
    for (const line of pack.lines) {
      add(`pack|${pack.id}|${line.name}|plan`, line.plan);
      for (const [ply, note] of Object.entries(line.notes ?? {})) add(`pack|${pack.id}|${line.name}|${ply}`, note);
    }
  }
  for (const group of json('src/traps.json')) {
    for (const trap of group.traps) {
      add(`trap|${group.id}|${trap.name}|bait`, trap.bait);
      add(`trap|${group.id}|${trap.name}|idea`, trap.idea);
    }
  }
  // Sentences the landing page's scripts put together: only new ones can be told from code.
  for (const text of landingText(read('docs/index.html')).scripts) add(`script|${text}`, text);
  return out;
}

if (process.argv.includes('--done')) {
  writeFileSync(join(ROOT, SNAPSHOT), `${JSON.stringify(englishNow(), null, 0).replace(/","/g, '",\n"')}\n`);
  console.log('Remembered today’s English as what the translations were made from.');
  process.exit(0);
}

function missing(lang) {
  const out = [];
  const en = json('src/locales/en.json');
  const dictionary = json(`src/locales/${lang}.json`);
  for (const [key, text] of Object.entries(en)) {
    if (dictionary[key] === undefined) out.push(['App', typeof text === 'string' ? text : text.other]);
  }
  const content = json(`src/locales/content/${lang}.json`);
  for (const pack of json('src/starter-packs.json')) {
    const words = content.packs?.[pack.id];
    if (!words) out.push(['Starter pack', pack.title]);
    for (const line of pack.lines) {
      const l = words?.lines?.[line.name];
      if (!l) { out.push(['Starter pack line', line.name]); continue; }
      if (line.plan && !l.plan) out.push(['Starter pack plan', line.plan]);
      for (const [ply, note] of Object.entries(line.notes ?? {})) if (!l.notes?.[ply]) out.push(['Starter pack note', note]);
    }
  }
  for (const group of json('src/traps.json')) {
    for (const trap of group.traps) if (!content.traps?.[group.id]?.traps?.[trap.name]) out.push(['Trap', trap.name]);
  }
  const landing = json(`src/locales/landing/${lang}.json`);
  for (const text of landingText(read('docs/index.html')).texts) {
    const inBlock = Object.keys(landing.blocks).some((k) => k.replace(/<[^>]+>/g, ' ').includes(text.replace(/^· /, '')));
    const isMove = /^\d+[.…]+\S+$/.test(text);
    if (landing.text[text] === undefined && !inBlock && !isMove && !LANDING_KEEP.test(text)) out.push(['Landing page', text]);
  }
  const legal = json(`src/locales/legal/${lang}.json`);
  for (const [title, file] of [['Terms', 'terms'], ['Privacy', 'privacy'], ['Licences', 'licences']]) {
    const html = read(`docs/${file}.html`);
    for (const text of landingText(html).texts) {
      const inBlock = Object.keys(legal.blocks).some((k) => k.replace(/<[^>]+>/g, ' ').includes(text));
      if (legal.text[text] === undefined && !inBlock && !LEGAL_KEEP.test(text)) out.push([title, text]);
    }
  }
  return out;
}

const before = existsSync(join(ROOT, SNAPSHOT)) ? json(SNAPSHOT) : null;
const now = englishNow();
const changed = before ? Object.keys(now).filter((k) => before[k] && before[k] !== now[k]) : [];
const newScripts = before ? Object.keys(now).filter((k) => k.startsWith('script|') && !before[k] && /[a-z]{2,} [a-z]{2,}/.test(k)) : [];

let waiting = 0;
for (const lang of LANGUAGES) {
  const list = missing(lang);
  waiting += list.length;
  if (list.length) {
    console.log(`\n${lang}: ${list.length} not translated`);
    for (const [where, text] of list.slice(0, 40)) console.log(`  ${where}: ${String(text).slice(0, 90)}`);
    if (list.length > 40) console.log(`  …and ${list.length - 40} more`);
  }
}
if (changed.length) {
  console.log(`\nEnglish changed since it was translated (${changed.length}), in every language:`);
  for (const k of changed.slice(0, 40)) console.log(`  ${k.replaceAll('|', ' · ').slice(0, 100)}`);
}
if (newScripts.length) {
  console.log(`\nNew in the landing page's scripts, if they're sentences (${newScripts.length}):`);
  for (const k of newScripts.slice(0, 20)) console.log(`  ${k.slice(7, 100)}`);
}
if (!waiting && !changed.length && !newScripts.length) console.log('Nothing waiting to be translated.');
