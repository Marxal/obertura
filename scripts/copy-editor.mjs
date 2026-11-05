// The copy editor at /copy/ (`npm run copy`): every translated sentence on one page, with
// the English beside it, saved back to the files as you type. It only exists in the local
// preview server: nothing here reaches a build. Same idea as marxal.net's /en/copy/.
//
// A save can only reach a sentence this file put on screen, so it can't touch code, and
// `checkEdit` refuses what would break the page or teach the wrong move. A translation is
// otherwise free to say something different from the English.
//
// The EN tab edits the English itself, with the Catalan beside it for reference. The
// translations stay as they are: `npm run i18n:status` then lists the sentences whose English
// changed, so each language gets a look. Names that translations are matched by (pack lines,
// traps), the legal pages and opening names aren't editable there.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { landingText, LANDING_KEEP, rewriteEnglish } from './landing-pages.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const json = (path) => JSON.parse(read(path));

export const COPY_LANGUAGES = ['ca', 'es', 'sv'];

const PLACEHOLDER = /\{\w+\}/g;
const TAG = /<[^>]+>/g;
const MOVE = /(?<![A-Za-zÀ-ÿ0-9])(O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)(?![A-Za-zÀ-ÿ0-9])/g;
const sorted = (text, pattern) => [...text.matchAll(pattern)].map((m) => m[1] ?? m[0]).sort();
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Code that happens to live in a translation file: not for editing here.
const isCode = (key) => /aria-label=|">$|^<span class=|^<small>|^<\/b>|^ (up|down)/.test(key);

// Tags a translation may add that the English doesn't have: bold, and a word in a move's colour.
const EXTRA_TAG = /^(<\/?(b|em|strong)>|<br ?\/?>|<span class="word-(blunder|mistake|brilliant)">|<\/span>)$/;

/** Why a sentence can't be saved, or null if it can. */
export function checkEdit(item, value, lang) {
  if (!value.trim()) return 'This can’t be empty. It would leave a gap on the page.';
  // Which tags, not how many: a language may bold two words where English bolds one.
  if (item.section !== 'app') {
    const wanted = new Set(sorted(item.en, TAG));
    const written = new Set(sorted(value, TAG));
    const lost = [...wanted].filter((t) => !written.has(t));
    const unknown = [...written].filter((t) => !wanted.has(t) && !EXTRA_TAG.test(t));
    if (lost.length || unknown.length) return `Keep the same tags as the English: ${[...wanted].join(' ') || 'none'}`;
  }
  // A plural may leave out its number: "L'altra" says one without needing the 1.
  const isPlural = item.path?.length === 2 && item.section === 'app';
  const wanted = sorted(item.en, PLACEHOLDER);
  const written = sorted(value, PLACEHOLDER);
  if (isPlural && lang !== 'en' ? !written.every((x) => wanted.includes(x)) : !same(wanted, written)) {
    return `Keep these as they are, each exactly once: ${wanted.join(' ') || 'none, so remove the {…}'}`;
  }
  if (item.section !== 'app' && item.section !== 'openings' && !same(sorted(item.en, MOVE), sorted(value, MOVE))) {
    return lang === 'en'
      ? `The moves have to stay the same, because every translation teaches them too: ${sorted(item.en, MOVE).join(' ') || 'none'}. Ask Claude to change moves.`
      : `The moves and squares have to match the English, written in English letters: ${sorted(item.en, MOVE).join(' ') || 'none'}`;
  }
  return null;
}

const row = (section, path, en, value, context) => ({ section, path, en, value, context });

