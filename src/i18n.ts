// t(): every sentence the app shows, in the language the app is running in.
//
// English is bundled and is the source. Any other language is loaded before the
// app starts (boot.ts, language.ts), so t() can stay synchronous and work in a
// module-level constant. Anything a language lacks shows in English, key by key,
// so a half-translated language is still usable and new features can ship in
// English. The plan behind all this is TRANSLATION-PLAN.md.
//
// Keys are checked at compile time against en.json: a typo fails the build.
// Whole sentences only. Never build one from translated fragments, because word
// order differs between languages. Put the value in the sentence as {name}.

import en from './locales/en.json';

export type MessageKey = keyof typeof en;

/** A sentence, or a sentence per plural form (`one`, `other`, and whatever else a language uses). */
export type Message = string | { [form: string]: string };
export type Dictionary = Record<string, Message>;
export type Params = Record<string, string | number>;

const english: Dictionary = en;
let active: Dictionary = english;
let plurals = new Intl.PluralRules('en');
let numbers = new Intl.NumberFormat();
let ordinals = new Intl.PluralRules('en', { type: 'ordinal' });
let locale: string | undefined;

/** Switch what t() reads from. `rulesFor` is the language whose plural rules apply. */
export function useDictionary(dictionary: Dictionary, rulesFor: string): void {
  active = dictionary;
  plurals = new Intl.PluralRules(rulesFor);
  ordinals = new Intl.PluralRules(rulesFor, { type: 'ordinal' });
  // In English, dates and numbers keep following the device: 4 November in Britain,
  // November 4 in the US. Any other language brings its own way of writing them.
  locale = rulesFor === 'en' ? undefined : rulesFor;
  numbers = new Intl.NumberFormat(locale);
}

/** What to hand toLocaleDateString and friends. */
export function appLocale(): string | undefined {
  return locale;
}

/** 21st, 2n, 3:e: `n` written as an ordinal, by the language's own ordinal rules. */
export function tOrdinal(key: MessageKey, n: number): string {
  const message = active[key] ?? english[key];
  const text = typeof message === 'string' ? message : message[ordinals.select(n)] ?? message.other;
  return fill(text, { n });
}

/**
 * A sentence with something other than text in it, such as a chip inside a line.
 * Returns the pieces in the language's own order, ready for `el.append(...)`:
 * "You played {move} here" with `{ move: chip }` gives ['You played ', chip, ' here'].
 */
export function tParts<T>(key: MessageKey, parts: Record<string, T>, params?: Params): (string | T)[] {
  return t(key, params).split(/(\{\w+\})/)
    .map((piece) => {
      const name = /^\{(\w+)\}$/.exec(piece)?.[1];
      return name && Object.prototype.hasOwnProperty.call(parts, name) ? parts[name] : piece;
    })
    .filter((piece) => piece !== '');
}

/** A large number the way the app's language writes it: 1,234 or 1.234. */
export function formatNumber(n: number): string {
  return numbers.format(n);
}

export const englishDictionary: Readonly<Dictionary> = english;

function fill(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

function resolve(message: Message | undefined, count: unknown): string | undefined {
  if (message === undefined || typeof message === 'string') return message;
  const form = typeof count === 'number' ? plurals.select(count) : 'other';
  return message[form] ?? message.other;
}

/** The sentence for `key`. `{ n }` also chooses the plural form when the message has one. */
export function t(key: MessageKey, params?: Params): string {
  const text = resolve(active[key], params?.n) ?? resolve(english[key], params?.n) ?? '';
  return fill(text, params);
}
