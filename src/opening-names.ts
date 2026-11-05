// Opening names in the reader's language, for showing. The English name stays what the app
// stores and matches on (families, traps, puzzles, statistics), so nothing here can change
// what a game or a line counts as.
//
// There are 10,956 names, but nearly all of a name is surnames and moves, which stay as they
// are. So each language holds a short list (src/locales/openings/<lang>.json): whole names
// it knows, plus chess words, and the rules here put a name together from them. A word it
// doesn't know is taken to be a name and stays: "Bongcloud Attack" is "Atac Bongcloud".

import { formatMovesInText, movesToSymbols } from './notation';

export interface OpeningWords {
  /** Whole names, and the words used on their own: "Italian Game" is "Italiana". */
  names: Record<string, string>;
  /** The last word of a name, what the rest describes. [word, gender], or for Swedish [word, the word with its ending, gender]. */
  nouns: Record<string, string[]>;
  /** [masculine, feminine], or Swedish [common, neuter]. */
  adjectives: Record<string, string[]>;
  /** Words after the noun that don't agree with it: "Exchange" is "de canvis". */
  phrases: Record<string, string>;
  /** Swedish puts what describes a noun in front. */
  order?: 'before';
}

const IS_MOVE = /\d/;
const CONNECTORS = new Set(['with', 'without', 'and', 'or', 'vs']);
const FEMININE = 1;

// A move at the start stays as it is: "e5" must never become "E5".
const capital = (text: string): string => (text && !IS_MOVE.test(text.split(' ')[0]) ? text.charAt(0).toUpperCase() + text.slice(1) : text);
const possessive = (word: string): string => word.replace(/['’]s$/, '');

function describe(words: string[], gender: number, list: OpeningWords): { described: string[]; names: string[] } {
  const described: string[] = [];
  const names: string[] = [];
  for (const word of words) {
    const adjective = list.adjectives[word];
    if (adjective) described.push(adjective[gender] ?? adjective[0]);
    else if (list.phrases[word]) described.push(list.phrases[word]);
    else names.push(list.names[word] ?? possessive(word));
  }
  return { described, names };
}

function withNoun(rest: string[], noun: string[], list: OpeningWords): string {
  const before = list.order === 'before';
  const gender = noun[noun.length - 1] === 'f' || noun[noun.length - 1] === 'n' ? FEMININE : 0;
  const whole = list.phrases[rest.join(' ')] ?? (rest.length > 1 ? undefined : list.phrases[rest[0] ?? '']);
  if (!before) {
    if (whole) return `${noun[0]} ${whole}`;
    const { described, names } = describe(rest, gender, list);
    return [noun[0], ...names, ...described].join(' ');
  }
  // Swedish: "Najdorf-varianten", "Avbytesvarianten", "Klassisk variant".
  const definite = noun[1];
  if (whole) return whole.endsWith('~') ? `${whole.slice(0, -1)}${definite}` : `${whole} ${noun[0]}`;
  const { described, names } = describe(rest, gender, list);
  // "huvud~" joins the noun: "Klassisk huvudlinje".
  const joined = described.filter((d) => d.endsWith('~')).map((d) => d.slice(0, -1)).join('');
  const separate = described.filter((d) => !d.endsWith('~'));
  if (names.length === 0) return [...separate, `${joined}${noun[0]}`].join(' ');
  return [...separate, `${names.join(' ')}-${joined}${definite}`].join(' ');
}

function translatePhrase(phrase: string, list: OpeningWords): string {
  const known = list.names[phrase];
  if (known) return known;
  const words = phrase.split(' ');
  const last = words[words.length - 1];

  // "Evans Gambit Accepted", "Botvinnik System Reversed": the thing, then what happened to it.
  const after = list.adjectives[last];
  const before = words[words.length - 2];
  const main = words.slice(0, -1).join(' ');
  if (after && words.length > 1 && (list.nouns[before] || list.names[main])) {
    const noun = list.nouns[before];
    const gender = noun && (noun[noun.length - 1] === 'f' || noun[noun.length - 1] === 'n') ? FEMININE : 0;
    const translated = translatePhrase(main, list);
    return list.order === 'before' ? `${translated} (${after[gender]})` : `${translated} ${after[gender]}`;
  }

  const noun = list.nouns[last];
  // "Paulsen Attack Variation" is the Paulsen Attack: the last word adds nothing.
  if (noun && words.length > 1 && /^(Variation|Variations|Var|Line)$/.test(last) && list.nouns[before]) return translatePhrase(main, list);
  if (noun && words.length > 1) return withNoun(words.slice(0, -1), noun, list);
  if (noun) return noun[0];

  // No noun to hang it on: each word for itself, as the name of a variation.
  const { length } = words;
  return words.map((word) => {
    if (list.names[word]) return list.names[word];
    const adjective = list.adjectives[word];
    if (adjective) return adjective[FEMININE];
    if (length > 1 && list.phrases[word]) return list.phrases[word].replace(/~$/, '');
    return possessive(word);
  }).join(' ');
}

function translateSegment(segment: string, list: OpeningWords): string {
  const known = list.names[segment];
  if (known) return known;
  if (segment.endsWith(')') && !segment.includes('(')) return `${translateSegment(segment.slice(0, -1), list)})`;
  // Moves stay put. What's between them is what gets translated.
  const parts: string[] = [];
  let run: string[] = [];
  const flush = (): void => {
    if (run.length) parts.push(translatePhrase(run.join(' '), list));
    run = [];
  };
  for (const token of segment.split(' ').filter(Boolean)) {
    if (IS_MOVE.test(token)) {
      flush();
      parts.push(token);
    } else if (CONNECTORS.has(token)) {
      flush();
      parts.push(list.names[token] ?? token);
    } else {
      run.push(token);
    }
  }
  flush();
  return capital(parts.join(' '));
}

/** The name in another language's words. Moves are left as the English wrote them. */
export function translateOpeningName(name: string, list: OpeningWords): string {
  return name.split(/(: |, | - )/).map((part, i) => (i % 2 ? part : translateSegment(part.trim(), list))).join('');
}

let active: OpeningWords | null = null;
const memo = new Map<string, string>();

export function useOpeningWords(list: OpeningWords | null): void {
  active = list;
  memo.clear();
}

/** The name in the reader's language and move notation. */
export function openingLabel(name: string): string;
export function openingLabel(name: string | null | undefined): string | null | undefined;
export function openingLabel(name: string | null | undefined): string | null | undefined {
  if (!name) return name;
  if (!active) return formatMovesInText(name);
  let translated = memo.get(name);
  if (translated === undefined) {
    translated = movesToSymbols(translateOpeningName(name, active));
    memo.set(name, translated);
  }
  return formatMovesInText(translated);
}