function landing(lang) {
  const file = `src/locales/landing/${lang}.json`;
  const words = json(file);
  const html = read('docs/index.html');
  const order = landingText(html);
  const text = order.texts.filter((k) => words.text[k] !== undefined).map((k) => row('landing', ['text', k], k, words.text[k]));
  const blocks = Object.keys(words.blocks).map((k) => row('landing', ['blocks', k], k, words.blocks[k]));
  const scripts = order.scripts.filter((k) => words.scripts[k] !== undefined && !isCode(k)).map((k) => row('landing', ['scripts', k], k, words.scripts[k]));
  return { file, groups: [
    { title: 'Page text', items: [...blocks, ...text] },
    { title: 'Boards and exercises', items: scripts },
  ] };
}

function legal(lang) {
  const file = `src/locales/legal/${lang}.json`;
  const words = json(file);
  const seen = new Set();
  const groups = [];
  for (const [title, page] of [['Terms', 'docs/terms.html'], ['Privacy', 'docs/privacy.html'], ['Licences', 'docs/licences.html']]) {
    const html = read(page);
    const found = [];
    for (const part of ['blocks', 'text']) {
      for (const [k, v] of Object.entries(words[part])) {
        const at = html.indexOf(k);
        if (at < 0 || seen.has(k)) continue;
        seen.add(k);
        found.push({ at, item: row('legal', [part, k], k, v) });
      }
    }
    groups.push({ title, items: found.sort((a, b) => a.at - b.at).map((x) => x.item) });
  }
  groups[0].items.unshift(row('legal', ['notice'], 'This translation is for convenience. If there is any difference, the {english} applies.', words.notice.replace(/<a href="\{english\}">[^<]*<\/a>/, '{english}')));
  return { file, groups };
}

function app(lang) {
  const file = `src/locales/${lang}.json`;
  const en = json('src/locales/en.json');
  const words = json(file);
  const groups = new Map();
  for (const [key, english] of Object.entries(en)) {
    const prefix = key.split('.')[0];
    if (!groups.has(prefix)) groups.set(prefix, []);
    if (typeof english === 'string') {
      groups.get(prefix).push(row('app', [key], english, words[key] ?? ''));
    } else {
      for (const form of Object.keys(words[key] ?? english)) {
        const shown = english[form] ?? english.other;
        groups.get(prefix).push(row('app', [key, form], shown, words[key]?.[form] ?? '', `${form === 'one' ? 'Singular' : form === 'other' ? 'Plural' : form}`));
      }
    }
  }
  return { file, groups: [...groups].map(([title, items]) => ({ title, items })) };
}

function packs(lang) {
  const file = `src/locales/content/${lang}.json`;
  const words = json(file);
  const source = json('src/starter-packs.json');
  const traps = json('src/traps.json');
  const groups = source.map((pack) => {
    const w = words.packs[pack.id];
    const items = [
      row('packs', ['packs', pack.id, 'title'], pack.title, w.title, 'Pack title'),
      row('packs', ['packs', pack.id, 'blurb'], pack.blurb, w.blurb, 'Pack description'),
    ];
    for (const line of pack.lines) {
      const l = w.lines[line.name];
      if (!l) continue; // new in English: `npm run i18n:status` lists it
      const prefix = ['packs', pack.id, 'lines', line.name];
      items.push(row('packs', [...prefix, 'name'], line.name, l.name, 'Line name'));
      if (line.plan) items.push(row('packs', [...prefix, 'plan'], line.plan, l.plan, `${line.name} · plan`));
      for (const [ply, note] of Object.entries(line.notes ?? {})) {
        const n = Number(ply);
        const move = `${Math.floor(n / 2) + 1}${n % 2 ? '…' : '.'}${line.sans[n]}`;
        items.push(row('packs', [...prefix, 'notes', ply], note, l.notes[ply], `${line.name} · ${move}`));
      }
    }
    return { title: pack.title, items };
  });
  for (const group of traps) {
    const w = words.traps[group.id];
    const items = [
      row('packs', ['traps', group.id, 'title'], group.title, w.title, 'Group title'),
      row('packs', ['traps', group.id, 'blurb'], group.blurb, w.blurb, 'Group description'),
    ];
    for (const trap of group.traps) {
      const x = w.traps[trap.name];
      if (!x) continue;
      const prefix = ['traps', group.id, 'traps', trap.name];
      items.push(row('packs', [...prefix, 'name'], trap.name, x.name, 'Trap name'));
      items.push(row('packs', [...prefix, 'bait'], trap.bait, x.bait, `${trap.name} · the bait`));
      items.push(row('packs', [...prefix, 'idea'], trap.idea, x.idea, `${trap.name} · the idea`));
    }
    groups.push({ title: group.title, items });
  }
  return { file, groups };
}

