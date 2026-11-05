// How much English is left in the code. Run with: npm run i18n:scan
//
// Reads every source file with TypeScript's own parser and counts the strings a
// person would read, so TRANSLATION-PLAN.md's numbers can be refreshed and each
// round's progress measured. It is an estimate, and a slightly high one: it can't
// tell a sentence from a long CSS class with spaces, only filter the obvious ones.
//
// `--list` prints every string with its file, to see what the count is counting.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');
const listing = process.argv.includes('--list');

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'locales' ? [] : sourceFiles(path);
    if (!name.endsWith('.ts') || name.endsWith('.d.ts') || name.includes('.selftest.')) return [];
    return [path];
  });
}

// Property and call names whose string values are code, never reading text.
const CODE_PROPERTIES = new Set([
  'className', 'id', 'type', 'name', 'key', 'value', 'src', 'href', 'rel', 'target', 'role',
  'cssText', 'd', 'viewBox', 'fill', 'stroke', 'color', 'event', 'kind', 'mode', 'view', 'sub',
]);
const CODE_CALLS = new Set([
  'querySelector', 'querySelectorAll', 'getElementById', 'createElement', 'createElementNS',
  'addEventListener', 'removeEventListener', 'dispatchEvent', 'getItem', 'setItem', 'removeItem',
  'setAttribute', 'getAttribute', 'removeAttribute', 'toggleAttribute', 'hasAttribute', 'closest', 'matches',
  'matchMedia', 'getComputedStyle', 'setProperty', 'getPropertyValue', 'add', 'remove', 'toggle', 'contains',
  'fetch', 'import', 'require', 'log', 'warn', 'error', 'info', 'debug', 'postMessage', 'startsWith', 'endsWith',
  'includes', 'split', 'replace', 'replaceAll', 'join', 'indexOf', 'padStart', 'padEnd', 'Error', 'TypeError', 'select',
]);

const stripMarkup = (text) => text
  .replace(/<svg[\s\S]*?<\/svg>/g, ' ')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&[a-z#0-9]+;/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** Does this look like something a person reads, rather than an identifier? */
function isReadable(raw) {
  const text = stripMarkup(raw);
  if (!/[A-Za-z]{2}/.test(text)) return false;
  if (/^[pnbrqkPNBRQK1-8]+\/.*\//.test(text)) return false; // a position
  if (/^(https?:|\/|\.|#|data:|mailto:|--|@media)/.test(text)) return false;
  if (/[{};]\s*$|:\s*[^ ]+;/.test(text)) return false; // CSS
  if (/^[a-z0-9_.:\-/]+$/.test(text)) return false; // an identifier, key or path
  if (/^[a-z][a-z0-9-]*( [a-z][a-z0-9_-]*-[a-z0-9_-]*)+$/.test(text)) return false; // CSS class lists
  if (/^[A-Z0-9_]+$/.test(text)) return false; // CONSTANTS
  if (/^(?:[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|O-O(?:-O)?)$/.test(text)) return false; // a chess move
  // One lowercase word is almost always a state name or a class. Real one-word
  // labels start with a capital ("Settings"), which is how this file tells them apart.
  if (!/\s/.test(text) && !/^[A-Z]/.test(text)) return false;
  return true;
}

function isCodePosition(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent)) return true;
  if (ts.isLiteralTypeNode(parent)) return true;
  if (ts.isCaseClause(parent)) return true;
  if (ts.isElementAccessExpression(parent)) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name) && CODE_PROPERTIES.has(parent.name.text)) return true;
  if (ts.isBinaryExpression(parent)) {
    const comparing = [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken];
    if (comparing.includes(parent.operatorToken.kind)) return true;
    if (parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(parent.left)
      && CODE_PROPERTIES.has(parent.left.name.text)) return true;
  }
  if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
    const callee = parent.expression;
    const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : '';
    if (CODE_CALLS.has(name)) return true;
    if (name === 't') return true; // already translated: its argument is a key
  }
  return false;
}

const strings = [];
let interpolated = 0;
let plurals = 0;
const filesWithText = new Set();

