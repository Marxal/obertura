// The fake language, `xx`: English with accents, about 40% longer, in [brackets].
//
// It exists to find problems before anything is translated. Text without brackets
// hasn't gone through t(). A missing closing bracket means the end was cut off. The
// extra length has no extra spaces, as with Swedish compounds, so it stresses
// layouts harder than a real translation does.

import type { Dictionary, Message } from '../i18n';

const ACCENTS: Record<string, string> = {
  a: 'à', e: 'é', i: 'í', o: 'ö', u: 'ü', c: 'ç', n: 'ñ', y: 'ÿ', l: 'ĺ', s: 'š',
  A: 'Å', E: 'É', I: 'Í', O: 'Ö', U: 'Ü', C: 'Ç', N: 'Ñ', S: 'Š',
};
const FILLER = 'åäöéçñ';

// Placeholders, markup and entities pass through untouched.
const UNTOUCHED = /(\{\w+\}|<[^>]+>|&[a-z#0-9]+;)/gi;

function longer(word: string): string {
  const accented = [...word].map((ch) => ACCENTS[ch] ?? ch).join('');
  const extra = word.length < 2 ? 0 : Math.max(1, Math.round(word.length * 0.4));
  let tail = '';
  for (let i = 0; i < extra; i++) tail += FILLER[(word.length + i) % FILLER.length];
  return accented + tail;
}

export function pseudoText(text: string): string {
  const body = text
    .split(UNTOUCHED)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/[A-Za-z’']+/g, longer)))
    .join('');
  return `[${body}]`;
}

function pseudoMessage(message: Message): Message {
  if (typeof message === 'string') return pseudoText(message);
  return Object.fromEntries(Object.entries(message).map(([form, text]) => [form, pseudoText(text)]));
}

export function pseudoDictionary(source: Readonly<Dictionary>): Dictionary {
  return Object.fromEntries(Object.entries(source).map(([key, message]) => [key, pseudoMessage(message)]));
}