// Opening names are built from these words by src/opening-names.ts. The moves check doesn't
// apply: there are none here, and the left side is the English word, not a sentence.
function openings(lang) {
  const file = `src/locales/openings/${lang}.json`;
  const words = json(file);
  const names = Object.entries(words.names).map(([k, v]) => row('openings', ['names', k], k, v));
  const nouns = Object.entries(words.nouns).map(([k, v]) => row('openings', ['nouns', k, '0'], k, v[0]));
  const adjectives = Object.entries(words.adjectives).flatMap(([k, v]) => v.map((form, i) => row('openings', ['adjectives', k, String(i)], k, form, lang === 'sv' ? (i ? 'Neuter' : 'Common') : (i ? 'Feminine' : 'Masculine'))));
  const phrases = Object.entries(words.phrases).map(([k, v]) => row('openings', ['phrases', k], k, v));
  return { file, groups: [
    { title: 'Whole names', items: names },
    { title: 'Attack, Defense, Variation…', items: nouns },
    { title: 'Classical, Modern, Open…', items: adjectives },
    { title: 'Exchange, Advance, Two Knights…', items: phrases },
  ] };
}

// ── The English itself ──────────────────────────────────────────────────────
// Each row shows the Catalan on the left (`ref`) and checks against the English as it is now.
const withRef = (item, ref) => ({ ...item, ref: ref ?? '' });

