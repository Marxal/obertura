// The translated starter pack notes and traps: complete, and with the chess intact.
// Every move and square a note names has to survive translation, so a slip of the
// hand can't teach someone the wrong move. No DOM, no storage.

import packsJson from './starter-packs.json' with { type: 'json' };
import trapsJson from './traps.json' with { type: 'json' };
import ca from './locales/content/ca.json' with { type: 'json' };
import es from './locales/content/es.json' with { type: 'json' };
import sv from './locales/content/sv.json' with { type: 'json' };
import endgamesJson from './endgames.json' with { type: 'json' };
import { allEndgames } from './endgame-catalog';
import { englishDictionary, useDictionary, type Dictionary } from './i18n';
import { formatMove, formatMovesInText, formatSanLine, movesToSymbols } from './notation';
import { translatePacks, translateTraps, type ContentWords } from './content-language';
import type { Pack } from './onboarding-starter';
import type { TrapPack } from './traps';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const packs = packsJson as unknown as Pack[];
const traps = trapsJson as unknown as TrapPack[];

// Moves, squares and move numbers ("5…Nxd5", "b4-b5", "O-O-O"), order ignored.
const CHESS = /(?<![A-Za-zÀ-ÿ0-9])(O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|\d+(?=\.|…))/g;
const chessIn = (text = ''): string => [...text.matchAll(CHESS)].map((m) => m[1]).sort().join(' ');

function sameChess(english: string | undefined, translated: string | undefined): boolean {
  return chessIn(english) === chessIn(translated);
}

