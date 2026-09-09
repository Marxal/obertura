// The context under a solved position — the two small rows that sit below the
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
// game — the rating gap, the slide into the mistake, how often this opening has
// caught you — lives one tap away in the full-story sheet (full-story.ts). Two
// rows is the whole budget: past that, the context stops being read at all.
//
// Rows only render when they have something true to say. A game with no clock
// trail has no clock row; a position your repertoire has never seen has no
// repertoire row; a 'steady' clock says nothing at all.

import { Icons } from './icons';
import { formatMove } from './notation';
import { TIME_TAG_LABEL, formatTimeFacts, type TimeTag } from './clock';
import {
  spotFacts, repertoireLinkAt, type RepertoireLink, type SpotTone,
} from './spot-facts';
import type { ImportedGame } from './import-core';

// Which move's steel blue, darkened: its own #5c8bb0 measures about 3:1 as
// text on the app's cream, and this row is 11px text that has to clear 4.5:1.
const RUSHED_BLUE = '#3f6f92';

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
  const lead = opts.withOpponent ? `vs ${game.opponent} · ${facts.when} · ` : `${facts.when} · `;
  line.appendChild(document.createTextNode(lead));

  const cost = document.createElement('span');
  cost.className = `sc-cost sc-cost--${facts.result}`;
  cost.textContent = facts.costLine;
  line.appendChild(cost);
  return line;
}

/**
 * The clock row and the repertoire row, in one block to append under the
 * comparison. Empty (and so invisible) when the game has neither to offer.
 *
 * The repertoire answer needs the position index, so it arrives late and is
 * appended when it does — the row simply is not there until then, which is
 * better than a placeholder that resolves into a different height.
 */
export function buildContextStrip(
  game: ImportedGame, ply: number, onOpenLine?: (lineName: string) => void,
): HTMLElement {
  const strip = document.createElement('div');
  strip.className = 'sc-strip';

  const facts = spotFacts(game, ply);
  if (facts.time && facts.time.tag !== 'steady') {
    strip.appendChild(clockRow(facts.time.tag, formatTimeFacts(facts.time)));
  }

  // Late, and only if there is something to say.
  void repertoireLinkAt(game, ply).then((link) => {
    if (!link || !strip.isConnected) return;
    strip.appendChild(repertoireRow(link, onOpenLine));
  }).catch(() => { /* the repertoire is a bonus here, not a dependency */ });

  return strip;
}

function clockRow(tag: Exclude<TimeTag, 'steady'>, readout: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'sc-row';

  const chip = document.createElement('span');
  chip.className = 'sc-tag';
  chip.style.setProperty('--sc-tint', TAG_TINT[tag]);
  chip.appendChild(TAG_ICON[tag](13));
  chip.appendChild(document.createTextNode(TIME_TAG_LABEL[tag]));
  row.appendChild(chip);

  const nums = document.createElement('span');
  nums.className = 'sc-nums';
  nums.textContent = readout;
  row.appendChild(nums);
  return row;
}

function repertoireRow(
  link: RepertoireLink, onOpenLine?: (lineName: string) => void,
): HTMLElement {
  const text = link.kind === 'covered'
    ? `Your ${link.lineName} plays ${formatMove(link.san ?? '')} here`
    : `${link.movesPast} move${link.movesPast === 1 ? '' : 's'} past your ${link.lineName}`;

  const row = document.createElement(onOpenLine ? 'button' : 'div');
  row.className = 'sc-book';
  if (onOpenLine) {
    (row as HTMLButtonElement).type = 'button';
    row.addEventListener('click', () => onOpenLine(link.lineName));
  }
  row.appendChild(Icons.book(14));

  const label = document.createElement('span');
  label.className = 'sc-book-text';
  label.textContent = text;
  row.appendChild(label);

  if (onOpenLine) row.appendChild(Icons.chevronRight(14));
  return row;
}