function englishLanding() {
  const html = read('docs/index.html');
  const ca = json('src/locales/landing/ca.json');
  const order = landingText(html);
  const blockKeys = Object.keys(ca.blocks).filter((k) => html.includes(`>${k}</`));
  const insideBlock = (t) => blockKeys.some((k) => k.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').includes(t));
  const blocks = blockKeys.map((k) => withRef(row('landing', ['blocks', k], k, k), ca.blocks[k]));
  const text = order.texts.filter((k) => !insideBlock(k) && !LANDING_KEEP.test(k) && !/^\d+[.…]/.test(k))
    .map((k) => withRef(row('landing', ['text', k], k, k), ca.text[k]));
  const scripts = order.scripts.filter((k) => ca.scripts[k] !== undefined && !isCode(k))
    .map((k) => withRef(row('landing', ['scripts', k], k, k), ca.scripts[k]));
  return { groups: [
    { title: 'Page text', items: [...blocks, ...text] },
    { title: 'Boards and exercises', items: scripts },
  ] };
}

function englishApp() {
  const en = json('src/locales/en.json');
  const ca = json('src/locales/ca.json');
  const groups = new Map();
  for (const [key, english] of Object.entries(en)) {
    const prefix = key.split('.')[0];
    if (!groups.has(prefix)) groups.set(prefix, []);
    if (typeof english === 'string') {
      groups.get(prefix).push(withRef(row('app', [key], english, english), ca[key]));
    } else {
      for (const form of Object.keys(english)) {
        groups.get(prefix).push(withRef(row('app', [key, form], english[form], english[form], form === 'one' ? 'Singular' : 'Plural'), ca[key]?.[form] ?? ca[key]?.other));
      }
    }
  }
  return { groups: [...groups].map(([title, items]) => ({ title, items })) };
}

function englishPacks() {
  const ca = json('src/locales/content/ca.json');
  const source = json('src/starter-packs.json');
  const groups = source.map((pack, p) => {
    const w = ca.packs[pack.id];
    const items = [
      withRef(row('packs', ['pack', p, 'title'], pack.title, pack.title, 'Pack title'), w?.title),
      withRef(row('packs', ['pack', p, 'blurb'], pack.blurb, pack.blurb, 'Pack description'), w?.blurb),
    ];
    pack.lines.forEach((line, i) => {
      const l = w?.lines?.[line.name];
      if (line.plan) items.push(withRef(row('packs', ['pack', p, 'lines', i, 'plan'], line.plan, line.plan, `${line.name} · plan`), l?.plan));
      for (const [ply, note] of Object.entries(line.notes ?? {})) {
        const n = Number(ply);
        const move = `${Math.floor(n / 2) + 1}${n % 2 ? '…' : '.'}${line.sans[n]}`;
        items.push(withRef(row('packs', ['pack', p, 'lines', i, 'notes', ply], note, note, `${line.name} · ${move}`), l?.notes?.[ply]));
      }
    });
    return { title: pack.title, items };
  });
  json('src/traps.json').forEach((group, g) => {
    const w = ca.traps[group.id];
    const items = [
      withRef(row('packs', ['trap', g, 'title'], group.title, group.title, 'Group title'), w?.title),
      withRef(row('packs', ['trap', g, 'blurb'], group.blurb, group.blurb, 'Group description'), w?.blurb),
    ];
    group.traps.forEach((trap, t) => {
      const x = w?.traps?.[trap.name];
      items.push(withRef(row('packs', ['trap', g, 'traps', t, 'bait'], trap.bait, trap.bait, `${trap.name} · the bait`), x?.bait));
      items.push(withRef(row('packs', ['trap', g, 'traps', t, 'idea'], trap.idea, trap.idea, `${trap.name} · the idea`), x?.idea));
    });
    groups.push({ title: group.title, items });
  });
  return { groups };
}

const ENGLISH = {
  landing: { title: 'Landing page', build: englishLanding },
  app: { title: 'The app', build: englishApp },
  packs: { title: 'Starter packs and traps', build: englishPacks },
};

/** Save one English sentence, everywhere it lives. Returns an error message, or null. */
function saveEnglish(section, path, value) {
  const built = ENGLISH[section]?.build();
  const item = built?.groups.flatMap((g) => g.items).find((x) => JSON.stringify(x.path) === JSON.stringify(path));
  if (!item) return 'That isn’t a sentence this page knows.';
  const problem = checkEdit(item, value, 'en');
  if (problem) return problem;
  if (value === item.en) return null;

  if (section === 'app') {
    const file = 'src/locales/en.json';
    const text = read(file);
    let next;
    if (path.length === 2) {
      // English plurals sit over several lines, one form per line: change that one line.
      const lines = text.split('\n');
      const start = lines.indexOf(`  ${JSON.stringify(path[0])}: {`);
      const at = lines.findIndex((l, i) => i > start && l.startsWith(`    ${JSON.stringify(path[1])}: `));
      if (start < 0 || at < 0) return 'Couldn’t find that sentence in the file. Ask Claude.';
      const comma = lines[at].endsWith(',') ? ',' : '';
      lines[at] = `    ${JSON.stringify(path[1])}: ${JSON.stringify(value)}${comma}`;
      next = lines.join('\n');
    } else {
      next = replaceDictionaryLine(text, path[0], value);
    }
    if (JSON.parse(next)[path[0]] === undefined) return 'Couldn’t save that. Ask Claude.';
    writeFileSync(join(ROOT, file), next);
    return null;
  }
  if (section === 'packs') {
    const file = path[0] === 'pack' ? 'src/starter-packs.json' : 'src/traps.json';
    const text = read(file);
    const data = JSON.parse(text);
    let holder = data;
    for (const step of path.slice(1, -1)) holder = holder[step];
    holder[path[path.length - 1]] = value;
    writeFileSync(join(ROOT, file), JSON.stringify(data) + (text.endsWith('\n') ? '\n' : ''));
    return null;
  }
  // The landing page: the page itself, then every translation's key, so none is lost.
  const [part, before] = path;
  const html = read('docs/index.html');
  const next = rewriteEnglish(html, part, before, value);
  if (next === html) return 'Couldn’t find that sentence on the page. Ask Claude.';
  for (const lang of COPY_LANGUAGES) {
    const file = `src/locales/landing/${lang}.json`;
    const data = json(file);
    if (!data[part] || data[part][value] !== undefined || data[part][before] === undefined) continue;
    data[part] = Object.fromEntries(Object.entries(data[part]).map(([k, v]) => [k === before ? value : k, v]));
    writeFileSync(join(ROOT, file), `${JSON.stringify(data, null, 2)}\n`);
  }
  writeFileSync(join(ROOT, 'docs/index.html'), next);
  // The copy's source of truth, where the sentence is written the same way.
  const notes = read('docs/LANDING-COPY.md');
  if (notes.includes(before)) writeFileSync(join(ROOT, 'docs/LANDING-COPY.md'), notes.replaceAll(before, value));
  return null;
}

const SECTIONS = {
  landing: { title: 'Landing page', build: landing },
  legal: { title: 'Terms and privacy', build: legal },
  app: { title: 'The app', build: app },
  packs: { title: 'Starter packs and traps', build: packs },
  openings: { title: 'Opening names', build: openings },
};

export function copySections(lang) {
  if (lang === 'en') return Object.entries(ENGLISH).map(([id, s]) => ({ id, title: s.title, groups: s.build().groups }));
  return Object.entries(SECTIONS).map(([id, s]) => ({ id, title: s.title, groups: s.build(lang).groups }));
}

/** One line of a flat dictionary, so a copy edit is a one-line diff. */
export function replaceDictionaryLine(text, key, entry) {
  const prefix = `  ${JSON.stringify(key)}: `;
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.startsWith(prefix));
  if (at < 0) throw new Error(`No line for ${key}`);
  const comma = lines[at].endsWith(',') ? ',' : '';
  const value = typeof entry === 'string'
    ? JSON.stringify(entry)
    : `{${Object.entries(entry).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')}}`;
  lines[at] = `${prefix}${value}${comma}`;
  return lines.join('\n');
}