export function runContentLanguageSelfTest(): TestResult[] {
  const out: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    out.push({ name, pass, detail });
  };

  for (const [lang, words] of [['ca', ca], ['es', es], ['sv', sv]] as [string, ContentWords][]) {
    const missing: string[] = [];
    const wrongChess: string[] = [];
    let texts = 0;
    const compare = (where: string, english: string | undefined, translated: string | undefined): void => {
      if (!english) return;
      texts++;
      if (!translated?.trim()) { missing.push(where); return; }
      if (!sameChess(english, translated)) wrongChess.push(where);
    };

    for (const pack of packs) {
      const w = words.packs?.[pack.id];
      compare(`${pack.id} title`, pack.title, w?.title);
      compare(`${pack.id} blurb`, pack.blurb, w?.blurb);
      for (const line of pack.lines) {
        const l = w?.lines?.[line.name];
        compare(`${line.name} name`, line.name, l?.name);
        compare(`${line.name} plan`, line.plan, l?.plan);
        for (const [ply, note] of Object.entries(line.notes ?? {})) compare(`${line.name} @${ply}`, note, l?.notes?.[ply]);
        for (const ply of Object.keys(l?.notes ?? {})) {
          if (!line.notes?.[ply]) wrongChess.push(`${line.name} @${ply} has no English note`);
        }
      }
    }
    for (const group of traps) {
      const w = words.traps?.[group.id];
      compare(`${group.id} title`, group.title, w?.title);
      compare(`${group.id} blurb`, group.blurb, w?.blurb);
      for (const trap of group.traps) {
        const x = w?.traps?.[trap.name];
        compare(`${trap.name} name`, trap.name, x?.name);
        compare(`${trap.name} bait`, trap.bait, x?.bait);
        compare(`${trap.name} idea`, trap.idea, x?.idea);
      }
    }
    check(`${lang}: every note, plan and trap is translated (${texts})`, missing.length === 0, missing.slice(0, 5).join('; '));
    check(`${lang}: the moves and squares match the English`, wrongChess.length === 0, wrongChess.slice(0, 5).join('; '));

    // A trap's name also tells traps apart when the lists are merged.
    const names = translateTraps(traps, words.traps).flatMap((g) => g.traps.map((t) => t.name));
    check(`${lang}: trap names stay different from each other`, new Set(names).size === names.length);

    const translated = translatePacks(packs, words.packs);
    check(`${lang}: translating leaves the moves and the filters alone`,
      translated.every((p, i) => p.level === packs[i].level && p.style === packs[i].style
        && p.lines.every((l, j) => l.ucis === packs[i].lines[j].ucis && l.sans === packs[i].lines[j].sans)));
    const groups = translateTraps(traps, words.traps);
    check(`${lang}: translating leaves a trap's family, level and moves alone`,
      groups.every((g, i) => g.traps.every((t, j) => {
        const e = traps[i].traps[j];
        return t.family === e.family && t.level === e.level && t.ucis === e.ucis;
      })));
  }

  // ── Falling back to English, one piece at a time ───────────────────────────
  const line = packs[0].lines[0];
  const firstPly = Object.keys(line.notes ?? {})[0];
  const partial = translatePacks(packs, {
    [packs[0].id]: { lines: { [line.name]: { notes: { [firstPly]: 'Hola' } } } },
  });
  const after = partial[0].lines[0];
  check('one translated note keeps the other notes in English',
    after.notes?.[firstPly] === 'Hola' && Object.keys(after.notes ?? {}).length === Object.keys(line.notes ?? {}).length
      && after.name === line.name && after.plan === line.plan);
  check('no words at all means the source, untouched', translatePacks(packs, undefined) === packs && translateTraps(traps, undefined) === traps);

  // ── Endgames: the words moved to the dictionary, the chess stayed ──────────
  const dictionary = englishDictionary as Record<string, unknown>;
  const rawEndgames = endgamesJson as { id: string }[];
  check('every endgame has its name and idea in the dictionary',
    rawEndgames.every((e) => dictionary[`endgame.${e.id}.name`] && dictionary[`endgame.${e.id}.idea`]));
  check('the catalogue shows those words', allEndgames().every((e) => !e.name.startsWith('endgame.') && !e.idea.startsWith('endgame.')));

  // ── Moves in sentences and in letters ──────────────────────────────────────
  const sentence = 'Prepares Nf3, then ...Bxf7+ and Nbd2–f1. Re1 or O-O, e8=Q+ wins. Not a word like Be or Nb.';
  check('a sentence takes symbols, and only its moves change',
    movesToSymbols(sentence) === 'Prepares ♞f3, then ...♝xf7+ and ♞bd2–f1. ♜e1 or O-O, e8=♛+ wins. Not a word like Be or Nb.',
    movesToSymbols(sentence));
  check('English letters stay as they are in letter notation', formatMovesInText(sentence, 'standard') === sentence);
  check('English figurines in a note by default', formatMovesInText('Play Nf3.', 'figurine') === 'Play ♞f3.');
  check('English letter notation is unchanged', formatMove('Nf3', 'standard') === 'Nf3' && formatSanLine(['e4', 'e5', 'Nf3'], 'standard') === '1.e4 e5 2.Nf3');

  const dictionary2 = englishDictionary as Dictionary;
  const letters: [string, string, string, string, string][] = [
    ['ca', 'Cf3', 'Axf7+', 'Td1', 'Dh5#'],
    ['es', 'Cf3', 'Axf7+', 'Td1', 'Dh5#'],
    ['sv', 'Sf3', 'Lxf7+', 'Td1', 'Dh5#'],
  ];
  for (const [lang, knight, bishop, rook, queen] of letters) {
    useDictionary(dictionary2, lang);
    check(`${lang}: letter notation uses its own letters`,
      formatMove('Nf3', 'standard') === knight && formatMove('Bxf7+', 'standard') === bishop
        && formatMove('Rd1', 'standard') === rook && formatMove('Qh5#', 'standard') === queen
        && formatMove('O-O', 'standard') === 'O-O' && formatMove('e4', 'standard') === 'e4');
    check(`${lang}: figurines are the same in every language`, formatMove('Nf3', 'figurine') === '♞f3');
    check(`${lang}: a translated note follows the setting`,
      formatMovesInText(movesToSymbols('Nf3 i Rd1'), 'figurine') === '♞f3 i ♜d1'
        && formatMovesInText(movesToSymbols('Nf3 i Rd1'), 'standard') === `${knight} i ${rook}`);
    check(`${lang}: a player's own letters are left alone`, formatMovesInText('Re2 és el rei', 'figurine') === 'Re2 és el rei');
    const translated = translatePacks(packs, { [packs[0].id]: { lines: { [packs[0].lines[0].name]: { plan: 'Amb Rd1' } } } });
    check(`${lang}: our own translated text arrives in symbols`, translated[0].lines[0].plan === 'Amb ♜d1');
  }
  useDictionary(dictionary2, 'ca');
  check('Catalan promotion uses Catalan letters', formatMove('e8=Q+', 'standard') === 'e8=D+');
  useDictionary(dictionary2, 'en');

  return out;
}