for (const path of sourceFiles(SRC)) {
  const code = readFileSync(path, 'utf8');
  const file = relative(ROOT, path);
  const source = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true);
  // Hand-written plurals: n === 1 ? '' : 's' and its relatives.
  plurals += (code.match(/===\s*1\s*\?\s*(''|""|``|'[^']{0,12}'|"[^"]{0,12}")\s*:/g) ?? []).length;

  const visit = (node) => {
    if (ts.isStringLiteralLike(node) && !ts.isTemplateExpression(node.parent)) {
      if (!isCodePosition(node) && isReadable(node.text)) {
        strings.push({ file, text: stripMarkup(node.text) });
        filesWithText.add(file);
      }
    } else if (ts.isTemplateExpression(node)) {
      const raw = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' ');
      if (!isCodePosition(node) && isReadable(raw)) {
        strings.push({ file, text: stripMarkup(raw) });
        filesWithText.add(file);
        interpolated += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function countOf(pattern, files) {
  return files.reduce((sum, name) => {
    const path = join(ROOT, name);
    return sum + (readFileSync(path, 'utf8').match(pattern) ?? []).length;
  }, 0);
}

// Words in a data file, skipping the fields that hold moves or codes rather than prose.
const NOT_PROSE = new Set(['id', 'colour', 'level', 'style', 'source', 'category', 'fen', 'youPlay', 'sans', 'ucis']);
function wordsInJson(file) {
  const walk = (value) => {
    if (typeof value === 'string') return value.split(/\s+/).filter(Boolean).length;
    if (Array.isArray(value)) return value.reduce((sum, item) => sum + walk(item), 0);
    if (value && typeof value === 'object') {
      return Object.entries(value).reduce((sum, [key, item]) => sum + (NOT_PROSE.has(key) ? 0 : walk(item)), 0);
    }
    return 0;
  };
  return walk(JSON.parse(readFileSync(join(ROOT, file), 'utf8')));
}

// The sentences written directly into index.html: text between tags, and the labels
// on icon buttons. Anything already marked data-i18n has been moved to a key.
function staticPageStrings() {
  const body = readFileSync(join(ROOT, 'index.html'), 'utf8')
    .replace(/^[\s\S]*?<body>/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/<[^>]*data-i18n="[^"]*"[^>]*>[^<]*/g, '');
  const between = [...body.matchAll(/>([^<]+)</g)].map((m) => m[1].trim());
  const labels = [...body.matchAll(/\b(?:aria-label|title|placeholder)="([^"]+)"/g)].map((m) => m[1].trim());
  return [...between, ...labels].filter(isReadable);
}

for (const text of staticPageStrings()) strings.push({ file: 'index.html', text });
filesWithText.add('index.html');

if (listing) {
  for (const { file, text } of strings) console.log(`${file}\t${text}`);
} else {
  const words = strings.reduce((sum, { text }) => sum + text.split(/\s+/).length, 0);
  const css = ['src/style.css', 'src/desktop.css'];
  const toLocale = sourceFiles(SRC).map((path) => relative(ROOT, path));
  const distinct = new Set(strings.map(({ text }) => text)).size;
  const done = Object.keys(JSON.parse(readFileSync(join(ROOT, 'src/locales/en.json'), 'utf8'))).length;
  console.log(`App text:            ${strings.length} strings (${distinct} different), ${words} words, in ${filesWithText.size} files`);
  console.log(`Moved to keys:       ${done}`);
  console.log(`Inserted values:     ${interpolated} strings`);
  console.log(`Hand-written plurals: ${plurals}`);
  console.log(`Dates and numbers:   ${countOf(/\.toLocale\w*\(|\bIntl\.\w+/g, toLocale)} toLocale/Intl uses`);
  console.log(`CSS:                 ${countOf(/white-space:\s*nowrap/g, css)} no-wrap rules, ${countOf(/text-overflow:\s*ellipsis/g, css)} "…" rules, ${countOf(/overflow-wrap|word-break|hyphens/g, css)} wrap rules`);
  console.log(`Starter pack notes:  ${wordsInJson('src/starter-packs.json')} words`);
  console.log(`Traps:               ${wordsInJson('src/traps.json')} words`);
}
