// The context under a solved position — the one row that sits below the
// red/green comparison in every "from your games" exercise, and the one line
// that replaces the brief above the board once the answer is in.
//
// WHY THE TOP LINE IS REPLACED RATHER THAN ADDED TO. Before you answer, the
// text above the board says what you did: "You played ♛xe8 ?? here and
// blundered." After you answer, the red box says exactly that, in more detail,
// with a number. Leaving both on screen spends a line of a phone's height
// saying one thing twice — so the brief steps aside and the game's context
// (when it was, what it cost) takes its slot. Nothing grows; the same pixels
// carry a different fact at a different moment.
//
// WHAT IS DELIBERATELY NOT HERE. Every other lesson we could draw out of a
// game — the rating gap, the slide into the mistake, whether your own
// repertoire already answers it, how often this opening has caught you — now
// lives one scroll away in full-story.ts's buildStoryContent, which every
// caller of buildContextStrip renders directly underneath it. This strip used
// to also carry the repertoire link, back when reaching it took a tap into a
// sheet; once both live on the same page one scroll apart, showing it twice
// was just noise, so it only carries the clock now.
//
// The clock row only renders when it has something true to say — a game with
// no clock trail, or a 'steady' clock, leaves this whole strip empty.

import { Icons } from './icons';
import { TIME_TAG_LABEL, formatTimeFacts, type TimeFacts, type TimeTag } from './clock';
import { spotFacts, type SpotTone } from './spot-facts';
import type { ImportedGame } from './import-core';
import { t, tParts } from './i18n';

// Which move's steel blue, darkened: its own #5c8bb0 measures about 3:1 as
// text on the app's cream, and this row is 11px text that has to clear 4.5:1.
const RUSHED_BLUE = '#3f6f92';

const RESULT_PILL: Record<ImportedGame['result'], string> = { win: t('showcase.won'), loss: t('showcase.lost'), draw: t('story.drawn') };

// The tag's tint. These are the app's own status colours, used for what they
// already mean everywhere else: red is trouble, amber is a warning, sage is
// fine. 'rushed' borrows Which move's steel blue because it is NOT a warning —
// it is a different kind of observation, and colouring it amber would say the
// clock was the problem when the clock was fine.

const TAG_TINT: Record<Exclude<TimeTag, 'steady'>, string> = {
  scramble: 'var(--danger)',
  low: 'var(--warn)',
  long: 'var(--accent-active)',
  rushed: RUSHED_BLUE,
  good: 'var(--success-active)',
};

const TAG_ICON: Record<Exclude<TimeTag, 'steady'>, (s?: number) => SVGElement> = {
  scramble: (s = 13) => Icons.alert(s),
  low: (s = 13) => Icons.clock(s),
  long: (s = 13) => Icons.clock(s),
  rushed: (s = 13) => Icons.zap(s),
  good: (s = 13) => Icons.clock(s),
};

/**
 * "3 days ago · you lost this one", with the result word carrying its own
 * colour — red for a loss, sage for a win. The colour is the point: it turns
 * the line into something you read at a glance rather than a sentence you have
 * to finish.
 *
 * Returns null when the game carries no date, which would leave half a line.
 */
export function buildContextLine(
  game: ImportedGame, ply: number,
  opts: { withOpponent?: boolean; tone?: SpotTone } = {},
): HTMLElement | null {
  const facts = spotFacts(game, ply, opts.tone);
  if (!facts.when) return null;

  const line = document.createElement('div');
  line.className = 'sc-line';
  // Which move hides who you were playing until the answer is in — the
  // opponent is part of the answer there, so the line carries it. The other
  // exercises name the opponent above the board throughout and don't.
  const lead = opts.withOpponent ? `${t('mid.vsName', { name: game.opponent })} · ${facts.when} · ` : `${facts.when} · `;
  line.appendChild(document.createTextNode(lead));

  const cost = document.createElement('span');
  cost.className = `sc-cost sc-cost--${facts.result}`;
  cost.textContent = RESULT_PILL[facts.result];
  line.appendChild(cost);
  return line;
}

/** "This game" and its result as a pill, where the date is already on screen. */
export function buildResultLine(game: ImportedGame): HTMLElement {
  const line = document.createElement('div');
  line.className = 'sc-line';
  const pill = document.createElement('span');
  pill.className = `sc-cost sc-cost--${game.result}`;
  pill.textContent = RESULT_PILL[game.result];
  line.append(...tParts('mid.thisGame', { result: pill }));
  return line;
}

/**
 * The clock at this move, readable at a glance: a bar of the whole clock, filled to
 * what was left, with what this move cost marked at its end. The tag names anything
 * worth naming. Sits straight under the comparison so a phone shows it without
 * scrolling. Empty when the game has no clock trail, as for correspondence.
 */
export function buildContextStrip(game: ImportedGame, ply: number): HTMLElement {
  const strip = document.createElement('div');
  strip.className = 'sc-strip';

  const time = spotFacts(game, ply).time;
  if (time) strip.appendChild(clockRow(time));

  return strip;
}

function clockRow(time: TimeFacts): HTMLElement {
  const row = document.createElement('div');
  row.className = 'sc-row';
  const tag = time.tag;
  if (tag !== 'steady') row.style.setProperty('--sc-tint', TAG_TINT[tag]);

  const head = document.createElement('div');
  head.className = 'sc-clock-head';
  if (tag !== 'steady') {
    const chip = document.createElement('span');
    chip.className = 'sc-tag';
    chip.appendChild(TAG_ICON[tag](13));
    chip.appendChild(document.createTextNode(TIME_TAG_LABEL[tag]));
    head.appendChild(chip);
  }
  const nums = document.createElement('span');
  nums.className = 'sc-nums';
  nums.textContent = formatTimeFacts(time);
  head.appendChild(nums);

  // An increment can lift the clock past its base, so the scale is whichever is bigger.
  const scale = Math.max(1, time.baseSec, time.leftSec + (time.spentSec ?? 0));
  const bar = document.createElement('div');
  bar.className = 'sc-clock-bar';
  bar.setAttribute('aria-hidden', 'true');
  const left = document.createElement('span');
  left.className = 'sc-clock-left';
  left.style.width = `${(100 * time.leftSec) / scale}%`;
  const spent = document.createElement('span');
  spent.className = 'sc-clock-spent';
  spent.style.width = `${(100 * (time.spentSec ?? 0)) / scale}%`;
  bar.append(left, spent);

  row.append(head, bar);
  return row;
}