/** Save one sentence. Returns an error message, or null when it's saved. */
export function saveEdit({ lang, section, path, value }) {
  if (lang === 'en' && Array.isArray(path) && typeof value === 'string') return saveEnglish(section, path, value);
  if (!COPY_LANGUAGES.includes(lang) || !SECTIONS[section] || !Array.isArray(path) || typeof value !== 'string') return 'That isn’t a sentence this page knows.';
  const built = SECTIONS[section].build(lang);
  const item = built.groups.flatMap((g) => g.items).find((x) => JSON.stringify(x.path) === JSON.stringify(path));
  if (!item) return 'That isn’t a sentence this page knows.';
  const problem = checkEdit(item, value, lang);
  if (problem) return problem;

  const text = read(built.file);
  const data = JSON.parse(text);
  let holder = data;
  for (const step of path.slice(0, -1)) holder = holder[step];
  const last = path[path.length - 1];
  if (section === 'legal' && path[0] === 'notice') {
    const link = data.notice.match(/<a href="\{english\}">[^<]*<\/a>/)[0];
    holder[last] = value.replace('{english}', link);
  } else {
    holder[last] = value;
  }

  const next = section === 'app'
    ? replaceDictionaryLine(text, path[0], data[path[0]])
    : `${JSON.stringify(data, null, 2)}\n`;
  JSON.parse(next); // never write a file that doesn't parse
  writeFileSync(join(ROOT, built.file), next);
  return null;
}
